variable "account_id" {
  description = "Cloudflare account the inboxes are registered under."
  type        = string
}

variable "addresses" {
  description = "Destination inboxes. Each gets a verification email; until it is clicked, mail routed to it is silently dropped."
  type        = set(string)
}
