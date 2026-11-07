set -euo pipefail

# Go 1.20+ ships no precompiled standard library, and every run starts with an
# empty GOCACHE, so each one would rebuild it and use up the time limit. Build
# what the harness and common solutions import into a seed cache; `run` copies
# it into the job. Built with `go run`, the same command each job uses.
build=$(mktemp -d)
cp test-harness-imports.go "$build/main.go"
(cd "$build" && GOCACHE=$GO_CACHE_SEED go run main.go)
rm -rf "$build"

du -sh "$GO_CACHE_SEED"

echo "largest seed cache files:"
find "$GO_CACHE_SEED" -type f -printf '%s %f\n' | sort -rn | head -5

# Piston caps each file a job writes, and that cap applies to the copy in `run`.
# The default is 10 MB, too small for the largest entries, so metadata.json
# raises it to 32 MiB for Go. Keep this check in step with that.
too_big=$(find "$GO_CACHE_SEED" -type f -size +31M)
if [ -n "$too_big" ]; then
  echo "seed cache files over Piston's file size limit:" >&2
  echo "$too_big" >&2
  exit 1
fi
