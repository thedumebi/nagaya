#!/usr/bin/env bash
# Install the built packages into a real Piston, with production's limits, and
# run code on them: ./smoke-test.sh <output dir>
# Rewrites <output dir>/index to point at a local server, so run make-index.sh
# again afterwards for the published URLs.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$here/lib.sh"
out=$(realpath "$1")
api=http://127.0.0.1:2000/api/v2
network=piston-smoke
failures=0

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
    docker logs --tail 50 piston-smoke 2>&1 || true
  fi
  docker rm -f piston-smoke piston-smoke-repo >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

bash "$here/make-index.sh" "$out" http://piston-smoke-repo:8000 >/dev/null

docker network create "$network" >/dev/null
docker run -d --name piston-smoke-repo --network "$network" \
  --volume "$out:/srv:ro" --entrypoint python3 "$PISTON_IMAGE" \
  -m http.server 8000 --directory /srv >/dev/null

# Same limits as ../docker-compose.yml.
docker run -d --name piston-smoke --network "$network" --privileged \
  --memory 1400m --publish 127.0.0.1:2000:2000 --tmpfs /piston/jobs \
  --env PISTON_REPO_URL=http://piston-smoke-repo:8000/index \
  --env PISTON_RUN_TIMEOUT=10000 --env PISTON_COMPILE_TIMEOUT=15000 \
  --env PISTON_RUN_CPU_TIME=10000 --env PISTON_COMPILE_CPU_TIME=15000 \
  --env PISTON_OUTPUT_MAX_SIZE=65536 \
  "$PISTON_IMAGE" >/dev/null

echo "waiting for Piston..."
for _ in $(seq 1 60); do
  curl -sf "$api/runtimes" >/dev/null && break
  sleep 2
done
curl -sf "$api/runtimes" >/dev/null

for metadata in "$here"/*/*/metadata.json; do
  language=$(jq -r .language "$metadata")
  version=$(jq -r .version "$metadata")
  echo "installing $language $version"
  curl -fsS --max-time 600 -X POST "$api/packages" -H 'Content-Type: application/json' \
    -d "{\"language\":\"$language\",\"version\":\"$version\"}" >/dev/null
done
curl -s "$api/runtimes" | jq -r '.[] | "  \(.language) \(.version)"'

MIB=$((1024 * 1024))
printf '\n%-26s %-6s %9s %9s %10s %12s %11s\n' case result wall_ms cpu_ms memory_mib compile_ms compile_mib

# check <case> <language> <version> <file> <run memory> <compile memory> <max wall ms, 0 = none> <required|info> <source>
check() {
  local name=$1 language=$2 version=$3 file=$4 run_memory=$5 compile_memory=$6 max_wall=$7 kind=$8 source=$9
  local response result wall
  response=$(jq -n --arg language "$language" --arg version "$version" --arg file "$file" --arg source "$source" \
    --argjson run_memory "$run_memory" --argjson compile_memory "$compile_memory" \
    '{language: $language, version: $version, files: [{name: $file, content: $source}],
      run_timeout: 10000, run_cpu_time: 10000, compile_timeout: 15000, compile_cpu_time: 15000,
      run_memory_limit: $run_memory, compile_memory_limit: $compile_memory}' |
    curl -s --max-time 60 -X POST "$api/execute" -H 'Content-Type: application/json' -d @-)
  result=pass
  if [ "$(jq -r '.run.stdout // ""' <<<"$response" | tr -d '[:space:]')" != OK ]; then result=FAIL; fi
  wall=$(jq -r '.run.wall_time // 0' <<<"$response")
  if [ "$max_wall" -gt 0 ] && [ "$wall" -gt "$max_wall" ]; then result=SLOW; fi
  printf '%-26s %-6s %9s %9s %10s %12s %11s\n' "$name" "$result" "$wall" "$(jq -r '.run.cpu_time // 0' <<<"$response")" \
    "$(jq -r '((.run.memory // 0) / 1048576 | floor)' <<<"$response")" \
    "$(jq -r '.compile.wall_time // "-"' <<<"$response")" \
    "$(jq -r 'if .compile then ((.compile.memory // 0) / 1048576 | floor) else "-" end' <<<"$response")"
  if [ "$result" != pass ]; then
    jq -c '{message, compile: (.compile // null | if . then {code, status, message, stderr: (.stderr | .[0:600])} else . end), run: (.run // null | if . then {code, signal, status, message, stderr: (.stderr | .[0:600])} else . end)}' <<<"$response" || echo "$response"
    if [ "$kind" = required ]; then failures=$((failures + 1)); fi
  fi
}

# The test program in each recipe, at runProgram's limits (256 MiB run, 512 MiB
# compile) and at runFreeCode's tighter run limit (134 MB). Those match
# PM-Interview-Bank's lib/codeRunner.ts. tsc 5.9 on Node 24 can't compile in
# 134 MB, so runFreeCode has to use the same 512 MiB compile limit as runProgram.
FREE=134217728
while read -r language package version file test; do
  source=$(cat "$here/$package/$version/$test")
  check "$language" "$language" "$version" "$file" $((256 * MIB)) $((512 * MIB)) 0 required "$source"
  check "$language free-run" "$language" "$version" "$file" "$FREE" $((512 * MIB)) 0 required "$source"
done <<'EOF'
javascript node 24.22.2 main.js test.js
typescript typescript 5.9.3 main.ts test.ts
python python 3.14.10 main.py test.py
java java 25.0.5 Main.java test.java
go go 1.27.3 main.go test.go
EOF

check "python libraries" python 3.14.10 main.py $((256 * MIB)) $((512 * MIB)) 0 required \
  'import numpy, scipy, pandas, Crypto, whoosh, bcrypt, passlib, sympy, xxhash, base58, cryptography, nacl; print("OK")'

# The Go gate. Go 1.20+ has no precompiled standard library, so these only stay
# fast if the seeded cache in go/<version>/setup.sh matches what the harness
# imports. Five runs, because the first can be slower than the rest.
go_harness=$(cat "$here/go/1.27.3/test-harness-imports.go")
for run in 1 2 3 4 5; do
  check "go harness imports #$run" go 1.27.3 main.go $((256 * MIB)) $((512 * MIB)) 5000 required "$go_harness"
done

# Each job copies the 51 MB seed cache in, and the job's memory limit may count
# it. A solution using most of its 256 MiB must still run.
check "go allocates 200 MiB" go 1.27.3 main.go $((256 * MIB)) $((512 * MIB)) 0 required \
  'package main
import "fmt"
func main() { b := make([]byte, 200<<20); for i := range b { b[i] = 1 }; fmt.Println("OK"); _ = b[0] }'

# A package outside the seed, for information: this is the cold-build cost a
# candidate pays for an unusual import.
check "go uncached import" go 1.27.3 main.go $((256 * MIB)) $((512 * MIB)) 0 info \
  'package main
import ("fmt"; "go/parser"; "go/token")
func main() { _, _ = parser.ParseExpr("1"); _ = token.NewFileSet(); fmt.Println("OK") }'

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures required case(s) failed"
  exit 1
fi
echo "all required cases passed"
