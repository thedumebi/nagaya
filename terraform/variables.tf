# ── from generated.auto.tfvars.json (pnpm render) ──

variable "zones" {
  description = "Per domain: its DNS records and email routing, rendered from sites.yaml."
  type = map(object({
    records = map(object({
      name     = string
      type     = string
      content  = string
      proxied  = bool
      priority = optional(number)
    }))
    email_mode         = string      # none | namecheap | cloudflare-pending | cloudflare
    email_rules        = map(string) # full address → inbox it forwards to
    email_catch_all_to = string      # inbox for everything else; "" = no catch-all
  }))
}

variable "deploy_repos" {
  description = "owner/repo of every repository whose CI deploys to the box."
  type        = list(string)
}

# ── from terraform.tfvars (edited by hand) ──

variable "cloudflare_account_id" {
  description = "Cloudflare account id (dashboard URL: dash.cloudflare.com/<this>)."
  type        = string
}

variable "github_owner" {
  description = "GitHub user or org that owns the repos."
  type        = string
}

variable "nagaya_host" {
  description = "Public IPv4 of the nagaya box. null until it exists (RUNBOOK.md §2.1)."
  type        = string
  default     = null
}

variable "nagaya_known_hosts" {
  description = "`ssh-keyscan -t ed25519 <ip>` output, so CI pins the box's host key instead of trusting whatever answers."
  type        = string
  default     = null
}
