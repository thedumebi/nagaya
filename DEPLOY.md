# Deploying nagaya

How the futari and ofuma sites move from three Hetzner boxes onto one netcup
VPS called **nagaya** (長屋, a row house: many households under one roof),
and the step-by-step runbook to do it.

This file is the **why**: what exists today, what replaces it, the decisions
and the memory budget. The **how** is in two other files:

- **[RUNBOOK.md](RUNBOOK.md)**: every step, in order, tagged with where it runs
  (💻 LAPTOP, 🖥️ SERVER, 🌐 BROWSER), plus shipping, rollback and day-2
  operations.
- **[docs/sites-yaml.md](docs/sites-yaml.md)**: what each key of the registry
  means.

---

## Context

**Today** three Hetzner CX23 boxes (2 vCPU / 4 GB each) run Docker Compose with Caddy:

| Box | IP | Serves |
|---|---|---|
| `dmb-prod` | 138.199.195.21 | dmb / abm / nihongo.futari.live, futari.live (static page), www.futari.live |
| `ofuma-prod` | 91.99.67.183 | ofuma.ai, www, api, doca, api-doca |
| `ofuma-stg` | 46.225.127.236 | stg / api-stg / doca.stg / api-doca.stg / piston.stg .ofuma.ai |

How the pieces work today:
- **dmb's compose owns the shared services.** Caddy, Postgres and Redis on the
  dmb box all belong to dmb's compose project. abm and nihongo attach to them
  over a hand-made `futari` network.
- **ofuma brings its own.** Each ofuma box runs its own Caddy, Postgres and Redis.
- **Every deploy builds on the box itself.** A deploy SSHes in, runs
  `git reset --hard` and then `docker compose up --build`.
- **DNS for both domains is Namecheap BasicDNS.**

**The goal** is one netcup VPS 500 G12.5 (Nooklet's box is the older VPS 500 G12: same CPU and memory, but 128 GB NVMe, where G12.5 has 64 GB SSD; G12 is no longer sold) running all of it except Piston, which keeps the old Hetzner staging box to itself:

- **One registry, `sites.yaml`, declares everything.** Adding a domain or
  subdomain is an entry and a merge.
- **Images are built in GitHub Actions** and pulled by the box. Nothing compiles on it.
- **Both domains move to Cloudflare**: proxied DNS, an Origin CA certificate,
  WAF rules, and Email Routing. Terraform drives all of it.
- **ofuma keeps a staging environment**, switched off by default and turned on when needed.

**What prompted it:**
- Three boxes cost three times what one does. They also leave three of
  everything to patch, back up and remember.
- Hetzner's 15 June 2026 price rise and stock problems are why Nooklet went to netcup.
- ofuma and doca are kept alive but are quiet, so they no longer justify boxes of their own.

---

## Decisions

| Area | Decision |
|---|---|
| Server | netcup **VPS 500 G12.5** (2 vCore, 4 GB, 64 GB SSD), Nuremberg, **monthly / no commitment**, hostname `nagaya` |
| Orchestration | **Docker Compose + Caddy**, not k3s. The apps are already compose-shaped, and k3s costs ~700 MB of a 4 GB box |
| What runs | futari.live (static), dmb, abm, nihongo, ofuma (main + doca) prod, ofuma staging (off by default). **Piston is not on nagaya**: it stays alone on the old Hetzner staging box (`boxes/piston/`), because it runs untrusted code in a privileged container and must never sit next to the databases and keys |
| Registry | `sites.yaml` in this repo, rendered by `pnpm render` (TypeScript + zod) into `generated/` |
| Images | Built in each app repo's CI, pushed to **GHCR** as `ghcr.io/thedumebi/<app>-<site>-<service>:<sha>` |
| Deploy | CI SSHes in with a key that can only run `nagaya deploy <project> <sha>` |
| App secrets | Unchanged model: dotenvx-encrypted `.env.production` committed in each app repo, **now baked into the image**; only the decryption keys live on the box |
| Postgres | **One instance, version 18** (matches Nooklet), one database and one role per site |
| Redis | `redis-futari` (rate limits, no password, as today) and `redis-ofuma` (BullMQ, password, `noeviction`), shared by ofuma prod + staging with per-environment namespacing |
| DNS / TLS | Cloudflare, **proxied**, SSL **Full (strict)**, **Cloudflare Origin CA** certificates (15 years, no ACME) |
| Firewall | ufw: SSH from anywhere, **443 from Cloudflare only**. Nothing else published |
| Email | Cloudflare **Email Routing** (receive) replaces Namecheap forwarding; Brevo (send) unchanged |
| Infra as code | **Terraform** for Cloudflare and GitHub Actions secrets. The box itself is `bin/nagaya`, not Terraform |
| Backups | Nightly `pg_dump` of every database to the existing R2 buckets, 30-day lifecycle |

### Running cost

| Item | Monthly |
|---|---|
| netcup VPS 500 G12.5, Nuremberg, no commitment | ~€9.50 (netcup's listed price, October 2026; your invoice is the truth). €8.26 on a 12-month term |
| Hetzner CX23, the Piston box | ~€5.49 (after Hetzner's June 2026 rise) |
| Cloudflare (DNS, CDN, WAF, Origin CA, Email Routing) | €0 |
| Cloudflare R2 (backups + Terraform state, well under 10 GB) | €0 |
| GHCR (private images, within the free storage) | €0 |
| **Total for compute** | **~€15/mo** for nagaya + the Piston box, replacing three Hetzner boxes |

---

## Architecture

```
                         visitors
                            │
                  Cloudflare edge (proxied DNS, WAF, Full strict)
                            │  443 only, from Cloudflare's ranges (ufw)
                            ▼
 ┌─────────────────────── netcup VPS 500 G12.5 "nagaya" (NUE) ───────────────────────┐
 │  2 vCPU / 4 GB / 64 GB SSD · Ubuntu 24.04 Minimal · Docker                         │
 │                                                                                    │
 │   caddy ──(each site's net)─▶ futari-{dmb,abm,nihongo}-frontend /srv/static/futari │
 │     │                       ofuma-main-frontend · backend (api.)                   │
 │     │                       ofuma-doca-doca-web · doca-api (api-doca.)             │
 │     │                       ofuma-*-stg-*  (off by default → "Staging is off")     │
 │     │                                                                              │
 │   per-site networks: frontend ─▶ backend ─▶ pg-main (Postgres 18, one DB per site) │
 │                                         └─▶ redis-futari | redis-ofuma             │
 │                                                                                    │
 │   /srv/nagaya  (this repo)  bin/nagaya · generated/ · keys/ · certs/ · state/      │
 └────────────────────────────────────────────────────────────────────────────────────┘
        ▲ nagaya deploy <project> <sha>                    │ nightly pg_dump
        │ (SSH, forced command)                            ▼
   GitHub Actions in each app repo ── push ──▶ GHCR    Cloudflare R2 (30-day lifecycle)
   GitHub Actions in nagaya ── terraform ──▶ Cloudflare DNS / email / WAF, GitHub secrets
```

---

## Memory budget (4 GB, measured)

Measured on the Hetzner boxes on 2026-10-03 with `docker stats --no-stream`
and `free -m`:

| Container (today) | Memory |
|---|---|
| dmb-backend / abm-backend / nihongo-backend | 101 / 112 / 155 MB |
| dmb-postgres (dmb + abm + nihongo) | 151 MB |
| dmb-caddy, dmb-redis, three nginx frontends | ~35 MB together |
| ofuma-backend | 162 MB |
| doca-api | 83 MB |
| ofuma-frontend, doca-web | ~17 MB together |
| ofuma-postgres, ofuma-redis, ofuma-caddy | ~64 MB (merge into the shared ones) |

What that means for nagaya:

| | |
|---|---|
| All app containers | ~0.85–0.9 GB |
| OS + Docker overhead | ~0.8–1.0 GB (the gap between container usage and `used` on both boxes) |
| **Expected steady state** | **~1.7–1.9 GB used, ~2 GB available** |
| ofuma staging, when switched on | +~0.25 GB |
| For comparison, Nooklet's netcup box today | 1462 MB used, 2447 MB available |

Every container has a cap (`mem:` in `sites.yaml`), so a leak kills that
container, which then restarts. It cannot take the box down. Two things keep
the box comfortable: **images build in CI** (a `vue-tsc` build on the box can
take 1–2 GB, and once filled the dmb box's disk with 9 GB of build cache), and
**staging is off unless you need it**. How to watch it, and when to upgrade, is
in [Day-2 → Memory](RUNBOOK.md#memory-is-the-box-short).

---

## Deliberately not doing

- **Zero-downtime deploys.** Containers are replaced in place, so a deploy is a
  few-second blip per site. Fine for these sites; Nooklet is where that work went.
- **Running R2 buckets through Terraform.** The backup buckets and their
  lifecycle rules already exist and hold the only off-box copies of the data.
  A misread plan that replaces a bucket is not a risk worth one less dashboard
  click. They stay dashboard-managed.
- **Building images on the box**, ever. It is what forced dmb's swapfile and
  filled its disk.
- **A metrics stack** (Prometheus, Grafana). `nagaya alerts` and `nagaya
  status` cover what a single small box needs. UptimeRobot (free) on one URL per
  site covers "is it up from outside", and is worth adding once Phase 6 is done.
- **Piston on nagaya.** It needs a privileged container (root on the host
  if its sandbox is escaped) and Java/C++ compiles spike to ~1.4 GB. It runs
  alone on the old Hetzner staging box instead; `boxes/piston/README.md`.
  The free public Piston API is whitelist-only (non-commercial) since
  February 2026, and Judge0's free tier allows 50 runs a day.
- **Authenticated Origin Pulls** (mTLS from Cloudflare). The DOCKER-USER rule
  already admits only Cloudflare's ranges; AOP would add a layer that does not
  depend on IP ranges. It is worth doing later, not needed to migrate.
