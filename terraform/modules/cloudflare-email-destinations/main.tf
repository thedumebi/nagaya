# Email Routing destination addresses are account-wide, not per zone: one
# verified address can receive for every zone. Kept apart from the zone module
# so two zones forwarding to the same inbox do not both try to create it.

resource "cloudflare_email_routing_address" "this" {
  for_each = var.addresses

  account_id = var.account_id
  email      = each.key
}
