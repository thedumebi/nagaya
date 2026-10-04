output "verified" {
  description = "Address → verification timestamp (null while unverified)."
  value       = { for address, destination in cloudflare_email_routing_address.this : address => destination.verified }
}
