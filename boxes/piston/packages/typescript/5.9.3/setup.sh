set -euo pipefail

# Installs the checksummed tarball from fetch.sh; npm's global prefix is this folder.
bin/npm install --global --no-audit --no-fund ./typescript.tgz
rm typescript.tgz
bin/tsc --version
