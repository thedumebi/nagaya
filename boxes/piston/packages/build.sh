#!/usr/bin/env bash
# Build one package: ./build.sh <language> <version> <output dir>
# Writes <output dir>/<language>-<version>.pkg.tar.gz. Linux x86-64 only, needs Docker.
#
# fetch.sh runs on the host, because the Piston image has neither curl nor xz.
# setup.sh runs inside the Piston image at the package's real install path, so
# anything it compiles or resolves matches where the package will run (glibc
# 2.28, the same path, the same environment).
set -euo pipefail

language=$1
version=$2
mkdir -p "$3"
out=$(realpath "$3")

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$here/lib.sh"

if ! grep -qF "$PISTON_IMAGE" "$here/../docker-compose.yml"; then
  echo "PISTON_IMAGE in lib.sh differs from ../docker-compose.yml" >&2
  exit 1
fi

recipe="$here/$language/$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pkg="$work/pkg"
cp -R "$recipe" "$pkg"

echo "--- $language $version: fetch"
(cd "$pkg" && source ./fetch.sh)

echo "--- $language $version: setup in the Piston image"
install_path="/piston/packages/$language/$version"
docker run --rm \
  --volume "$pkg:$install_path" \
  --workdir "$install_path" \
  --env OWNER="$(id -u):$(id -g)" \
  --entrypoint /bin/bash \
  "$PISTON_IMAGE" \
  -c 'set -euo pipefail
      source ./environment
      if [ -f setup.sh ]; then bash ./setup.sh; fi
      chown -R "$OWNER" .'

echo "--- $language $version: package"
jq '.build_platform = "docker-debian"' "$pkg/metadata.json" > "$pkg/pkg-info.json"
rm -f "$pkg/fetch.sh" "$pkg/setup.sh" "$pkg/metadata.json"
tar czf "$out/$language-$version.pkg.tar.gz" -C "$pkg" .
du -h "$out/$language-$version.pkg.tar.gz"
