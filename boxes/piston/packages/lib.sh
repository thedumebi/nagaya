# Shared by the package scripts. Sourced, not run.

# Must equal the image in ../docker-compose.yml: packages are built and tested
# on the same image that runs them. build.sh checks this.
PISTON_IMAGE="ghcr.io/engineer-man/piston@sha256:2f66b7456189c4d713aa986d98eccd0b6ee16d26c7ec5f21b30e942756fd127a"

# fetch <url> <sha256|sha512> <hex digest> <file>: download and verify, or stop.
fetch() {
  local url=$1 algo=$2 digest=$3 file=$4
  curl -fsSL --retry 3 -o "$file" "$url"
  if ! echo "$digest  $file" | "${algo}sum" --check --status; then
    echo "checksum mismatch for $url" >&2
    exit 1
  fi
}
