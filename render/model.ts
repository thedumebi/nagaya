// Turns the validated registry into the model: defaults applied, staging
// copies expanded, references checked, names derived. Every file writer reads
// the model and nothing else, so each naming rule lives in exactly one place:
// here. Types are in types/, fixed values in constants.ts.

import { CADDY_CONTAINER, CREDENTIAL_KEYS, NAMECHEAP_MX, NAMECHEAP_SPF, ROOT } from './constants.ts'
import { RegistryError } from './errors.ts'
import type {
  Attachment,
  BackedUpDatabase,
  BuildServiceInput,
  CredentialKeys,
  Cron,
  DnsRecord,
  Dotenvx,
  EmailRule,
  Model,
  Origin,
  Project,
  Registry,
  ResourceRef,
  Route,
  Service,
  SiteConfig,
  SiteDefaults,
  Variant,
  Zone,
} from './types/index.ts'

// ============================================
// HELPERS
// ============================================

// Throws with the location in sites.yaml first, e.g.
// "apps.futari.sites.abm: route "abm" says port 3007 but …".
function fail(location: string, message: string): never {
  throw new RegistryError(`${location}: ${message}`)
}

// "api" + "ofuma.ai" → "api.ofuma.ai"; "@" means the domain itself.
export function fullHostname(label: string, domain: string): string {
  return label === '@' ? domain : `${label}.${domain}`
}

// The staging twin of a label. Always ONE label deep ("api" → "api-stg", never
// "api.stg"), so Cloudflare's free certificate, which covers *.<domain> but not
// *.*.<domain>, still applies.
// The variable holding a service's image tag in its project's tags file:
// backend → TAG_BACKEND, doca-api → TAG_DOCA_API.
export function tagVariableFor(serviceKey: string): string {
  return `TAG_${serviceKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

export function stagingLabel(label: string): string {
  return label === '@' ? 'stg' : `${label}-stg`
}

// Either form of a resource reference → { use, as[] }. A plain name is reached
// as "postgres" or "redis".
function resolveResourceRef(ref: ResourceRef, kind: 'postgres' | 'redis'): { use: string, as: string[] } {
  if (typeof ref === 'string')
    return { use: ref, as: [kind] }
  return { use: ref.use, as: Array.isArray(ref.as) ? [...ref.as] : [ref.as] }
}

function projectIdFor(appName: string, siteName: string, isStaging: boolean): string {
  return `${appName}-${siteName}${isStaging ? '-stg' : ''}`
}

function originIp(location: string, origin: Origin): string {
  return origin.ip ?? fail(location, `origin "${origin.name}" has no ip yet (set origins.${origin.name}.ip)`)
}

// ============================================
// THE MODEL
// ============================================

export function buildModel(registry: Registry): Model {
  const projects: Project[] = []
  const routes: Route[] = []
  const zones: Zone[] = []
  const databases: BackedUpDatabase[] = []

  const lookupOrigin = (location: string, originName: string): Origin => {
    const originConfig = registry.origins[originName] ?? fail(location, `unknown origin "${originName}" (define it under origins:)`)
    return { name: originName, ...originConfig }
  }

  for (const [appName, appConfig] of Object.entries(registry.apps)) {
    const appDefaults: SiteDefaults = appConfig.defaults ?? {}
    const zone: Zone = { domain: appConfig.domain, records: [], email: null }
    zones.push(zone)

    for (const [siteName, siteOwnConfig] of Object.entries(appConfig.sites)) {
      const location = `apps.${appName}.sites.${siteName}`
      // The app's defaults, overridden by whatever the site sets itself.
      const site: SiteConfig = { ...appDefaults, ...siteOwnConfig }
      const hasStaging = site.stg ?? false
      const variants: Variant[] = hasStaging ? ['prod', 'stg'] : ['prod']

      if (site.static && site.services)
        fail(location, 'a site is either static: or services:, not both')
      if (!site.static && !site.services)
        fail(location, 'needs either static: or services:')
      if (site.static && hasStaging)
        fail(location, 'static sites have no staging copy; set stg: false')
      if (site.services && !site.repo)
        fail(location, 'a site with services needs repo: (the GitHub repo whose CI deploys it)')
      if (!site.origin)
        fail(location, 'no origin (set it on the site or in the app defaults)')

      for (const variant of variants) {
        const isStaging = variant === 'stg'
        const projectId = projectIdFor(appName, siteName, isStaging)
        const origin = lookupOrigin(location, isStaging ? (site.stg_origin ?? site.origin) : site.origin)
        const labelFor = (label: string) => (isStaging ? stagingLabel(label) : label)

        // ── routes and their DNS records ──
        for (const [label, target] of Object.entries(site.routes)) {
          const host = fullHostname(labelFor(label), appConfig.domain)
          if (target === 'static') {
            if (!site.static)
              fail(location, `route "${label}: static" but the site has no static: directory`)
            routes.push({ host, zone: appConfig.domain, variant, project: null, kind: 'static', upstream: null, staticDir: site.static, redirectTo: null })
          }
          else {
            const targetMatch = /^([a-z][a-z0-9-]*):(\d+)$/.exec(target)
            if (!targetMatch)
              fail(location, `route "${label}: ${target}" must be <service>:<port> or "static"`)
            const [, serviceKey, port] = targetMatch as unknown as [string, string, string]
            const targetService = site.services?.[serviceKey] ?? fail(location, `route "${label}" targets unknown service "${serviceKey}"`)
            if (targetService.port !== Number(port))
              fail(location, `route "${label}" says port ${port} but service ${serviceKey} listens on ${targetService.port}`)
            routes.push({ host, zone: appConfig.domain, variant, project: projectId, kind: 'proxy', upstream: `${projectId}-${serviceKey}:${port}`, staticDir: null, redirectTo: null })
          }
          addRecord(zone, location, { name: host, type: 'A', content: originIp(location, origin), proxied: origin.proxied, priority: null })
        }
        if (site.www === 'redirect' && !isStaging) {
          if (!('@' in site.routes))
            fail(location, 'www: redirect needs a "@" route to redirect to')
          const host = fullHostname('www', appConfig.domain)
          routes.push({ host, zone: appConfig.domain, variant, project: null, kind: 'redirect', upstream: null, staticDir: null, redirectTo: appConfig.domain })
          addRecord(zone, location, { name: host, type: 'A', content: originIp(location, origin), proxied: origin.proxied, priority: null })
        }

        if (!site.services)
          continue

        // ── a deployable project ──
        const networkSiteName = site.network ?? siteName
        if (site.network) {
          const networkSite = appConfig.sites[site.network] ?? fail(location, `network: ${site.network} is not a site of app ${appName}`)
          if ((networkSite.stg ?? appDefaults.stg ?? false) !== hasStaging)
            fail(location, `network: ${site.network} must have the same stg setting as this site`)
        }
        const network = projectIdFor(appName, networkSiteName, isStaging)

        const attachments: Attachment[] = []
        let database: Project['database'] = null
        let redis: Project['redis'] = null

        if (site.postgres) {
          const postgresRef = resolveResourceRef(site.postgres, 'postgres')
          if (!registry.resources.postgres[postgresRef.use])
            fail(location, `postgres: ${postgresRef.use} is not defined under resources.postgres`)
          attachments.push({ container: postgresRef.use, aliases: postgresRef.as })
          if (site.database) {
            const databaseName = isStaging ? `${site.database}_stg` : site.database
            database = { name: databaseName, resource: postgresRef.use }
            if (!databases.some(existing => existing.name === databaseName && existing.resource === postgresRef.use))
              databases.push({ name: databaseName, resource: postgresRef.use, app: appName, variant })
          }
        }
        else if (site.database) {
          fail(location, 'database: needs a postgres: resource')
        }
        if (site.redis) {
          const redisRef = resolveResourceRef(site.redis, 'redis')
          const redisConfig = registry.resources.redis[redisRef.use] ?? fail(location, `redis: ${redisRef.use} is not defined under resources.redis`)
          attachments.push({ container: redisRef.use, aliases: redisRef.as })
          redis = { resource: redisRef.use, passwordEnv: redisConfig.password_env ?? null }
        }

        // A service Caddy routes to is "public". Caddy reaches it by joining
        // this project's network (by container name, no alias), never by the
        // service joining a network shared with other projects.
        const routedServiceKeys = new Set(
          Object.values(site.routes).filter(target => target !== 'static').map(target => target.split(':')[0]),
        )
        if (routedServiceKeys.size)
          attachments.push({ container: CADDY_CONTAINER, aliases: [] })

        const services: Service[] = Object.entries(site.services).map(([serviceKey, serviceConfig]) => buildService({
          registry,
          appName,
          siteName,
          projectId,
          serviceKey,
          serviceConfig,
          isStaging,
          location,
          database,
          redis,
          isPublic: routedServiceKeys.has(serviceKey),
          siteServiceKeys: Object.keys(site.services!),
        }))

        const tagVariables = services.map(service => service.tagVariable)
        const repeatedTagVariable = tagVariables.find((tagVariable, index) => tagVariables.indexOf(tagVariable) !== index)
        if (repeatedTagVariable)
          fail(location, `two services share the image tag variable ${repeatedTagVariable}; rename one so their keys differ in more than - or _`)

        const cronNames = (site.cron ?? []).map(cronConfig => cronConfig.name)
        const repeatedCronName = cronNames.find((cronName, index) => cronNames.indexOf(cronName) !== index)
        if (repeatedCronName)
          fail(location, `two crons are named "${repeatedCronName}"; a cron's id is <project>-<name>, so names must differ within a site`)

        const crons: Cron[] = isStaging
          ? [] // staging copies get no scheduled jobs
          : (site.cron ?? []).map((cronConfig) => {
              const cronService = services.find(service => service.key === cronConfig.service)
                ?? fail(location, `cron ${cronConfig.name} targets unknown service "${cronConfig.service}"`)
              return {
                id: `${projectId}-${cronConfig.name}`,
                at: cronConfig.at,
                container: cronService.container,
                port: cronService.port,
                path: cronConfig.post,
                secretHeader: cronConfig.secret_header ?? null,
              }
            })

        projects.push({
          id: projectId,
          app: appName,
          site: siteName,
          variant,
          repo: site.repo!,
          network,
          ownsNetwork: !site.network,
          needs: site.network ? [network] : [],
          services,
          attachments,
          database,
          redis,
          crons,
        })
      }
    }

    // ── records that are not sites ──
    for (const recordConfig of appConfig.dns ?? []) {
      addRecord(zone, `apps.${appName}.dns`, {
        name: fullHostname(recordConfig.name, appConfig.domain),
        type: recordConfig.type,
        content: recordConfig.content,
        proxied: false,
        priority: recordConfig.priority ?? null,
      })
    }

    // ── email ──
    if (appConfig.email) {
      const emailConfig = appConfig.email
      const emailLocation = `apps.${appName}.email`
      const rules: EmailRule[] = emailConfig.addresses.map(entry => typeof entry === 'string'
        ? { address: `${entry}@${appConfig.domain}`, to: emailConfig.forward_to }
        : { address: `${entry.address}@${appConfig.domain}`, to: entry.forward_to })

      const seenAddresses = new Set<string>()
      for (const rule of rules) {
        if (seenAddresses.has(rule.address))
          fail(emailLocation, `${rule.address} is listed twice`)
        seenAddresses.add(rule.address)
      }

      const catchAllTo = emailConfig.catch_all === true
        ? emailConfig.forward_to
        : emailConfig.catch_all === false ? null : emailConfig.catch_all
      zone.email = { mode: emailConfig.mode, rules, catchAllTo }

      if (emailConfig.mode === 'namecheap') {
        for (const [host, priority] of NAMECHEAP_MX)
          addRecord(zone, emailLocation, { name: appConfig.domain, type: 'MX', content: host, proxied: false, priority })
        addRecord(zone, emailLocation, { name: appConfig.domain, type: 'TXT', content: NAMECHEAP_SPF, proxied: false, priority: null })
      }

      const inboxes = [...rules.map(rule => rule.to), ...(catchAllTo ? [catchAllTo] : [])]
      if (emailConfig.mode !== 'namecheap' && inboxes.some(inbox => inbox.startsWith('CHANGE_ME')))
        fail(emailLocation, `set forward_to (and any per-address forward_to) to a real inbox before switching to mode: ${emailConfig.mode}`)
    }
  }

  checkTunnelPorts(registry)
  checkHostsAreUnique(routes)
  checkAliasesAreUnique(projects)
  checkDatabasesHaveCredentials(projects)

  return { registry, projects, routes, zones, databases }
}

// A/AAAA/CNAME are keyed by name, so changing an origin is an in-place update
// (one record, new IP), never a delete-then-create that would briefly leave
// the name unresolvable or round-robin two boxes. MX/TXT can repeat on a name,
// so they are keyed by content too.
function addRecord(zone: Zone, location: string, record: Omit<DnsRecord, 'key'>) {
  const key = record.type === 'MX' || record.type === 'TXT'
    ? `${record.type} ${record.name} ${record.content}`
    : `${record.type} ${record.name}`
  if (zone.records.some(existing => existing.key === key))
    fail(location, `duplicate DNS record ${key}`)
  if (record.type === 'CNAME' && zone.records.some(existing => existing.name === record.name))
    fail(location, `${record.name} has a CNAME and other records; DNS does not allow that`)
  if (record.type !== 'CNAME' && zone.records.some(existing => existing.name === record.name && existing.type === 'CNAME'))
    fail(location, `${record.name} already has a CNAME; DNS does not allow other records beside it`)
  zone.records.push({ key, ...record })
}

// ============================================
// SERVICES
// ============================================

function buildService(input: BuildServiceInput): Service {
  const { registry, serviceConfig, serviceKey, isStaging, location } = input
  const nodeEnv = isStaging ? 'staging' : 'production'

  let dotenvx: Dotenvx | null = null
  if (serviceConfig.dotenvx) {
    if (!serviceConfig.dotenvx.endsWith('/.env.production'))
      fail(location, `services.${serviceKey}.dotenvx must point at a .env.production file (staging uses the .env.staging beside it)`)
    const keyName = `${input.appName}-${input.siteName}-${serviceKey}`
    dotenvx = {
      path: isStaging ? serviceConfig.dotenvx.replace(/\.env\.production$/, '.env.staging') : serviceConfig.dotenvx,
      keyName,
      // Holds ONLY DOTENV_PRIVATE_KEY_<ENV>=… (KEY=VALUE format, which is what
      // compose's env_file reads). Not an env file of the app's settings.
      keyFile: `${ROOT}/keys/${keyName}.${nodeEnv}.key`,
    }
  }

  // Which env keys hold the credentials: always the same names (see
  // CREDENTIAL_KEYS). Only needed when there is a database or a Redis password
  // to set up or check.
  let credentials: CredentialKeys | null = null
  if (dotenvx && (input.database || input.redis?.passwordEnv)) {
    credentials = {
      pgUser: CREDENTIAL_KEYS.pgUser,
      pgPassword: CREDENTIAL_KEYS.pgPassword,
      pgDatabase: CREDENTIAL_KEYS.pgDatabase,
      redisPassword: input.redis?.passwordEnv ? CREDENTIAL_KEYS.redisPassword : null,
    }
  }

  const dependsOn = serviceConfig.depends_on ?? []
  for (const dependency of dependsOn) {
    if (dependency === serviceKey || !input.siteServiceKeys.includes(dependency))
      fail(location, `services.${serviceKey}.depends_on: "${dependency}" is not another service of this site`)
  }

  const mounts = (serviceConfig.mounts ?? []).map(mountName =>
    registry.resources.mounts[mountName]
    ?? fail(location, `services.${serviceKey}.mounts: ${mountName} is not defined under resources.mounts`))

  return {
    key: serviceKey,
    container: `${input.projectId}-${serviceKey}`,
    image: `${registry.registry}/${input.appName}-${input.siteName}-${serviceKey}`,
    tagVariable: tagVariableFor(serviceKey),
    port: serviceConfig.port,
    mem: serviceConfig.mem,
    command: serviceConfig.command ? serviceConfig.command.replace(/\s+/g, ' ').trim() : null,
    health: serviceConfig.health ?? null,
    mounts,
    aliases: [serviceKey, ...(serviceConfig.aliases ?? [])],
    dependsOn,
    public: input.isPublic,
    nodeEnv,
    dotenvx,
    credentials,
  }
}

// ============================================
// WHOLE-FILE CHECKS
// ============================================

// Each Postgres is published on its own 127.0.0.1 port for SSH tunnels.
function checkTunnelPorts(registry: Registry) {
  const seenPorts = new Map<number, string>()
  for (const [name, postgresConfig] of Object.entries(registry.resources.postgres)) {
    const holder = seenPorts.get(postgresConfig.tunnel_port)
    if (holder)
      fail(`resources.postgres.${name}`, `tunnel_port ${postgresConfig.tunnel_port} is already used by ${holder}`)
    seenPorts.set(postgresConfig.tunnel_port, name)
  }
}

function checkHostsAreUnique(routes: Route[]) {
  const seenHosts = new Set<string>()
  for (const route of routes) {
    if (seenHosts.has(route.host))
      fail('routes', `${route.host} is routed twice`)
    seenHosts.add(route.host)
  }
}

// Two containers answering to the same alias on one network would make Docker
// DNS return either of them, at random. Refuse that outright.
function checkAliasesAreUnique(projects: Project[]) {
  const ownersByNetwork = new Map<string, Map<string, string>>()
  for (const project of projects) {
    const aliasOwners = ownersByNetwork.get(project.network) ?? new Map<string, string>()
    ownersByNetwork.set(project.network, aliasOwners)
    const claim = (alias: string, container: string) => {
      const currentOwner = aliasOwners.get(alias)
      if (currentOwner && currentOwner !== container)
        fail(`network ${project.network}`, `alias "${alias}" is claimed by both ${currentOwner} and ${container}`)
      aliasOwners.set(alias, container)
    }
    for (const service of project.services) {
      for (const alias of service.aliases)
        claim(alias, service.container)
    }
    for (const attachment of project.attachments) {
      for (const alias of attachment.aliases)
        claim(alias, attachment.container)
    }
  }
}

// nagaya creates each database's role from the credentials in the app's own
// env file, so a project with a database needs a service whose env holds them.
function checkDatabasesHaveCredentials(projects: Project[]) {
  for (const project of projects) {
    if (project.database && !project.services.some(service => service.credentials))
      fail(`project ${project.id}`, 'has a database but no dotenvx service to read its credentials from')
  }
}
