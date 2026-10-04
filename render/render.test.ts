import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { RegistryError } from './errors.ts'
import { loadModel, renderAll } from './index.ts'
import { stagingLabel } from './model.ts'

const SITES_YAML = readFileSync(new URL('../sites.yaml', import.meta.url), 'utf8')
const CLOUDFLARE_RANGES = ['173.245.48.0/20', '2400:cb00::/32']

// Load sites.yaml after a small in-memory edit, to provoke one specific error.
function loadEdited(edit: (sitesYaml: string) => string) {
  return () => loadModel(edit(SITES_YAML))
}

test('the real sites.yaml renders', () => {
  const model = loadModel(SITES_YAML)
  const files = renderAll(model, CLOUDFLARE_RANGES)
  assert.ok(files.get('generated/caddy/Caddyfile')?.includes('dmb.futari.live {'))
  assert.deepEqual(model.projects.map(project => project.id), [
    'futari-dmb',
    'futari-abm',
    'futari-nihongo',
    'ofuma-main',
    'ofuma-main-stg',
    'ofuma-doca',
    'ofuma-doca-stg',
  ])
})

test('staging labels stay one level deep', () => {
  assert.equal(stagingLabel('@'), 'stg')
  assert.equal(stagingLabel('api-doca'), 'api-doca-stg')
})

test('staging copies get their own database, env file, key and hostnames', () => {
  const model = loadModel(SITES_YAML)
  const stagingProject = model.projects.find(project => project.id === 'ofuma-main-stg')!
  const backend = stagingProject.services.find(service => service.key === 'backend')!
  assert.equal(stagingProject.database?.name, 'ofuma_stg')
  assert.equal(backend.dotenvx?.path, '/app/.env.staging')
  assert.equal(backend.nodeEnv, 'staging')
  assert.match(backend.dotenvx!.keyFile, /ofuma-main-backend\.staging\.key$/)
  const stagingHosts = model.routes.filter(route => route.variant === 'stg').map(route => route.host)
  assert.deepEqual(stagingHosts, ['stg.ofuma.ai', 'api-stg.ofuma.ai', 'doca-stg.ofuma.ai', 'api-doca-stg.ofuma.ai'])
})

test('every container is told its environment, and only that', () => {
  const files = renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES)
  const stagingCompose = files.get('generated/compose/ofuma-main-stg.yml')!
  assert.match(stagingCompose, /frontend:[\s\S]*NODE_ENV: staging/)
  assert.doesNotMatch(stagingCompose, /OFUMA_/)
})

test('doca shares main\'s network, so it can reach http://backend:3004', () => {
  const model = loadModel(SITES_YAML)
  assert.equal(model.projects.find(project => project.id === 'ofuma-doca')!.network, 'ofuma-main')
  assert.equal(model.projects.find(project => project.id === 'ofuma-doca-stg')!.network, 'ofuma-main-stg')
})

test('every app with a database reads the same credential key names', () => {
  const model = loadModel(SITES_YAML)
  for (const project of model.projects.filter(project => project.database)) {
    const keys = project.services.find(service => service.credentials)!.credentials!
    assert.equal(keys.pgUser, 'PG_USERNAME')
    assert.equal(keys.pgDatabase, 'PG_DATABASE')
  }
})

test('A records are keyed by name, so a cutover updates in place', () => {
  const model = loadModel(SITES_YAML)
  const futariZone = model.zones.find(zone => zone.domain === 'futari.live')!
  assert.ok(futariZone.records.some(record => record.key === 'A dmb.futari.live'))
  // Namecheap's five eforward MX exist only while the zone's email is in
  // namecheap mode; under Cloudflare Email Routing its MX are Cloudflare's
  // own locked records, which Terraform never manages.
  const expectedMx = futariZone.email?.mode === 'namecheap' ? 5 : 0
  assert.equal(futariZone.records.filter(record => record.type === 'MX').length, expectedMx)
})

test('postgres is published on its own tunnel_port, and two cannot share one', () => {
  const coreCompose = renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES).get('generated/compose/core.yml')!
  assert.match(coreCompose, /127\.0\.0\.1:5432:5432/)
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace(
    '  redis:\n    redis-futari:',
    '    pg-second:\n      version: 18\n      shared_buffers: 64MB\n      max_connections: 10\n      tunnel_port: 5432\n      mem: 128m\n\n  redis:\n    redis-futari:',
  )), /tunnel_port 5432 is already used by pg-main/)
})

test('a typo in a key is an error, not silently ignored', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('        www: redirect', '        ww: redirect')), RegistryError)
})

test('a route to a service on the wrong port is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('dmb: frontend:8080', 'dmb: frontend:8081')), /listens on 8080/)
})

test('two containers claiming one alias on a network is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('aliases: [abm-backend]', 'aliases: [redis]')), /alias "redis"/)
})

test('pointing a site at an origin with no IP is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml
    .replace(/nagaya: +\{ ip: [^,]+,/, 'nagaya: { ip: null,')
    .replace('origin: hetzner-dmb', 'origin: nagaya')), /has no ip yet/)
})

test('switching email off namecheap with a placeholder inbox is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml
    .replace(/forward_to: \S+/g, 'forward_to: CHANGE_ME@gmail.com')
    .replace('mode: namecheap', 'mode: cloudflare')), /forward_to/)
})

test('email: a plain address uses forward_to, an object uses its own inbox', () => {
  const futariEmail = loadModel(SITES_YAML).zones.find(zone => zone.domain === 'futari.live')!.email!
  const inboxFor = Object.fromEntries(futariEmail.rules.map(rule => [rule.address, rule.to]))
  assert.equal(inboxFor['admissions@futari.live'], 'chiwuzohdaniel@gmail.com')
  assert.equal(inboxFor['abm@futari.live'], 'tamiloreallen@gmail.com')
  assert.equal(futariEmail.catchAllTo, 'chiwuzohdaniel@gmail.com')
})

test('email: catch_all can name its own inbox', () => {
  const model = loadModel(SITES_YAML.replace('catch_all: true', 'catch_all: other@example.com'))
  assert.equal(model.zones.find(zone => zone.domain === 'futari.live')!.email!.catchAllTo, 'other@example.com')
})

test('email: the same address listed twice is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('        - hello\n', '        - hello\n        - hello\n')), /listed twice/)
})

test('alerts.to may be one inbox or a list', () => {
  const planFor = (sitesYaml: string) => JSON.parse(renderAll(loadModel(sitesYaml), CLOUDFLARE_RANGES).get('generated/plan.json')!)
  assert.deepEqual(planFor(SITES_YAML).alerts.to, ['chiwuzohdaniel@gmail.com'])
  const twoInboxes = SITES_YAML.replace('  to: chiwuzohdaniel@gmail.com ', '  to: [chiwuzohdaniel@gmail.com, b@example.com] ')
  assert.deepEqual(planFor(twoInboxes).alerts.to, ['chiwuzohdaniel@gmail.com', 'b@example.com'])
})

test('a frontend starts after the backend its nginx proxies to', () => {
  const files = renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES)
  assert.match(files.get('generated/compose/futari-dmb.yml')!, /frontend:[\s\S]*depends_on:\n\s+- backend/)
  assert.match(files.get('generated/compose/ofuma-doca.yml')!, /doca-web:[\s\S]*depends_on:\n\s+- doca-api/)
})

test('depends_on must name another service of the same site', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('depends_on: [doca-api]', 'depends_on: [backend]')), /not another service of this site/)
})

test('redis runs the major version sites.yaml names', () => {
  assert.match(renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES).get('generated/compose/core.yml')!, /image: redis:8-alpine/)
})

test('plan.json keys are all camelCase', () => {
  const planText = renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES).get('generated/plan.json')!
  const snakeKeys = [...planText.matchAll(/"([a-z]+_[a-z0-9_]+)":/g)].map(found => found[1])
  assert.deepEqual(snakeKeys, [])
})

test('a cron id is <project>-<name>; two crons with one name in a site is an error', () => {
  const cronIds = loadModel(SITES_YAML).projects.flatMap(project => project.crons.map(cron => cron.id))
  assert.deepEqual(cronIds, ['futari-nihongo-reminders'])
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace(
    '        cron:\n          - name: reminders',
    '        cron:\n          - name: reminders\n            at: "0 * * * *"\n            service: backend\n            post: /other\n          - name: reminders',
  )), /two crons are named "reminders"/)
})

test('each alert check gets its own crontab line, on its own schedule', () => {
  const crontab = renderAll(loadModel(SITES_YAML), CLOUDFLARE_RANGES).get('generated/crontab')!
  assert.match(crontab, /^\*\/5 \* \* \* \* \/srv\/nagaya\/bin\/nagaya alerts memory /m)
  assert.match(crontab, /^7 6 \* \* \* \/srv\/nagaya\/bin\/nagaya alerts cloudflare-ranges /m)
  const hourly = loadModel(SITES_YAML.replace('every: "7 6 * * *"', 'every: "0 * * * *"'))
  assert.match(renderAll(hourly, CLOUDFLARE_RANGES).get('generated/crontab')!, /^0 \* \* \* \* \S+ alerts cloudflare-ranges /m)
})

test('an alert check nagaya has no code for is an error', () => {
  assert.throws(loadEdited(sitesYaml => sitesYaml.replace('    cloudflare-ranges:\n', '    restarts:\n')), RegistryError)
})
