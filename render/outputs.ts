// The small generated files: crontab, firewall script, Terraform variables, and
// plan.json (the machine-readable model bin/nagaya reads with jq).

import { ROOT } from './constants.ts'
import { HEADER } from './header.ts'
import type { Model } from './types/index.ts'

export function renderCrontab(model: Model): string {
  const lines = [
    HEADER('#').trimEnd(),
    '# Installed as the deploy user\'s whole crontab by `nagaya apply`.',
    '# Cron has a bare PATH; without this line docker and dotenvx are not found.',
    'SHELL=/bin/bash',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    '',
    `${model.registry.backups.at} ${ROOT}/bin/nagaya backup >> ${ROOT}/logs/backup.log 2>&1`,
  ]
  if (model.registry.alerts)
    lines.push(`${model.registry.alerts.every} ${ROOT}/bin/nagaya alerts >> ${ROOT}/logs/alerts.log 2>&1`)
  for (const project of model.projects) {
    for (const cron of project.crons)
      lines.push(`${cron.at} ${ROOT}/bin/nagaya cron ${cron.id} >> ${ROOT}/logs/cron.log 2>&1`)
  }
  return `${lines.join('\n')}\n`
}

export function renderFirewall(cloudflareRanges: string[]): string {
  const ipv4Ranges = cloudflareRanges.filter(range => range.includes('.'))
  return `#!/usr/bin/env bash
${HEADER('#').trimEnd()}
#
# The nagaya firewall: SSH from anywhere, 443 from Cloudflare only. Two layers,
# because ufw alone is not enough on a Docker host:
#
#   1. ufw (INPUT chain): sshd, and Caddy's IPv6 listener (Docker's userland
#      proxy accepts IPv6 on the host, so that traffic does pass through ufw).
#   2. DOCKER-USER (FORWARD chain): Caddy's IPv4 :443 is published by Docker
#      with DNAT, so those packets are FORWARDed to the container and never
#      reach ufw's INPUT rules at all. Without this chain the origin would
#      answer anyone on the internet who found its IP, ufw notwithstanding.
#
# Idempotent. Run by hand after the weekly Cloudflare-ranges PR merges:
#   sudo ${ROOT}/generated/firewall.sh
# and at every boot by nagaya-firewall.service (installed on the first run),
# because iptables rules do not survive a reboot.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run with sudo" >&2; exit 1; fi

if [[ "\${1:-}" != --boot ]]; then
  ufw default deny incoming
  ufw default allow outgoing
  # MUST precede "ufw enable", or enabling locks you out of your own box.
  ufw allow OpenSSH

  # Every 443 rule carries the comment nagaya-cf. Delete them all and re-add
  # the current list, so a range Cloudflare retires does not stay open.
  mapfile -t old < <(ufw status numbered | awk -F'[][]' '/nagaya-cf/ { gsub(/ /, "", $2); print $2 }' | sort -rn)
  for n in "\${old[@]}"; do ufw --force delete "$n" >/dev/null; done
  for ip in ${cloudflareRanges.join(' ')}; do
    ufw allow proto tcp from "$ip" to any port 443 comment nagaya-cf >/dev/null
  done
  ufw --force enable
fi

# ── DOCKER-USER: only Cloudflare may open connections to published :443 ──
# Created here if Docker has not made it yet: at boot this runs BEFORE
# docker.service (see the unit below), so the rule is in place before Docker
# restores Caddy and publishes 443. Docker adopts an existing DOCKER-USER chain
# and never flushes it.
IF="$(ip route show default | awk '{print $5; exit}')"
iptables -N DOCKER-USER 2>/dev/null || true
iptables -N NAGAYA-CF 2>/dev/null || true
iptables -F NAGAYA-CF
for ip in ${ipv4Ranges.join(' ')}; do
  iptables -A NAGAYA-CF -s "$ip" -j RETURN
done
iptables -A NAGAYA-CF -j DROP
# --ctorigdstport matches the port the client asked for, before Docker's DNAT
# rewrote it. --ctdir ORIGINAL limits it to packets from the connecting side,
# so replies to the containers' own outbound HTTPS calls are never touched.
rule=(-i "$IF" -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j NAGAYA-CF)
iptables -C DOCKER-USER "\${rule[@]}" 2>/dev/null || iptables -I DOCKER-USER "\${rule[@]}"

# ── re-apply at every boot, BEFORE Docker starts its containers ──
# Written every run (not only when missing), so a change to the unit in a
# later render reaches the box.
if [[ "\${1:-}" != --boot ]]; then
  cat > /etc/systemd/system/nagaya-firewall.service <<'UNIT'
[Unit]
Description=nagaya firewall: Cloudflare-only 443 for Docker-published ports
After=network-online.target ufw.service
Wants=network-online.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=${ROOT}/generated/firewall.sh --boot
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target docker.service
UNIT
  systemctl daemon-reload
  systemctl enable nagaya-firewall.service >/dev/null
fi

if [[ "\${1:-}" != --boot ]]; then
  ufw status verbose
  echo
  iptables -S DOCKER-USER
  echo "NAGAYA-CF: $(iptables -S NAGAYA-CF | grep -c RETURN) Cloudflare ranges, then DROP"
fi
`
}

export function renderTfvars(model: Model): string {
  const zones: Record<string, unknown> = {}
  for (const zone of model.zones) {
    zones[zone.domain] = {
      records: Object.fromEntries(zone.records.map(record => [record.key, {
        name: record.name,
        type: record.type,
        content: record.content,
        proxied: record.proxied,
        priority: record.priority,
      }])),
      email_mode: zone.email?.mode ?? 'none',
      email_rules: Object.fromEntries((zone.email?.rules ?? []).map(rule => [rule.address, rule.to])),
      email_catch_all_to: zone.email?.catchAllTo ?? '',
    }
  }
  // Repos whose CI deploys to the box: Terraform gives each the NAGAYA_*
  // Actions secrets it needs to reach it.
  const deployRepos = [...new Set(model.projects.map(project => project.repo))].sort()
  return `${JSON.stringify({ zones, deploy_repos: deployRepos }, null, 2)}\n`
}

// Everything bin/nagaya needs, so the bash never re-derives a name.
export function renderPlan(model: Model): string {
  const plan = {
    root: ROOT,
    resources: {
      postgres: Object.keys(model.registry.resources.postgres),
      redis: Object.entries(model.registry.resources.redis)
        .map(([redisName, redisConfig]) => ({ name: redisName, password_env: redisConfig.password_env ?? null })),
    },
    projects: model.projects.map(project => ({
      id: project.id,
      app: project.app,
      site: project.site,
      variant: project.variant,
      repo: project.repo,
      compose: `generated/compose/${project.id}.yml`,
      network: project.network,
      owns_network: project.ownsNetwork,
      attach: project.attachments,
      database: project.database,
      redis: project.redis,
      services: project.services.map(service => ({
        key: service.key,
        container: service.container,
        image: service.image,
        port: service.port,
        health: service.health,
        nodeEnv: service.nodeEnv,
        dotenvx: service.dotenvx,
        credentials: service.credentials,
      })),
    })),
    routes: model.routes.map(route => ({ host: route.host, project: route.project, variant: route.variant, kind: route.kind })),
    crons: model.projects.flatMap(project => project.crons),
    // `to` is always a list here, whichever form sites.yaml used.
    alerts: model.registry.alerts
      ? { ...model.registry.alerts, to: [model.registry.alerts.to].flat() }
      : null,
    backups: {
      databases: model.databases.map(database => ({
        name: database.name,
        resource: database.resource,
        bucket: model.registry.backups.buckets[database.app] ?? null,
      })),
    },
  }
  return `${JSON.stringify(plan, null, 2)}\n`
}
