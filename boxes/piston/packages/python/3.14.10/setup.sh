set -euo pipefail

# Same libraries as upstream's python/3.10.0, with pycryptodome for the dead
# pycrypto. Wheels only, resolved by this interpreter in this image, so nothing
# needs a newer glibc than the image has. pip-freeze.txt records every version
# that went in, dependencies included.
bin/python3.14 -m pip install --no-cache-dir --root-user-action=ignore --only-binary=:all: --requirement requirements.txt
bin/python3.14 -m pip freeze > pip-freeze.txt
cat pip-freeze.txt
