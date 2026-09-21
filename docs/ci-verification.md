# Verifying the two-repository Windows CI

The Windows job in `.github/workflows/release.yml` was rewritten to build from
two checkouts: this repository and the `fukuyori/pixel` commit that
`pixel.commit` names. It has not been run yet. This is how to run it and what
to look at.

Use `verify_windows=true` for this check. It runs only preparation and the
Windows job, saving ZIP/installer artifacts in GitHub Actions without signing,
creating tags, publishing to R2/GitHub Releases, or deploying the worker.
The option must first be committed and pushed to the branch being checked.

## Before you start

Both branches have to be pushed, because the job fetches them by name and by
commit.

```powershell
gh api repos/fukuyori/terminal-browser/branches/windows-v0.11.1 --jq '.commit.sha'
gh api repos/fukuyori/pixel/branches/windows-v0.11.1 --jq '.commit.sha'
Get-Content pixel.commit
```

The SHA in `pixel.commit` must exist on GitHub; the Pixel branch may have
advanced beyond it. Verify the exact pin with `gh api repos/fukuyori/pixel/commits/<sha>`.
If the commit is missing, `actions/checkout` fails with `No commit found` and
nothing else in the job runs. On 2026-09-21, both terminal-browser `05fef3e`
and the pinned Pixel `5bb53b956ec2b9d1373e56f8c0c8869a720668bd` were present
on GitHub. This does not include the later verification-mode workflow changes.

## What a run costs

| Started by | `channel` | GitHub release | Cloudflare R2 |
| --- | --- | --- | --- |
| Manual run, `verify_windows` = `true` | `dev` | no | no |
| Tag push (`v*`, `*-win.*`) | `stable` | created | uploaded |
| Manual run, `bump` = `patch`/`minor`/`major` | `stable` (tags and pushes for you) | created | uploaded |
| Manual run, `bump` = `none` | `dev` | no | uploaded |
| Push to `main` | `dev` | no | uploaded |
| Push to any other branch | — | not triggered | — |

Verification skips the macOS/Linux build, worker and release jobs. It requires
a branch ref, `bump=none` and `deploy_worker=false`; incompatible inputs fail
before version resolution can create a tag. Its concurrency group is separate
from release runs, so it does not cancel an in-progress release.

Without `verify_windows=true`, the existing publishing behavior remains:
`bump=none` still uploads to R2, and a stable run also creates a GitHub release.
Verification still consumes Actions runner time and artifact storage.

The worker deploy is separate and is skipped for a branch run unless
`deploy_worker` is checked.

## Running it

After pushing the workflow changes to the branch:

```powershell
gh workflow run release.yml --ref windows-v0.11.1 -F verify_windows=true
gh run watch (gh run list --workflow release.yml --branch windows-v0.11.1 --limit 1 --json databaseId --jq '.[0].databaseId')
```

`bump` defaults to `none` and `deploy_worker` to `false`. The verification
version is `verify-<sha>`, and the checkout ref is the triggering commit SHA.
Check that the run's `headSha` matches the commit you intended to verify.

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

Near the end of the same step, where signing would go, the script compares
the SHA-256 of three copies of `pixel.node`:

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

Historical local counts (compare the tested commit, not just the totals):

| Suite | Date | Passed | Skipped |
| --- | --- | --- | --- |
| pixel JavaScript | 2026-09-20 | 43 | 15 |
| pixel Rust | 2026-09-20 | 317 | 1 |
| terminal-browser | 2026-09-21, `05fef3e` | 88 | 1 |

The skips are shell-safety tests that need `os.forkpty`, the executable bit
that Windows cannot grant, ghostty's macOS-only tests, one ignored Rust test,
and the clipboard test that only runs with `TB_TEST_CLIPBOARD=1`.

A failure here stops the job before the installer and the upload.

### 6. The installer is built and the artifacts are named as before

Step **Build Windows installer** runs `package-windows-inno.ps1`, which needs
the Inno Setup that the earlier choco step installed, and which maps
`0.11.1-win.1` to `0.11.1.1`. A verification run's `verify-<sha>` version
is not that format, so the installer version falls back to `0.0.0.0`.
That is expected for a verification run and is not a failure.

The upload step takes its files from `terminal-browser/dist-release/`. The
artifact is still named `windows-release-windows-x64`, which is what the
`release` job's `pattern: windows-release-*` expects.

## Signing stays out of a verification run

With `verify_windows=true`, **Prepare signing certificate** is skipped even
if a signing secret exists. `WINDOWS_SIGN` starts as `false`, so neither the
payload nor the installer receives `-Sign`. These are CI validation artifacts,
not signed distribution packages.

A stable release without the secret fails on purpose: `stable Windows releases
require WINDOWS_CODESIGN_PFX`. Signed builds for release are the maintainer's,
run locally with `-Sign`, or a tagged run once the secret is in place.

## Known gaps

Local validation on 2026-09-21 passed `actionlint` 1.7.12 and eleven executions
of the actual version-resolution Bash step with Git writes replaced by a
recording stub. These covered verification on a branch/main, rejection of
release bumps/worker deployment/tag refs, and ordinary branch/main/tag/release
version resolution. Job and signing gates were also checked. The ignored
local harness is `tools/stall-diagnostics/check-verification-workflow.cjs`.

- No runner execution has happened, so its build and artifact behavior is unconfirmed.
- The new mode has not run on GitHub yet. Local workflow validation is not
  evidence that runner builds, tests or artifact uploads succeed.
- macOS/Linux builds and publishing are outside this Windows-only check.
- The run's duration is unknown. pixel's native build and electron download
  are new work for this job.
- Nothing here checks signing, because a verification run does not sign. The
  payload's signatures are checked by `sign-windows.ps1` during a signed build.
