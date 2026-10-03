// The registry: the shape of sites.yaml.
//
// Each zod schema here is the single definition of one part of the file. The
// TypeScript type beside it is inferred from the schema, never written out by
// hand, so the validation and the types cannot drift apart. Every object is
// `.strict()`: an unknown key (a typo) fails `pnpm render` instead of being
// silently ignored. docs/sites-yaml.md is the prose version of this file.

import { z } from 'zod'

// ============================================
// SINGLE VALUES
// ============================================

// App, site, service, resource and origin names. They end up in container,
// network and image names, which Docker and GHCR restrict.
export const nameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes')

// A route key: "@" (the domain itself) or a subdomain label such as "api".
export const labelSchema = z.string().regex(/^(@|[a-z0-9][a-z0-9.-]*)$/, '"@" or a subdomain label such as "api"')

// DNS-only record names may also contain underscores (_dmarc, brevo1._domainkey).
export const dnsNameSchema = z.string().regex(/^(@|[a-z0-9_][a-z0-9_.-]*)$/, '"@" or a record name such as "_dmarc"')

// A memory size in Docker's format.
export const memorySchema = z.string().regex(/^\d+[mg]$/, 'a memory size such as 384m or 1g')

// The NAME of an env variable (never its value): REDIS_PASSWORD_OFUMA.
export const envKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'an UPPER_SNAKE env var name')

export const databaseNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores')

// The part of an email address before the @: "admissions".
export const localPartSchema = z.string().regex(/^[a-z0-9._-]+$/, 'the part before the @, e.g. "admissions"')

// ============================================
// ORIGINS AND RESOURCES
// ============================================

// A machine DNS records can point at. `ip: null` until the machine exists.
export const originConfigSchema = z.object({
  ip: z.string().ip({ version: 'v4' }).nullable(),
  proxied: z.boolean(),
}).strict()
export type OriginConfig = z.infer<typeof originConfigSchema>

export const postgresConfigSchema = z.object({
  version: z.number().int().min(16),
  shared_buffers: z.string(),
  max_connections: z.number().int().positive(),
  // The port on the box's 127.0.0.1 where this Postgres is published, for an
  // SSH tunnel from the laptop. Apps never use it; they reach Postgres over
  // the Docker networks on its own port 5432.
  tunnel_port: z.number().int().min(1024).max(65535),
  mem: memorySchema,
}).strict()
export type PostgresConfig = z.infer<typeof postgresConfigSchema>

export const redisConfigSchema = z.object({
  password_env: envKeySchema.optional(), // a key in nagaya's own .env.production
  policy: z.enum(['noeviction', 'allkeys-lru']).optional(),
  mem: memorySchema,
}).strict()
export type RedisConfig = z.infer<typeof redisConfigSchema>

export const mountConfigSchema = z.object({
  host: z.string().startsWith('/'), // path on the box
  at: z.string().startsWith('/'), // path inside the container
}).strict()
export type MountConfig = z.infer<typeof mountConfigSchema>

export const resourcesConfigSchema = z.object({
  postgres: z.record(nameSchema, postgresConfigSchema).default({}),
  redis: z.record(nameSchema, redisConfigSchema).default({}),
  mounts: z.record(nameSchema, mountConfigSchema).default({}),
}).strict()
export type ResourcesConfig = z.infer<typeof resourcesConfigSchema>

// A site's reference to a resource: its name, or { use, as } when the site's
// code reaches it under a different hostname (or several).
export const resourceRefSchema = z.union([
  nameSchema,
  z.object({
    use: nameSchema,
    as: z.union([nameSchema, z.array(nameSchema).nonempty()]),
  }).strict(),
])
export type ResourceRef = z.infer<typeof resourceRefSchema>

// ============================================
// SITES AND SERVICES
// ============================================

// One container of a site.
export const serviceConfigSchema = z.object({
  port: z.number().int().positive(),
  mem: memorySchema,
  command: z.string().optional(),
  health: z.string().startsWith('/').optional(),
  mounts: z.array(nameSchema).optional(),
  aliases: z.array(nameSchema).optional(),
  // Path INSIDE the image of the dotenvx-encrypted env file the app decrypts
  // itself. Setting it injects the matching DOTENV_PRIVATE_KEY_* (NODE_ENV is
  // set on every container regardless).
  dotenvx: z.string().startsWith('/').optional(),
}).strict()
export type ServiceConfig = z.infer<typeof serviceConfigSchema>

export const secretHeaderSchema = z.object({
  name: z.string(), // the HTTP header, e.g. x-cron-secret
  env: envKeySchema, // the key in nagaya's .env.production holding its value
}).strict()
export type SecretHeader = z.infer<typeof secretHeaderSchema>

export const cronConfigSchema = z.object({
  name: nameSchema,
  at: z.string(), // cron schedule
  service: nameSchema,
  post: z.string().startsWith('/'),
  secret_header: secretHeaderSchema.optional(),
}).strict()
export type CronConfig = z.infer<typeof cronConfigSchema>

// The keys an app's `defaults:` may set. A site may set the same keys, and
// its own value wins: anything that can be defaulted can be overridden.
export const siteDefaultsShape = {
  origin: nameSchema.optional(),
  stg_origin: nameSchema.optional(),
  postgres: resourceRefSchema.optional(),
  redis: resourceRefSchema.optional(),
  database: databaseNameSchema.optional(),
  stg: z.boolean().optional(),
}
export const siteDefaultsSchema = z.object(siteDefaultsShape).strict()
export type SiteDefaults = z.infer<typeof siteDefaultsSchema>

export const siteConfigSchema = z.object({
  ...siteDefaultsShape,
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name').optional(),
  static: nameSchema.optional(),
  network: nameSchema.optional(),
  services: z.record(nameSchema, serviceConfigSchema).optional(),
  routes: z.record(labelSchema, z.string()),
  www: z.literal('redirect').optional(),
  cron: z.array(cronConfigSchema).optional(),
}).strict()
export type SiteConfig = z.infer<typeof siteConfigSchema>

// ============================================
// DNS AND EMAIL
// ============================================

export const dnsRecordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX'])
export type DnsRecordType = z.infer<typeof dnsRecordTypeSchema>

export const dnsRecordConfigSchema = z.object({
  type: dnsRecordTypeSchema,
  name: dnsNameSchema,
  content: z.string(),
  priority: z.number().int().optional(),
}).strict()
export type DnsRecordConfig = z.infer<typeof dnsRecordConfigSchema>

export const emailModeSchema = z.enum(['namecheap', 'cloudflare-pending', 'cloudflare'])
export type EmailMode = z.infer<typeof emailModeSchema>

export const emailConfigSchema = z.object({
  mode: emailModeSchema,
  // The default inbox: for addresses written as plain names, and catch_all: true.
  forward_to: z.string().email(),
  // "admissions"                                    → forward_to
  // { address: abm, forward_to: someone@gmail.com } → its own inbox
  addresses: z.array(z.union([
    localPartSchema,
    z.object({ address: localPartSchema, forward_to: z.string().email() }).strict(),
  ])).default([]),
  // true → forward_to; an email address → that inbox; false → no catch-all.
  catch_all: z.union([z.boolean(), z.string().email()]).default(false),
}).strict()
export type EmailConfig = z.infer<typeof emailConfigSchema>

// ============================================
// APPS, BACKUPS, ALERTS, THE WHOLE FILE
// ============================================

export const appConfigSchema = z.object({
  domain: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'a domain such as futari.live'),
  defaults: siteDefaultsSchema.optional(),
  email: emailConfigSchema.optional(),
  dns: z.array(dnsRecordConfigSchema).optional(),
  sites: z.record(nameSchema, siteConfigSchema),
}).strict()
export type AppConfig = z.infer<typeof appConfigSchema>

export const backupsConfigSchema = z.object({
  at: z.string(), // cron schedule, UTC
  buckets: z.record(nameSchema, z.string()), // app name → R2 bucket
}).strict()
export type BackupsConfig = z.infer<typeof backupsConfigSchema>

// Box health alerts, emailed through Brevo by `nagaya alerts` (cron).
export const alertsConfigSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).nonempty()]), // one inbox or several
  from: z.string().email(), // must be on a domain authenticated in Brevo
  every: z.string(), // cron schedule
  repeat_hours: z.number().positive(), // re-send while a problem persists
  thresholds: z.object({
    mem_available_mb: z.number().int().positive(), // alert below this
    swap_pages_per_sec: z.number().positive(), // swap-in + swap-out, averaged since the last check
    psi_some_avg300: z.number().positive(), // % of the last 5 min some task waited on memory
    disk_used_pct: z.number().int().min(1).max(99),
  }).strict(),
}).strict()
export type AlertsConfig = z.infer<typeof alertsConfigSchema>

export const registrySchema = z.object({
  registry: z.string(), // where images live: <registry>/<app>-<site>-<service>
  origins: z.record(nameSchema, originConfigSchema),
  resources: resourcesConfigSchema,
  backups: backupsConfigSchema,
  alerts: alertsConfigSchema.optional(),
  apps: z.record(nameSchema, appConfigSchema),
}).strict()
export type Registry = z.infer<typeof registrySchema>
