// The model: sites.yaml after model.ts has resolved it. Every default
// applied, every staging copy expanded, every name worked out. The file
// writers (caddy.ts, compose.ts, outputs.ts) read only this.
//
// Where a model type shares fields with the registry, it is built FROM the
// registry schema (pick / extend), so a field is defined exactly once.

import { z } from 'zod'
import {
  dnsRecordConfigSchema,
  emailModeSchema,
  mountConfigSchema,
  originConfigSchema,
  registrySchema,
  secretHeaderSchema,
  serviceConfigSchema,
} from './registry.ts'
import type { Registry, ServiceConfig } from './registry.ts'

// ============================================
// SMALL PIECES
// ============================================

export const variantSchema = z.enum(['prod', 'stg'])
export type Variant = z.infer<typeof variantSchema>

// What a container is told it is. Backends pick .env.production or
// .env.staging by it; ofuma's frontends pick their runtime-env file by it.
export const nodeEnvSchema = z.enum(['production', 'staging'])
export type NodeEnv = z.infer<typeof nodeEnvSchema>

// A registry origin, plus the name it was declared under.
export const originSchema = originConfigSchema.extend({ name: z.string() })
export type Origin = z.infer<typeof originSchema>

// A resource container attached to a project's network under the hostnames
// the project's code uses for it: pg-main as "postgres" and "dmb-postgres".
export const attachmentSchema = z.object({
  container: z.string(),
  aliases: z.array(z.string()),
})
export type Attachment = z.infer<typeof attachmentSchema>

// The NAMES of the env keys nagaya reads from an app's own env file (always
// CREDENTIAL_KEYS in constants.ts). Never values.
export const credentialKeysSchema = z.object({
  pgUser: z.string(),
  pgPassword: z.string(),
  pgDatabase: z.string(),
  redisPassword: z.string().nullable(),
})
export type CredentialKeys = z.infer<typeof credentialKeysSchema>

export const dotenvxSchema = z.object({
  path: z.string(), // the env file inside the image (.env.production or .env.staging)
  keyName: z.string(), // <app>-<site>-<service>: the .keys file copied to the box
  keyFile: z.string(), // the one-key file this container gets: keys/<keyName>.<env>.env
})
export type Dotenvx = z.infer<typeof dotenvxSchema>

// ============================================
// SERVICES, CRONS, PROJECTS
// ============================================

export const serviceSchema = serviceConfigSchema.pick({ port: true, mem: true }).extend({
  key: z.string(), // as written in sites.yaml: backend, frontend, doca-api
  container: z.string(), // <project>-<key>
  image: z.string(), // <registry>/<app>-<site>-<key>, no tag
  command: z.string().nullable(),
  health: z.string().nullable(),
  mounts: z.array(mountConfigSchema),
  aliases: z.array(z.string()), // on the project network; always includes `key`
  public: z.boolean(), // Caddy routes to it, so it also joins the edge network
  nodeEnv: nodeEnvSchema,
  dotenvx: dotenvxSchema.nullable(),
  credentials: credentialKeysSchema.nullable(),
})
export type Service = z.infer<typeof serviceSchema>

export const cronSchema = z.object({
  id: z.string(), // <project>-<name>
  at: z.string(),
  container: z.string(),
  port: z.number(),
  path: z.string(),
  secretHeader: secretHeaderSchema.nullable(),
})
export type Cron = z.infer<typeof cronSchema>

export const projectDatabaseSchema = z.object({
  name: z.string(), // ofuma, or ofuma_stg for the staging copy
  resource: z.string(), // the Postgres container holding it
})

export const projectRedisSchema = z.object({
  resource: z.string(),
  passwordEnv: z.string().nullable(), // the key in nagaya's env holding its password
})

// A site in one environment: what gets deployed (`nagaya deploy <id> <tag>`).
export const projectSchema = z.object({
  id: z.string(), // <app>-<site>[-stg]: compose project name
  app: z.string(),
  site: z.string(),
  variant: variantSchema,
  repo: z.string(),
  network: z.string(),
  ownsNetwork: z.boolean(), // false when it joins another site's network
  services: z.array(serviceSchema),
  attachments: z.array(attachmentSchema),
  database: projectDatabaseSchema.nullable(),
  redis: projectRedisSchema.nullable(),
  crons: z.array(cronSchema),
})
export type Project = z.infer<typeof projectSchema>

// ============================================
// ROUTES, DNS, ZONES
// ============================================

export const routeSchema = z.object({
  host: z.string(),
  zone: z.string(),
  variant: variantSchema,
  project: z.string().nullable(), // the project serving it; null for static/redirect
  kind: z.enum(['proxy', 'static', 'redirect']),
  upstream: z.string().nullable(), // container:port, for proxy
  staticDir: z.string().nullable(), // directory under static/, for static
  redirectTo: z.string().nullable(), // apex domain, for redirect
})
export type Route = z.infer<typeof routeSchema>

export const dnsRecordSchema = dnsRecordConfigSchema.pick({ type: true, content: true }).extend({
  key: z.string(), // its identity in Terraform: "A dmb.futari.live", "MX futari.live eforward1…"
  name: z.string(), // fully qualified
  proxied: z.boolean(),
  priority: z.number().nullable(),
})
export type DnsRecord = z.infer<typeof dnsRecordSchema>

export const emailRuleSchema = z.object({
  address: z.string(), // full address: admissions@futari.live
  to: z.string(), // the inbox it forwards to
})
export type EmailRule = z.infer<typeof emailRuleSchema>

export const zoneSchema = z.object({
  domain: z.string(),
  records: z.array(dnsRecordSchema),
  email: z.object({
    mode: emailModeSchema,
    rules: z.array(emailRuleSchema),
    catchAllTo: z.string().nullable(),
  }).nullable(),
})
export type Zone = z.infer<typeof zoneSchema>

export const backedUpDatabaseSchema = z.object({
  name: z.string(),
  resource: z.string(),
  app: z.string(),
  variant: variantSchema,
})
export type BackedUpDatabase = z.infer<typeof backedUpDatabaseSchema>

// ============================================
// THE WHOLE MODEL
// ============================================

export const modelSchema = z.object({
  registry: registrySchema,
  projects: z.array(projectSchema),
  routes: z.array(routeSchema),
  zones: z.array(zoneSchema),
  databases: z.array(backedUpDatabaseSchema),
})
export type Model = z.infer<typeof modelSchema>

// The inputs model.ts passes when building one service. Function arguments,
// not data, so a plain type rather than a schema.
export interface BuildServiceInput {
  registry: Registry
  appName: string
  siteName: string
  projectId: string
  serviceKey: string
  serviceConfig: ServiceConfig
  isStaging: boolean
  location: string
  database: Project['database']
  redis: Project['redis']
  isPublic: boolean
}
