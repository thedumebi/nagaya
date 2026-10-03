// pnpm render                    sites.yaml -> generated/
// pnpm render:check              exit 1 if generated/ is stale (CI runs this)
// pnpm render:refresh-cf-ips     re-fetch Cloudflare's IP ranges, then render

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { renderCaddyfile } from './caddy.ts'
import { renderCore, renderProject } from './compose.ts'
import { RegistryError } from './errors.ts'
import { buildModel } from './model.ts'
import { renderCrontab, renderFirewall, renderPlan, renderTfvars } from './outputs.ts'
import { registrySchema } from './types/index.ts'
import type { Model } from './types/index.ts'

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLOUDFLARE_RANGES_FILE = join(REPO_DIR, 'render/cloudflare-ips.json')
const CLOUDFLARE_RANGE_URLS = ['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6']

// sites.yaml text → validated, resolved model. Throws RegistryError listing
// every problem found, each with its location in the file.
export function loadModel(sitesYaml: string): Model {
  const parsed = registrySchema.safeParse(parse(sitesYaml))
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `  sites.yaml ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new RegistryError(`sites.yaml does not match the schema:\n${problems.join('\n')}`)
  }
  const model = buildModel(parsed.data)
  for (const database of model.databases) {
    if (!model.registry.backups.buckets[database.app])
      throw new RegistryError(`backups.buckets: no bucket for app "${database.app}" (database ${database.name})`)
  }
  return model
}

// Every generated file, as path → content. Touches no disk.
export function renderAll(model: Model, cloudflareRanges: string[]): Map<string, string> {
  const files = new Map<string, string>()
  files.set('generated/caddy/Caddyfile', renderCaddyfile(model, cloudflareRanges))
  files.set('generated/compose/core.yml', renderCore(model))
  for (const project of model.projects)
    files.set(`generated/compose/${project.id}.yml`, renderProject(project))
  files.set('generated/crontab', renderCrontab(model))
  files.set('generated/firewall.sh', renderFirewall(cloudflareRanges))
  files.set('generated/plan.json', renderPlan(model))
  files.set('terraform/generated.auto.tfvars.json', renderTfvars(model))
  return files
}

async function fetchCloudflareRanges(): Promise<string[]> {
  const ranges: string[] = []
  for (const url of CLOUDFLARE_RANGE_URLS) {
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`${url}: HTTP ${response.status}`)
    const lines = (await response.text()).split('\n').map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      if (!/^[0-9a-f:.]+\/\d{1,3}$/i.test(line))
        throw new Error(`${url}: unexpected line "${line}"`)
    }
    ranges.push(...lines)
  }
  if (ranges.length < 10)
    throw new Error(`only ${ranges.length} Cloudflare ranges; refusing to lock the firewall down to that`)
  return ranges
}

// Files under generated/compose that no project produces any more: a removed
// site. --check reports them; a normal render deletes them.
function staleComposeFiles(files: Map<string, string>): string[] {
  const composeDir = join(REPO_DIR, 'generated/compose')
  if (!existsSync(composeDir))
    return []
  return readdirSync(composeDir)
    .map(fileName => `generated/compose/${fileName}`)
    .filter(path => !files.has(path))
}

async function main() {
  const flags = new Set(process.argv.slice(2))
  if (flags.has('--refresh-cf-ips')) {
    const ranges = await fetchCloudflareRanges()
    writeFileSync(CLOUDFLARE_RANGES_FILE, `${JSON.stringify(ranges, null, 2)}\n`)
    console.log(`render/cloudflare-ips.json: ${ranges.length} ranges`)
  }
  const cloudflareRanges = JSON.parse(readFileSync(CLOUDFLARE_RANGES_FILE, 'utf8')) as string[]

  let model: Model
  try {
    model = loadModel(readFileSync(join(REPO_DIR, 'sites.yaml'), 'utf8'))
  }
  catch (error) {
    if (error instanceof RegistryError) {
      console.error(`✗ ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  const files = renderAll(model, cloudflareRanges)
  const stalePaths = staleComposeFiles(files)

  if (flags.has('--check')) {
    const outOfDate: string[] = []
    for (const [path, content] of files) {
      const absolutePath = join(REPO_DIR, path)
      if (!existsSync(absolutePath) || readFileSync(absolutePath, 'utf8') !== content)
        outOfDate.push(path)
    }
    outOfDate.push(...stalePaths.map(path => `${path} (no longer in sites.yaml)`))
    if (outOfDate.length) {
      console.error('✗ generated files are out of date. Run `pnpm render` and commit:')
      for (const path of outOfDate)
        console.error(`  ${path}`)
      process.exit(1)
    }
    console.log(`✓ generated/ matches sites.yaml (${files.size} files)`)
    return
  }

  for (const [path, content] of files) {
    const absolutePath = join(REPO_DIR, path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content, { mode: path.endsWith('.sh') ? 0o755 : 0o644 })
  }
  for (const path of stalePaths)
    rmSync(join(REPO_DIR, path))

  console.log(`✓ rendered ${files.size} files from sites.yaml`)
  for (const project of model.projects)
    console.log(`  ${project.variant === 'stg' ? 'stg ' : 'prod'}  ${project.id}`)
  for (const path of stalePaths)
    console.log(`  removed ${path}`)
}

// Only when run as a command, not when the tests import loadModel/renderAll.
if (import.meta.url === `file://${process.argv[1]}`)
  await main()
