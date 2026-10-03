// generated/caddy/Caddyfile — the single edge for every site on the box.
//
// Caddy sits behind Cloudflare (generated/firewall.sh admits only Cloudflare
// on 443), so:
//   - TLS is a Cloudflare Origin CA cert per zone, loaded from /certs. No ACME.
//   - The real client IP comes from CF-Connecting-IP, trusted only from
//     Cloudflare's published ranges, and is written into X-Forwarded-For so the
//     backends' rate limiters and geo lookups (which read the first XFF hop)
//     see the visitor, never a Cloudflare edge address.

import { HEADER } from './header.ts'
import type { Model, Route } from './types/index.ts'

// Shown on a staging hostname while its containers are stopped.
const STAGING_OFF_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staging is off</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}code{background:#f3f3f3;padding:.1em .3em;border-radius:3px}</style></head><body><h1>Staging is off</h1><p>This staging environment is switched off to save memory. Bring it up on the box with <code>nagaya stg up APP</code>, or push to its staging branch.</p></body></html>`

// "futari.live" → "tls_futari_live", the snippet each of the zone's sites imports.
function tlsSnippetName(domain: string): string {
  return `tls_${domain.replace(/[^a-z0-9]/g, '_')}`
}

export function renderCaddyfile(model: Model, cloudflareRanges: string[]): string {
  const blocks: string[] = [HEADER('#')]

  blocks.push(`{
	# Cloudflare terminates the visitor's HTTPS; it reaches us on 443 only
	# (Always Use HTTPS is on at the edge), so there is nothing to redirect.
	auto_https disable_redirects

	servers {
		# Only these peers may set the client IP. Refreshed weekly by
		# .github/workflows/cf-ranges.yml (pnpm render:refresh-cf-ips).
		trusted_proxies static ${cloudflareRanges.join(' ')}
		client_ip_headers CF-Connecting-IP
	}
}
`)

  for (const zone of model.zones) {
    blocks.push(`(${tlsSnippetName(zone.domain)}) {
	tls /certs/${zone.domain}.pem /certs/${zone.domain}.key
}
`)
  }

  blocks.push(`(proxy_headers) {
	# Overwrite, never append: whatever the visitor sent in X-Forwarded-For is
	# discarded and replaced with the address Cloudflare saw.
	header_up X-Forwarded-For {client_ip}
}
`)

  const routesByZone = new Map<string, Route[]>()
  for (const route of model.routes)
    routesByZone.set(route.zone, [...(routesByZone.get(route.zone) ?? []), route])

  for (const [domain, zoneRoutes] of routesByZone) {
    blocks.push(`# ─────────────────────────── ${domain} ───────────────────────────\n`)
    for (const route of zoneRoutes)
      blocks.push(renderSiteBlock(route, tlsSnippetName(domain)))
  }

  return `${blocks.join('\n').trimEnd()}\n`
}

function renderSiteBlock(route: Route, tlsSnippet: string): string {
  const lines = [`${route.host} {`, `\timport ${tlsSnippet}`]

  if (route.kind === 'redirect') {
    lines.push(`\tredir https://${route.redirectTo}{uri} permanent`)
  }
  else if (route.kind === 'static') {
    lines.push(
      '\tencode zstd gzip',
      '\theader {',
      '\t\tX-Content-Type-Options nosniff',
      '\t\tReferrer-Policy strict-origin-when-cross-origin',
      '\t}',
      `\troot * /srv/static/${route.staticDir}`,
      '\tfile_server',
    )
  }
  else {
    // No proxy timeouts: Caddy's reverse_proxy has none by default, so a slow
    // response is never cut off here. The limit that applies is Cloudflare's:
    // a proxied request gets 100 s, then a 524.
    lines.push('\tencode zstd gzip', `\treverse_proxy ${route.upstream} {`, '\t\timport proxy_headers', '\t}')
    if (route.variant === 'stg') {
      // A stopped staging container does not resolve, so Caddy answers 502.
      // Show a page that says why instead. It also hides a crashed staging,
      // which is why `nagaya status` is the source of truth.
      lines.push(
        '\thandle_errors 502 503 {',
        '\t\theader Content-Type "text/html; charset=utf-8"',
        `\t\trespond \`${STAGING_OFF_PAGE}\` 503`,
        '\t}',
      )
    }
  }

  lines.push('}', '')
  return lines.join('\n')
}
