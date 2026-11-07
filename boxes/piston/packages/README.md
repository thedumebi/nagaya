# Piston packages

Upstream Piston stopped updating its language packages, so its newest Node is
EOL and has no security fixes. These recipes build the runtimes we need, and
publish them to the `piston-pkgs` release on this repo with an index that
Piston reads through `PISTON_REPO_URL`.

The GCC package still comes from upstream. Its entry, and those of the older
versions, are in `upstream-index.csv`, because Piston looks every install up in
one index.

## Layout

```text
<language>/<version>/
  metadata.json   name, version, aliases (becomes pkg-info.json)
  fetch.sh        downloads and verifies the runtime; runs on the build machine
  setup.sh        optional; runs inside the Piston image at the install path
  environment     sourced once at install; Piston caches the result
  compile         optional; TypeScript only
  run             what Piston runs for each job
  test.*          prints OK; used by smoke-test.sh
```

Every download is checked against a digest pinned in `fetch.sh`, and the
Python libraries are pinned in `requirements.txt`.

## Build and publish

The **Piston packages** workflow builds every package, installs them into a real
Piston with production's limits, and runs code on them.

- **On a pull request** touching this folder: builds and tests only.
- **Run by hand on `master`** (Actions → Piston packages → Run workflow): also publishes.

Publishing changes nothing on the box. To install from it, see
[`../README.md`](../README.md).

## Change a version

1. Copy the recipe folder to the new version.
2. Update `metadata.json` and the URLs and digests in `fetch.sh`. Update the
   version in `run` if it names one (Python's does), and `requirements.txt`
   wheels for a new Python.
3. For Node, update TypeScript's `fetch.sh` too, since that package carries its own Node.
4. Update the versions listed in `smoke-test.sh`.
5. Open a PR and read the smoke test's table.

Then roll it out with PM-Interview-Bank's `PISTON_VERSION_MAP`, because the app
asks for exact versions.

## The Go seed cache

Go 1.20+ ships no precompiled standard library. Each job starts with an empty
build cache, so without help every run would rebuild it. `setup.sh` compiles
`test-harness-imports.go` into a seed cache, and `run` copies that into the job.

If the app's Go harness starts importing a new package
(`lib/coding/codegen/go.ts`), add it to `test-harness-imports.go`. An import
outside the seed still works, but costs a cold build inside the candidate's
time limit. The smoke test prints that cost as `go uncached import`.
