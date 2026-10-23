import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hookProblems, nginxLatest, nodeAdvice, syncRepoFiles, syncTargets, workflowProblems } from './runtime-sync.ts'

const SITES_YAML = readFileSync(new URL('../sites.yaml', import.meta.url), 'utf8')
const RUNTIME = { node: '24.22.1', nginx: '1.30.6' }

const BACKEND_DOCKERFILE = `# syntax=docker/dockerfile:1
ARG NODE_VERSION=22.17.0

FROM node:\${NODE_VERSION}-alpine AS base
WORKDIR /app

FROM base AS runner
CMD ["node", "dist/index.js"]
`

const FRONTEND_DOCKERFILE = `ARG NODE_VERSION=22.17.0
ARG NGINX_VERSION=1.27.5

FROM node:\${NODE_VERSION}-alpine AS build
FROM nginxinc/nginx-unprivileged:\${NGINX_VERSION}-alpine AS runner
`

const PACKAGE_JSON = `{
  "name": "dmb",
  "engines": {
    "node": "22.17.0"
  }
}
`

// A migrated repo, as the sync reads it.
function repo(overrides: Record<string, string> = {}) {
  return new Map(Object.entries({
    '.nvmrc': 'v22.17.0\n',
    'package.json': PACKAGE_JSON,
    'dmb/backend/Dockerfile': BACKEND_DOCKERFILE,
    'dmb/frontend/Dockerfile': FRONTEND_DOCKERFILE,
    '.github/workflows/ci.yaml': 'steps:\n  - uses: actions/setup-node@v7\n    with:\n      node-version-file: .nvmrc\n',
    ...overrides,
  }))
}

test('a migrated repo gets exactly the owned lines rewritten', () => {
  const { changed, problems } = syncRepoFiles(repo(), RUNTIME)
  assert.deepEqual(problems, [])
  assert.deepEqual([...changed.keys()].sort(), ['.nvmrc', 'dmb/backend/Dockerfile', 'dmb/frontend/Dockerfile', 'package.json'])
  assert.equal(changed.get('.nvmrc'), '24.22.1\n')
  assert.equal(changed.get('dmb/backend/Dockerfile'), BACKEND_DOCKERFILE.replace('22.17.0', '24.22.1'))
  assert.match(changed.get('dmb/frontend/Dockerfile')!, /^ARG NODE_VERSION=24\.22\.1\nARG NGINX_VERSION=1\.30\.6\n/)
  assert.equal(changed.get('package.json'), PACKAGE_JSON.replace('"22.17.0"', '"^24.22.1"'))
})

test('a repo already on the pins is left alone', () => {
  const first = syncRepoFiles(repo(), RUNTIME)
  const synced = new Map([...repo(), ...first.changed])
  assert.equal(syncRepoFiles(synced, RUNTIME).changed.size, 0)
})

test('a version named outside the owned lines is a problem, not a silent miss', () => {
  const { problems } = syncRepoFiles(repo({
    'ofuma/frontend/Dockerfile': 'FROM node:22.17.0-alpine AS build\nFROM nginx:alpine AS runner\n',
    'doca/api/Dockerfile': 'FROM base\nARG NODE_VERSION=24.22.1\nFROM node:${NODE_VERSION}-alpine\n',
  }), RUNTIME)
  assert.deepEqual(problems, [
    'ofuma/frontend/Dockerfile:1: FROM node:22.17.0-alpine — use node:${NODE_VERSION}-alpine',
    'ofuma/frontend/Dockerfile:2: FROM nginx:alpine — use <image>:${NGINX_VERSION}-alpine',
    'doca/api/Dockerfile: uses ${NODE_VERSION} but has no "ARG NODE_VERSION=" above its first FROM',
  ])
})

test('a workflow must take Node from .nvmrc', () => {
  assert.deepEqual(workflowProblems('.github/workflows/ci.yaml', 'with:\n  node-version: 22\n'), [
    '.github/workflows/ci.yaml:2: node-version: 22 — use node-version-file: .nvmrc',
  ])
  const { problems } = syncRepoFiles(repo({ 'package.json': '{ "name": "x" }\n' }), RUNTIME)
  assert.deepEqual(problems, ['package.json: no "engines": { "node": … } to keep in step'])
})

test('a git hook must take nvm\'s Node from .nvmrc', () => {
  assert.deepEqual(hookProblems('.husky/pre-commit', 'export PATH="$HOME/.nvm/versions/node/v22.17.0/bin:$PATH"\n'), [
    '.husky/pre-commit:1: export PATH="$HOME/.nvm/versions/node/v22.17.0/bin:$PATH" — read the version from .nvmrc',
  ])
  assert.deepEqual(hookProblems('.husky/pre-commit', 'export PATH="$HOME/.nvm/versions/node/v$(sed \'s/^v//\' .nvmrc)/bin:$PATH"\n'), [])
})

test('every repo and branch nagaya deploys from is synced, once', () => {
  assert.deepEqual(syncTargets(SITES_YAML), [
    { repo: 'thedumebi/dmb.futari', branch: 'master' },
    { repo: 'thedumebi/abm.futari', branch: 'master' },
    { repo: 'thedumebi/nihongo.futari', branch: 'master' },
    { repo: 'thedumebi/ofuma.ai', branch: 'master' },
    { repo: 'thedumebi/ofuma.ai', branch: 'stg' },
  ])
})

test('the deploy workflow templates take Node from .nvmrc too', () => {
  const dir = new URL('../templates/app-repo/', import.meta.url)
  for (const name of readdirSync(dir))
    assert.deepEqual(workflowProblems(name, readFileSync(new URL(name, dir), 'utf8')), [])
})

test('--latest flags a security release on the same major, and only that major', () => {
  const releases = [
    { version: 'v26.12.1', security: true },
    { version: 'v24.22.2', security: false },
    { version: 'v24.22.1', security: true },
    { version: 'v24.22.0', security: false },
  ]
  assert.deepEqual(nodeAdvice('24.22.1', releases), { latest: '24.22.2', security: false })
  assert.deepEqual(nodeAdvice('24.22.0', releases), { latest: '24.22.2', security: true })
  assert.deepEqual(nodeAdvice('24.22.2', releases), { latest: '24.22.2', security: false })
  assert.equal(nginxLatest('1.30.6', ['1.30.7-alpine', '1.30.8-alpine-slim', '1.31.0-alpine', '1.30.5-alpine']), '1.30.7')
})
