# Root module: wires the rendered registry (generated.auto.tfvars.json) and
# the hand-kept facts (terraform.tfvars) into the three modules.
#
#   modules/cloudflare-zone               one per domain: zone, TLS, DNS, WAF,
#                                         origin certificate, email rules
#   modules/cloudflare-email-destinations account-wide forwarding inboxes
#   modules/github-deploy-secrets         NAGAYA_* Actions secrets on each repo

module "zone" {
  source   = "./modules/cloudflare-zone"
  for_each = var.zones

  account_id = var.cloudflare_account_id
  domain     = each.key
  records    = each.value.records
  email = {
    mode         = each.value.email_mode
    rules        = each.value.email_rules
    catch_all_to = each.value.email_catch_all_to
  }
  origin_csr = fileexists("${path.module}/csr/${each.key}.csr") ? file("${path.module}/csr/${each.key}.csr") : null
}

module "email_destinations" {
  source = "./modules/cloudflare-email-destinations"

  account_id = var.cloudflare_account_id
  # Created from cloudflare-pending on, so the address exists (and can be
  # verified) BEFORE Email Routing is enabled in the dashboard, which then
  # picks it instead of creating a duplicate Terraform could not adopt.
  # Every inbox any rule or catch-all forwards to, across all zones.
  addresses = toset(flatten([
    for zone in values(var.zones) :
    concat(values(zone.email_rules), zone.email_catch_all_to == "" ? [] : [zone.email_catch_all_to])
    if contains(["cloudflare-pending", "cloudflare"], zone.email_mode)
  ]))
}

# Only once the box exists (nagaya_host and its host key are known).
module "deploy_secrets" {
  source = "./modules/github-deploy-secrets"
  count  = var.nagaya_host != null && var.nagaya_known_hosts != null ? 1 : 0

  # The app repos deploy; the nagaya repo itself runs `apply` on merge.
  repositories = toset(concat([for repo in var.deploy_repos : split("/", repo)[1]], ["nagaya"]))
  secrets = {
    NAGAYA_HOST        = var.nagaya_host
    NAGAYA_USER        = "deploy"
    NAGAYA_KNOWN_HOSTS = var.nagaya_known_hosts
  }
}
