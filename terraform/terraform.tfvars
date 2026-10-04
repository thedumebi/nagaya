# Facts Terraform needs that do not belong in sites.yaml. None are secret.
# Secrets come from the environment: CLOUDFLARE_API_TOKEN, GITHUB_TOKEN,
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (R2 state bucket).

cloudflare_account_id = "fc1d900f3e5f5c13647bb78fe5cf15b1"
github_owner          = "thedumebi"

# Filled in at RUNBOOK.md §4.4, once the box exists (Phase 2):
nagaya_host        = "152.53.205.203"
nagaya_known_hosts = "152.53.205.203 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINRHmAII8bkEUxSOgOnHJ08auRM5Np4PIEX8arVHQqdx"