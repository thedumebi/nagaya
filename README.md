# nagaya

長屋, a row house: many households under one roof. This repo runs every
futari and ofuma site on one VPS.

| | |
|---|---|
| **[sites.yaml](sites.yaml)** | The registry: every site, resource, DNS record and alert threshold. |
| **[docs/sites-yaml.md](docs/sites-yaml.md)** | What each key in it means, with a worked example. |
| **[docs/box-layout.md](docs/box-layout.md)** | Where things live on the box, and why `/srv`. |
| **[DEPLOY.md](DEPLOY.md)** | The runbook: building the box, migrating off Hetzner, day-2 operations. |
| `render/` | `pnpm render`: sites.yaml → `generated/` (TypeScript + zod, run on Node 24). All types live in `render/types/`. |
| `generated/` | Caddyfile, compose files, crontab, firewall, plan.json. Committed; never edited by hand. |
| `bin/nagaya` | The CLI on the box: `apply`, `deploy`, `stg up/down`, `backup`, `restore`, `drill`, `alerts`, `status`. |
| `terraform/` | Cloudflare (zones, DNS, TLS, WAF, email routing, origin certs) and GitHub Actions secrets, as modules. |
| `templates/app-repo/` | The deploy workflow each app repo copies. |
| `static/` | Static sites Caddy serves directly (the futari.live page). |

```bash
nvm use            # Node 24
pnpm install
pnpm test          # renderer tests
pnpm render        # after editing sites.yaml; commit generated/ with it
```

How a change flows:

- **The registry:** edit `sites.yaml` → `pnpm render` → PR (CI shows the
  Terraform plan) → merge → Terraform applies DNS → `nagaya apply` on the box.
- **An app:** push to its repo → its CI builds images to GHCR →
  `nagaya deploy <project> <sha>`.
