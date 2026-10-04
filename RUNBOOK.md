# nagaya runbook

Every step to build the nagaya box and move the futari and ofuma sites onto
it, then how to run it. Why it is built this way (the decisions, the
architecture, the memory budget) is in **[DEPLOY.md](DEPLOY.md)**. What each
key of `sites.yaml` means is in **[docs/sites-yaml.md](docs/sites-yaml.md)**.

Every step is tagged with where it runs: 💻 LAPTOP, 🖥️ SERVER, 🌐 BROWSER.
Read [Conventions](#conventions) first; the laptop has a shell trap that
silently kills compound commands.

---

### Conventions

| Tag | Where |
|---|---|
| 💻 **LAPTOP** | your Mac. Paths below assume the repos sit side by side in `~/Documents/projects/` |
| 🖥️ **SERVER** | an SSH session on **nagaya**. **Each step says which user** |
| 🖥️ **HETZNER** | an SSH session on one of the **old** boxes, named in the step |
| 🌐 **BROWSER** | a web dashboard (netcup, Cloudflare, Namecheap, GitHub) |

> **Which user runs a server command.** §2.4–§2.6 run as **`root`** (the `deploy`
> user does not exist until §2.5, and §2.6 is what disables root SSH). From **§2.7
> onward everything runs as `deploy`**, using `sudo` where needed. Every 🖥️ heading
> names the user.

> **If a button label has moved.** The 🌐 steps quote the labels the vendors'
> dashboards use today. Dashboards get redesigned; if a label does not match,
> the intent of the step is still right. Find the equivalent control and
> **fix this file in the same commit**. A runbook that drifts silently is worse
> than none.

> ⚠️ **The `cd` trap on this machine.** Your shell has a `cd` *function* that runs
> `nvm use` in any directory with an `.nvmrc`, and every repo here has one. In a
> non-interactive shell `nvm` is undefined, so a bare `cd` **exits 127 and kills
> the whole compound command**, printing nothing. Every 💻 command block that
> uses `cd` starts with:
> ```bash
> unset -f cd pnpm node npm npx 2>/dev/null
> ```
> This does **not** apply to 🖥️ SERVER or HETZNER commands.

> ⚠️ **Comments in pasted commands.** Most blocks here end lines with
> `# expect: …`. In zsh that is only a comment if `interactivecomments` is on;
> it is **off by default**, and then the `#` and every word after it are
> passed to the command as arguments (`head: #: No such file or directory`).
> Turn it on once, for good:
> ```bash
> echo 'setopt interactivecomments' >> ~/.zshrc && source ~/.zshrc
> ```

> **Node 24 for this repo.** `nagaya` uses Node 24 (`.nvmrc` says `24`), which
> runs the TypeScript renderer directly with no build step. The app repos stay
> on their own versions.

### Names used throughout

| Placeholder | Meaning |
|---|---|
| `nagaya` | the `~/.ssh/config` alias for `deploy@152.53.205.203` (the box), set up in §2.3 |
| `<sha>` | a full git commit SHA that an app repo's CI built images for |
| project ids | `futari-dmb`, `futari-abm`, `futari-nihongo`, `ofuma-main`, `ofuma-doca`, `ofuma-main-stg`, `ofuma-doca-stg` |

---

## The order to do things in

One pass, top to bottom. Nothing refers forward to a step further down, and
reference material is at the end. The Done column is for you to tick.

| Phase | What | Where | Done? |
|---|---|---|:--:|
| **0** | Accounts and laptop tools | 🌐 💻 | |
| **1** | Prepare the app repos (safe to ship now; Hetzner is unaffected) | 💻 🌐 | |
| **2** | Order and harden the netcup box, clone nagaya onto it | 🌐 🖥️ 💻 | |
| **3** | nagaya's own secrets, the apps' keys, certificates' CSRs, GeoLite | 💻 🖥️ | |
| **4** | Cloudflare through Terraform: zones, nameservers, email, origin certs | 🌐 💻 🖥️ | |
| **5** | First `nagaya apply`: Caddy, Postgres 18, Redis up and empty | 🖥️ 💻 | |
| **6** | Cut over one site at a time: nihongo → abm → dmb + root → ofuma | 🖥️ 💻 🌐 | |
| **7** | ofuma staging: save its data now, bring it up when wanted | 🖥️ 💻 | |
| **8** | Backups verified and a restore drill passed | 🖥️ | |
| **9** | Decommission Hetzner and the migration scaffolding | 🌐 💻 | |

> **Nothing is cut over until Phase 6.** Phases 0–5 build the new home next to
> the old ones. Until a site's DNS record moves in §6.x, visitors never touch
> nagaya, and every step before that can be redone.

---

## Working while blocked

| Blocked on | You can still do |
|---|---|
| **netcup order review** (§2.1, usually same-day, sometimes 1–2 days) | All of Phase 1. §3.1 (create nagaya's `.env.production`; the box is not needed). §4.1–§4.3 (Cloudflare and GitHub tokens, the state bucket). |
| **Nameserver propagation** (§4.9) | §3.5 GeoLite seed. Build images for every site (Phase 1.7 workflows, "deploy" unticked). |
| **A site's maintenance window** (Phase 6) | Cut over the sites in any order you like after nihongo, which goes first because it is the simplest. |

Two things that look parallel and are not:

- **§4.10 email and §4.9 activation.** Email Routing cannot be enabled until
  the zone is active on Cloudflare. Between the nameserver change and §4.10,
  mail still flows only if the Namecheap MX records keep working. Do §4.10
  straight after activation, at a quiet hour.
- **§5.1 needs §4.11.** Caddy will not start without the origin certificates
  on disk, and `nagaya apply` stops at that point.

---

## Phase 0 — Accounts and laptop tools

**0.1** 🌐 **BROWSER** — confirm the accounts:

| Account | For | Notes |
|---|---|---|
| netcup CCP | ordering the VPS | Same account as Nooklet's box |
| Cloudflare | DNS, WAF, Origin CA, Email Routing, R2 | Same login as Nooklet; R2 is already in use (`dmb-backups`, `ofuma-backups`) |
| GitHub `thedumebi` | the app repos, GHCR, the new `nagaya` repo | |
| Namecheap | registrar for futari.live and ofuma.ai | Stays the registrar; only the nameservers move |

**0.2** 💻 **LAPTOP** — toolchain:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null
node --version      # expect v24.x
pnpm --version      # any 9 or 10
dotenvx --version   # if missing: npm i -g @dotenvx/dotenvx
```

**0.3** 💻 **LAPTOP** — Terraform and the GitHub CLI:
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform gh
terraform version   # expect >= 1.10 (use_lockfile needs it)
gh auth login       # GitHub.com → HTTPS → login with a browser
```
> Use `hashicorp/tap/terraform`, not `brew install terraform`. Homebrew core
> stopped updating Terraform after the licence change; the tap is HashiCorp's
> own and current.

**0.4** 💻 **LAPTOP** — the repo's own dependencies:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
pnpm install
pnpm test && pnpm render:check     # expect: every test passes, "generated/ matches sites.yaml"
```

---

## Phase 1 — Prepare the app repos

Changes that make each app's images runnable on nagaya. **Every one of them is
safe to merge now.** Hetzner keeps deploying exactly as before, because
everything here is either inert there or an improvement.

> ✅ **Done 2026-10-04.** All of 1.1–1.7 is merged and pushed: futari's on
> `master`; ofuma's on both `master` and `stg` (cherry-picked onto `master`,
> so `stg`'s Piston commit stayed off production). Hetzner redeployed every
> site cleanly, and the first nagaya image builds passed in all four repos.
> The steps below stay as the record of what was done and why.

### 1.1 💻 LAPTOP — bake the encrypted env file into dmb, abm and nihongo's backend images

On Hetzner each backend gets `.env.production` from a **bind mount** of the
repo checkout. On nagaya there is no checkout (the box only pulls images), so
the encrypted file has to be inside the image. ofuma already works this way.

It is safe because every value in the file is ciphertext, and the decryption
key is never in the image: it is injected at run time from
`/srv/nagaya/keys`. Someone with the image alone has nothing.

For **each** of dmb, abm and nihongo (shown for dmb; replace `dmb` throughout):

1. `.dockerignore`. The repo excludes `**/.env.*`. Add one exception
   **after** that line (in `.dockerignore` the last matching rule wins):
   ```
   **/.env.*
   !dmb/backend/.env.production
   ```
2. `dmb/backend/Dockerfile`, in the `runner` stage, directly **after**
   `WORKDIR /app/dmb/backend`:
   ```dockerfile
   # The dotenvx-ENCRYPTED env file. Safe in the image: the key is injected at
   # run time (nagaya: /srv/nagaya/keys). On Hetzner a bind mount still
   # overrides this copy, so behaviour there is unchanged.
   COPY dmb/backend/.env.production ./.env.production
   ```
3. Prove it from the repo root (Docker Desktop or colima running):
   ```bash
   unset -f cd pnpm node npm npx 2>/dev/null
   cd ~/Documents/projects/dmb.futari
   docker build --platform linux/amd64 -f dmb/backend/Dockerfile -t dmb-backend:envcheck .
   docker run --rm --platform linux/amd64 --entrypoint sh dmb-backend:envcheck -c '
     f=.env.production; echo "$PWD/$f"
     echo "encrypted: $(grep -cE "^[A-Z0-9_]+=\"?encrypted:" $f)"
     echo "plain: $(grep -E "^[A-Z0-9_]+=" $f | grep -vE "=\"?encrypted:" | cut -d= -f1 | tr "\n" " ")"'
   # expect: /app/dmb/backend/.env.production, encrypted: <every setting>,
   # plain: DOTENV_PUBLIC_KEY_PRODUCTION and nothing else.
   # Prints key NAMES only, never a value.
   docker rmi dmb-backend:envcheck
   ```
4. Commit and push. Hetzner redeploys as usual; the bind mount still wins there.

> The path matters: `sites.yaml` says `dotenvx: /app/dmb/backend/.env.production`,
> and that is where nagaya reads the database credentials from. If a Dockerfile
> ever moves its `WORKDIR`, update `sites.yaml` in the same change.

### 1.2 💻 LAPTOP — trust the proxy for the real client IP

**Why this matters on nagaya.** The request path becomes:
```
Cloudflare → Caddy → frontend nginx → backend
```
Caddy writes the visitor's real IP into `X-Forwarded-For` (it reads
`CF-Connecting-IP`, trusting it only from Cloudflare's ranges). The backends'
rate limiter takes the first `X-Forwarded-For` hop **only if the TCP peer is
inside `TRUSTED_PROXY_CIDRS`**, and here the peer is the frontend nginx.

**What goes wrong without it.** Without the setting, every visitor shares the
nginx container's IP, and so shares one rate-limit bucket.

- dmb and abm have no `TRUSTED_PROXY_CIDRS` at all.
- ofuma's still lists DigitalOcean Kubernetes ranges from before Hetzner.
- nihongo is already right (`172.16.0.0/12,10.0.0.0/8`).

nagaya pins Docker's address pool inside `172.16.0.0/12` (§2.7), so that one
range is enough:

```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/dmb.futari
dotenvx set TRUSTED_PROXY_CIDRS "172.16.0.0/12" -f dmb/backend/.env.production
cd ../abm.futari
dotenvx set TRUSTED_PROXY_CIDRS "172.16.0.0/12" -f abm/backend/.env.production
cd ../ofuma
dotenvx set TRUSTED_PROXY_CIDRS "172.16.0.0/12" -f ofuma/backend/.env.production   # on master
```
(ofuma's `.env.staging` is changed in §7.3, on the `stg` branch.)

`dotenvx set` encrypts the value as it writes it. Check before committing:
```bash
grep '^TRUSTED_PROXY_CIDRS=' dmb/backend/.env.production   # expect ="encrypted:…"
```

This is also correct on Hetzner, where Docker's subnets are 172.x and Caddy
already overwrites `X-Forwarded-For` with the real peer. Shipping it now fixes
per-visitor rate limiting there too.

### 1.3 💻 LAPTOP — ofuma: let staging share Redis safely *(needed before the first `stg up`, not before Phase 6)*

ofuma prod and staging share one Redis (`redis-ofuma`). Today every connection
uses database 0, so a staging worker would pull **production's** BullMQ jobs
off the same queues. Two settings keep them apart, one new and one existing:

| Var | Separates | prod | stg |
|---|---|---|---|
| `REDIS_DB` *(new)* | keys and BullMQ queues: the ioredis `db` option, a separate keyspace | `0` (default) | `1` |
| `EVENT_CHANNEL_PREFIX` *(exists)* | the evaluation-event pub/sub channels | `evaluation:events` (default) | `stg:evaluation:events` |

- **Why `REDIS_DB` covers the queues:** BullMQ keeps everything in keys
  (lists, sorted sets, streams) and uses no pub/sub, so a separate database
  is a complete separation. No BullMQ `prefix` is needed.
- **Why the channels need their own setting:** Redis pub/sub **ignores the
  database number**; channels are shared across the whole server. ofuma's
  event emitter and subscriber already build every channel name from
  `EVENT_CHANNEL_PREFIX`, so staging only has to set a different value (§7.3).
  It can't be injected on the connection instead: ioredis' `keyPrefix` skips
  pub/sub channels, and BullMQ rejects connections that set it.

The code change (on `master` and `stg`, after §1.5, whose doca file it shares):

- `ofuma/shared/src/types/env.ts` and `doca/shared/src/env.ts`: `REDIS_DB`, default `0`
- `db: env.REDIS_DB` on every Redis connection: `ofuma/shared/src/utils/redis.ts`,
  `services/queue/queue-manager.ts`, `services/events/event-emitter.ts`,
  `event-subscriber.ts`, and `doca/api/src/workers/generation-worker.ts`.
  doca uses no pub/sub, so it needs nothing else.

Checked 2026-10-04: ofuma/shared, ofuma/backend and doca/shared typecheck clean;
doca/api has the same 13 errors `stg` already had (stale imports, none in these
lines); ofuma's tests pass. With the defaults, production behaves exactly as
before, so this can merge any time. 

### 1.4 💻 LAPTOP — ofuma: the frontends read their runtime values from their own repo

ofuma's frontend and doca-web are built with **placeholders**. The
`.env.production` beside each one holds literal names like
`VITE_API_URL=OFUMA_API_URL`, and at container start `env.sh` replaces every
`OFUMA_*` (or `DOCA_*`) placeholder in the built files with the environment
variable of that name.

- **On Hetzner** those variables came from decrypting the *backend's* env file
  on the host, which needed a checkout of the repo.
- **On nagaya** there is no checkout, and the values belong to the app, not to
  infrastructure.

So they move into the app repo: one plaintext file per environment, baked into
the image, chosen by `NODE_ENV`, exactly like the backends.

**1.4.1** — the values, as new files (public values, plaintext, committed):

`ofuma/frontend/runtime-env/production.env`
```dotenv
OFUMA_API_URL=https://ofuma.ai/api
OFUMA_APP_TITLE=Ofuma.ai
OFUMA_DOCA_URL=https://doca.ofuma.ai
OFUMA_CONTACT_EMAIL_GENERAL=hi@ofuma.ai
OFUMA_CONTACT_EMAIL_SALES=sales@ofuma.ai
OFUMA_CONTACT_EMAIL_SUPPORT=support@ofuma.ai
OFUMA_CONTACT_EMAIL_SECURITY=security@ofuma.ai
OFUMA_CONTACT_EMAIL_PRIVACY=privacy@ofuma.ai
OFUMA_CONTACT_EMAIL_LEGAL=legal@ofuma.ai
```
`ofuma/frontend/runtime-env/staging.env`: the same keys, with
`OFUMA_API_URL=https://stg.ofuma.ai/api`, `OFUMA_APP_TITLE=Ofuma.ai [Staging]`
and `OFUMA_DOCA_URL=https://doca-stg.ofuma.ai`.

`doca/web/runtime-env/production.env`
```dotenv
DOCA_API_URL=https://doca.ofuma.ai/api
DOCA_APP_TITLE=Doca
DOCA_OFUMA_URL=https://ofuma.ai
DOCA_OFUMA_API_URL=https://ofuma.ai/api
```
`doca/web/runtime-env/staging.env`: `https://doca-stg.ofuma.ai/api`,
`Doca [Staging]`, `https://stg.ofuma.ai`, `https://stg.ofuma.ai/api`.

(These are today's production values, from the env that Hetzner's deploy
decrypted, and the single-level staging names from Phase 7.)

> Why a `runtime-env/` folder and not `.env.staging`: Vite reads
> `.env.<mode>` files at **build** time, and `.env.production` is already the
> placeholder file for the build. A separate folder keeps build-time
> placeholders and run-time values from being confused with each other.

**1.4.2** — `ofuma/frontend/Dockerfile`, runner stage, next to the other `COPY` lines
(the same in `doca/web/Dockerfile` with `doca/web/…`):
```dockerfile
# Per-environment runtime values; env.sh loads the one matching NODE_ENV.
COPY --chown=nginx-app:nginx-app ofuma/frontend/runtime-env /etc/app-env
```

**1.4.3** — `ofuma/frontend/env.sh` (and `doca/web/env.sh`), after the
`ASSET_DIR` default and **before** the substitution loop:
```sh
# Load this environment's values from the image (NODE_ENV comes from nagaya).
# A variable already set in the container's environment wins, so a one-off
# override with `docker run -e` still works.
ENV_FILE="/etc/app-env/${NODE_ENV:-production}.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading $ENV_FILE"
    while IFS='=' read -r key value; do
        case "$key" in ''|\#*) continue ;; esac
        eval "already=\${$key+set}"
        [ -n "$already" ] || export "$key=$value"
    done < "$ENV_FILE"
else
    echo "WARNING: $ENV_FILE not found; placeholders will stay unreplaced"
fi
```

**1.4.4** — prove it locally:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/ofuma
docker build --platform linux/amd64 -f ofuma/frontend/Dockerfile --target runner -t ofuma-fe:check .
docker run --rm -e NODE_ENV=staging -p 8089:8080 ofuma-fe:check   # logs "Loading /etc/app-env/staging.env", "Completed N replacements"
# another terminal:
curl -s localhost:8089 | grep -o 'Ofuma.ai \[Staging\]' | head -1
```

On Hetzner nothing changes: its compose still passes the `OFUMA_*` variables
explicitly, and those win over the file.

### 1.5 💻 LAPTOP — doca: the standard database key names

nagaya reads every app's database credentials from the app's own env file
under fixed names: `PG_USERNAME`, `PG_PASSWORD`, `PG_DATABASE`, plus
`REDIS_PASSWORD` when its Redis has a password. dmb, abm, nihongo and the ofuma
backend already use them. doca prefixed them all with `DOCA_`, so its keys
were renamed:

| Was | Now |
|---|---|
| `DOCA_PG_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `_DATABASE` | `PG_HOST` / `PG_PORT` / `PG_USERNAME` / `PG_PASSWORD` / `PG_DATABASE` |
| `DOCA_REDIS_HOST` / `_PORT` / `_PASSWORD` | `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` |

doca's other `DOCA_*` settings (`DOCA_PORT`, `DOCA_DB_POOL_MAX`, the prompt ids,
`DOCA_DATABASE_URL`…) are its own business and keep their prefix. There is no
clash: doca runs as its own process with its own env file, which has no other
`PG_*` or `REDIS_*` keys. Its `@ofuma/shared` imports (constants, openapi,
types) never load ofuma's env schema.

The change is on branch **`nagaya/doca-standard-db-env`** in the ofuma repo,
cut from `stg`:

- `doca/shared/src/env.ts` and `doca/api/src/workers/generation-worker.ts`: the new names.
- `doca/api/.env.production` and `.env.staging`: each encrypted line's **name**
  changed and its ciphertext left as it was. dotenvx encrypts the value only,
  so every value decrypts exactly as before. This was checked by comparing
  hashes of the decrypted values before and after, never the values.
- `doca/GETTING_STARTED.md`, the legacy `k8s/` doca manifests, and a comment
  in `docker-compose.prod.yml`.
- Your untracked local `doca/api/.env` got the same rename, so local dev keeps working.

Merge it: PR into `stg`, then `stg` into `master` as usual. It is safe on
Hetzner. The code and its env file change together in one commit, and Hetzner's
compose never names doca's database keys itself.

### 1.6 💻 LAPTOP — futari: the frontends read their runtime values from their own repo

The same change as ofuma's §1.4, for dmb, abm and nihongo. It makes their
frontends work like their backends:
- **one image** serves production and staging;
- the values live **in the app repo, per environment**;
- **nagaya passes only `NODE_ENV`**.

**Why it is needed.** Today these frontends have their API URL and title
**baked in at build time** (`ARG VITE_API_URL` in the Dockerfile). A futari
staging copy would run the production image, and its staging frontend would
call the **production** API. The nagaya deploy templates (§1.7) pass no build
arguments, so **do this before a repo's first nagaya image build**.

The change was made on branch **`nagaya/frontend-runtime-env`** in each of
`dmb.futari`, `abm.futari` and `nihongo.futari`, and is merged. Each touches four files (shown for dmb;
abm and nihongo use `ABM_` / `NIHONGO_`):

| File | What it does |
|---|---|
| `dmb/frontend/runtime-env/production.env` | `DMB_API_URL=https://dmb.futari.live/api`, `DMB_APP_TITLE=DMB`. Today's live values |
| `dmb/frontend/runtime-env/staging.env` | `DMB_API_URL=https://dmb-stg.futari.live/api`, `DMB_APP_TITLE=DMB [Staging]`. Only used if the site ever gets `stg: true` |
| `dmb/frontend/env.sh` | At container start (as `/docker-entrypoint.d/40-runtime-env.sh`): loads `/etc/app-env/${NODE_ENV:-production}.env`, then replaces every `DMB_*` placeholder in the built `.js`/`.html`/`.css` with its value. A variable already set in the container's environment wins. POSIX `sh`, since the nginx Alpine image has no bash |
| `dmb/frontend/Dockerfile` | The build stage sets `VITE_API_URL=DMB_API_URL` and `VITE_APP_TITLE=DMB_APP_TITLE` (placeholders) instead of taking `ARG`s. The runner copies `env.sh` and `runtime-env/`, and gives the built files to uid 101 so the unprivileged nginx user can rewrite them |

nihongo's title stays `go`, which is what its live `.env.production` sets
today. Edit `runtime-env/production.env` before committing if that was never
intended.

**Already checked** when the change was written (2026-10-04):
- dmb's real frontend, built the way the Dockerfile builds it, succeeds, and
  its output contains the placeholders (`DMB_API_URL`, `DMB_APP_TITLE` ×5,
  including the `<title>` and Open Graph tags);
- `env.sh`, run on that output, fills in the staging values with
  `NODE_ENV=staging` and keeps a value containing `&` and `|` intact;
- each branch was cut from that repo's `master` as of that day.

**1.6.1** 💻 **LAPTOP** — review, for each repo (shown for dmb):
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/dmb.futari
git switch nagaya/frontend-runtime-env
git status --short
#  M dmb/frontend/Dockerfile
# ?? dmb/frontend/env.sh
# ?? dmb/frontend/runtime-env/
git diff dmb/frontend/Dockerfile
cat dmb/frontend/env.sh dmb/frontend/runtime-env/*.env
```
> If `master` has moved on since 2026-10-04, bring the branch up to date
> after committing (1.6.3): `git fetch && git rebase origin/master`.

**1.6.2** 💻 **LAPTOP** — prove the container end to end (needs Docker running):
```bash
docker build --platform linux/amd64 -f dmb/frontend/Dockerfile -t dmb-fe:check .
docker run --rm -d --name dmb-fe-check -e NODE_ENV=staging -p 8089:8080 dmb-fe:check
docker logs dmb-fe-check | grep runtime-env      # loading /etc/app-env/staging.env, replaced 2 placeholder(s)
curl -s localhost:8089 | grep -o '<title>[^<]*'  # <title>DMB [Staging]
docker rm -f dmb-fe-check && docker rmi dmb-fe:check
```

**1.6.3** 💻 **LAPTOP** — commit and merge:
```bash
git add dmb/frontend/Dockerfile dmb/frontend/env.sh dmb/frontend/runtime-env
git commit -m "Frontend reads its URL and title at start-up from runtime-env/<NODE_ENV>.env"
git push -u origin nagaya/frontend-runtime-env     # PR into master, merge
```

**It's safe on Hetzner** before cutover:
- Hetzner's compose still passes `VITE_API_URL` as a build argument; the
  Dockerfile no longer reads it, so Docker only warns that it's unused.
- Hetzner's frontend container sets no `NODE_ENV`, so `env.sh` uses
  `production.env`, which holds exactly today's values.

### 1.7 💻 LAPTOP — add the nagaya deploy workflows (push trigger off)

Each app repo gets a workflow that builds images in CI, pushes them to GHCR
and, when asked, tells nagaya to deploy them. Templates are in this repo:

| Copy | To |
|---|---|
| `templates/app-repo/futari-dmb.yml` | `dmb.futari/.github/workflows/deploy-nagaya.yml` |
| `templates/app-repo/futari-abm.yml` | `abm.futari/.github/workflows/deploy-nagaya.yml` |
| `templates/app-repo/futari-nihongo.yml` | `nihongo.futari/.github/workflows/deploy-nagaya.yml` |
| `templates/app-repo/ofuma.yml` | `ofuma/.github/workflows/deploy-nagaya.yml`, on **master** and **stg** |

> **ofuma and doca ship together from `master` (production) and `stg`
> (staging).** One workflow builds all four images and deploys `ofuma-main`
> and then `ofuma-doca` at the same SHA. The `doca/master` and `doca/dev`
> branches stopped on 2026-04-29, before the repo was restructured; doca's
> current code is on `master`/`stg`. The old `deploy-doca-*-vps` workflows
> exist only on `master` but trigger on pushes to `doca/master`/`doca/stg`.
> GitHub runs a push workflow from the pushed branch's own files, so those
> could never fire. Ignore those branches.
>
> A `workflow_dispatch` run uses the workflow file **from the branch you
> pick**, so the file must be on both `master` and `stg`.

They ship with `push:` **commented out** and a `deploy` checkbox that defaults
to off. Until a site is cut over, you run them by hand to **build images
only**; the old `deploy-vps.yaml` keeps deploying to Hetzner on push. Each
site's cutover step turns `push:` on and deletes the old workflow.

**The templates pass no frontend values.** Every frontend, futari's included,
is built with placeholders and reads its URL and title at start-up from
`frontend/runtime-env/<NODE_ENV>.env` in its own repo (§1.4 for ofuma, §1.6
for futari). That is why this step comes last: §1.1 and §1.4–§1.6 must be
merged in a repo **before** its nagaya workflow builds images.

**1.7.1** 🌐 **BROWSER (GitHub)** — run each new workflow once to create its
images: repo → **Actions** → **Deploy (nagaya)** → **Run workflow** → branch
`master`, **Deploy after building** unticked → **Run workflow**. Expect the
**test** job, then one **build** job per service, all green.

**1.7.2** 🌐 **BROWSER (GitHub)** — check the packages exist and are private:
profile → **Packages**. Expect `futari-dmb-backend`, `futari-dmb-frontend`,
and so on, each **Private** and linked to its repo.

> **nihongo's two packages are Public**, and that is expected: a package
> pushed from a workflow takes its repo's visibility, and `nihongo.futari` is
> a public repo. The image holds nothing the repo does not already publish
> (the code and the same dotenvx-encrypted `.env.production`). nagaya pulls
> every image with its token either way. Checked 2026-10-04: the other eight
> refuse an anonymous pull.

> ⚠️ **If a build fails with `denied: permission_denied: write_package`:** the
> package already existed (from a manual push) and is not linked to this repo.
> Package → **Package settings** → **Manage Actions access** → **Add
> repository** → the repo → role **Write**. Nooklet hit exactly this (§8.4 there).

---

## Phase 2 — Order and harden the netcup box

Adapted from Nooklet's Phase 3, which has been run for real on the same VPS
model. Differences: hostname `nagaya`; no k3s, so no pod/service CIDRs in the
firewall; Docker gets a daemon config; the repo lives in `/srv/nagaya`.

**2.1** 🌐 **BROWSER (netcup)** — order the server. *(done: the box exists, currently with netcup's default Debian; §2.2 replaces it with Ubuntu)*

1. `https://www.netcup.com/en/server/vps` → **VPS 500 G12** (2 vCore / 4 GB DDR5 / 128 GB NVMe).
2. In the configurator:

   | Option | Choose | Why |
   |---|---|---|
   | **Contract period** | `0 months` (+€0.90/mo) | Hourly billing, no commitment. |
   | **Location** | **Nuremberg, Germany** (+€0.90/mo) | ⚠️ **Irreversible.** The location cannot change after setup. Nuremberg matches Nooklet's box, and Hetzner's Falkenstein is next door. |

   There is no OS choice at checkout. You install it in §2.2.
   Expected total: **~€7.71/mo incl. 19% VAT**, no setup fee.
3. Complete checkout. **Expect a manual review** ("Your order will be checked
   by one of our employees shortly"), usually the same day. Answer any ID or
   payment questions promptly. Meanwhile, see [Working while blocked](#working-while-blocked).
4. You get **two logins**: **CCP** (`customercontrolpanel.de`) for billing and
   upgrades, and **SCP** (`servercontrolpanel.de`) for the server itself: power,
   console, OS install, snapshots.
5. In the **SCP**, open the server and note its **IPv4**: **`152.53.205.203`**. It is
   already in `sites.yaml` (`origins.nagaya`) and written into every command
   below. Nothing points at that origin yet, so it changes no DNS.

**2.2** 🌐 **BROWSER (netcup SCP)** — install Ubuntu.

1. SCP → the server → **Media** → **Images** tab.
2. Under **Official Images**: **`Ubuntu 24.04.5 UEFI amd64`** → **Minimal**.

   | Axis | Pick | Why |
   |---|---|---|
   | Version | **24.04** | LTS to 2029 and in Docker's tested matrix; the same as Nooklet. |
   | Firmware | **UEFI** | netcup's modern default. |
   | Variant | **Minimal**, not `cloudimg` | `cloudimg` ships cloud-init, which takes over users, SSH keys and `sshd_config` on boot and can quietly undo §2.5–§2.6. |

3. Install form. Set what it offers; **the form varies**, and anything it
   does not offer is set on the box in §2.5:

   | Field | Set to | Why |
   |---|---|---|
   | Partitioning | **One large partition with all the disk** | No reason to hand-partition. |
   | Hostname | **`nagaya`** | It shows in every prompt. You will have Hetzner, Nooklet and nagaya terminals open at once during the migration. |
   | Timezone / Locale, *if offered* | **UTC** / **`en_US.UTF-8`** | §2.5 sets both either way. |
   | Create additional user, *if offered* | **off** | §2.5 creates `deploy`. |
   | Custom Script, *if offered* | **empty** | |
   | Send e-mail to me | **on** | The root password and the server's SSH host-key fingerprints arrive this way. |

   There is no step to upload your own SSH key here. The first login is
   with the emailed root password (§2.4).
4. **Install** → SCP password → confirm.
5. When the email arrives, keep it open: it has the **root password** (a new
   one on every install) and the **SSH host-key fingerprints**, which §2.4
   checks.

> ⚠️ **Installing an image wipes the disk.** Harmless now. Never press it on a
> box that holds data.

**2.3** 💻 **LAPTOP** — SSH key and config entry:
```bash
ssh-keygen -t ed25519 -C "nagaya-admin" -f ~/.ssh/nagaya_admin
cat >> ~/.ssh/config <<'CFG'

Host nagaya
  HostName 152.53.205.203
  User deploy
  IdentityFile ~/.ssh/nagaya_admin
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
```
After this, `ssh nagaya` and `scp file nagaya:/path` need no flags.
`IdentitiesOnly yes` stops ssh offering every key in your agent and being
refused for too many attempts.

**2.4** 💻 **LAPTOP** → 🖥️ **SERVER (as `root`)** — check it is really your
box, copy the key up and log in:
```bash
# The box had Debian before §2.2, so drop any host key remembered from then.
ssh-keygen -R 152.53.205.203
# The fingerprint the box presents now. Compare it with the ED25519 line in
# the install email: they must match exactly. If they don't, stop.
ssh-keyscan -t ed25519 152.53.205.203 2>/dev/null | ssh-keygen -lf -
ssh-copy-id -i ~/.ssh/nagaya_admin.pub root@152.53.205.203   # answer "yes" to the fingerprint; then the root password from the email
ssh -i ~/.ssh/nagaya_admin root@152.53.205.203               # no password asked: the key works
```

**2.5** 🖥️ **SERVER (as `root`)** — the deploy user, packages, swap:
```bash
adduser deploy && usermod -aG sudo deploy

# rsync is NOT on the Minimal image. Copy root's key with cp and set the modes
# explicitly: sshd silently refuses keys in a group- or world-readable ~/.ssh,
# and the error is the same "Permission denied (publickey)" as a wrong key.
cp -r /root/.ssh /home/deploy/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
ls -ld /home/deploy/.ssh                  # expect drwx------ deploy deploy
ls -l  /home/deploy/.ssh/authorized_keys  # expect -rw------- deploy deploy

apt update && apt upgrade -y
# curl: Docker/dotenvx installers. jq + git: bin/nagaya. nano: there is no editor otherwise.
apt install -y ufw unattended-upgrades curl jq git nano
dpkg-reconfigure -plow unattended-upgrades     # answer Yes

# 2 GB swap: insurance, not capacity. If the box is ever swapping steadily,
# that is the signal to upgrade (Day-2 → Memory), not to add swap.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Clock and language. The install form may not have offered these (§2.2).
# UTC: the backup cron runs at "03:00", and on Berlin time that shifts with
# DST, skipping or doubling a run at each changeover.
timedatectl set-timezone UTC
timedatectl | grep 'Time zone'            # expect: Etc/UTC (UTC, +0000)
apt install -y locales
locale-gen en_US.UTF-8 && update-locale LANG=en_US.UTF-8
cat /etc/default/locale                   # expect LANG=en_US.UTF-8 (applies from your next login)
```

**2.6** 🖥️ **SERVER (as `root`)** — no passwords, no root over SSH:
```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
sshd -T | grep -iE '^(passwordauthentication|permitrootlogin)'
# expect: permitrootlogin no / passwordauthentication no
```
> ⚠️ **If `sshd -T` still says `yes`:** a file in `/etc/ssh/sshd_config.d/` is
> overriding the edit, as `50-cloud-init.conf` does on cloud images. Fix or
> delete it and restart ssh.

💻 **LAPTOP** — **before closing the root session**, prove the deploy user works from a second terminal:
```bash
ssh -t nagaya 'echo login-ok && sudo true && echo sudo-ok'
```
(`sudo true` prompts for the password you gave `adduser`. **`-t` is needed:**
ssh with a command gives it no terminal, and without one sudo cannot ask for
the password, so it fails with "a terminal is required" even though sudo
works. Do not use `sudo -n` either: nothing grants passwordless sudo.)

`nagaya` here is the `Host nagaya` entry from §2.3, so you never type
`deploy@152.53.205.203`. It works for `ssh`, `scp` and `rsync` alike.

**2.7** 🖥️ **SERVER (as `deploy`)** — Docker, its daemon config, dotenvx:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy

# Before ANY network exists: log rotation, and an address pool inside
# 172.16.0.0/12 (what TRUSTED_PROXY_CIDRS trusts, §1.2). Without the pool,
# Docker falls back to 192.168.x.x once the 172.17–31 ranges are used up,
# and a project created then would silently stop seeing real client IPs.
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-address-pools": [ { "base": "172.20.0.0/14", "size": 24 } ]
}
JSON
sudo systemctl restart docker

curl -sfS https://dotenvx.sh | sudo sh
dotenvx --version
```
> ⚠️ **Group membership applies from the next login.** `docker ps` will say
> *permission denied* until you `exit` and `ssh nagaya` again. Not a broken install.
>
> Install dotenvx with its own installer: there is no Node on this box, on
> purpose. And do not `apt install dotenv`, which is a different tool.

```bash
exit
```
💻 → `ssh nagaya`, then:
```bash
docker ps                                                   # empty table, no error
docker info --format '{{json .DefaultAddressPools}}'        # expect the 172.20.0.0/14 pool
```

**2.8** 💻 **LAPTOP** + 🌐 **BROWSER** + 🖥️ **SERVER (as `deploy`)** — put the nagaya repo on GitHub and on the box.

💻 Create the GitHub repo and push (first time only):
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
git init -b master && git add -A && git commit -m "nagaya: registry, renderer, runbook"
gh repo create thedumebi/nagaya --private --source . --push
```
> Check `git status` before the first commit: `.env.keys`, `keys/`, `certs/`
> and `state/` must not appear. `.gitignore` covers them, and this check catches
> the day it does not.

🖥️ **SERVER (as `deploy`)** — a read-only deploy key for the box:
```bash
ssh-keygen -t ed25519 -C "nagaya-box" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
🌐 **GitHub** → `thedumebi/nagaya` → **Settings** → **Deploy keys** → **Add deploy
key** → title `nagaya box`, paste the key, **Allow write access unticked** → **Add key**.

> A deploy key is right here: one repo, read-only, and **it never expires**.
> A fine-grained PAT would expire within a year and the box's `git pull`, and
> with it every `nagaya apply`, would break silently.

🖥️ **SERVER (as `deploy`)**:
```bash
cat >> ~/.ssh/config <<'CFG'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config

sudo mkdir -p /srv/nagaya /srv/shared/futari
sudo chown deploy:deploy /srv/nagaya /srv/shared /srv/shared/futari
git clone git@github.com:thedumebi/nagaya.git /srv/nagaya     # answer "yes" to GitHub's host key

mkdir -p /srv/nagaya/{keys,certs,state,logs}
chmod 700 /srv/nagaya/keys /srv/nagaya/certs
sudo ln -sf /srv/nagaya/bin/nagaya /usr/local/bin/nagaya
nagaya --help                         # prints the command list
```

**2.9** 🖥️ **SERVER (as `deploy`)** — firewall: SSH from anywhere, **443 from Cloudflare only**.

The rules are generated, with Cloudflare's current ranges baked in, so the
firewall is reviewable and versioned rather than pasted:
```bash
sudo /srv/nagaya/generated/firewall.sh
```
Expected output:
- `Status: active` and `22/tcp (OpenSSH) ALLOW IN Anywhere`;
- about 22 rules of the form `443/tcp ALLOW IN 173.245.48.0/20 # nagaya-cf`;
- `-A DOCKER-USER -i <iface> -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j NAGAYA-CF`,
  where `<iface>` is the public interface the script detected (often `eth0` or `ens3` on netcup);
- `NAGAYA-CF: 15 Cloudflare ranges, then DROP`.

**Why two layers, when Nooklet needed one.** ⚠️ **Docker-published ports
bypass ufw.**

- **Why ufw does not see it.** Caddy's `443:443` is published by Docker using
  DNAT, so packets for it go through iptables' **FORWARD** chain to the
  container. ufw's rules live in **INPUT**, so it never sees them. With ufw
  alone, anyone who learned the box's IP could talk to Caddy directly, skipping
  Cloudflare and its WAF, and could forge `CF-Connecting-IP`.
- **Why Nooklet did not hit this.** Its ingress used `hostNetwork`, which goes
  through INPUT.
- **The fix here.** The script adds a rule to Docker's own `DOCKER-USER` chain
  (which Docker evaluates first and never rewrites). It sends every new
  connection for original port 443 arriving on the public interface through
  `NAGAYA-CF`: allow Cloudflare's ranges, drop the rest.
- **IPv6.** Docker's IPv6 listener is a userland proxy on the host, so ufw's
  INPUT rules do cover it.
- **Reboots.** iptables rules do not survive a reboot, so the script installs
  `nagaya-firewall.service`. It re-applies the DOCKER-USER part at boot,
  **before** `docker.service`, so the rule is already there when Docker brings
  Caddy back and publishes 443. Docker adopts an existing `DOCKER-USER` chain
  and never flushes it.

Check it survives a reboot (worth doing once, now, while nothing runs):
```bash
sudo reboot
# 💻 wait ~30 s, then: ssh nagaya
sudo iptables -S DOCKER-USER | grep NAGAYA-CF     # the rule is back
systemctl is-active nagaya-firewall                # active
```

Rules for the compose files that keep this true:

- **Only two things publish a port.** Caddy publishes **443**, and Postgres
  publishes **127.0.0.1**:5432. Verification test E proves the origin is
  unreachable directly; re-run it after any change that adds `ports:`.
- **There is no port 80 at all.** Cloudflare reaches the origin over HTTPS
  (Full strict), and *Always Use HTTPS* answers plain-HTTP visitors at the edge.
- **Re-run the script when Cloudflare's ranges change.** The weekly
  `cf-ranges` workflow opens a PR when they do, and its body reminds you. The
  script replaces every `nagaya-cf` and `NAGAYA-CF` rule with the current list.

**2.10** 💻 **LAPTOP** + 🖥️ **SERVER** — the CI key, able to do exactly two things.

Every repo's CI SSHes in as `deploy` with one shared key. On the box that key
is pinned to `nagaya ssh-dispatch`, which accepts only `deploy <project> <sha>`
or `apply` and refuses anything else. So a leaked key can redeploy a commit
that is already in GHCR, and nothing more.

💻 **LAPTOP**:
```bash
ssh-keygen -t ed25519 -C "nagaya-ci" -f ~/.ssh/nagaya_ci -N ""
# one line, the public key prefixed with the restriction:
printf 'command="/srv/nagaya/bin/nagaya ssh-dispatch",restrict %s\n' "$(cat ~/.ssh/nagaya_ci.pub)" \
  | ssh nagaya 'cat >> ~/.ssh/authorized_keys'
```
> Append, do not `ssh-copy-id`: it would add the key **without** the
> `command=` restriction. With `restrict`, there is no port forwarding, no agent
> forwarding and no PTY.

Prove the restriction from the laptop:
```bash
ssh -i ~/.ssh/nagaya_ci -o IdentitiesOnly=yes deploy@152.53.205.203 'ls /'
# expect: ✗ refused: "ls /" (the CI key may only run: deploy <project> <sha> | apply)
```

Then the private half as an Actions secret on the five repos (Terraform sets
the other `NAGAYA_*` secrets in §4.5, but never this one, because anything
Terraform sets is stored in its state):
```bash
for r in nagaya dmb.futari abm.futari nihongo.futari ofuma.ai; do
  gh secret set NAGAYA_SSH_KEY -R "thedumebi/$r" < ~/.ssh/nagaya_ci
done
```
And the host key, for CI to pin (goes into `terraform.tfvars` in §4.4):
```bash
ssh-keyscan -t ed25519 152.53.205.203 2>/dev/null
# → 152.53.205.203 ssh-ed25519 AAAA…   keep this line
```

---

## Phase 3 — nagaya's secrets, the apps' keys, CSRs, GeoLite

**3.1** 💻 **LAPTOP** — create nagaya's own `.env.production`.

These are secrets nagaya itself uses, not any app's. Every key is listed in
`.env.production.example`.

```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
E=.env.production
P=~/Documents/projects

# Superuser for nagaya's own use (roles, backups, restores). No app ever uses it.
dotenvx set PG_SUPERUSER_PASSWORD "$(openssl rand -base64 24)" -f $E

# ofuma's EXISTING Redis password, so ofuma's production env does not change.
# (doca's REDIS_PASSWORD is already identical; checked 2026-10-03.)
dotenvx set REDIS_PASSWORD_OFUMA "$(dotenvx get REDIS_PASSWORD \
  -f $P/ofuma/ofuma/backend/.env.production -fk $P/ofuma/ofuma/backend/.env.keys)" -f $E

# nihongo's reminder-cron secret, sent as x-cron-secret by `nagaya cron`.
dotenvx set NIHONGO_CRON_SECRET "$(dotenvx get CRON_SECRET \
  -f $P/nihongo.futari/nihongo/backend/.env.production -fk $P/nihongo.futari/nihongo/backend/.env.keys)" -f $E

dotenvx set GHCR_USER thedumebi -f $E

# Brevo, for `nagaya alerts` (Day-2 → Memory). The same account and key the
# futari apps already send with; futari.live is authenticated there, so
# nagaya@futari.live can send without any new Brevo setup.
dotenvx set BREVO_API_KEY "$(dotenvx get BREVO_API_KEY \
  -f $P/dmb.futari/dmb/backend/.env.production -fk $P/dmb.futari/dmb/backend/.env.keys)" -f $E
```
The R2 and GHCR values come from §3.2 and §3.3. Set them as you create them:
```bash
dotenvx set R2_ENDPOINT "https://<ACCOUNT_ID>.r2.cloudflarestorage.com" -f $E
dotenvx set R2_ACCESS_KEY_ID '<from 3.2>' -f $E
dotenvx set R2_SECRET_ACCESS_KEY '<from 3.2>' -f $E
dotenvx set GHCR_TOKEN '<from 3.3>' -f $E
```
**Prove it is all ciphertext before committing.** Every value must start
`encrypted:`; only `DOTENV_PUBLIC_KEY*` is readable:
```bash
grep -vE '^\s*(#|$)' .env.production | grep -v '^DOTENV_PUBLIC_KEY' | grep -v '="encrypted:' \
  && echo "✗ PLAINTEXT ABOVE — do not commit" || echo "✓ all encrypted"
git status --short     # .env.production listed; .env.keys must NOT be
git add .env.production && git commit -m "nagaya: encrypted secrets" && git push
```

**3.2** 🌐 **BROWSER (Cloudflare)** — an R2 token for backups.

**R2 Object Storage** → **Manage API tokens** (right-hand panel) → **Create
Account API token**:
- **Name:** `nagaya-backups`
- **Permissions:** **Object Read & Write**
- **Specify bucket(s):** **Apply to specific buckets only** → `dmb-backups`, `ofuma-backups`
- **TTL:** Forever

**Create**, then copy the **Access Key ID** and **Secret Access Key** (shown
once) into §3.1's `dotenvx set` lines. The S3 endpoint for `R2_ENDPOINT` is
shown on the same page.

> One token for both buckets instead of each app's old token: backups are now
> nagaya's job, not each app's. The old per-app S3 keys in the app env files
> become unused (cleanup in Phase 9).

**3.3** 🌐 **BROWSER (GitHub)** — a token for the box to pull private images.

Profile → **Settings** → **Developer settings** → **Personal access tokens** →
**Tokens (classic)** → **Generate new token (classic)**:
- **Note:** `nagaya ghcr pull`
- **Expiration:** **No expiration**. This is read-only and pull-only, and the
  box cannot deploy when it lapses. Put a calendar reminder to review it yearly instead.
- **Scopes:** **`read:packages`** only.

Copy it into `GHCR_TOKEN` (§3.1).

> Classic, not fine-grained: fine-grained tokens still cannot read GHCR
> packages owned by a user account.

**3.4** 💻 **LAPTOP** → 🖥️ — put the decryption keys on the box.

nagaya's own key, and each app's `.env.keys`, renamed by the rule
`<app>-<site>-<service>.keys` ([docs/sites-yaml.md](docs/sites-yaml.md#where-keys-live-on-the-box)):

```bash
unset -f cd pnpm node npm npx 2>/dev/null
P=~/Documents/projects
scp $P/nagaya/.env.keys                          nagaya:/srv/nagaya/.env.keys
scp $P/dmb.futari/dmb/backend/.env.keys          nagaya:/srv/nagaya/keys/futari-dmb-backend.keys
scp $P/abm.futari/abm/backend/.env.keys          nagaya:/srv/nagaya/keys/futari-abm-backend.keys
scp $P/nihongo.futari/nihongo/backend/.env.keys  nagaya:/srv/nagaya/keys/futari-nihongo-backend.keys
scp $P/ofuma/ofuma/backend/.env.keys             nagaya:/srv/nagaya/keys/ofuma-main-backend.keys
scp $P/ofuma/doca/api/.env.keys                  nagaya:/srv/nagaya/keys/ofuma-doca-doca-api.keys
ssh nagaya 'chmod 600 /srv/nagaya/.env.keys /srv/nagaya/keys/*.keys && ls -l /srv/nagaya/keys'
```

| On the laptop | On the box | Holds |
|---|---|---|
| `nagaya/.env.keys` | `/srv/nagaya/.env.keys` | `DOTENV_PRIVATE_KEY_PRODUCTION` for nagaya's own secrets |
| `dmb.futari/dmb/backend/.env.keys` | `keys/futari-dmb-backend.keys` | dmb's production key |
| `abm.futari/abm/backend/.env.keys` | `keys/futari-abm-backend.keys` | abm's production key |
| `nihongo.futari/nihongo/backend/.env.keys` | `keys/futari-nihongo-backend.keys` | nihongo's production key |
| `ofuma/ofuma/backend/.env.keys` | `keys/ofuma-main-backend.keys` | ofuma's production **and** staging keys |
| `ofuma/doca/api/.env.keys` | `keys/ofuma-doca-doca-api.keys` | doca's production and staging keys |

**Copy each `.env.keys` whole, as it is. Don't split it by hand.** A file
may hold more than one key (ofuma's has production and staging; abm's also
has the key for local `.env`), and nagaya picks out the one it needs.

nagaya never mounts these files into a container. On every deploy it writes
`keys/<name>.production.key` and `keys/<name>.staging.key`, each holding the
one key for that environment. So a staging container is never handed the
production key.

**3.5** 💻 **LAPTOP** — seed the shared GeoLite2 data from the dmb box.

The futari backends mount `/srv/shared/futari` at `/opt/futari` and update it
themselves. Seeding it skips the wait for their first download, during which
every lookup returns no country:
```bash
scp -3 -r deploy@138.199.195.21:/opt/futari/geodata nagaya:/srv/shared/futari/
ssh nagaya 'ls -la /srv/shared/futari/geodata'      # expect GeoLite2-Country.mmdb
```
(`scp -3` routes the copy through the laptop, so neither box needs a key for the other.)

**3.6** 🖥️ **SERVER (as `deploy`)** — private keys and CSRs for the Origin CA certificates.

Each zone gets one Cloudflare Origin CA certificate for `<domain>` and
`*.<domain>`. Generate the **private key on the box**, so it never travels and
never enters Terraform state; only the CSR (public) goes to Cloudflare:
```bash
cd /srv/nagaya/certs
umask 077
for d in futari.live ofuma.ai; do
  openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$d.key" -out "$d.csr" \
    -subj "/CN=$d" -addext "subjectAltName=DNS:$d,DNS:*.$d"
done
ls -l      # two .key (-rw-------) and two .csr
openssl req -in futari.live.csr -noout -text | grep -A1 'Subject Alternative Name'
# expect: DNS:futari.live, DNS:*.futari.live
```
💻 **LAPTOP** — bring the CSRs into the repo, into `pending/`:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
scp 'nagaya:/srv/nagaya/certs/*.csr' terraform/csr/pending/
git add terraform/csr/pending/*.csr && git commit -m "Origin CA CSRs" && git push
```
> **Why `pending/`:** Terraform requests a certificate for every CSR directly
> in `terraform/csr/`, and Cloudflare refuses (error 1010, "This zone is
> either not part of your account…") until the zone is **active**, which
> happens in §4.9. §4.11 moves them up a level once it is.

**3.7** 🖥️ **SERVER (as `deploy`)** — pull nagaya's encrypted secrets, log in to GHCR, test the alert email:
```bash
git -C /srv/nagaya pull
nagaya login            # expect: Login Succeeded
nagaya alerts --test    # expect: ✓ test email sent to …
```
Check the inbox named in `sites.yaml` → `alerts.to`, spam folder included, for
"[nagaya] test alert" with a `free -m` snapshot. If it is in spam, mark it
*Not spam* once, so a real alert does not land there at 3 a.m.
`nagaya login` decrypts `GHCR_USER` / `GHCR_TOKEN` with `/srv/nagaya/.env.keys`
and stores the credential in `~/.docker/config.json`. If it fails to decrypt,
the `.env.keys` on the box does not match the `.env.production` committed in
§3.1; re-copy it (§3.4).

---

## Phase 4 — Cloudflare through Terraform

Terraform creates both zones on Cloudflare, with every record **mirroring
today's DNS**: same IPs, grey-clouded (`proxied: false`), and the Namecheap mail
forwarding. Then you move the nameservers. The two zones answer exactly as
Namecheap does today, so nothing visible changes until Phase 6 moves a site.

### 4.1 🌐 BROWSER (Cloudflare) — account id and an API token

1. The **account id** is in the dashboard URL after login,
   `dash.cloudflare.com/<ACCOUNT_ID>/…`, and on any zone's Overview page
   (right-hand column). Put it in `terraform/terraform.tfvars`
   (`cloudflare_account_id`) and in `terraform/backend.hcl` (the R2 endpoint).
2. **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**:
   - **Name:** `nagaya-terraform`
   - **Permissions**, every row needed:

     | Scope | Item | Access |
     |---|---|---|
     | Account | Email Routing Addresses | Edit |
     | Account | Account Settings | Read |
     | Zone | Zone | Edit |
     | Zone | Zone Settings | Edit |
     | Zone | DNS | Edit |
     | Zone | SSL and Certificates | Edit |
     | Zone | Zone WAF | Edit |
     | Zone | Email Routing Rules | Edit |

   - **Account Resources:** Include → your account.
   - **Zone Resources:** Include → **All zones from an account** → your account.
     *Not* "specific zone": the zones do not exist yet, and creating them is the
     point.
   - **Continue to summary** → **Create Token**. Copy it (shown once).

> **Zone → Zone → Edit** on all zones of the account is what allows creating a
> zone. Without it, the first apply fails with a 403 on `cloudflare_zone`, and
> nothing else in the plan explains why.

### 4.2 🌐 BROWSER (GitHub) — a token for Terraform's GitHub provider

Profile → **Settings** → **Developer settings** → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**:
- **Name:** `nagaya-terraform` · **Expiration:** 1 year (the maximum; put the
  renewal date in your calendar)
- **Resource owner:** `thedumebi`
- **Repository access:** **Only select repositories** → `nagaya`, `dmb.futari`,
  `abm.futari`, `nihongo.futari`, `ofuma.ai`
- **Repository permissions:** **Secrets → Read and write** (Metadata → Read is added automatically)

### 4.3 🌐 BROWSER (Cloudflare) — the Terraform state bucket

State has to exist before Terraform can, so this one bucket is made by hand:

1. **R2 Object Storage** → **Create bucket** → name **`nagaya-tfstate`**,
   location **Automatic**, storage class **Standard** → **Create bucket**.
2. **Manage API tokens** → **Create Account API token** → name
   `nagaya-tfstate`, **Object Read & Write**, **specific bucket** `nagaya-tfstate`,
   TTL Forever → **Create**. Copy both keys.

> No lifecycle rule on this bucket. It holds one small file that must never
> expire. Turning on **Object versioning** is not needed: Terraform keeps the
> previous state in the lock-protected object and `terraform state pull` can
> always save a copy.

### 4.4 💻 LAPTOP — fill in Terraform's inputs

Secrets in a file **outside** the repo, readable only by you:
```bash
mkdir -p ~/.config/nagaya && umask 077
cat > ~/.config/nagaya/tf.env <<'ENV'
CLOUDFLARE_API_TOKEN=<4.1>
GITHUB_TOKEN=<4.2>
AWS_ACCESS_KEY_ID=<4.3 access key id>
AWS_SECRET_ACCESS_KEY=<4.3 secret>
ENV
```
The same four values become Actions secrets on the nagaya repo, for CI.
**From here on, every push to `master` runs `terraform apply` in CI** (the
Apply workflow), so the commit at the end of this step is the first apply:
```bash
set -a; . ~/.config/nagaya/tf.env; set +a
gh secret set CLOUDFLARE_API_TOKEN       -R thedumebi/nagaya -b "$CLOUDFLARE_API_TOKEN"
gh secret set TF_GITHUB_TOKEN            -R thedumebi/nagaya -b "$GITHUB_TOKEN"
gh secret set TF_STATE_ACCESS_KEY_ID     -R thedumebi/nagaya -b "$AWS_ACCESS_KEY_ID"
gh secret set TF_STATE_SECRET_ACCESS_KEY -R thedumebi/nagaya -b "$AWS_SECRET_ACCESS_KEY"
```
Non-secret inputs, committed. `terraform/terraform.tfvars`:
```hcl
cloudflare_account_id = "<4.1>"
github_owner          = "thedumebi"
nagaya_host           = "152.53.205.203"
nagaya_known_hosts    = "152.53.205.203 ssh-ed25519 AAAA…"   # the ssh-keyscan line from §2.10
```
and `terraform/backend.hcl`: replace `CHANGE_ME_ACCOUNT_ID`.

### 4.5 💻 LAPTOP + 🌐 — check the first apply

Pushing §4.4's tfvars commit ran the **Apply** workflow (repo → Actions →
Apply): Render check ✓, Terraform apply ✓, nagaya apply skipped (the box is
not marked ready until §5.1). Then confirm from the laptop that Cloudflare and
the state agree:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
set -a; . ~/.config/nagaya/tf.env; set +a    # or wherever you keep these four values
cd terraform
terraform init -backend-config=backend.hcl
terraform plan                               # expect: No changes.
terraform state list | sed -E 's/\[.*//' | sort | uniq -c
```
The plan prints to the terminal. (If you save one with `-out=`, it is a binary
file; read it with `terraform show <file>`. `*.plan` is git-ignored.)

What the state should hold:

Terraform is split into three modules (`terraform/main.tf` wires them):

| Module | What it holds |
|---|---|
| `modules/cloudflare-zone` | one instance per domain: the zone, TLS settings, DNS records, the WAF rule, the Origin CA certificate, email routing rules |
| `modules/cloudflare-email-destinations` | the forwarding inboxes. They are account-wide, so they are not per zone |
| `modules/github-deploy-secrets` | the `NAGAYA_*` Actions secrets on each repo |

| In the plan | Count |
|---|---|
| `module.zone["…"].cloudflare_zone.this` | 2: futari.live, ofuma.ai |
| `module.zone["…"].cloudflare_zone_setting.*` | 6: ssl strict, always_use_https, min_tls 1.2, per zone |
| `module.zone["…"].cloudflare_dns_record.this["…"]` | every record: the site A records **with `proxied = false` and the Hetzner IPs**, the Brevo DKIM CNAMEs, the brevo-code and DMARC TXT, five eforward MX and an SPF per zone, and the three old staging names |
| `module.zone["…"].cloudflare_ruleset.waf` | 2 |
| `module.zone["…"].cloudflare_origin_ca_certificate.this[0]` | **none yet**: they come in §4.11, once the zones are active |
| `module.deploy_secrets[0].github_actions_secret.this["…"]` | 15: `NAGAYA_HOST` / `NAGAYA_USER` / `NAGAYA_KNOWN_HOSTS` on five repos |
| email routing | **none yet**: both zones are `mode: namecheap` |

```bash
terraform output nameservers
```
Keep the nameserver output open: two names per zone, for example
`ada.ns.cloudflare.com` and `rob.ns.cloudflare.com`. **They are specific to
your account.**

> ⚠️ **(For §4.11.) If the `cloudflare_origin_ca_certificate` fails with an
> authentication error once the zone is active**, this token cannot issue Origin CA certificates (older accounts sometimes need the
> separate "Origin CA Key"). Do it in the dashboard instead. The key still never
> leaves the box:
> 1. Zone → **SSL/TLS** → **Origin Server** → **Create Certificate**.
> 2. Choose **Use my private key and CSR**, paste `terraform/csr/<domain>.csr`,
>    and pick **15 years**.
> 3. **Create**, then copy the certificate PEM for §4.11.
> 4. Then move that zone's CSR back into `terraform/csr/pending/` so
>    Terraform stops trying, and push.

> The zones are now **pending**. A pending zone answers nothing to the
> internet, because the world still asks Namecheap. Nothing has changed for
> visitors yet.

### 4.6 💻 LAPTOP — prove Cloudflare's answers match today's

Before moving the nameservers, ask Cloudflare's nameservers directly and
compare with what the internet sees now:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya/terraform
for zone in futari.live ofuma.ai; do
  ns=$(terraform output -json nameservers | jq -r --arg z "$zone" '.[$z][0]')
  echo "── $zone via $ns"
  jq -r --arg z "$zone" '.zones[$z].records[] | "\(.type) \(.name)"' generated.auto.tfvars.json | sort -u |
  while read -r type name; do
    new=$(dig +short "$type" "$name" @"$ns" | tr -d '"' | sort | tr '\n' ' ')
    old=$(dig +short "$type" "$name"         | tr -d '"' | sort | tr '\n' ' ')
    [ "$new" = "$old" ] && echo "  ok    $type $name" || echo "  DIFF  $type $name | cloudflare: $new | today: $old"
  done
done
```
Expect `ok` on every line, with these exceptions:

- **`doca-stg`, `api-doca-stg`, `stg`, `api-stg` (ofuma.ai).** The new
  staging names exist only on Cloudflare (today: empty). Fine.
- **Records with no `today` value at all** (`today:` empty) are new. That is
  fine only for the four staging names above. Any other one needs a look.

**Anything else marked DIFF must be understood before §4.8.** It is either a
record Namecheap has that `sites.yaml` is missing (add it under that app's
`dns:`, re-render, apply), or a typo.

Also open **Namecheap** → **Domain List** → **Manage** → **Advanced DNS** for
each domain, and compare against the list by eye. Namecheap sometimes holds
records `dig` cannot enumerate, such as a TXT on an unusual name.

### 4.7 🌐 BROWSER (Namecheap) — DNSSEC off, and note the mail aliases

For **each** of futari.live and ofuma.ai:
1. **Domain List** → **Manage** → **Advanced DNS**. If **DNSSEC** is on,
   switch it **off**. Moving nameservers with DNSSEC on leaves the domain
   unresolvable: resolvers get signatures that no longer match. Cloudflare
   would then sit on "Pending Nameserver Update" forever without saying why.
2. On the same tab, **Mail Settings** → **Email Forwarding**: write down every
   alias. `sites.yaml` → `email.addresses` should list them all; `catch_all:
   true` covers any you miss, but listing them documents what exists.

### 4.8 🌐 BROWSER (Namecheap) — point the nameservers at Cloudflare

For each domain: **Domain List** → **Manage** → **Domain** tab → **Nameservers**:
1. Switch **Namecheap BasicDNS** to **Custom DNS**.
2. Paste the two names from §4.5 (`terraform output nameservers`), one per
   field, exactly as shown. No trailing dots.
3. Click the **green checkmark (✓)**. ⚠️ **Nothing saves until you click it.**
   Leaving the page discards the change, which is the most common mistake on this screen.

### 4.9 💻 LAPTOP — wait for activation

```bash
dig +short NS futari.live; dig +short NS ofuma.ai     # until both show *.ns.cloudflare.com
cd ~/Documents/projects/nagaya/terraform
set -a; . ~/.config/nagaya/tf.env; set +a
terraform apply -refresh-only -auto-approve >/dev/null && terraform output zone_status
# expect: { "futari.live" = "active", "ofuma.ai" = "active" }
```
Usually 5–30 minutes; the registrar's worst case is 24 hours. Cloudflare also
emails when each zone goes active. Still pending after a few hours? Re-check
DNSSEC (§4.7) and that both nameservers were saved with the checkmark.

From here on, **Cloudflare answers for both domains**, with the same records
as before. The sites still run on Hetzner, grey-clouded, with their own
Let's Encrypt certificates.

### 4.10 🌐 + 💻 — email: Namecheap forwarding → Cloudflare Email Routing

Do this **straight after activation**, per zone, at a quiet hour. Inbound mail
to the domain can bounce for a few minutes in the middle.

Cloudflare will not enable Email Routing while foreign MX records exist. And
the forwarding inbox must exist in Terraform **before** the dashboard
onboarding, or the wizard creates it and Terraform cannot adopt it later. So
there are four small steps:

**4.10.1** 💻 — set `email.mode: cloudflare-pending` for the zone in
`sites.yaml` (and the real `forward_to`). This removes the eforward MX and SPF
records, and creates the forwarding inbox as an Email Routing destination:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
# edit sites.yaml: apps.futari.email.mode: cloudflare-pending
pnpm render
set -a; . ~/.config/nagaya/tf.env; set +a
terraform -chdir=terraform apply
# expect: 6 to destroy (5 MX + 1 SPF) and, the first time only, one
#         + module.email_destinations.cloudflare_email_routing_address.this["<inbox>"]
#         per distinct inbox (futari.live: chiwuzohdaniel@gmail.com and tamiloreallen@gmail.com)
```

**4.10.2** 🌐 — Cloudflare has emailed **each** inbox a verification link.
Click yours, and ask the owner of every other inbox (for futari.live, whoever
reads `tamiloreallen@gmail.com`, for `abm@`) to click theirs. ⚠️ **An unverified
destination receives nothing**: no bounce, no warning. Mail just disappears.
Check that every one took:
```bash
terraform -chdir=terraform apply -refresh-only -auto-approve >/dev/null
terraform -chdir=terraform output email_destinations_verified    # a timestamp for every inbox, no null
```

**4.10.3** 🌐 **BROWSER (Cloudflare)** — zone → **Email** → **Email Routing**
(newer dashboards: **Compute** → **Email Service** → **Email Routing**) →
**Onboard Domain** / **Get started**:
- When it asks for a destination, **choose an existing, verified address**
  (yours). Do not type a new one.
- When it offers to create a first routing rule, **skip** it. Terraform makes
  the rules in the next step.
- Review the records Cloudflare proposes: three **MX** (`route1/2/3.mx.cloudflare.net`),
  one **TXT** SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`) and one **TXT**
  DKIM (`cf2024-1._domainkey`). Then **Add records and enable**.
- These are Cloudflare's own **locked** records. Terraform never manages them,
  which is why `mode: cloudflare` produces no MX or SPF.

**4.10.4** 💻 — `email.mode: cloudflare`, so Terraform creates the routing rules:
```bash
# edit sites.yaml: apps.futari.email.mode: cloudflare
pnpm render && terraform -chdir=terraform apply
# expect: + module.zone["futari.live"].cloudflare_email_routing_rule.address[…] per address,
#         + its cloudflare_email_routing_catch_all; nothing destroyed
git add -A && git commit -m "futari.live: email on Cloudflare Email Routing" && git push
```

**4.10.5** 💻 — prove it:
```bash
dig +short MX futari.live      # route1/2/3.mx.cloudflare.net only
dig +short TXT futari.live     # exactly ONE v=spf1 …, plus brevo-code
```
- Send a message from an unrelated account to `admissions@futari.live`, and
  to a made-up address to test the catch-all. Check Gmail, spam included.
- **Brevo:** **Senders, Domains & Dedicated IPs** → **Domains** → futari.live
  should still say **Authenticated**. Its DKIM CNAMEs and DMARC moved with the
  zone; a re-check button refreshes it.
- Send one real email from the app (a dmb password reset or digest) and check
  it arrives **not in spam**. In Gmail, *Show original* should say
  `DKIM: PASS` and `DMARC: PASS`.

**Repeat 4.10.1–4.10.5 for ofuma.ai**, testing `hi@ofuma.ai`. Set ofuma's real
`forward_to` first: render refuses any mode but `namecheap` with the `CHANGE_ME`
placeholder. If it is the same inbox as futari's, 4.10.1 creates nothing new
and 4.10.2 is already done.

> **Email Routing is receive-only.** Sending as `@futari.live` keeps going
> through Brevo, exactly as today; nothing about sending changes.
>
> **If you ever add a sender that needs SPF**, merge it into Cloudflare's
> single SPF record. Never add a second `v=spf1` record: two SPF records is not
> extra coverage, it is invalid, and receivers may fail both.

### 4.11 💻 LAPTOP → 🖥️ — the origin certificates onto the box

Per zone, once **that** zone shows `active` (§4.9). Move its CSR out of
`pending/`; the push makes CI request the certificate:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
git pull
git mv terraform/csr/pending/futari.live.csr terraform/csr/
git commit -m "Origin CA certificate: futari.live is active" && git push
```
(The same for `ofuma.ai` once it is active.) Each fetched file must start with
`-----BEGIN CERTIFICATE-----`.
Wait for the Apply run to go green (Terraform apply: `2 added`), then fetch
the certificates:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya/terraform
set -a; . ~/.config/nagaya/tf.env; set +a
for d in futari.live ofuma.ai; do
  # jq -e fails on null: no certificate yet means nothing is copied.
  terraform output -json origin_certificates | jq -er --arg d "$d" '.[$d]' > "/tmp/$d.pem" \
    || { echo "✗ no certificate for $d yet: is its zone active, its CSR out of pending/, and the Apply run green?"; rm -f "/tmp/$d.pem"; continue; }
  head -1 "/tmp/$d.pem"
  scp "/tmp/$d.pem" "nagaya:/srv/nagaya/certs/$d.pem" && rm "/tmp/$d.pem"
done
```
🖥️ **SERVER (as `deploy`)** — each certificate must match the key generated
next to it in §3.6. The two hashes per domain must be identical:
```bash
cd /srv/nagaya/certs
for d in futari.live ofuma.ai; do
  echo "$d"
  openssl x509 -noout -modulus -in "$d.pem" | openssl md5
  openssl rsa  -noout -modulus -in "$d.key" | openssl md5
  openssl x509 -noout -enddate -in "$d.pem"              # notAfter= 2041…
done
chmod 644 *.pem; chmod 600 *.key; ls -l
```
> A mismatched pair loads fine and then fails every TLS handshake at request
> time, with an error that does not mention the key. Ten seconds here saves an
> evening later.

> 📅 **Put the `notAfter` date (15 years out) in a calendar.** Cloudflare sends
> no expiry warning for Origin CA certificates. Renewal is just §3.6 and
> §4.11 again.

---

## Phase 5 — First `nagaya apply`: the shared layer

**5.1** 🖥️ **SERVER (as `deploy`)**:
```bash
git -C /srv/nagaya pull
nagaya apply
```
What it does, in order:
1. `git pull`.
2. Creates the `edge` network and one network per project.
3. Starts **core**: `caddy`, `pg-main` (Postgres 18), `redis-futari`,
   `redis-ofuma`. It waits for Postgres to answer.
4. Attaches Postgres and Redis to each project network under the names the
   apps use.
5. Validates and reloads the Caddyfile.
6. Reports every project as "not deployed yet".
7. Installs the crontab: backups, nihongo reminders, alerts.

💻 **LAPTOP** — once 5.2 below passes, let CI run `nagaya apply` on every
merge from now on:
```bash
env -u GITHUB_TOKEN gh variable set NAGAYA_BOX_READY --body true -R thedumebi/nagaya
gh variable list -R thedumebi/nagaya        # NAGAYA_BOX_READY  true
```
(`env -u GITHUB_TOKEN`: if your shell still has the Terraform credentials
loaded, `gh` would use that token, which may set secrets but not variables,
and fail with HTTP 403. Without it, `gh` uses your own login.)
Until this is set, the Apply workflow does Terraform only and skips the box.

> ⚠️ **If Caddy keeps restarting**, look at `docker logs caddy`. Nine times in
> ten a certificate or key is missing or unreadable in `/srv/nagaya/certs`
> (§3.6, §4.11). The file names must be exactly `<domain>.pem` and `<domain>.key`.

**5.2** 🖥️ **SERVER (as `deploy`)** — verify:
```bash
nagaya status
docker exec pg-main psql -U postgres -tAc 'SELECT version()'      # PostgreSQL 18.x
docker exec pg-main psql -U postgres -tAc 'SHOW shared_buffers'   # 256MB
docker exec redis-futari redis-cli ping                           # PONG
docker exec redis-ofuma redis-cli ping                            # NOAUTH: proves the password is enforced
docker network inspect futari-dmb -f '{{range .Containers}}{{.Name}} {{end}}'   # pg-main redis-futari
curl -sk -o /dev/null -w '%{http_code}\n' --resolve dmb.futari.live:443:127.0.0.1 https://dmb.futari.live/
# 502: right. Caddy and the certificate work; no dmb container exists yet.
crontab -l | grep nagaya                                          # backup, alerts, nihongo cron
```

**5.3** 💻 **LAPTOP** — the origin must not answer the internet directly
(verification test E). From the laptop, which is not Cloudflare:
```bash
curl -sk -m 8 -o /dev/null -w '%{http_code}\n' https://152.53.205.203/ ; echo "exit=$?"
# expect: 000, and exit 28 (timed out). Any HTTP status means the firewall is open.
```

**5.4** 🌐 **BROWSER (GitHub)** — CI can reach the box: `thedumebi/nagaya` →
**Actions** → **Apply** → **Run workflow**. All three jobs go green, and the
**nagaya apply** job's log ends with `✓ apply finished`. From now on, merging
to `master` in this repo applies it.

---

## Phase 6 — Cut over, one site at a time

Each site moves on its own, with a few minutes of API downtime, and can be
rolled back until the moment writes land on nagaya. The order goes from least
to most at stake: **nihongo → abm → dmb + the futari.live page → ofuma (main + doca)**.

### 6.0 The procedure, and the one rule

Every cutover is the same eleven steps. §6.1 runs them for nihongo with every
command spelled out; the later sections give only what differs.

| # | Step | Where |
|---|---|---|
| a | Phase 1 changes merged for this repo; a nagaya image build run for the current `master` → note `<sha>` | 🌐 |
| b | `nagaya prepare <project> <sha>`: pull images, create the role and an **empty** database | 🖥️ nagaya |
| c | **Maintenance starts.** Stop the backend on Hetzner, and remove its cron lines there | 🖥️ HETZNER |
| d | Dump its database on Hetzner | 🖥️ HETZNER |
| e | Copy the dump to nagaya | 💻 |
| f | `nagaya restore <db> <dump>` | 🖥️ nagaya |
| g | `nagaya deploy <project> <sha>`: migrations (none to run), start, health checks | 🖥️ nagaya |
| h | Set the site's `origin: nagaya` in `sites.yaml`; render; Terraform apply. **DNS flips; maintenance ends** | 💻 |
| i | Verify from outside: Cloudflare in front, the app works, mail, crons | 💻 🌐 |
| j | In the app repo, switch on `push:` in `deploy-nagaya.yml` and delete `deploy-vps.yaml` | 💻 |
| k | Stop the site's remaining containers on Hetzner (keep them for 7 days) | 🖥️ HETZNER |

> **The rule: nothing may write to the database between (c) and (h) anywhere
> but nagaya, and nothing at all between (c) and (g).** Before (h), rolling back
> is "start the Hetzner backend again"; nagaya never served a visitor. After
> (h), writes land on nagaya, and going back means dumping nagaya into Hetzner
> ([Rolling back](#rolling-back)). That is why the Hetzner boxes stay for 7 days.

> **Why the database is restored *before* the first start.** Every backend runs
> its migrations when it starts. Started against an empty database, dmb would
> build a fresh schema that the restore then collides with, and ofuma would
> crash-loop (its squashed migrations cannot build an empty database at all). So
> `prepare` creates the role and an empty database, `restore` fills it, and only
> then does `deploy` start the app, which finds every migration already applied.

> **Postgres 16 → 18 happens here, for free.** The Hetzner dumps come from
> Postgres 16 and restore into 18. A plain-SQL `pg_dump` loads into any newer
> major version, and `nagaya restore` drops the one line kind that a
> non-superuser cannot run (`COMMENT ON EXTENSION`).

### 6.1 nihongo.futari.live

**a.** 🌐 **GitHub** → `nihongo.futari` → **Actions** → **Deploy (nagaya)** →
**Run workflow** → `master`, *Deploy after building* **unticked**. When it is
green, copy the commit SHA from the run's summary. That is `<sha>`.

**b.** 🖥️ **SERVER nagaya (as `deploy`)**:
```bash
nagaya prepare futari-nihongo <sha>
# expect: ✓ futari-nihongo: database nihongo owned by thedumebi
# (pg-main and redis-futari were attached to the futari-nihongo network by Phase 5's apply)
docker exec pg-main psql -U postgres -tAc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" nihongo
# 0, which is right: empty until (f)
```
> If `prepare` says *sites.yaml says database "nihongo" but … PG_DATABASE="…"*,
> the env file baked into that image disagrees with the registry; fix whichever
> is wrong. If it says *could not read … from …*, the image predates §1.1 (no
> env file baked in): rebuild from a commit that has it.

**c.** 🖥️ **HETZNER dmb-prod (`ssh deploy@138.199.195.21`)**. **Maintenance starts.**
```bash
crontab -l > ~/crontab.before-nihongo-cutover      # keep a copy
crontab -l | grep -v nihongo | crontab -          # removes nihongo's backup and reminders lines
crontab -l                                         # check: no nihongo lines left, dmb/abm intact
docker stop nihongo-backend
```
> ⚠️ **The reminders cron must never run on both boxes**, or every learner gets
> each reminder twice. Hetzner's line goes now. nagaya's runs from (g), and it
> skips while the container is not up.

**d.** 🖥️ **HETZNER dmb-prod**:
```bash
docker exec dmb-postgres pg_dump -U thedumebi --no-owner --no-acl -d nihongo | gzip > ~/nihongo-cutover.sql.gz
ls -lh ~/nihongo-cutover.sql.gz                    # not a few hundred bytes
gunzip -c ~/nihongo-cutover.sql.gz | grep -c '^COPY ' # one per table with data
```

**e.** 💻 **LAPTOP**:
```bash
scp -3 deploy@138.199.195.21:nihongo-cutover.sql.gz nagaya:/tmp/
```

**f.** 🖥️ **SERVER nagaya**:
```bash
nagaya restore nihongo /tmp/nihongo-cutover.sql.gz
# ✓ nihongo restored: N tables, owned by thedumebi
# migrations applied: M     ← must equal Hetzner's:
```
🖥️ **HETZNER**, to compare:
```bash
docker exec dmb-postgres psql -U thedumebi -d nihongo -tAc 'SELECT count(*) FROM drizzle.__drizzle_migrations'
```

**g.** 🖥️ **SERVER nagaya**:
```bash
nagaya deploy futari-nihongo <sha>
# ✓ futari-nihongo-backend /healthcheck
# ✓ https://nihongo.futari.live → 200      (through Caddy on the box itself)
curl -sk --resolve nihongo.futari.live:443:127.0.0.1 https://nihongo.futari.live/api/healthcheck
# {"status":"ok",…}: the SPA's /api proxy reaches the backend
rm /tmp/nihongo-cutover.sql.gz
```

**h.** 💻 **LAPTOP** — flip DNS:
```yaml
# sites.yaml → apps.futari.sites.nihongo
      nihongo:
        repo: thedumebi/nihongo.futari
        origin: nagaya            # ← add
```
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nagaya
pnpm render
set -a; . ~/.config/nagaya/tf.env; set +a
terraform -chdir=terraform apply
# expect exactly one change, in place:
#   ~ module.zone["futari.live"].cloudflare_dns_record.this["A nihongo.futari.live"]
#       content: "138.199.195.21" → "152.53.205.203",  proxied: false → true
git add -A && git commit -m "nihongo.futari.live → nagaya" && git push
```
A proxied record switches immediately: there is no TTL to wait out. Visitors
whose resolver cached the old A record (TTL 300 s) keep reaching Hetzner for up
to 5 minutes, where the backend is stopped, so the API errors. That is the
maintenance window. The CI apply that the push triggers finds nothing left to do.

> Applying from the laptop instead of a PR keeps the maintenance window to
> minutes. The PR-and-merge path is the right one for every change that is
> *not* a cutover.

**i.** 💻 **LAPTOP** + 🌐 — verify from outside:
```bash
dig +short nihongo.futari.live                    # Cloudflare addresses (104.x / 172.6x.x), not 138.199…
curl -sI https://nihongo.futari.live | grep -iE '^(server|cf-ray)'   # server: cloudflare, a cf-ray
curl -s https://nihongo.futari.live/api/healthcheck
```
- **In a browser:** log in, and do one thing that writes, such as a review.
- **Mail:** trigger a Brevo email (a magic link or password reset) and check it arrives.
- **Reminders cron:** at the next quarter-hour, on nagaya:
  `tail -3 /srv/nagaya/logs/cron.log` → a line for `futari-nihongo-reminders` with the endpoint's response.
- **Real client IP:**
  `docker logs --since 5m futari-nihongo-backend 2>&1 | tail` shows your IP,
  not a 172.x or Cloudflare address, wherever it logs one.
- **R2 assets:** `assets.nihongo.futari.live` is R2, not the box, and is unaffected.

**j.** 💻 **LAPTOP** — make pushes deploy to nagaya:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/nihongo.futari
# .github/workflows/deploy-nagaya.yml: uncomment the push: trigger,
# and change the workflow_dispatch "deploy" default to true
git rm .github/workflows/deploy-vps.yaml
git commit -am "Deploy to nagaya on push; retire the Hetzner workflow" && git push
```
That push deploys through the new path end to end. Watch it in **Actions**:
test → build → deploy, with `✓ futari-nihongo is live at <sha>` in the deploy log.

**k.** 🖥️ **HETZNER dmb-prod**:
```bash
docker stop nihongo-frontend          # stopped, not removed: the rollback path for 7 days
```

**And once, after the first cutover**, prove backups work on real data:
```bash
nagaya backup          # ✓ nihongo: N bytes   (dmb/abm "do not exist yet, skipped")
```

### 6.2 abm.futari.live

The same as §6.1 with these values:

| Step | abm |
|---|---|
| a | `abm.futari` → **Deploy (nagaya)** → `<sha>` |
| b | `nagaya prepare futari-abm <sha>`. The role `thedumebi` already exists from nihongo; abm's env holds the same password (checked 2026-10-03), so prepare just confirms it. If it refuses with *already has a different password*, the env files diverged: make them agree. |
| c | `crontab -l \| grep -v '/home/deploy/abm' \| crontab -` then `docker stop abm-backend` |
| d | `docker exec dmb-postgres pg_dump -U thedumebi --no-owner --no-acl -d abm \| gzip > ~/abm-cutover.sql.gz` |
| e | `scp -3 deploy@138.199.195.21:abm-cutover.sql.gz nagaya:/tmp/` |
| f | `nagaya restore abm /tmp/abm-cutover.sql.gz` |
| g | `nagaya deploy futari-abm <sha>` |
| h | `origin: nagaya` on `apps.futari.sites.abm` → render → apply → push |
| i | log in; abm's click and view tracking records a country (GeoLite works: no `EXDEV` in `docker logs futari-abm-backend`) |
| j | push trigger on, delete `deploy-vps.yaml` in `abm.futari` |
| k | `docker stop abm-frontend` |

> The abm cron line on Hetzner is identified by its path (`cd /home/deploy/abm`),
> because its log file is the shared `backup.log`. Check `crontab -l` after:
> dmb's line must still be there.

### 6.3 dmb.futari.live and the futari.live page

dmb owns Caddy, Postgres and Redis on the Hetzner box. Once dmb has moved, that
box serves nothing, so the static apex page (`futari.live`, `www`) moves in
the same step.

| Step | dmb |
|---|---|
| a | `dmb.futari` → **Deploy (nagaya)** → `<sha>` |
| b | `nagaya prepare futari-dmb <sha>` |
| c | `crontab -l \| grep -v '/home/deploy/dmb' \| crontab -` then `docker stop dmb-backend` |
| d | `docker exec dmb-postgres pg_dump -U thedumebi --no-owner --no-acl -d dmb \| gzip > ~/dmb-cutover.sql.gz` |
| e | `scp -3 deploy@138.199.195.21:dmb-cutover.sql.gz nagaya:/tmp/` |
| f | `nagaya restore dmb /tmp/dmb-cutover.sql.gz` |
| g | `nagaya deploy futari-dmb <sha>` |
| h | **Move the whole app**: in `apps.futari.defaults` set `origin: nagaya`, and delete the per-site `origin: nagaya` lines you added for nihongo and abm. That one change moves dmb, `futari.live` and `www.futari.live`. Render → apply (expect 3 records changed: dmb, apex, www) → push |
| i | log in; the job-hunt **Applied / Not-applying** click endpoints; the digest send (`send-job-digest`) from the laptop still works (it calls Brevo directly, not the box); `https://futari.live` shows the landing page; `https://www.futari.live` → 301 → `https://futari.live/` |
| j | push trigger on, delete `deploy-vps.yaml` in `dmb.futari` |
| k | `cd ~/dmb && docker compose -f docker-compose.prod.yml stop`: the whole Hetzner stack, Caddy included |

> **The landing page now lives in this repo** (`static/futari/`). Edit it here;
> the copy in `dmb.futari/futari/` is retired in Phase 9. Caddy serves it from
> disk, so a change goes live with the next `nagaya apply` (any merge to master),
> without a reload.

### 6.4 ofuma.ai: main and doca, production

ofuma differs in three ways:

- **Two sites share one database and one role.** `main` and `doca` both use
  the `ofuma` database.
- **The role is renamed.** On the Hetzner ofuma box the app logged in as
  `thedumebi`, with a password different from the futari sites'. On nagaya,
  `thedumebi` already belongs to the futari sites, so ofuma gets its own role,
  `ofuma`. That needs one env-file change per site, below.
- **One branch builds both.** `master` builds main's and doca's images at the same SHA.

**6.4.1** 🌐 **GitHub** → `ofuma.ai` → **Actions**. Disable the four Hetzner
workflows, so the env commit below cannot deploy a half-changed config to Hetzner:
`deploy-ofuma-production-vps`, `deploy-doca-production-vps`,
`deploy-ofuma-staging-vps`, `deploy-doca-staging-vps` → **···** → **Disable workflow**.
(The two doca ones can never fire anyway, see §1.7, but disable them so nobody
re-enables the old path by accident.)

**6.4.2** 💻 **LAPTOP** — the new role, in both production env files on
`master`. One new password, used in both. §1.5 (doca's standard key names)
must already be on `master`:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/ofuma
git checkout master && git pull
grep -q '^PG_USERNAME=' doca/api/.env.production || echo "✗ §1.5 is not on master yet"
NEWPW="$(openssl rand -base64 24)"
for f in ofuma/backend/.env.production doca/api/.env.production; do
  dotenvx set PG_USERNAME ofuma    -f "$f"
  dotenvx set PG_PASSWORD "$NEWPW" -f "$f"
done
unset NEWPW
git commit -am "ofuma + doca: own database role for nagaya" && git push
```
Nothing else in the production env files changes:

- `PG_HOST=postgres`, `REDIS_HOST=redis` and `OFUMA_INTERNAL_API_URL=http://backend:3004`
  all resolve on nagaya through the network aliases.
- `REDIS_PASSWORD` is the value nagaya's `REDIS_PASSWORD_OFUMA` was copied
  from (§3.1).
- `TRUSTED_PROXY_CIDRS` was fixed in §1.2.

**6.4.3** 🌐 **GitHub** → **Deploy (nagaya)** → **Run workflow** on `master`,
deploy unticked → `<sha>`. One run builds all four images.

**6.4.4** 🖥️ **SERVER nagaya**:
```bash
nagaya prepare ofuma-main <sha>      # creates role ofuma and database ofuma
nagaya prepare ofuma-doca <sha>      # same role and database: confirms the passwords agree
```

**6.4.5** 🖥️ **HETZNER ofuma-prod (`ssh deploy@91.99.67.183`)**. **Maintenance starts.**
```bash
crontab -l > ~/crontab.before-cutover && crontab -l | grep -v backup-db | crontab -
docker logs --since 10m ofuma-backend 2>&1 | grep -iE 'job|worker' | tail   # quiet? ofuma is idle; if a job is mid-run, wait
docker stop ofuma-backend doca-api
docker exec ofuma-postgres pg_dump -U thedumebi --no-owner --no-acl -d ofuma | gzip > ~/ofuma-cutover.sql.gz
ls -lh ~/ofuma-cutover.sql.gz
```
> BullMQ's Redis contents are **not** migrated: queued and delayed jobs stay on
> Hetzner. ofuma is idle enough that there should be none. Stripe retries any
> webhook that fails while the API is down, for up to three days, so payments
> are not lost in the window.

**6.4.6** 💻 → 🖥️:
```bash
scp -3 deploy@91.99.67.183:ofuma-cutover.sql.gz nagaya:/tmp/
```
🖥️ **SERVER nagaya**:
```bash
nagaya restore ofuma /tmp/ofuma-cutover.sql.gz       # the doca schema comes with it
nagaya deploy ofuma-main <sha>
nagaya deploy ofuma-doca <sha>
curl -sk --resolve api.ofuma.ai:443:127.0.0.1 https://api.ofuma.ai/healthcheck
curl -sk --resolve api-doca.ofuma.ai:443:127.0.0.1 https://api-doca.ofuma.ai/healthcheck
rm /tmp/ofuma-cutover.sql.gz
```

**6.4.7** 💻 — `apps.ofuma.defaults.origin: nagaya` (leave `stg_origin` alone
until Phase 7). Render → apply. Expect 5 records changed: `ofuma.ai`, `www`,
`api`, `doca`, `api-doca`. Then push.

**6.4.8** 💻 + 🌐 — verify:
- **The sites:** log in at `https://ofuma.ai`, and open `https://doca.ofuma.ai`.
  The doca session check calls the ofuma backend over the private network, so a
  logged-in doca page proves the `network: main` wiring.
- **Stripe:** Dashboard → **Developers** → **Webhooks** → the endpoint →
  **Send test webhook** → expect a 2xx.
- **Workers:** trigger one evaluation (or any queued action) and see it
  complete in `docker logs ofuma-main-backend`.
- **Slow requests:** ⚠️ **Cloudflare cuts proxied requests at 100 s** (error
  524). On Hetzner, with no CDN in front, Caddy allowed up to 300 s; on
  nagaya the box adds no limit of its own, but Cloudflare's 100 s applies.
  If an operation takes longer and matters, make it asynchronous. Grey-clouding `api.ofuma.ai` instead is not an
  option, because the firewall only admits Cloudflare.

**6.4.9** 💻 — in `ofuma` on `master`: switch on the `push:` trigger in
`deploy-nagaya.yml` (branches `master` only for now; `stg` joins in §7.5). Leave the disabled Hetzner
workflows for Phase 9.

**6.4.10** 🖥️ **HETZNER ofuma-prod**:
```bash
cd ~/ofuma && docker compose -f docker-compose.prod.yml stop
```

---

## Phase 7 — ofuma staging

Staging is **off by default**. Bringing it up is optional, but **saving its
data is not**: the Hetzner staging box is deleted in Phase 9, and ofuma's
migrations cannot rebuild an empty database. A staging database you did not
save cannot be recreated later.

### 7.1 🖥️ HETZNER ofuma-stg + 💻 — save the staging database *(required, before Phase 9)*

```bash
# 🖥️ ssh deploy@46.225.127.236
docker exec ofuma-postgres pg_dump -U thedumebi --no-owner --no-acl -d ofuma | gzip > ~/ofuma-stg-final.sql.gz
ls -lh ~/ofuma-stg-final.sql.gz
```
```bash
# 💻 two copies: the laptop, and nagaya's state dir (backed up nowhere else, so keep the laptop one too)
scp deploy@46.225.127.236:ofuma-stg-final.sql.gz ~/Documents/ofuma-stg-final.sql.gz
scp ~/Documents/ofuma-stg-final.sql.gz nagaya:/srv/nagaya/state/ofuma-stg-final.sql.gz
```

### 7.2 Code: Redis namespacing *(once)*

§1.3 must be merged on `stg` before staging first runs on nagaya, so that
staging workers never take production's jobs.

### 7.3 💻 LAPTOP — staging env files *(once)*

Staging gets its own database role, Redis namespace and hostnames. ofuma and
doca both, on branch `stg`:
```bash
unset -f cd pnpm node npm npx 2>/dev/null
cd ~/Documents/projects/ofuma && git checkout stg && git pull
E=ofuma/backend/.env.staging
STGPW="$(openssl rand -base64 24)"
REDISPW="$(dotenvx get REDIS_PASSWORD_OFUMA -f ../nagaya/.env.production -fk ../nagaya/.env.keys)"
dotenvx set PG_USERNAME ofuma_stg -f $E
dotenvx set PG_PASSWORD "$STGPW"  -f $E
dotenvx set PG_DATABASE ofuma_stg -f $E
dotenvx set REDIS_PASSWORD "$REDISPW" -f $E           # was empty: staging's own Redis had none
dotenvx set REDIS_DB 1 -f $E
dotenvx set EVENT_CHANNEL_PREFIX "stg:evaluation:events" -f $E   # pub/sub ignores REDIS_DB (§1.3)
dotenvx set TRUSTED_PROXY_CIDRS "172.16.0.0/12" -f $E
dotenvx set ALLOWED_ORIGINS "https://stg.ofuma.ai,https://doca-stg.ofuma.ai" -f $E
dotenvx set OFUMA_DOCA_URL "https://doca-stg.ofuma.ai" -f $E
dotenvx set DOCA_SITE_URL  "https://doca-stg.ofuma.ai" -f $E

# doca: the same role and password (it is the same database)
E=doca/api/.env.staging
dotenvx set PG_USERNAME ofuma_stg  -f $E
dotenvx set PG_PASSWORD "$STGPW"   -f $E
dotenvx set PG_DATABASE ofuma_stg  -f $E
dotenvx set REDIS_PASSWORD "$REDISPW" -f $E
dotenvx set REDIS_DB 1 -f $E
dotenvx set ALLOWED_ORIGINS    "https://doca-stg.ofuma.ai" -f $E
dotenvx set DOCA_API_URL       "https://doca-stg.ofuma.ai/api" -f $E
dotenvx set DOCA_OFUMA_URL     "https://stg.ofuma.ai" -f $E
dotenvx set DOCA_OFUMA_API_URL "https://stg.ofuma.ai/api" -f $E
git commit -am "ofuma + doca staging: nagaya role, Redis namespace, single-level hostnames" && git push
unset STGPW REDISPW
```
The staging **frontends** need nothing here. Their values are in
`ofuma/frontend/runtime-env/staging.env` and `doca/web/runtime-env/staging.env`
(§1.4), already pointing at the single-level names. Make sure §1.4 is merged
on `stg` too.
🌐 **Google Cloud Console** → **APIs & Services** → **Credentials** → the
staging OAuth client → **Authorised redirect URIs** / **JavaScript origins**:
add the `doca-stg.ofuma.ai` equivalents of any `doca.stg.ofuma.ai` entries.
The old ones can go in Phase 9.

### 7.4 💻 — point the staging names at nagaya

`sites.yaml`: delete `stg_origin: hetzner-ofuma-stg` from
`apps.ofuma.defaults`, so staging follows `origin: nagaya`. Render → apply →
push. Expect 4 records changed: `stg`, `api-stg`, `doca-stg`, `api-doca-stg`.
While staging is down, they show the "Staging is off" page.

### 7.5 🖥️ + 🌐 — first start: restore, then deploy

1. 🌐 **Deploy (nagaya)** on `stg`, *deploy unticked* → `<sha_stg>` (all four images).
2. 🖥️ nagaya:
   ```bash
   nagaya prepare ofuma-main-stg <sha_stg>          # role ofuma_stg, empty database ofuma_stg
   nagaya prepare ofuma-doca-stg <sha_stg>
   nagaya restore ofuma_stg /srv/nagaya/state/ofuma-stg-final.sql.gz
   nagaya deploy ofuma-main-stg <sha_stg>           # also marks staging "up"
   nagaya deploy ofuma-doca-stg <sha_stg>
   ```
3. Add `stg` to the `push:` branches in `deploy-nagaya.yml`, on both `master`
   and `stg`, so `[master, stg]` everywhere.
4. Check it: `https://stg.ofuma.ai` loads and logs in. Then confirm staging's
   queues are separate:
   ```bash
   # the password is redis-server's argument, not an env var in the container, so pass it from nagaya's env
   dotenvx run --quiet -f /srv/nagaya/.env.production -fk /srv/nagaya/.env.keys -- sh -c \
     'for db in 0 1; do echo "DB $db: $(docker exec redis-ofuma redis-cli -a "$REDIS_PASSWORD_OFUMA" --no-auth-warning -n $db --scan --pattern "bull:*" | wc -l) BullMQ keys"; done
      docker exec redis-ofuma redis-cli -a "$REDIS_PASSWORD_OFUMA" --no-auth-warning pubsub channels "*evaluation:events*"'
   ```
   Expect BullMQ keys in **both** DB 0 (production) and DB 1 (staging), and
   among the channels, staging's `stg:evaluation:events:…` next to
   production's `evaluation:events:…`.

### 7.6 Day to day

```bash
nagaya stg down ofuma     # when finished: frees ~250 MB, keeps data and DNS
nagaya stg up ofuma       # when needed again (or push to stg)
```
Staging is a no-op for backups while it is down: the nightly job still dumps
`ofuma_stg`, since it exists, and that is cheap.

---

## Phase 8 — Backups, proven

The crontab has run `nagaya backup` at 03:00 UTC since Phase 5. It dumps
every database that exists to `s3://<bucket>/<db>/<db>-<UTC stamp>.sql.gz` and
checks each upload is at least 2 KB. Retention is the buckets' existing 30-day
lifecycle rules.

**8.1** 🖥️ **SERVER nagaya** — the morning after the last cutover:
```bash
tail -20 /srv/nagaya/logs/backup.log      # ✓ dmb / abm / nihongo / ofuma (/ ofuma_stg): N bytes
```

**8.2** 🌐 **BROWSER (Cloudflare)** — **R2** → `dmb-backups` → objects under
`dmb/`, `abm/`, `nihongo/`; `ofuma-backups` → `ofuma/` (and `ofuma_stg/`).
**Settings** → **Object lifecycle rules**: a delete-after-30-days rule on each
bucket, carried over from Hetzner days.

**8.3** 🖥️ **SERVER nagaya** — **the restore drill**. A backup that has
never been restored is a hope, not a backup:
```bash
nagaya drill dmb
#   live    dmb: 23 tables, 41 migrations
#   backup  dmb/dmb-2026-…Z.sql.gz: 23 tables, 41 migrations
# ✓ drill passed for dmb
nagaya drill ofuma
```
`drill` fetches the newest object for that database from R2 and restores it
into a scratch `restore_test` database. It compares table and migration counts
with the live database, then drops the scratch copy. Run it for every database
now, and again every few months, or after any change to `backup`. A real
restore of a live database is `nagaya restore <db> latest --replace`
([Rolling back → the database](#the-database)).

---

## Phase 9 — Decommission

After **7 days** with every site on nagaya and nothing odd in
`/srv/nagaya/logs/alerts-memory.log`:

**9.1** 🌐 **Hetzner Cloud** — for each of `dmb-prod`, `ofuma-prod`, `ofuma-stg`:
1. **Snapshots** → **Take snapshot**. It costs cents a month, and it is the last
   copy of the box exactly as it was.
2. Then **Delete** the server.

Keep the snapshots for a month, then delete them too.

**9.2** 💻 **nagaya** — remove the migration scaffolding from `sites.yaml`:
- the `hetzner-*` entries under `origins:`;
- the three old staging records under `apps.ofuma.dns` (`doca.stg`,
  `api-doca.stg`, `piston.stg`). Before deleting `piston.stg`, ⚠️ disable
  PM-Interview-Bank's code runner, or clear its `PISTON_*` settings on Vercel:
  it calls that host, and Piston is gone.

Render → PR → merge. Expect only deletions in the plan.

**9.3** 💻 **The app repos**, and the leftovers in this one:
- **dmb.futari:**
  - delete `Caddyfile` and the `futari/` directory (both live in nagaya now);
  - delete the `caddy`, `postgres` and `redis` services from `docker-compose.prod.yml`, or the whole file;
  - delete `ci_deploy_key*` from the working tree;
  - mark DEPLOY.md as historical, pointing at nagaya;
  - the `k8s/` tree and the `deploy-production.yaml` / `deploy-staging.yaml`
    workflows were already dead and can go too.
- **abm.futari, nihongo.futari:** delete `docker-compose.prod.yml`, the
  unused `Caddyfile`, and `ci_deploy_key*`.
- **ofuma:**
  - delete the four `deploy-*-vps.yaml` callers and `deploy-vps.yaml`;
  - delete `Caddyfile` and the Piston services;
  - DEPLOY-HETZNER.md becomes historical;
  - check DigitalOcean, as `DEPLOY-HETZNER.md` asked, for any surviving DOKS cluster or managed Postgres.
- **Every repo:** delete the old Actions secrets: `DEPLOY_HOST`, `DEPLOY_USER`,
  `DEPLOY_SSH_KEY`, `DEPLOY_PATH`, `DEPLOY_PORT`, and ofuma's `PROD_HOST` / `STG_HOST`.
- **App env files:** the per-app R2 keys (`S3_*`, `AWS_*`) are unused now that
  nagaya runs backups. Remove them, then revoke the matching R2 tokens in Cloudflare.
- **The migration branches:** once merged, delete
  `nagaya/frontend-runtime-env` in `dmb.futari`, `abm.futari` and
  `nihongo.futari`, and `nagaya/doca-standard-db-env` in the ofuma repo
  (`git branch -d <branch>`, and on GitHub if you pushed them).

**9.4** 🌐 **Namecheap** — **Email Forwarding** rules for both domains are
now dead config (mail goes through Cloudflare). Delete them so nobody edits them
by mistake.

**9.5** 🌐 **Google Cloud Console** — remove the `doca.stg` / `api-doca.stg`
OAuth origins and redirect URIs.

---

## Shipping a change

| Change | How it ships |
|---|---|
| **App code** (any app repo) | Push to `master` (or a staging branch). That repo's **Deploy (nagaya)** workflow tests, builds the images, pushes them to GHCR and runs `nagaya deploy <project> <sha>`. If health checks fail, nagaya rolls back to the previous tag and the job goes red. |
| **App config / secrets** | `dotenvx set KEY value -f <app>/backend/.env.production`, commit, push. The env file is baked into the image, so a config change is a deploy like any other. A changed `PG_PASSWORD` is applied to the role by that deploy. |
| **The registry** (`sites.yaml`) | Branch, edit, `pnpm render`, commit both, open a PR. CI shows the Terraform plan. Merge → Terraform apply → `nagaya apply`. |
| **nagaya itself** (`bin/nagaya`, renderer, static page) | PR → merge; `nagaya apply` pulls it. |
| **The futari.live page** | Edit `static/futari/`, PR → merge. Caddy reads from disk, so no reload is needed. |
| **Cloudflare's IP ranges** | Two independent signals: the box's daily `nagaya alerts cloudflare-ranges` (cron, `sites.yaml` → `alerts.checks`) emails you when the published ranges differ from the repo's, and the weekly bot PR does the edit for you. Merge the PR (or run `pnpm render:refresh-cf-ips` and open one yourself), then `sudo /srv/nagaya/generated/firewall.sh` on the box. The PR only runs `pr.yml`'s checks if the `BOT_PR_TOKEN` secret is set (see the workflow's comment); otherwise the merge's `apply.yml` is the check. Either way, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** once. |

## Adding a site

[docs/sites-yaml.md → A worked example](docs/sites-yaml.md#a-worked-example-adding-blogfutarilive)
covers it. In short:

1. **Registry:** add the site under its app, run `pnpm render`, open a PR, and merge.
   That creates the DNS record, the network and the Caddy route.
2. **Repo:** copy the closest `templates/app-repo/*.yml` into the new repo
   and adjust the names. Make sure its backend Dockerfile bakes in the
   encrypted `.env.production` (§1.1).
3. **Keys:** copy its `.env.keys` to `/srv/nagaya/keys/<app>-<site>-<service>.keys` (§3.4).
4. **Secrets:** run `gh secret set NAGAYA_SSH_KEY -R thedumebi/<repo> < ~/.ssh/nagaya_ci`.
   Terraform sets the other `NAGAYA_*` secrets, because the merge added the
   repo to `deploy_repos`.
5. **Deploy:** push to the new repo's `master`. The first deploy creates the
   database and role from its env file.

### Adding a whole new domain

1. Add an **app** with `domain:`, `email: { mode: namecheap … }` if mail
   exists today, and its non-site `dns:` records. Run `pnpm render` and apply.
2. Repeat §4.6–§4.11 for that domain: compare records, then turn DNSSEC off and
   switch the nameservers at the registrar. After that, email routing.
3. Generate the CSR on the box (§3.6, one domain) and commit it. The next apply
   issues the certificate; copy it over (§4.11).
4. Run `nagaya apply`. Caddy gets a `tls_<domain>` snippet for the new zone.

## Removing a site

1. Delete its block from `sites.yaml`, `pnpm render`, PR, merge.
   - **Terraform** deletes its DNS records.
   - **`nagaya apply`** notices a running project that the registry no longer
     has, stops it and removes its containers (`docker compose -p <project> down`).
2. **The data is kept on purpose.** The database, the role, its R2 backups and
   the key file all stay. Drop them by hand when you are sure:
   ```bash
   nagaya psql postgres    # then: DROP DATABASE <db>; DROP ROLE <role>;  (if no other site uses it)
   rm /srv/nagaya/keys/<app>-<site>-*
   ```

---

## Rolling back

### An app deploy

`nagaya deploy` already rolls back on its own if the new containers never
pass their health checks. For a deploy that is healthy but wrong:
```bash
nagaya rollback <project>          # redeploys the tag before the current one
```
Or push a revert to the repo, which is the better record. A rollback does not
undo migrations: Drizzle migrations only go forward. Write the next migration
to be compatible with the previous code if you think you might need one.

### A cutover (Phase 6)

- **Before step (h)**, with DNS still on Hetzner: run `docker start
  <app>-backend` on the Hetzner box and restore its cron lines from
  `~/crontab.before-*`. Nothing ever reached nagaya.
- **After step (h)**, writes have landed on nagaya:
  1. Stop the nagaya backend: `docker stop futari-<site>-backend`.
  2. Dump: `docker exec pg-main pg_dump -U postgres --no-owner --no-acl -d <db> | gzip > /tmp/<db>.sql.gz`.
  3. Copy it to Hetzner and restore it there as `thedumebi` into an emptied
     database: `dropdb` + `createdb`, then `gunzip -c … | psql`.
  4. Start the Hetzner backend.
  5. Set `origin:` back to the `hetzner-*` origin, render, and apply.

  That is the reason the Hetzner boxes stay for 7 days.

### The database

```bash
nagaya restore <db> latest --replace      # newest R2 backup; up to 24 h of data lost
nagaya restore <db> /path/to/file.sql.gz --replace
```
Stop the projects that use the database first; restore refuses while they run.
`--replace` drops and recreates the database owned by the same role, then
loads as that role. Start the projects again with `nagaya deploy <project>
$(sed -n 's/^TAG=//p' /srv/nagaya/state/tags/<project>.env)`.

### DNS

Every record is in git. To roll a registry change back, revert the commit and
merge. For an emergency without CI: `git revert` locally, `pnpm render`,
`terraform -chdir=terraform apply`.

---

## Day-2 operations

### Where things are on the box

| Path | What |
|---|---|
| `/srv/nagaya` | this repo (`git pull` by `nagaya apply`). Why `/srv`: [docs/box-layout.md](docs/box-layout.md) |
| `/srv/nagaya/generated/` | the rendered Caddyfile, compose files, crontab, firewall, plan.json |
| `/srv/nagaya/keys/` | apps' `.env.keys` (`*.keys`) and nagaya's per-environment splits (`*.production.key`, `*.staging.key`). `chmod 700` |
| `/srv/nagaya/certs/` | Origin CA `<domain>.pem` + `.key`. `chmod 700` |
| `/srv/nagaya/state/tags/` | the image tag each project runs (`<project>.env`) and the previous one (`.prev.env`) |
| `/srv/nagaya/state/stg/` | `up` / `down` per staging project |
| `/srv/nagaya/state/alerts/` | alert bookkeeping: last swap counters, when each alert was last sent |
| `/srv/nagaya/logs/` | `backup.log`, `cron.log`, `alerts-memory.log`, `alerts-cloudflare-ranges.log` |
| `/srv/shared/futari/geodata` | GeoLite2, shared by the futari backends |
| `/etc/docker/daemon.json` | log rotation, address pool (§2.7) |

### Everyday commands

```bash
nagaya status                               # projects, tags, staging state, docker stats, free -m, disk
docker logs -f --tail 100 ofuma-main-backend
docker compose -p futari-dmb ps             # one project's containers
nagaya psql dmb                             # psql as the superuser
tail -f /srv/nagaya/logs/alerts-memory.log  # one line every 5 minutes: the numbers the memory check acts on
```

### Connect a database client (TablePlus etc.)

Postgres listens on the box's loopback only. Tunnel to it:
```bash
ssh -N -L 5433:127.0.0.1:5432 nagaya     # 💻 leave running
```
Then connect to `localhost:5433` as the **app's role** for its database, for
example `thedumebi` for dmb/abm/nihongo or `ofuma` for ofuma.

**Each database admits only its own role.** On every deploy, `nagaya` runs
`REVOKE CONNECT … FROM PUBLIC` and `GRANT CONNECT … TO <owner>` for the
site's database, and revokes `PUBLIC` on the default `postgres` database too.
Postgres would otherwise let *every* role connect to *every* database. So a
staging login can't open production, and a mistyped `PG_DATABASE` fails at
connect instead of writing somewhere wrong. To check (as the superuser):
```bash
nagaya psql postgres
```
```sql
SELECT has_database_privilege('ofuma_stg', 'ofuma_stg', 'CONNECT');  -- t
SELECT has_database_privilege('ofuma_stg', 'ofuma',     'CONNECT');  -- f
SELECT datname, pg_get_userbyid(datdba) AS owner, datacl FROM pg_database ORDER BY 1;
```
dmb, abm and nihongo all use the role `thedumebi`, so that one role can open
all three of its databases. Give each its own `PG_USERNAME`/`PG_PASSWORD` in
its env file to separate them. Use the
superuser `postgres` only when you mean to. TablePlus's own **Over SSH** option
does the same: SSH host `152.53.205.203`, user `deploy`, key `~/.ssh/nagaya_admin`,
then database host `127.0.0.1:5432`.

### Memory: is the box short?

**How to read `free -m`.** Look at **`available`**, not `free`. `buff/cache`
is the kernel using spare RAM as file cache, and it hands that back the moment
a process needs it, so low `free` with high `available` is a healthy box.

**How to tell whether it is swapping.** The **used** column of the `Swap:`
line is not the measure. It counts idle pages that were pushed out once and
never needed back. That is harmless: ofuma-prod on Hetzner showed 636 MB of
swap used with 2.6 GB available, left over from on-box builds. What matters is
**activity**, whether pages are moving in and out *now*:
```bash
vmstat 5      # watch the si (swap in) and so (swap out) columns
```
- **Mostly 0, with the odd blip:** fine.
- **Non-zero line after line for minutes:** the box is genuinely short of RAM,
  and everything is slower for it.

Two more signals:
```bash
cat /proc/pressure/memory            # "some avg300=" — % of the last 5 min some task waited on memory
journalctl -k | grep -i oom          # the kernel killed something: a container hit its cap, or the box ran out
docker ps -a --format '{{.Names}}' | xargs docker inspect -f '{{.Name}} oomkilled={{.State.OOMKilled}} restarts={{.RestartCount}}' | grep oomkilled=true
```

**The alerts do this watching for you.** `nagaya alerts memory` runs from cron
on the schedule in `sites.yaml` → `alerts.checks.memory.every` (every 5
minutes). It logs one line per run to `logs/alerts-memory.log` and emails
`alerts.to` through Brevo when any of these trips:

| Check | Default threshold | Measured from |
|---|---|---|
| Available memory | below **400 MB** | `/proc/meminfo` MemAvailable |
| Swap activity | **100 pages/s** (~400 KB/s) in + out, averaged since the last run | `/proc/vmstat` pswpin + pswpout deltas |
| Memory pressure | tasks stalled **>10%** of the last 5 min | `/proc/pressure/memory` some avg300 |
| OOM kills | **any** new one | `/proc/vmstat` oom_kill delta |
| Disk | **85%** of `/` | `df` |

How the emails behave:
- **When they come:** one email when a problem starts, a reminder every 6 h
  while it lasts (`repeat_hours`), and one "resolved" email when it clears.
  OOM kills are events, so each is reported once.
- **What they contain:** the numbers, `free -m`, the top containers by memory,
  any container whose last exit was an OOM kill, and the disk line.
- **How they send:** from `nagaya@futari.live` through Brevo's API, with
  `BREVO_API_KEY` in nagaya's `.env.production`, the same key the futari apps
  use. If a send fails, it is retried on the next run.
- **To check the pipe:** run `nagaya alerts --test` at any time.
- **To tune:** change the thresholds (or `every`) under `alerts.checks.memory` in `sites.yaml` and merge.

**What to do when it fires:**
1. **Find the cause.** `nagaya status`: which container is big?
   `docker stats` over a minute: is it growing (a leak) or stable (just too
   big for its cap)?
2. **Cheap fixes first:** `nagaya stg down ofuma` (~250 MB). Lower a cap that
   is mostly empty, or raise one that keeps getting OOM-killed. Restart a
   leaking container while you look for the leak.
3. **If steady-state usage stays above ~3.2 GB**, or swap activity is
   persistent, upgrade in place: **CCP** → the VPS → **Upgrade** → **VPS 1000
   G12** (8 GB). netcup notes *"After an upgrade, a vServer will be
   restarted"*, so plan a few minutes of downtime. Every container comes back
   on its own (`restart: unless-stopped`), and the firewall unit re-applies
   the DOCKER-USER rule.

### Disk

```bash
df -h /
docker system df
```
Nothing builds on the box, so the 9 GB build-cache problem from the dmb box
cannot recur. After every successful deploy nagaya deletes old images,
keeping each project's current and previous tag (the rollback target).
Container logs rotate at 3 × 10 MB. If disk does climb, look at `docker system df -v`, then
at the Postgres volume (`docker exec pg-main du -sh /var/lib/postgresql`).

### Rotate a database password

1. `dotenvx set PG_PASSWORD "$(openssl rand -base64 24)" -f <env file>` in the
   app repo, then commit and push.
2. The deploy sets the role's new password, and the backend restarts with it.
3. **If two sites share the role** (ofuma main + doca), nagaya refuses the
   first deploy, because the other site's env still has the old password.
   Update both env files, then deploy the first with
   `NAGAYA_ROTATE=<role> nagaya deploy …` from an admin SSH session, then the second normally.

### Update Caddy, Postgres minor, Redis

```bash
nagaya core pull  # docker compose on core.yml, with nagaya's secrets loaded
nagaya apply      # recreates whatever changed, then re-attaches networks
```
(Plain `docker compose -f …/core.yml` fails with *required variable
PG_SUPERUSER_PASSWORD is missing*: core.yml needs nagaya's decrypted secrets
for every subcommand. `nagaya core …` supplies them.)
Minor versions only: `postgres:18-alpine` moves within 18. That costs a few
seconds of downtime for every site using the recreated container.

### Upgrade Postgres to a new major (19, …)

Data directories are not forward compatible. Pointing a 19 image at 18 data
refuses to start (`database files are incompatible with server`). Every major
upgrade is a dump, a fresh volume and a restore, with downtime in between.
Nooklet's "Upgrading PostgreSQL" section is the long-form version. The short form:

1. `nagaya backup`, then `nagaya drill` for each database.
2. Stop every project that uses the resource (`docker compose -p <project> stop` for each).
3. Dump everything: `docker exec pg-main pg_dumpall -U postgres | gzip > /srv/nagaya/state/pre-upgrade.sql.gz`,
   and copy it to the laptop too.
4. Set `version: 19` in `sites.yaml`, render, and merge **without** applying on the box:
   push with `[skip ci]`, or run the box step by hand later.
5. Remove the old volume:
   ```bash
   nagaya core stop pg-main
   docker rm pg-main
   docker volume rm nagaya-core_pg-main-data
   ```
6. `nagaya apply`. That starts an empty 19.
7. Restore the dump: `gunzip -c … | docker exec -i pg-main psql -U postgres`.
8. `nagaya apply` again, which starts the projects.
9. `nagaya drill` each database.

### Origin certificates

They are valid for 15 years, and Cloudflare sends **no** reminder. Renewing
is §3.6 (new key + CSR on the box), committing the CSR, a Terraform apply
(the certificate is replaced), and §4.11 (copy, verify the modulus), then
`docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

---

## Reference

### The secret model

| Secret | Lives | Encrypted by | Decrypted by |
|---|---|---|---|
| Each app's config (DB, Redis, Brevo, Stripe, OAuth…) | the app repo's `.env.production` / `.env.staging`, **baked into its image** | dotenvx (app's public key) | the app itself, at start-up, with the key nagaya injects |
| Each app's dotenvx private keys | laptop + `/srv/nagaya/keys/*.keys` | — | nagaya splits one key per environment into `keys/*.<env>.env`, mounted as `env_file` |
| Postgres superuser, Redis password, R2 backup token, GHCR pull token, Brevo key, nihongo cron secret | nagaya's `.env.production` (committed) | dotenvx | `bin/nagaya`, under `dotenvx run` with `/srv/nagaya/.env.keys` |
| Each site's DB role password | **only** in the app's env file | — | nagaya reads it out of the image at deploy time and sets the role; nagaya keeps a 16-char hash only, to detect two sites disagreeing |
| Cloudflare / GitHub / state tokens | `~/.config/nagaya/tf.env` + Actions secrets on the nagaya repo | — | Terraform |
| CI's SSH key | `~/.ssh/nagaya_ci` + Actions secret `NAGAYA_SSH_KEY` on 5 repos | — | pinned to `nagaya ssh-dispatch` on the box |
| Origin CA private keys | `/srv/nagaya/certs/*.key` only | — | Caddy |

**Rule of thumb:** a stolen image, a stolen repo or the leaked Terraform state
each contains no usable secret on its own. Usable secrets need a key file that
exists only on the laptop and the box.

### Why it is built this way

- **Compose, not k3s.** Nooklet needed zero-downtime rolling updates for a
  storefront taking payments. These sites can take a few seconds' blip on
  deploy. k3s would cost ~700 MB of the 4 GB, and every app would need porting
  to manifests.
- **A registry and a renderer, rather than Coolify or Dokploy.** Those are
  good, but they bring a dashboard, a database and an agent of their own to the
  box, and they hide state in that database. `sites.yaml` plus `generated/` is
  all in git and diffable: a PR shows exactly what will change.
- **Resources attached outside compose.** If `core.yml` listed every project
  network, adding a site would make compose recreate Postgres and drop every
  site's connections. `docker network connect --alias` adds the site without
  touching anything running.
- **Roles from the app's env, not from nagaya.** One source of truth per
  password, so rotating one is a normal app deploy, and nagaya never holds an
  app's database password.
- **Origin CA, not Let's Encrypt.** Behind proxied DNS, an ACME HTTP-01
  challenge has to cross Cloudflare and needs port 80 open. Origin CA is one
  15-year certificate per zone with no renewal machinery, trusted only by
  Cloudflare, which is exactly who may connect.
- **443 only.** Cloudflare speaks HTTPS to the origin (Full strict), and
  *Always Use HTTPS* redirects visitors at the edge. Port 80 on the box would
  serve nobody.
- **Crons inside containers, not via public URLs.** During a migration a public
  URL can lead to either box. Inside the container it can only be this one.

---

## Verification — the acceptance tests

Run all of them after Phase 6. Re-run A, D and E after any change to the
firewall, compose ports or Caddy.

| | Test | Pass |
|---|---|---|
| **A** | Every hostname in `sites.yaml` from the laptop: `curl -sI https://<host>` | 2xx/3xx with `server: cloudflare`, a `cf-ray` header, and for www a 301 to the apex |
| **B** | Each site: log in, write something, read it back | works |
| **C** | Brevo send from each app; mail to every `email.addresses` entry and to a made-up address | arrives, DKIM/DMARC pass, not in spam |
| **D** | Real client IP: `curl https://dmb.futari.live/api/…` past a rate limit from one machine, then from another network | the second is unaffected; logs show real IPs |
| **E** | Origin not reachable directly: `curl -sk -m 8 https://152.53.205.203/` from the laptop | times out (exit 28) |
| **F** | The WAF: `curl -s -o /dev/null -w '%{http_code}' -A nuclei/3 https://dmb.futari.live/` and `…/.env` | 403 from Cloudflare |
| **G** | Deploy path: push a trivial commit to each repo | the workflow goes green; `nagaya status` shows the new SHA |
| **H** | Rollback path: `nagaya deploy futari-nihongo <a SHA whose backend crashes on start>`, for example a commit with a deliberate `process.exit(1)` | the health check fails, then a rollback to the previous tag, and the site stays up |
| **I** | Staging: `nagaya stg up ofuma`, a job on staging, `nagaya stg down ofuma` | the job runs only on staging (its queue is in Redis DB 1); after down, the "Staging is off" page shows and ~250 MB is freed |
| **J** | Backups: `nagaya drill <db>` for every database | passes |
| **K** | Alerts: `nagaya alerts --test`; then, to see a real one, temporarily set `mem_available_mb` above the current value, merge, wait 5 min, and set it back | the test arrives; a real alert arrives, then "resolved" after reverting |
| **L** | Reboot: `sudo reboot` | every site comes back on its own; `iptables -S DOCKER-USER` shows the NAGAYA-CF rule; E still passes |

---

## Open items

- [ ] §1.3 ofuma Redis namespacing: code change, before the first `stg up`.
- [ ] UptimeRobot checks: `https://futari.live`, `https://dmb.futari.live/api/healthcheck`,
      `https://abm.futari.live/api/healthcheck`, `https://nihongo.futari.live/api/healthcheck`,
      `https://api.ofuma.ai/healthcheck`, `https://api-doca.ofuma.ai/healthcheck`.
- [ ] Calendar: the Origin CA certificates' expiry (2041), the GitHub
      fine-grained token's renewal (1 year from §4.2), and a yearly look at the
      GHCR pull token.
- [ ] `EMAIL_FROM` for the futari apps is `hello@<app>.futari.live`, a subdomain
      of the Brevo-authenticated domain. It works today through DMARC's relaxed
      alignment. Worth a look if deliverability ever dips.
