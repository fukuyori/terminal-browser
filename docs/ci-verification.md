# Verifying the two-repository Windows CI

The Windows job in `.github/workflows/release.yml` was rewritten to build from
two checkouts: this repository and the `fukuyori/pixel` commit that
`pixel.commit` names. It has not been run yet. This is how to run it and what
to look at.

Read [what a run costs](#what-a-run-costs) before starting: every run of this
workflow uploads to Cloudflare R2, including the ones meant only as a check.

## Before you start

Both branches have to be pushed, because the job fetches them by name and by
commit.

```powershell
gh api repos/fukuyori/terminal-browser/branches/windows-v0.11.1 --jq '.commit.sha'
gh api repos/fukuyori/pixel/branches/windows-v0.11.1 --jq '.commit.sha'
Get-Content pixel.commit
```

The pixel branch's commit and `pixel.commit` must be the same string. If the
commit is missing, `actions/checkout` fails with `No commit found` and nothing
else in the job runs.

## What a run costs

| Started by | `channel` | GitHub release | Cloudflare R2 |
| --- | --- | --- | --- |
| Tag push (`v*`, `*-win.*`) | `stable` | created | uploaded |
| Manual run, `bump` = `patch`/`minor`/`major` | `stable` (tags and pushes for you) | created | uploaded |
| Manual run, `bump` = `none` | `dev` | no | uploaded |
| Push to `main` | `dev` | no | uploaded |
| Push to any other branch | — | not triggered | — |

The GitHub release step is behind `if: needs.prepare.outputs.channel ==
'stable'`. The publish step is not behind anything: `scripts/publish-r2.sh`
runs on every build that reaches the `release` job, and a `dev` build lands at
`/v/<branch>-<sha>` without moving the dev channel.

So a manual run with `bump` = `none` will not create a release, but it will
still put a build in the bucket. That is the cheapest way to exercise the job,
and it is not free.

The worker deploy is separate and is skipped for a branch run unless
`deploy_worker` is checked.

## Running it

From the branch, so `prepare` resolves a dev version from it:

```powershell
gh workflow run release.yml --ref windows-v0.11.1
gh run watch (gh run list --workflow release.yml --branch windows-v0.11.1 --limit 1 --json databaseId --jq '.[0].databaseId')
```

`bump` defaults to `none`, so this is a dev build.

## What the run has to show

These are the parts that are new and have never executed. Each one either
works on the first run or does not.

### 1. The pixel commit is read and fetched

Step **Read the pixel commit to build against** prints nothing on success; it
sets an output. Step **Run actions/checkout@v4** (the second one) must succeed.

A failure here is one of: `pixel.commit` is not 40 hex characters, or the
commit is not on the remote.

### 2. The build script finds and accepts the pixel checkout

Step **Build Windows payload and ZIP** runs `build-windows.ps1` with
`-RequireCleanPixel`. Its first actions are the checks:

- `$root/../pixel` exists and holds `packages/pixel/package.json`
- `git -C $pixel rev-parse HEAD` equals `pixel.commit`
- `git -C $pixel status --porcelain` is empty

The second one is the one to watch. `actions/checkout` leaves a detached HEAD
at the requested commit, which should make `rev-parse HEAD` return exactly
that commit, but that has not been observed. A mismatch throws
`pixel is at <a> but pixel.commit asks for <b>`.

### 3. pixel builds on the runner

Still inside step **Build Windows payload and ZIP**: the script installs pixel
with `--frozen-lockfile`, builds its TypeScript, then builds the native addon
with `--release`.

`CARGO_TARGET_DIR` is set for the whole job to a directory outside the
workspace. pixel's `build-native.mjs` reads it, so the built library should be
found there rather than under `pixel/engine/target`. This combination has not
been run.

The same step also downloads electron through pixel's `postinstall.mjs`, which
on Windows takes the published build and unpacks it with
`%SystemRoot%\System32\tar.exe`.

### 4. The engine binary is the one that was just built

Near the end of the same step, before signing, the script compares the
SHA-256 of three copies of `pixel.node`:

- `../pixel/packages/native/win32-x64/pixel.node`
- the one `browser/` resolves (`scripts/pixel-paths.mjs native`)
- the one in the payload

A mismatch throws `the engine binary differs between where it was built and
where it is used`, naming all three. This is the check that a stale copy in
`node_modules` would trip.

### 5. The tests run on what the build produced

Step **Test** runs after the build, because the build is what installs both
checkouts. It runs, in order: pixel's typecheck, pixel's tests, `cargo test`
on `pixel/engine`, this repository's typecheck, and this repository's tests.

Expected counts, from a local run on 2026-09-20:

| Suite | Passed | Skipped |
| --- | --- | --- |
| pixel JavaScript | 43 | 15 |
| pixel Rust | 317 | 1 |
| terminal-browser | 51 | 1 |

The skips are shell-safety tests that need `os.forkpty`, the executable bit
that Windows cannot grant, ghostty's macOS-only tests, one ignored Rust test,
and the clipboard test that only runs with `TB_TEST_CLIPBOARD=1`.

A failure here stops the job before the installer and the upload.

### 6. The installer is built and the artifacts are named as before

Step **Build Windows installer** runs `package-windows-inno.ps1`, which needs
the Inno Setup that the earlier choco step installed, and which maps
`0.11.1-win.1` to `0.11.1.1`. Note that a dev run's version is
`<branch>-<sha>`, which is not that format, so the installer version falls
back to `0.0.0.0`. That is expected for a dev run and is not a failure.

The upload step takes its files from `terminal-browser/dist-release/`. The
artifact is still named `windows-release-windows-x64`, which is what the
`release` job's `pattern: windows-release-*` expects.

## If signing secrets are present

`WINDOWS_CODESIGN_PFX` and `WINDOWS_CODESIGN_PASSWORD` make the job pass
`-Sign` to both scripts. Then, in the payload:

```powershell
Get-AuthenticodeSignature electron\pixel.exe,
  browser\node_modules\@zenbu-labs\pixel-native-win32-x64\pixel.node |
  Select-Object Status, Path
```

Every one must be `Valid`. `sign-windows.ps1` checks this itself after
signing, so a bad signature fails the step rather than shipping.

A stable release without the secret fails on purpose: `stable Windows releases
require WINDOWS_CODESIGN_PFX`.

## Known gaps

- No run has happened, so nothing above is confirmed.
- A dev run still uploads to R2. There is no switch for "build but publish
  nothing"; adding one would change how releases behave and has not been done.
- The run's duration is unknown. pixel's native build and electron download
  are new work for this job.
