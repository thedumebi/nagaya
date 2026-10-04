# The Actions secrets a repo's workflow uses to reach the nagaya box.
#
# NAGAYA_SSH_KEY is deliberately NOT here: it is a private key, and anything
# Terraform sets is stored in state. Set it by hand (RUNBOOK.md §2.10). The
# box's read-only deploy key for cloning nagaya is also manual (§2.8): it has
# to exist before the box can run anything at all.

# Every (repository, secret name) combination: 5 repos × 3 secrets = 15.
# Only the NAMES are made non-sensitive (to key the resources); values stay
# sensitive and never appear in plan output.
locals {
  repository_secrets = {
    for combination in setproduct(var.repositories, nonsensitive(keys(var.secrets))) :
    "${combination[0]} ${combination[1]}" => { repository = combination[0], secret_name = combination[1] }
  }
}

resource "github_actions_secret" "this" {
  for_each = local.repository_secrets

  repository      = each.value.repository
  secret_name     = each.value.secret_name
  plaintext_value = var.secrets[each.value.secret_name]
}
