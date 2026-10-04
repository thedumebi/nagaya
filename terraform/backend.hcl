# terraform init -backend-config=backend.hcl
# The R2 S3 endpoint is https://<ACCOUNT_ID>.r2.cloudflarestorage.com. Not a
# secret; the account id is in the dashboard URL.
endpoints = {
  s3 = "https://CHANGE_ME_ACCOUNT_ID.r2.cloudflarestorage.com"
}
