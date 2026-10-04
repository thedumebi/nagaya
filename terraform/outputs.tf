output "nameservers" {
  description = "Paste these into Namecheap → Domain → Nameservers → Custom DNS (RUNBOOK.md §4.8)."
  value       = { for domain, zone in module.zone : domain => zone.name_servers }
}

output "zone_status" {
  description = "pending until the nameserver change is seen, then active."
  value       = { for domain, zone in module.zone : domain => zone.status }
}

output "origin_certificates" {
  description = "PEM certificates to copy to /srv/nagaya/certs/<domain>.pem (RUNBOOK.md §4.11). Public data."
  value       = { for domain, zone in module.zone : domain => zone.origin_certificate if zone.origin_certificate != null }
}

output "email_destinations_verified" {
  description = "Forwarding inboxes and when each was verified (null = click the link Cloudflare emailed)."
  value       = module.email_destinations.verified
}
