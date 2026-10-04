# Terraform manages the parts of nagaya that live in other people's
# dashboards: Cloudflare (zones, DNS, TLS settings, WAF, email routing, origin
# certificates) and GitHub (the Actions secrets app repos use to deploy).
# It never touches the box itself; that is bin/nagaya's job.
#
# Inputs: generated.auto.tfvars.json (rendered from sites.yaml, never edit)
#         terraform.tfvars          (account ids and box facts, edited by hand)
# Layout: main.tf wires modules/ (see its header).
# Run:    RUNBOOK.md §4 (first time), then CI on every merge.

terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.10"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
  }

  # State lives in a private R2 bucket created by hand (RUNBOOK.md §4.3); the
  # endpoint is in backend.hcl. Credentials come from AWS_ACCESS_KEY_ID /
  # AWS_SECRET_ACCESS_KEY (an R2 token scoped to that one bucket).
  # use_lockfile takes a lock object next to the state, so the laptop and CI
  # cannot apply at the same time.
  backend "s3" {
    bucket                      = "nagaya-tfstate"
    key                         = "nagaya.tfstate"
    region                      = "auto"
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Token from CLOUDFLARE_API_TOKEN (RUNBOOK.md §4.1 lists its permissions).
provider "cloudflare" {}

# Token from GITHUB_TOKEN: fine-grained, Secrets read/write on the nagaya and
# app repos (RUNBOOK.md §4.2).
provider "github" {
  owner = var.github_owner
}
