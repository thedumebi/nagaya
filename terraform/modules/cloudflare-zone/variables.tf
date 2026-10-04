variable "account_id" {
  description = "Cloudflare account that owns the zone."
  type        = string
}

variable "domain" {
  description = "The zone apex, e.g. futari.live."
  type        = string
}

variable "records" {
  description = "DNS records keyed by a stable id (rendered from sites.yaml)."
  type = map(object({
    name     = string
    type     = string
    content  = string
    proxied  = bool
    priority = optional(number)
  }))
}

variable "email" {
  description = "Email routing for the zone (sites.yaml → apps.<app>.email)."
  type = object({
    mode         = string      # none | namecheap | cloudflare-pending | cloudflare
    rules        = map(string) # full address → inbox
    catch_all_to = string      # "" = no catch-all
  })
}

variable "origin_csr" {
  description = "PEM CSR for the Origin CA certificate, or null to skip it."
  type        = string
  default     = null
}
