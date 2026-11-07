#!/usr/bin/env bash
# Write the index Piston reads through PISTON_REPO_URL:
#   ./make-index.sh <output dir> <base url of the packages>
# One "name,version,sha256,url" line per built package, then upstream-index.csv:
# Piston looks every install up here, so runtimes we still take from upstream
# have to be listed too.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out=$1
base_url=${2%/}

{
  for file in "$out"/*.pkg.tar.gz; do
    name=$(basename "$file" .pkg.tar.gz)
    checksum=$(sha256sum "$file" | cut -d' ' -f1)
    echo "${name%-*},${name##*-},$checksum,$base_url/$(basename "$file")"
  done
  cat "$here/upstream-index.csv"
} > "$out/index"

cut -d, -f1,2 "$out/index"
