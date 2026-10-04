# One Cloudflare zone and everything in it: TLS settings, DNS records, the WAF
# rule, the Origin CA certificate and email routing rules. The root module
# instantiates it once per domain in sites.yaml.

# ───────────────────────────── zone ─────────────────────────────

# Creating the zone is what produces the two nameservers you set at Namecheap.
resource "cloudflare_zone" "this" {
  account = { id = var.account_id }
  name    = var.domain
  type    = "full"
}

# Full (strict): the edge verifies the origin's certificate. Plain Full would
# accept any certificate at all; Flexible would talk to the origin in clear.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = cloudflare_zone.this.id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = cloudflare_zone.this.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = cloudflare_zone.this.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

# ───────────────────────────── DNS ─────────────────────────────

# Keys come from the renderer: "A dmb.futari.live" for A/AAAA/CNAME (so an
# origin change is an in-place update), "TXT <name> <content>" for TXT/MX.
resource "cloudflare_dns_record" "this" {
  for_each = var.records

  zone_id = cloudflare_zone.this.id
  name    = each.value.name
  type    = each.value.type
  # Cloudflare stores TXT content quoted and flags unquoted values; quoting
  # here keeps the plan from showing a diff on every run.
  content  = each.value.type == "TXT" ? "\"${each.value.content}\"" : each.value.content
  proxied  = contains(["A", "AAAA", "CNAME"], each.value.type) ? each.value.proxied : null
  priority = each.value.priority
  ttl      = 1 # automatic
}

# ───────────────────────────── WAF ─────────────────────────────

# Scanners and probe paths are dropped at the edge, before they reach the box.
# Ported from Nooklet RUNBOOK.md §7.12. Do NOT add /swagger or /api-docs: some
# of the apps serve their own docs and you would block them.
locals {
  scanner_expression = join(" or ", concat(
    [for user_agent in ["l9scan", "nuclei", "sqlmap", "masscan", "zgrab", "gobuster", "dirbuster", "wpscan", "nikto"] :
    "(http.user_agent contains \"${user_agent}\")"],
    [for path in ["/.env", "/.git", "/.vscode", "/wp-", "/xmlrpc.php", "/info.php", "/server-status", "/actuator", "/login.action", "/ecp/"] :
    "(http.request.uri.path contains \"${path}\")"],
  ))
}

resource "cloudflare_ruleset" "waf" {
  zone_id = cloudflare_zone.this.id
  name    = "nagaya custom rules"
  kind    = "zone"
  phase   = "http_request_firewall_custom"
  rules = [{
    description = "Block scanners and probe paths"
    expression  = local.scanner_expression
    action      = "block"
    enabled     = true
  }]
}

# ───────────────────────────── origin certificate ─────────────────────────────

# 15 years, for <domain> and *.<domain>. The CSR is generated ON THE BOX
# (RUNBOOK.md §3.6); the private key never leaves it and so never enters state.
# No CSR yet means no certificate yet.
resource "cloudflare_origin_ca_certificate" "this" {
  count = var.origin_csr == null ? 0 : 1

  csr                = var.origin_csr
  hostnames          = [var.domain, "*.${var.domain}"]
  request_type       = "origin-rsa"
  requested_validity = 5475
}

# ───────────────────────────── email routing ─────────────────────────────

# Only in mode "cloudflare". Enabling Email Routing itself (which adds
# Cloudflare's locked MX/SPF/DKIM records) is a dashboard click, RUNBOOK.md
# §4.10.3; these rules need it enabled first. The destination address is
# account-wide, so it lives in the cloudflare-email-destinations module.
locals {
  email_routing_enabled = var.email.mode == "cloudflare"
}

# One rule per address, each to its own inbox (sites.yaml: a plain string uses
# the app's forward_to, an object names its own).
resource "cloudflare_email_routing_rule" "address" {
  for_each = local.email_routing_enabled ? var.email.rules : {}

  zone_id  = cloudflare_zone.this.id
  name     = "forward ${each.key}"
  enabled  = true
  matchers = [{ type = "literal", field = "to", value = each.key }]
  actions  = [{ type = "forward", value = [each.value] }]
}

resource "cloudflare_email_routing_catch_all" "this" {
  count = local.email_routing_enabled && var.email.catch_all_to != "" ? 1 : 0

  zone_id  = cloudflare_zone.this.id
  name     = "catch-all"
  enabled  = true
  matchers = [{ type = "all" }]
  actions  = [{ type = "forward", value = [var.email.catch_all_to] }]
}
