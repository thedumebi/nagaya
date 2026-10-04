# Where things live on the box

nagaya puts everything it owns under `/srv`. This page explains why, and what
each directory on the box is for.

## Why `/srv`? (It is not a typo for `src`.)

Linux has a long-standing convention for where things go: the **Filesystem
Hierarchy Standard** (FHS). Most distributions, Ubuntu included, follow it.
The directories that matter here:

| Directory | FHS meaning | Typical contents | Used by nagaya for |
|---|---|---|---|
| **`/srv`** | *"Site-specific data served by this system"* | the files behind websites, git repositories, FTP areas | **everything nagaya owns**: `/srv/nagaya` (this repo, plus keys, certs, state, logs) and `/srv/shared` (data shared between apps) |
| `/opt` | *"Add-on application software packages"* | a self-contained program installed outside the package manager, e.g. `/opt/google/chrome` | nothing on the host. Inside the futari containers, `/opt/futari` is where the GeoLite2 data is mounted, because that is the path the apps already used on Hetzner |
| `/home/<user>` | a user's personal files | dotfiles, a user's own projects | only the `deploy` user's SSH config and keys (`~/.ssh`) |
| `/var/lib` | programs' variable state | `/var/lib/docker` (images, volumes), `/var/lib/postgresql` | Docker keeps its images and **named volumes**, including the Postgres and Redis data, under `/var/lib/docker`. nagaya never touches it directly |
| `/etc` | system configuration | `/etc/ssh/sshd_config`, `/etc/docker/daemon.json` | the Docker daemon config (§2.7) and the firewall's systemd unit |
| `/usr/local/bin` | locally installed commands | `dotenvx` | the `nagaya` command (a symlink to `/srv/nagaya/bin/nagaya`) |

**Why `/srv` rather than `/home/deploy`?**
- **It describes what the data is.** "This machine serves these sites" is
  exactly what `/srv` is for. Nooklet's box used `/home/deploy/nooklet`, which
  works too, but it ties the data to one login account. If `deploy` were
  renamed, removed or joined by a second admin user, the sites' home shouldn't
  have to move.
- **One place to back up, inspect or move.** Everything nagaya-specific is
  under `/srv/nagaya`, apart from the data in Docker volumes.

It's a convention, not a technical requirement. Changing it means changing
`ROOT` in `render/constants.ts`, and the paths in `bin/nagaya` and DEPLOY.md.

## Inside `/srv`

```
/srv
├── nagaya/                      ← a git checkout of this repo (owned by deploy)
│   ├── bin/nagaya               ← the CLI (symlinked to /usr/local/bin/nagaya)
│   ├── generated/               ← committed output of `pnpm render`
│   │   ├── caddy/Caddyfile      ← mounted into Caddy as /etc/caddy (the directory)
│   │   ├── compose/*.yml        ← one file per project, plus core.yml
│   │   ├── crontab              ← installed as deploy's crontab by `nagaya apply`
│   │   ├── firewall.sh          ← run with sudo; installs nagaya-firewall.service
│   │   └── plan.json            ← what bin/nagaya reads
│   ├── static/futari/           ← the futari.live page, mounted into Caddy as /srv/static
│   ├── .env.production          ← nagaya's own secrets, encrypted (committed)
│   ├── .env.keys                ← their decryption key       ┐
│   ├── keys/                    ← apps' .env.keys + per-env .key │ NOT in git: listed
│   ├── certs/                   ← Origin CA certs + keys      │ in .gitignore, created
│   ├── state/                   ← tags, staging up/down, …    │ on the box only
│   └── logs/                    ← backup, cron, alerts logs  ┘
└── shared/
    └── futari/geodata/          ← GeoLite2, mounted into the futari backends as /opt/futari
```

## Paths inside containers

A container has its own filesystem, separate from the box's. Mounts connect
the two:

| On the box | Inside the container | Container |
|---|---|---|
| `/srv/nagaya/generated/caddy` | `/etc/caddy` | caddy |
| `/srv/nagaya/certs` | `/certs` | caddy |
| `/srv/nagaya/static` | `/srv/static` | caddy |
| `/srv/shared/futari` | `/opt/futari` | futari-dmb-backend, futari-abm-backend, futari-nihongo-backend |
| Docker volume `nagaya-core_pg-main-data` | `/var/lib/postgresql` | pg-main |
| Docker volume `nagaya-core_redis-*-data` | `/data` | redis-futari, redis-ofuma |

That's why the same word shows up on both sides with different meanings:
`/srv/static` *inside Caddy* is `/srv/nagaya/static` *on the box*.
