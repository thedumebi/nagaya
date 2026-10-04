# Required in every module that uses a non-HashiCorp provider: without it,
# Terraform assumes hashicorp/<name> (a different, unconfigured provider for
# github; a non-existent one for cloudflare) and init fails or misbehaves.
# The version constraint lives once, in the root versions.tf.
terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
  }
}
