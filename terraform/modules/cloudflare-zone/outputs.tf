output "name_servers" {
  description = "The two Cloudflare nameservers assigned to this zone."
  value       = cloudflare_zone.this.name_servers
}

output "status" {
  description = "pending until the registrar points at Cloudflare, then active."
  value       = cloudflare_zone.this.status
}

output "origin_certificate" {
  description = "PEM certificate (public data), or null when no CSR was given."
  value       = one(cloudflare_origin_ca_certificate.this[*].certificate)
}
