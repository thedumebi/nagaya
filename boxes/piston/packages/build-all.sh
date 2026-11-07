#!/usr/bin/env bash
# Build every package in this folder: ./build-all.sh <output dir>
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

for metadata in "$here"/*/*/metadata.json; do
  recipe=$(dirname "$metadata")
  bash "$here/build.sh" "$(basename "$(dirname "$recipe")")" "$(basename "$recipe")" "$1"
done
