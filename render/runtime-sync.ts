// pnpm runtime-sync              push sites.yaml's runtime pins into every app repo
// pnpm runtime-sync --dry-run    show what would change; push nothing
// pnpm runtime-sync --check      exit 1 if any app repo differs from the pins
// pnpm runtime-sync --latest     exit 1 if a pinned image tag is missing, or a newer Node
//                               security release or nginx patch is out
//
// For each repo and branch nagaya deploys from (master; stg too for a site
// with staging), it clones, rewrites the lines it owns, and pushes one commit.
// The push is what rebuilds: the app's deploy workflow runs on it like on any
// other push. The lines it owns, and nothing else:
//
//   every Dockerfile    ARG NODE_VERSION=<node>   ARG NGINX_VERSION=<nginx>
//   .nvmrc              <node>
//   package.json        "engines": { "node": "^<node>" }
//
// Everything else must read those: `FROM node:${NODE_VERSION}-alpine`, the
// nginx runner `FROM …nginx…:${NGINX_VERSION}-alpine`, every setup-node in
// .github/workflows `node-version-file: .nvmrc`, and a git hook that puts
// nvm's Node on PATH `v$(sed 's/^v//' .nvmrc)`. A repo that names a
// version anywhere else is reported and left alone, never half-synced.
//
// Auth: NAGAYA_SYNC_TOKEN (CI), else `gh auth token` (the laptop).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel } from './index.ts'
import type { RuntimeConfig } from './types/index.ts'

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

// The branch each variant deploys from (the app repos' deploy workflows).
const BRANCHES = { prod: 'master', stg: 'stg' } as const

const COMMIT_AUTHOR = ['-c', 'user.name=nagaya runtime-sync', '-c', 'user.email=nagaya@futari.live']

export type Target = { repo: string, branch: string }

// One repo's files after the rewrite: the new contents of every file that
// changed, and every line that names a version the sync does not own.
export type RepoResult = { changed: Map<string, string>, problems: string[] }

// ─────────────── The rewrites: pure, text in → text out ───────────────

const FROM_LINE = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i
const NGINX_IMAGE = /(^|\/)nginx(-unprivileged)?(:|$)/

export function rewriteDockerfile(text: string, runtime: RuntimeConfig): string {
  return text
    .replace(/^ARG NODE_VERSION=.*$/m, `ARG NODE_VERSION=${runtime.node}`)
    .replace(/^ARG NGINX_VERSION=.*$/m, `ARG NGINX_VERSION=${runtime.nginx}`)
}

export function dockerfileProblems(path: string, text: string): string[] {
  const problems: string[] = []
  const lines = text.split('\n')
  const firstFrom = lines.findIndex(line => FROM_LINE.test(line))
  const globalArgs = lines.slice(0, firstFrom === -1 ? lines.length : firstFrom).join('\n')
  for (const [index, line] of lines.entries()) {
    const image = FROM_LINE.exec(line)?.[1]
    if (!image)
      continue
    const where = `${path}:${index + 1}`
    if (/^(docker\.io\/)?(library\/)?node(:|$)/.test(image) && !image.includes(':${NODE_VERSION}'))
      problems.push(`${where}: FROM ${image} — use node:\${NODE_VERSION}-alpine`)
    if (NGINX_IMAGE.test(image) && !image.includes(':${NGINX_VERSION}'))
      problems.push(`${where}: FROM ${image} — use <image>:\${NGINX_VERSION}-alpine`)
  }
  // An ARG after the first FROM is scoped to that stage: FROM lines can't see it.
  if (text.includes('${NODE_VERSION}') && !/^ARG NODE_VERSION=/m.test(globalArgs))
    problems.push(`${path}: uses \${NODE_VERSION} but has no "ARG NODE_VERSION=" above its first FROM`)
  if (text.includes('${NGINX_VERSION}') && !/^ARG NGINX_VERSION=/m.test(globalArgs))
    problems.push(`${path}: uses \${NGINX_VERSION} but has no "ARG NGINX_VERSION=" above its first FROM`)
  return problems
}

// Only the engines.node string changes, so the file's formatting survives.
export function rewritePackageJson(text: string, runtime: RuntimeConfig): string {
  return text.replace(/("engines"\s*:\s*\{[^}]*?"node"\s*:\s*")[^"]*(")/, `$1^${runtime.node}$2`)
}

export function packageJsonProblems(text: string): string[] {
  const engines = (JSON.parse(text) as { engines?: { node?: unknown } }).engines
  return typeof engines?.node === 'string' ? [] : ['package.json: no "engines": { "node": … } to keep in step']
}

export function workflowProblems(path: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) =>
    /^\s*node-version:\s*\S/.test(line)
      ? [`${path}:${index + 1}: ${line.trim()} — use node-version-file: .nvmrc`]
      : [])
}

// A hook that hard-codes nvm's path runs the old Node after every bump.
export function hookProblems(path: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) =>
    /versions\/node\/v\d/.test(line)
      ? [`${path}:${index + 1}: ${line.trim()} — read the version from .nvmrc`]
      : [])
}

function isDockerfile(path: string): boolean {
  const name = basename(path)
  return name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile')
}

// Every file the sync reads, as path → content, from a checkout's file list.
export function syncRepoFiles(files: Map<string, string>, runtime: RuntimeConfig): RepoResult {
  const changed = new Map<string, string>()
  const problems: string[] = []
  const update = (path: string, before: string | undefined, after: string) => {
    if (before !== after)
      changed.set(path, after)
  }
  for (const [path, text] of files) {
    if (isDockerfile(path)) {
      problems.push(...dockerfileProblems(path, text))
      update(path, text, rewriteDockerfile(text, runtime))
    }
    else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
      problems.push(...workflowProblems(path, text))
    }
    else if (/^\.husky\/[^/]+$/.test(path)) {
      problems.push(...hookProblems(path, text))
    }
  }
  update('.nvmrc', files.get('.nvmrc'), `${runtime.node}\n`)
  const packageJson = files.get('package.json')
  if (packageJson === undefined) {
    problems.push('package.json: missing at the repo root')
  }
  else {
    problems.push(...packageJsonProblems(packageJson))
    update('package.json', packageJson, rewritePackageJson(packageJson, runtime))
  }
  return { changed, problems }
}

// ─────────────── Which repos, which branches ───────────────

export function syncTargets(sitesYaml: string): Target[] {
  const seen = new Set<string>()
  const targets: Target[] = []
  for (const project of loadModel(sitesYaml).projects) {
    const target = { repo: project.repo, branch: BRANCHES[project.variant] }
    const key = `${target.repo}@${target.branch}`
    if (!seen.has(key)) {
      seen.add(key)
      targets.push(target)
    }
  }
  return targets
}

// ─────────────── Git ───────────────

function token(): string {
  const fromEnv = process.env.NAGAYA_SYNC_TOKEN
  if (fromEnv)
    return fromEnv
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  }
  catch {
    throw new Error('no NAGAYA_SYNC_TOKEN, and `gh auth token` failed: run `gh auth login`')
  }
}

// The token goes in as an HTTP header through git's env config, the way
// actions/checkout does it, so it is never in a URL, an argv or an error.
function gitEnv(secret: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${secret}`).toString('base64')}`,
  }
}

function git(cwd: string, env: NodeJS.ProcessEnv, args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readCheckout(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name).slice(dir.length + 1)
    if (!entry.isFile() || path.startsWith('.git/'))
      continue
    if (isDockerfile(path) || path.startsWith('.github/workflows/') || path.startsWith('.husky/') || path === '.nvmrc' || path === 'package.json')
      files.set(path, readFileSync(join(dir, path), 'utf8'))
  }
  return files
}

type Mode = 'sync' | 'dry-run' | 'check'
type Outcome = 'up to date' | 'pushed' | 'would push' | 'drifted' | 'problems'

// One clone, rewrite and push. Returns 'retry' when someone pushed first.
function syncOnce(target: Target, runtime: RuntimeConfig, mode: Mode, env: NodeJS.ProcessEnv, message: string): Outcome | 'retry' {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-sync-'))
  try {
    git(dir, env, ['clone', '--quiet', '--depth', '1', '--branch', target.branch, `https://github.com/${target.repo}.git`, '.'])
    const result = syncRepoFiles(readCheckout(dir), runtime)
    for (const problem of result.problems)
      console.error(`    ✗ ${problem}`)
    if (result.problems.length)
      return 'problems'
    if (!result.changed.size)
      return 'up to date'
    for (const [path, content] of result.changed)
      writeFileSync(join(dir, path), content)
    // --check runs in CI, whose logs are public (nagaya is a public repo):
    // paths only. The full diff is for --dry-run, on the laptop.
    if (mode === 'check') {
      for (const path of result.changed.keys())
        console.error(`    ✗ ${path}: differs from the pins`)
      return 'drifted'
    }
    if (mode === 'dry-run') {
      console.log(git(dir, env, ['--no-pager', 'diff', '--color=never']).replace(/^/gm, '    '))
      return 'would push'
    }
    git(dir, env, [...COMMIT_AUTHOR, 'commit', '--quiet', '--all', '--message', message])
    try {
      git(dir, env, ['push', '--quiet', 'origin', `HEAD:${target.branch}`])
    }
    catch (error) {
      if (/non-fast-forward|fetch first|rejected/.test(String((error as { stderr?: string }).stderr)))
        return 'retry'
      throw error
    }
    return 'pushed'
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─────────────── --latest: is the pin still the newest fix? ───────────────

type NodeRelease = { version: string, security: boolean }

function parts(version: string): number[] {
  return version.replace(/^v/, '').split('.').map(Number)
}

function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)]
  for (let index = 0; index < 3; index++) {
    if (x[index] !== y[index])
      return x[index]! > y[index]!
  }
  return false
}

// The newest Node on the pin's major, and whether any release after the pin is a security fix.
export function nodeAdvice(pin: string, releases: NodeRelease[]): { latest: string, security: boolean } {
  const major = parts(pin)[0]
  const later = releases.filter(release => parts(release.version)[0] === major && newer(release.version, pin))
  const latest = later.reduce((best, release) => newer(release.version, best) ? release.version.replace(/^v/, '') : best, pin)
  return { latest, security: later.some(release => release.security) }
}

// The newest patch on the pin's minor, from tags such as "1.30.6-alpine".
export function nginxLatest(pin: string, tags: string[]): string {
  const [major, minor] = parts(pin)
  return tags
    .map(tag => /^(\d+\.\d+\.\d+)-alpine$/.exec(tag)?.[1])
    .filter((version): version is string => !!version && parts(version)[0] === major && parts(version)[1] === minor)
    .reduce((best, version) => newer(version, best) ? version : best, pin)
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

// Both nginx images the apps use must have the tag before the pin can move.
const NGINX_REPOS = ['library/nginx', 'nginxinc/nginx-unprivileged']

// The pinned tags themselves, on every image an app builds FROM.
async function missingTags(runtime: RuntimeConfig): Promise<string[]> {
  const tags = [
    `library/node:${runtime.node}-alpine`,
    ...NGINX_REPOS.map(repo => `${repo}:${runtime.nginx}-alpine`),
  ]
  const found = await Promise.all(tags.map(async (tag) => {
    const [repo, name] = tag.split(':')
    const response = await fetch(`https://hub.docker.com/v2/repositories/${repo}/tags/${name}`)
    return response.ok
  }))
  return tags.filter((_, index) => !found[index])
}

async function latest(runtime: RuntimeConfig): Promise<boolean> {
  let stale = false
  for (const tag of await missingTags(runtime)) {
    console.log(`✗ ${tag} is not on Docker Hub: every build FROM it would fail`)
    stale = true
  }
  const releases = await fetchJson('https://nodejs.org/dist/index.json') as NodeRelease[]
  const node = nodeAdvice(runtime.node, releases)
  if (node.latest !== runtime.node) {
    console.log(`${node.security ? '✗' : '·'} Node ${node.latest} is out (pinned ${runtime.node})${node.security ? ', with security fixes' : ''}`)
    stale ||= node.security
  }
  else {
    console.log(`✓ Node ${runtime.node} is the newest ${parts(runtime.node)[0]}.x`)
  }
  const [major, minor] = parts(runtime.nginx)
  const perRepo = await Promise.all(NGINX_REPOS.map(async (repo) => {
    const page = await fetchJson(`https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&name=${major}.${minor}.`) as { results: { name: string }[] }
    return nginxLatest(runtime.nginx, page.results.map(result => result.name))
  }))
  const nginx = perRepo.reduce((lowest, version) => newer(lowest, version) ? version : lowest)
  if (nginx !== runtime.nginx) {
    console.log(`✗ nginx ${nginx} is out on both images (pinned ${runtime.nginx})`)
    stale = true
  }
  else {
    console.log(`✓ nginx ${runtime.nginx} is the newest ${major}.${minor}.x`)
  }
  return stale
}

// ─────────────── main ───────────────

async function main() {
  const flags = new Set(process.argv.slice(2))
  const sitesYaml = readFileSync(join(REPO_DIR, 'sites.yaml'), 'utf8')
  const { runtime } = loadModel(sitesYaml).registry

  if (flags.has('--latest')) {
    if (await latest(runtime))
      process.exit(1)
    return
  }

  const mode: Mode = flags.has('--check') ? 'check' : flags.has('--dry-run') ? 'dry-run' : 'sync'
  const env = gitEnv(token())
  const nagayaSha = process.env.GITHUB_SHA?.slice(0, 7)
    ?? (existsSync(join(REPO_DIR, '.git')) ? git(REPO_DIR, process.env, ['rev-parse', '--short', 'HEAD']).trim() : 'local')
  const message = `Node ${runtime.node}, nginx ${runtime.nginx} (from nagaya ${nagayaSha})\n\nWritten by nagaya's runtime-sync from sites.yaml → runtime. Change the\nversions there, not here: the next sync would put them back.`

  console.log(`${mode}: Node ${runtime.node}, nginx ${runtime.nginx}`)
  let failed = false
  for (const target of syncTargets(sitesYaml)) {
    console.log(`  ${target.repo}@${target.branch}`)
    let outcome = syncOnce(target, runtime, mode, env, message)
    if (outcome === 'retry')
      outcome = syncOnce(target, runtime, mode, env, message)
    if (outcome === 'retry')
      throw new Error(`${target.repo}@${target.branch}: rejected twice; someone is pushing, run it again`)
    console.log(`    → ${outcome}`)
    failed ||= outcome === 'problems' || outcome === 'drifted'
  }
  if (failed)
    process.exit(1)
}

// Only when run as a command, not when the tests import the rewrites.
if (import.meta.url === `file://${process.argv[1]}`)
  await main()
