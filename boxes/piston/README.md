# The Piston box

`piston.stg.ofuma.ai` → Hetzner CX23 `46.225.127.236` (the old ofuma staging
box, kept for this alone). It runs [Piston](https://github.com/engineer-man/piston),
the code-execution engine behind PM-Interview-Bank's **Run Tests** and its
coding-spec pipeline, for Python, JavaScript, TypeScript, Java, C++ and Go.

**Why not on nagaya:** Piston runs untrusted code in a **privileged**
container, which is root on the host if its sandbox is ever escaped. nagaya
holds every database and every app's decryption keys. Java and C++ compiles
also spike to ~1.4 GB, which nagaya's 4 GB is not sized for.

## What runs

| Container | Does |
|---|---|
| `piston-caddy` | TLS for `piston.stg.ofuma.ai` (Let's Encrypt, HTTP-01 on port 80), basic auth, proxy to Piston |
| `piston` | Piston, pinned by digest, privileged, capped at 1400 MiB |

Volumes (created by the old ofuma compose, reused so nothing is reinstalled):
`ofuma_piston_packages` (the installed runtimes, ~5 GB), `ofuma_caddy_data`
(certificates), `ofuma_caddy_config`.

## Files

On the box at `~/piston`, copied from this folder (it is not a git checkout):

| File | In git? | Holds |
|---|---|---|
| `docker-compose.yml` | yes | the two services, plus the one-off runtime installer (`--profile install`) |
| `caddy/Caddyfile` | yes | the one site block |
| `.env` | **no** | `ACME_EMAIL=…` |
| `caddy/piston-auth` | **no** | `piston <bcrypt hash>`; PM-Interview-Bank's `PISTON_AUTH_TOKEN` is the password it matches |

The two untracked files stay out of git because this repo is public. Both are
`chmod 600`.

## Day to day

```bash
ssh deploy@46.225.127.236
cd ~/piston
docker compose ps
docker compose logs --tail 50 piston
```

**Update this folder's files on the box** after changing them here:
```bash
# 💻 from the nagaya repo
scp boxes/piston/docker-compose.yml deploy@46.225.127.236:piston/
scp boxes/piston/caddy/Caddyfile deploy@46.225.127.236:piston/caddy/
# 🖥️ on the box
cd ~/piston && docker compose up -d                 # recreates only what changed
docker exec piston-caddy caddy reload --config /etc/caddy/Caddyfile   # Caddyfile-only change
```

**Rotate the token:**
```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'NEW_TOKEN'
# put "piston <hash>" in ~/piston/caddy/piston-auth, then reload Caddy (above),
# then set PISTON_AUTH_TOKEN=NEW_TOKEN in PM-Interview-Bank
```

**Reinstall the runtimes** (only if the packages volume is ever lost). The
versions must match PM-Interview-Bank's `lib/codeRunner.ts` `PISTON_VERSION_MAP`:
```bash
docker compose --profile install run --rm piston-install-runtimes
```

**Change the Piston image:** re-run PM-Interview-Bank's `coding:revalidate`
against the new image first, then change the digest here.

## Checks

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://piston.stg.ofuma.ai/api/v2/runtimes   # 401
curl -s -u "piston:$PISTON_AUTH_TOKEN" https://piston.stg.ofuma.ai/api/v2/runtimes | jq -r '.[] | "\(.language) \(.version)"'
# python 3.10.0, node 18.15.0 (javascript), typescript 5.0.3, java 15.0.2, gcc 10.2.0 (c++), go 1.16.2
curl -s -u "piston:$PISTON_AUTH_TOKEN" https://piston.stg.ofuma.ai/api/v2/execute \
  -H 'Content-Type: application/json' \
  -d '{"language":"python","version":"3.10.0","files":[{"content":"print(6*7)"}]}' | jq -r .run.stdout   # 42
```
