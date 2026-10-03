// Fixed values the renderer uses. Changing one changes every generated file
// that depends on it.

// Where this repo is checked out on the box. Every path in generated/ that the
// box reads starts here. (/srv is the Linux-standard home for data a machine
// serves: websites, repos.)
export const ROOT = '/srv/nagaya'

// The env keys nagaya reads from an app's OWN env file to create its database
// role and check its Redis password. A convention, not configuration: every
// app with a database names its credentials exactly this way.
export const CREDENTIAL_KEYS = {
  pgUser: 'PG_USERNAME',
  pgPassword: 'PG_PASSWORD',
  pgDatabase: 'PG_DATABASE',
  redisPassword: 'REDIS_PASSWORD',
} as const

// Namecheap's email forwarding, exactly as `dig` showed it on 2026-10-03.
// Used only while an app's email.mode is "namecheap".
export const NAMECHEAP_MX: ReadonlyArray<readonly [host: string, priority: number]> = [
  ['eforward1.registrar-servers.com', 10],
  ['eforward2.registrar-servers.com', 10],
  ['eforward3.registrar-servers.com', 10],
  ['eforward4.registrar-servers.com', 15],
  ['eforward5.registrar-servers.com', 20],
]
export const NAMECHEAP_SPF = 'v=spf1 include:spf.efwd.registrar-servers.com ~all'

// Docker label on every container nagaya manages, holding its project id.
// `nagaya apply` uses it to find containers of projects removed from sites.yaml.
export const PROJECT_LABEL = 'dev.nagaya.project'

// The compose project holding Caddy, Postgres and Redis.
export const CORE_PROJECT = 'nagaya-core'

// The Docker network Caddy shares with every container it routes to.
export const EDGE_NETWORK = 'edge'
