# `sites.yaml` — the registry

`sites.yaml` is the one file that says what runs on the nagaya box and what
DNS points at it. You never edit Caddy, compose files, crontabs or DNS by hand.
You edit this file and merge it, and the rest follows:

```
sites.yaml ──pnpm render──▶ generated/caddy/Caddyfile        Caddy: hostnames → containers
                            generated/compose/core.yml        Postgres, Redis, Caddy
                            generated/compose/<project>.yml   one per deployable project
                            generated/crontab                 backups, alert checks, site crons
                            generated/firewall.sh             firewall (Cloudflare-only 443)
                            generated/plan.json               what bin/nagaya reads
                            terraform/generated.auto.tfvars.json   DNS + email for Terraform
```

On a merge to `master`, CI runs `terraform apply` (DNS, email routing, GitHub
secrets) and then `nagaya apply` on the box (networks, containers, Caddy,
crontab). [RUNBOOK.md](../RUNBOOK.md) has the full runbook. This page explains
the file.

- [The four ideas](#the-four-ideas)
- [A worked example](#a-worked-example-adding-blogfutarilive)
- [Top-level keys](#top-level-keys)
- [resources](#resources)
- [apps](#apps)
- [sites](#sites)
- [services](#services)
- [Staging (`stg: true`)](#staging-stg-true)
- [How names are derived](#how-names-are-derived)
- [Networking, in one picture](#networking-in-one-picture)
- [What `pnpm render` refuses](#what-pnpm-render-refuses)
- [Recipes](#recipes)

---

## The four ideas

| Term | What it is | In this file |
|---|---|---|
| **resource** | Shared infrastructure, defined **once** at the top and referred to by name. | `pg-main`, `redis-futari`, `redis-ofuma`, `futari-geo` |
| **app** | One **domain**. Groups its sites and gives them defaults. | `futari` (futari.live), `ofuma` (ofuma.ai) |
| **site** | One **deployable unit** under an app: one repo, one CI pipeline, a set of containers, and the subdomains routed to them. | futari: `root`, `dmb`, `abm`, `nihongo`. ofuma: `main`, `doca` |
| **service** | One **container** in a site: image, port, memory cap, start command, health check, its encrypted env file. | `backend`, `frontend`, `doca-api`, `doca-web` |

Two rules cover most of it:

1. **Sites inherit their app's `defaults`** unless they set the key themselves.
2. **Sharing is just two sites naming the same resource.** `dmb`, `abm` and
   `nihongo` all say `postgres: pg-main`, so all three databases live in the
   same Postgres. Nothing else is needed to share it.

A **project** is a site in one environment: `ofuma-main` is the production
copy of site `main`, and `ofuma-main-stg` is its staging copy. Projects are
what you deploy (`nagaya deploy ofuma-main <sha>`) and what `nagaya status` lists.

---

## A worked example: adding `blog.futari.live`

Say a new repo `thedumebi/blog` has a backend and a frontend, the same shape as dmb.
Add one block under `apps.futari.sites`:

```yaml
      blog:
        repo: thedumebi/blog
        origin: nagaya
        database: blog
        services:
          backend:
            port: 3010
            mem: 256m
            command: node dist/db/migrate.js && exec node dist/index.js
            health: /healthcheck
            dotenvx: /app/blog/backend/.env.production
          frontend:
            port: 8080
            mem: 64m
            depends_on: [backend]
        routes: { blog: frontend:8080 }      # blog.futari.live
```

The blog repo itself needs what every app here has:
- **backend:** its encrypted `.env.production` baked into the image, with the
  credentials under the standard names (`PG_USERNAME`, `PG_PASSWORD`,
  `PG_DATABASE`);
- **frontend:** built with placeholders and filled in at start-up from
  `runtime-env/<NODE_ENV>.env`, as the futari frontends do (RUNBOOK.md §1.6).
  dmb's `frontend/env.sh`, `runtime-env/` and Dockerfile are the template;
- **a deploy workflow** copied from `templates/app-repo/futari-dmb.yml` with
  the names changed.

Then:

```bash
pnpm render            # writes generated/compose/futari-blog.yml, adds a Caddy block, a DNS record
git checkout -b add-blog && git commit -am "Add blog.futari.live" && git push
```

What happens next:

- **On the PR:** CI shows the Terraform plan (`+ cloudflare_dns_record … blog.futari.live`).
- **On merge:** Terraform creates the proxied A record, then `nagaya apply`
  creates the `futari-blog` network, attaches `pg-main` and `redis-futari` to
  it, and reloads Caddy.
- **The site is live once its repo deploys.** The blog repo's CI builds
  `ghcr.io/thedumebi/futari-blog-backend:<sha>` and the matching frontend, then
  runs `deploy futari-blog <sha>`. On that first deploy nagaya reads the
  database credentials out of the image's env file, creates the role and the
  `blog` database (connectable only by that role), and starts the containers.

Until the blog repo's first deploy, `blog.futari.live` gets a 502 from Caddy.
`nagaya apply` reports the project as "not deployed yet".

---

## Top-level keys

```yaml
registry: ghcr.io/thedumebi
origins:   { … }
resources: { … }
backups:   { … }
alerts:    { … }
apps:      { … }
```

### `registry`
Where images live. A service's image is always
`<registry>/<app>-<site>-<service>`, e.g. `ghcr.io/thedumebi/ofuma-doca-doca-api`.
The tag is the git SHA the app repo's CI built; nagaya records it per project.

### `origins`
The machines DNS can point at. Every site has an origin. Its A records point
at that machine's IP, proxied (orange cloud) or not according to `proxied`.

```yaml
origins:
  nagaya:      { ip: 152.53.205.203, proxied: true }
  hetzner-dmb: { ip: 138.199.195.21, proxied: false }
```

- **`proxied: true`** is the steady state. Traffic goes through Cloudflare, and
  the box's firewall only admits Cloudflare.
- **`proxied: false`** (grey cloud) exists for the migration. A record pointing
  at an old Hetzner box behaves exactly as it does today: that box's own Caddy,
  its own Let's Encrypt certificates, and visitors' real IPs.
- **`ip: null`** is allowed until the box exists. Pointing a site at an origin
  with no IP is a render error.

**Moving a site between machines is changing one word** (`origin:`). Because
records are keyed by name, Terraform updates the record in place. There is
never a moment with no record, or with two.

### `backups`
```yaml
backups:
  at: "0 3 * * *"            # UTC
  buckets:
    futari: dmb-backups      # app → R2 bucket
    ofuma: ofuma-backups
```
One nightly job dumps **every** database any site declares, staging ones
included (once they exist). Each goes to `s3://<bucket>/<db>/<db>-<UTC stamp>.sql.gz`.
Every app with a database must have a bucket, or render fails. Retention is
the bucket's lifecycle rule (30 days); nothing in nagaya deletes backups.

### `alerts`
```yaml
alerts:
  to: you@gmail.com              # or a list: [you@gmail.com, someone@example.com]
  from: nagaya@futari.live       # any address on a domain authenticated in Brevo
  checks:
    memory:
      every: "*/5 * * * *"
      repeat_hours: 6
      thresholds:
        mem_available_mb: 400
        swap_pages_per_sec: 100
        psi_some_avg300: 10
        disk_used_pct: 85
    cloudflare-ranges:
      every: "7 6 * * *"
```
Emails about the box itself, sent to `to` through Brevo with nagaya's
`BREVO_API_KEY`.

- **Each entry under `checks` is one check** with its own cron schedule
  (`every`). The crontab gets one line per check,
  `nagaya alerts <check>`, logging to `logs/alerts-<check>.log`.
- **To switch a check off,** delete it. **To change when it runs,** change
  its `every`. Nothing in code changes for either.
- **Only kinds nagaya has code for are accepted:** `memory` and
  `cloudflare-ranges`. A new kind (say, a container that keeps restarting)
  needs its code in `bin/nagaya` as well as an entry here, and render refuses
  an unknown kind rather than scheduling a check that does nothing.
- **To email more people,** make `to` a list.
- **`nagaya alerts --test`** sends a test email.

#### `memory`
Each run logs one line and emails when a threshold is crossed:

| Threshold | Alerts when |
|---|---|
| `mem_available_mb` | MemAvailable drops below it |
| `swap_pages_per_sec` | pages swapped in + out per second, averaged since the previous run, reach it. A page is 4 KB, so 100 is about 400 KB/s. This is swap **activity**; swap merely *in use* is not a problem |
| `psi_some_avg300` | some task was stalled on memory for at least this % of the last 5 minutes |
| `disk_used_pct` | `/` is at least this full |
| *(always on)* | the kernel OOM-killed anything since the previous run |

You get one email when a problem starts, a reminder every `repeat_hours` while
it lasts, and one when it clears. RUNBOOK.md "Day-2 → Memory" covers what to
do when one arrives.

#### `cloudflare-ranges`
Compares Cloudflare's published IP ranges with `render/cloudflare-ips.json`,
which the firewall and Caddy are built from.
- **If they differ,** it emails the added and removed ranges and the commands
  to fix it. Each distinct new list is reported once.
- **It never changes the firewall itself.**
- **It doesn't depend on GitHub's scheduled workflow,** which can run late or
  not at all.

Omit the whole `alerts:` block to switch every alert off.

---

## resources

```yaml
resources:
  postgres:
    pg-main:
      version: 18
      shared_buffers: 256MB
      max_connections: 100
      tunnel_port: 5432
      mem: 768m
  redis:
    redis-futari:
      version: 8
      mem: 128m
    redis-ofuma:
      version: 8
      password_env: REDIS_PASSWORD_OFUMA
      policy: noeviction
      mem: 256m
  mounts:
    futari-geo:
      host: /srv/shared/futari
      at: /opt/futari
```

### `postgres.<name>`
One Postgres container, also named `<name>`, from `postgres:<version>-alpine`.

| Key | Meaning |
|---|---|
| `version` | Major version. **18**, matching Nooklet. Changing it is a dump-and-restore, not an edit; see RUNBOOK.md "Upgrading Postgres". |
| `shared_buffers` | Postgres's own cache. 256MB suits a 4 GB box running everything else too. |
| `max_connections` | Total across every database. Each backend's pool counts against it. |
| `tunnel_port` | The port on the box's `127.0.0.1` where this Postgres is published, for an SSH tunnel from your laptop. Two Postgres resources can't share one; render refuses. |
| `mem` | Container memory cap. |

- **Networking:** apps reach Postgres over the Docker networks on its own port
  5432. Every container has its own address there, so ports never clash. The
  only port on the **box** is `tunnel_port`, bound to `127.0.0.1`, which you
  reach through an SSH tunnel (RUNBOOK.md "Connect a database client"). Redis
  publishes no port at all: nothing outside Docker needs it, and you inspect
  it with `docker exec <name> redis-cli`.
- **Data:** a named volume `<name>-data`, mounted at `/var/lib/postgresql`. That
  is the Postgres 18 layout: data sits in `/var/lib/postgresql/18/docker`.
- **Superuser:** `postgres`, with the password from `PG_SUPERUSER_PASSWORD` in
  nagaya's `.env.production`. No app logs in as `postgres`. Each database is
  owned by its app's own role (see [`database`](#database)).

### `redis.<name>`
One Redis container named `<name>`, using `redis:<version>-alpine` with AOF
(append-only file) persistence, so its data survives a restart.

| Key | Meaning |
|---|---|
| `version` | Major version; the image is `redis:<version>-alpine`. **8**, the current line (8.10 as of 2026-09). Queue data is not migrated from Hetzner, so there is no on-disk format to worry about. |
| `password_env` | Optional. A key in **nagaya's** `.env.production`. When set, Redis requires that password. On every deploy nagaya also checks that the app's own env has the same value, so a mismatch fails the deploy instead of degrading silently. |
| `policy` | `noeviction` (refuse writes when full; **required** for BullMQ queues, since evicting a queued job loses it) or `allkeys-lru` (evict the oldest key; fine for pure caches). Omitted means Redis's default, `noeviction`. |
| `mem` | Container cap. Redis's own `maxmemory` is set to 75% of it, so Redis hits its own limit before the kernel OOM-kills it. |

### `mounts.<name>`
A host directory that services can mount. `host` is the path on the box; `at`
is the path inside the container.

`futari-geo` mounts the **parent** of the GeoLite2 directory, not the
directory itself. geolite2-redist downloads into a sibling temp dir and then
renames across. If only the leaf directory were mounted, that rename would
cross devices and fail with `EXDEV` on every update, and the database would
silently never refresh.

---

## apps

```yaml
apps:
  ofuma:
    domain: ofuma.ai
    defaults: { … }
    email:    { … }
    dns:      [ … ]
    sites:    { … }
```

### `domain`
The Cloudflare zone. Terraform creates the zone, and with it the two
nameservers to set at the registrar. Adding a **new** domain is therefore a new
app plus a one-time nameserver change (RUNBOOK.md "Adding a whole new domain").

### `defaults`
Any of these keys, applied to every site of the app that does not set its own:

| Key | Meaning |
|---|---|
| `origin` | Default origin for the app's records. |
| `stg_origin` | Origin for the **staging** copies' records. Defaults to `origin`. |
| `postgres` | A Postgres resource reference. |
| `redis` | A Redis resource reference. |
| `database` | Database name. |
| `stg` | Whether sites get a staging copy. |

### Resource references
A reference is the resource's name, optionally with the hostname(s) the site
uses for it:

```yaml
postgres: pg-main                                    # reachable as "postgres"
redis: redis-ofuma                                   # reachable as "redis"
postgres: { use: pg-main, as: dmb-postgres }         # reachable as "dmb-postgres"
postgres: { use: pg-main, as: [postgres, dmb-postgres] }
```

**Use the plain name** unless the site's code uses a different hostname. The
object form exists because abm and nihongo were written to reach dmb's
containers as `dmb-postgres` / `dmb-redis`, while dmb itself says `postgres` /
`redis`. Giving the futari app both names means no env file had to change.

### `email`
```yaml
email:
  mode: cloudflare                 # namecheap | cloudflare-pending | cloudflare
  forward_to: you@gmail.com        # the default inbox
  addresses:
    - admissions                   # a plain name → forward_to
    - hello
    - { address: abm, forward_to: someone@gmail.com }   # an object → its own inbox
  catch_all: true                  # true → forward_to · an address → that inbox · false → none
```

| `mode` | DNS it produces | Use it |
|---|---|---|
| `namecheap` | Namecheap's five `eforward*` MX records and its SPF | Only until the zone is active on Cloudflare (RUNBOOK.md §4.10). It mirrors today. |
| `cloudflare-pending` | No MX, no SPF. Terraform creates `forward_to` as an Email Routing destination, and Cloudflare emails it a verification link | For the few minutes while you verify the inbox and enable Email Routing in the dashboard, choosing that existing destination. Cloudflare refuses to enable routing while foreign MX records exist. |
| `cloudflare` | Nothing in DNS. Cloudflare adds and locks its own MX/SPF/DKIM when Email Routing is enabled. Terraform creates the routing rules. | Steady state. |

- **`addresses`:** each item becomes a rule for `<address>@<domain>`.
  - A **plain name** forwards to the app's `forward_to`.
  - An **object** `{ address, forward_to }` forwards to its own inbox, for
    example `abm@futari.live` going to someone else.
  - Listing an address twice is a render error.
- **`catch_all`:** what happens to mail for any address not listed.
  - `true` forwards it to `forward_to`.
  - An email address forwards it there instead.
  - `false` bounces it.
- **Every inbox must be verified.** Terraform creates each distinct inbox
  (`forward_to`, any per-address one, the catch-all's) as an Email Routing
  destination. Cloudflare emails each one a link, and until that inbox's owner
  clicks it, mail routed there is dropped silently. Render refuses any mode
  but `namecheap` while any of them is still the `CHANGE_ME` placeholder.
- **This is receive-only.** Sending as `@futari.live` goes through Brevo, as
  today. If you ever add a sending service that needs SPF, it must be merged
  into Cloudflare's **single** SPF record, never added as a second one.

### `dns`
Records that are not sites: mail verification, DKIM, DMARC, and the
temporary migration records. Each is
`{ type: A|AAAA|CNAME|TXT|MX, name: <label or "@">, content: …, priority?: n }`.
These are never proxied.

```yaml
dns:
  - { type: CNAME, name: brevo1._domainkey, content: b1.futari-live.dkim.brevo.com }
  - { type: TXT,   name: _dmarc,            content: "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com" }
```

Write TXT content **without** surrounding quotes. Terraform adds them, because
Cloudflare stores TXT values quoted.

---

## sites

```yaml
sites:
  main:
    repo: thedumebi/ofuma.ai
    services: { … }
    routes:
      "@": frontend:8080
      api: backend:3004
    www: redirect
```

| Key | Meaning |
|---|---|
| `repo` | `owner/name` of the repo whose CI deploys this site. Required for sites with services. Terraform gives that repo the `NAGAYA_*` Actions secrets. |
| `origin`, `stg_origin`, `postgres`, `redis`, `database`, `stg` | As in [defaults](#defaults); a site's own value wins. |
| `services` | The site's containers ([below](#services)). |
| `static` | Instead of services: a directory under `static/` that Caddy serves directly. No container, no image. The futari.live landing page is one. |
| `routes` | **Subdomain label → `service:port`**, or `static`. `"@"` is the domain itself. Each route becomes a Caddy block and a DNS record. The port must match the service's `port`, or render fails. |
| `www` | `redirect` adds `www.<domain>` with a permanent redirect to the apex. Needs a `"@"` route. |
| `network` | Join another site's network instead of getting your own. `doca` sets `network: main` because doca-api calls `http://backend:3004`. Both sites must have the same `stg` setting. |
| `cron` | Scheduled HTTP calls into a service ([below](#cron)). |

### `database`
The name of this site's database in its Postgres resource. Nagaya **does not
store the role or password**. Both come from the app's own encrypted env file,
baked into its image:

1. On each deploy, nagaya reads the service's env file out of the image and
   decrypts `PG_USERNAME`, `PG_PASSWORD` and `PG_DATABASE`.
2. It checks that `PG_DATABASE` equals the registry's `database`. A mismatch
   fails the deploy with a message saying which file to fix.
3. It creates the role if missing, sets its password to the env's value, and
   creates the database owned by that role if missing.
4. It makes the database **connectable only by its owner role** (plus the
   superuser): `REVOKE CONNECT … FROM PUBLIC`, `GRANT CONNECT … TO <role>`.
   Postgres would otherwise let every role connect to every database, so a
   staging login could open production. Sites that share a role (dmb, abm and
   nihongo all use `thedumebi`) can open each other's databases; give each its
   own `PG_USERNAME` to separate them.

So **rotating a database password is an env-file change and a deploy**.
Two sites that share a role must agree on its password. If they do not, nagaya
refuses rather than letting each deploy lock the other out (override for a
deliberate rotation: `NAGAYA_ROTATE=<role> nagaya deploy …`).

### `cron`
```yaml
cron:
  - name: reminders
    at: "*/15 * * * *"
    service: backend
    post: /notifications/run-reminders
    secret_header: { name: x-cron-secret, env: NIHONGO_CRON_SECRET }
```

Each entry is a POST to `http://127.0.0.1:<port><post>` **inside** the service's
container, sent by `nagaya cron <project>-<name>`, which the generated crontab
runs:

- **Internal, not through the public URL.** During a migration, a call to the
  public URL would reach whichever box DNS points at, so both boxes' crons
  could hit the same app. Calling inside the container cannot.
- **Skipped if the container is not running.** A stopped site never gets a
  call queued up for later.
- **Secret from nagaya's env.** `secret_header.env` names a key in nagaya's
  `.env.production`, sent as that header.
- **Production only.** Staging copies get no crons.
- **Ids:** a cron's id is `<project>-<name>`, e.g. `futari-nihongo-reminders`.
  Other sites can reuse a name; two crons with the same name **in one site**
  is a render error.

---

## services

abm's, which uses every key:

```yaml
services:
  backend:
    port: 3006
    mem: 384m
    aliases: [abm-backend]
    command: >-
      DB_MIGRATING=true node dist/db/migrate.js &&
      DB_SEEDING=true node dist/db/seed.js &&
      exec node dist/index.js
    health: /healthcheck
    mounts: [futari-geo]
    dotenvx: /app/abm/backend/.env.production
  frontend:
    port: 8080
    mem: 64m
    depends_on: [backend]
```

| Key | Meaning |
|---|---|
| `port` | What the process listens on inside the container. |
| `mem` | Hard memory cap. Exceeding it kills **this container only** (then `restart: unless-stopped` brings it back), never the box. |
| `command` | Overrides the image's CMD, run as `sh -c "<command>"`. This is where migrations and seeds run before the app starts. Write it on several lines with `>-`; whitespace is collapsed. End it with `exec node …` so Node, not the shell, receives the stop signal and shuts down cleanly. |
| `health` | Path that answers 2xx/3xx when the service is up. `nagaya deploy` polls it **inside the container** for up to 90 s, then rolls back to the previous tag if it never answers. |
| `dotenvx` | Path **inside the image** of the app's encrypted `.env.production`. Setting it makes nagaya inject that environment's `DOTENV_PRIVATE_KEY_*`, and the app decrypts its own file at start-up. The staging copy uses the `.env.staging` beside it. |
| `depends_on` | Other services **of the same site** to start first. Frontends list their backend: their nginx resolves `backend` when it starts, and fails if that container does not exist yet. It does not cover Postgres and Redis: they are in another compose project, and `nagaya apply` starts and waits for them before any site. |
| `aliases` | Extra hostnames for this container on its project network. The service key is always one. abm's backend adds `abm-backend` because abm's nginx proxies to that name. |
| `mounts` | Names from `resources.mounts`. |

### What nagaya passes into a container, and what it doesn't

**Exactly one value: `NODE_ENV`**, which is `production` for the production
project and `staging` for the staging copy. Every other value an app needs
comes from the app's own repo, baked into its image:

- **Backends** carry their dotenvx-encrypted `.env.production` and `.env.staging`,
  and pick one by `NODE_ENV`.
- **Frontends** (all five) are built with placeholders, and `env.sh` fills
  in their URL and title at container start from plaintext
  `runtime-env/production.env` or `runtime-env/staging.env`, picked by
  `NODE_ENV` the same way (RUNBOOK.md §1.4 for ofuma, §1.6 for futari). One
  image serves both environments, and the deploy workflows pass no build
  arguments.

So the registry never holds an app's configuration. It says what runs where,
not how each app is set up.

### The credential key names: a convention, not a setting
An app with a `database` must keep its credentials in its own env file under
exactly these names. nagaya reads them there on every deploy:

| Key | Used for |
|---|---|
| `PG_USERNAME`, `PG_PASSWORD` | creating the role, or resetting its password to match |
| `PG_DATABASE` | checking it equals the registry's `database` (`<database>_stg` for staging) |
| `REDIS_PASSWORD` | only if the site's Redis has `password_env`: checking it matches the Redis server |

There is no option to rename them. An app that uses other names renames them
in its own repo (doca did, RUNBOOK.md §1.5). The registry stays free of app
details. A wrong or missing name surfaces at deploy, with a message naming the
key and the file.

### Where keys live on the box
Each `dotenvx` service needs its app's `.env.keys` copied to
`/srv/nagaya/keys/<app>-<site>-<service>.keys`, e.g. `ofuma-main-backend.keys`.
Nagaya splits it into one file per environment,
`keys/<app>-<site>-<service>.<production|staging>.key`, each holding a single
`DOTENV_PRIVATE_KEY_<ENV>=…` line. That's what the container gets through
`env_file`, so a staging container is never handed the production key. It is
**not** the app's settings: those stay encrypted inside the image. RUNBOOK.md
§3.4 has the full table.

---

## Staging (`stg: true`)

`stg: true` on a site (or in `defaults`) makes a second, independent copy of it:

| | production project | staging project |
|---|---|---|
| Project / containers | `ofuma-main`, `ofuma-main-backend` | `ofuma-main-stg`, `ofuma-main-stg-backend` |
| Hostnames | `@`, `api`, `doca`, `api-doca` | `stg`, `api-stg`, `doca-stg`, `api-doca-stg` |
| Image | `ofuma-main-backend:<sha from master>` | the **same image name**, `<sha from stg>` |
| Env | `NODE_ENV=production`: the backend decrypts `/app/.env.production` with `DOTENV_PRIVATE_KEY_PRODUCTION`; the frontend loads `runtime-env/production.env` | `NODE_ENV=staging`: the backend's `.env.staging` with `DOTENV_PRIVATE_KEY_STAGING`; the frontend's `runtime-env/staging.env` |
| Database | `ofuma` | `ofuma_stg` |
| Redis | same instance | same instance. **The app must namespace itself** with a different `REDIS_DB` and key prefix (RUNBOOK.md §1.3), or staging workers would take production's jobs |
| DNS | `origin` | `stg_origin` (or `origin`) |
| Cron | yes | none |
| Running | always | **off by default** |

**Staging hostnames are always one label deep**: `api` becomes `api-stg`,
never `api.stg`. Cloudflare's free Universal SSL certificate covers
`ofuma.ai` and `*.ofuma.ai`, and a wildcard matches exactly one label. So it
covers `stg.ofuma.ai` and `doca-stg.ofuma.ai`, but not `doca.stg.ofuma.ai`,
and visitors to a two-level name get a certificate error at the edge. (Nooklet's
`stg.nooklet.co` is one level, which is why it works.) Two-level names need
Cloudflare's paid Advanced Certificate Manager. For the same reason staging
gets no `www` (`www.stg` would be two levels).

**On and off:**

```bash
nagaya stg up ofuma      # start every ofuma staging project
nagaya stg down ofuma    # stop them; volumes, database and DNS stay
```

A push to the staging branch (`stg`) deploys and switches that
project on. Up/down is runtime state on the box, not a registry change, so no
commit is needed. While staging is off, its hostnames serve a "Staging is off"
page (Caddy turns the 502 from a missing container into it).

---

## How names are derived

You never write these. They are fixed functions of the registry:

| Thing | Rule | Example |
|---|---|---|
| Project | `<app>-<site>`, plus `-stg` | `ofuma-doca-stg` |
| Container | `<project>-<service>` | `ofuma-doca-stg-doca-api` |
| Image | `<registry>/<app>-<site>-<service>` (same for prod and stg) | `ghcr.io/thedumebi/ofuma-doca-doca-api` |
| Project network | `<app>-<site>` (or the `network:` site's), plus `-stg` | `ofuma-main-stg` |
| Hostname | `<label>.<domain>`, `"@"` → `<domain>` | `api-doca.ofuma.ai` |
| Staging label | `"@"` → `stg`, `x` → `x-stg` | `api-doca-stg` |
| Staging database | `<database>_stg` | `ofuma_stg` |
| Keys file (copied up) | `/srv/nagaya/keys/<app>-<site>-<service>.keys` | `ofuma-doca-doca-api.keys` |
| Key file (per env, made by nagaya) | `…/<app>-<site>-<service>.<production\|staging>.key` | `ofuma-main-backend.staging.key` |
| Image tag record | `/srv/nagaya/state/tags/<project>.env` | `TAG=3f2c1ab…` |
| Cron id | `<project>-<name>` | `futari-nihongo-reminders` |
| Alert check log | `/srv/nagaya/logs/alerts-<check>.log` | `alerts-memory.log` |
| Backup object | `<bucket>/<db>/<db>-<UTC stamp>.sql.gz` | `ofuma-backups/ofuma/ofuma-2026-10-04T03-00-00Z.sql.gz` |

---

## Networking, in one picture

```
                      edge network (Caddy + every routed container)
   ┌──────────┐  ┌─────────────────────┬──────────────────────┬────────────────────────┐
   │  caddy   │──│ futari-dmb-frontend │ ofuma-main-frontend  │ ofuma-main-stg-frontend│ …
   └──────────┘  └─────────────────────┴──────────────────────┴────────────────────────┘

   network futari-dmb                 network ofuma-main                network ofuma-main-stg
   ├─ futari-dmb-backend  "backend"   ├─ ofuma-main-backend "backend"   ├─ ofuma-main-stg-backend "backend"
   ├─ futari-dmb-frontend "frontend"  ├─ ofuma-main-frontend           ├─ …
   ├─ pg-main  "postgres","dmb-postgres"  ├─ ofuma-doca-doca-api "doca-api"
   └─ redis-futari "redis","dmb-redis"    ├─ pg-main      "postgres"
                                          └─ redis-ofuma  "redis"
```

- **Each project network is private to that site.** That is why the hostname
  `backend` can mean a different container in every network, and why
  `redis` resolves to `redis-futari` for dmb and `redis-ofuma` for ofuma.
- **Resources are attached by `nagaya apply`** (`docker network connect
  --alias`), outside compose. If core.yml listed every project network,
  adding a site would make compose recreate Postgres and briefly drop every
  other site's connections.
- **Caddy only joins `edge`.** It reaches containers by their unique container
  names (`ofuma-main-stg-frontend:8080`), so the same `frontend` alias in
  different networks never confuses it.
- **Nothing publishes a port except Caddy (443) and Postgres (127.0.0.1:`tunnel_port`).**
  Docker-published ports bypass ufw, because their traffic is DNATed through
  FORWARD, not INPUT. So `generated/firewall.sh` also restricts Caddy's 443
  in Docker's own `DOCKER-USER` chain (RUNBOOK.md §2.9). Any new `ports:` entry
  would need the same treatment; keeping the list to two is what makes the
  firewall mean something.

---

## What `pnpm render` refuses

The point of the registry is that mistakes fail at render time, on your
laptop or in the PR, rather than on the box. It refuses:

- **Shape and references:**
  - a key it does not know (a typo like `ww:` for `www:`);
  - a reference to an origin, resource or mount that is not defined;
  - a site with both `static` and `services`, or neither;
  - a site with services and no `repo`;
  - an alert check nagaya has no code for.
- **Routes and DNS:**
  - a route to a service that does not exist, or on the wrong port;
  - a hostname routed twice;
  - a CNAME sharing a name with another record;
  - a site pointed at an origin whose `ip` is still `null`;
  - `www: redirect` on a site with no `"@"` route.
- **Containers and data:**
  - two containers claiming the same alias on one network (Docker would pick between them at random);
  - a `depends_on` naming anything but another service of the same site;
  - two Postgres resources with the same `tunnel_port`;
  - a `database` with no `postgres`, or with no service whose env holds its credentials;
  - an app with a database but no backup bucket;
  - two crons with the same name in one site.
- **Staging:**
  - `network:` joining a site with a different `stg` setting;
  - a `dotenvx` path that is not a `.env.production` file.
- **Email:** the same address listed twice; any mode but `namecheap` while an inbox is still a `CHANGE_ME` placeholder.

CI runs `pnpm render:check` and fails if `generated/` is not exactly what
`sites.yaml` produces. A hand edit in `generated/` is always caught.

---

## Recipes

**Point a site at a different machine:** set its `origin:` and merge.

**Give an existing site a staging copy:**
1. Set `stg: true` on the site.
2. In the app repo:
   - the backend's `.env.staging` exists next to `.env.production`, is baked
     into the image, and sets `PG_DATABASE=<database>_stg` and its own
     `PG_USERNAME`/`PG_PASSWORD`;
   - the frontend has `runtime-env/staging.env` with the `-stg` URLs;
   - if the site's Redis is shared with production (as ofuma's is), the app
     namespaces itself with `REDIS_DB` and `REDIS_PREFIX` (RUNBOOK.md §1.3).
3. Merge, then push to the repo's staging branch, which deploys staging and
   switches it on.

**Raise a memory cap:** change `mem:` and merge. The container is recreated
with the new cap on the next `nagaya apply`.

**Change when an alert check runs, or switch one off:** edit or delete its
entry under `alerts.checks` and merge. The crontab follows.

**Add a scheduled job:**
1. Add a `cron:` entry to the site.
2. Put the secret in nagaya's `.env.production`:
   `dotenvx set KEY value -f .env.production`.
3. Merge.

**Remove a site:**
1. Delete its block and merge. Terraform deletes its DNS records, and `nagaya
   apply` stops and removes its containers.
2. The database and its backups stay. Drop the database by hand when you are
   sure: `nagaya psql postgres` then `DROP DATABASE …`.
