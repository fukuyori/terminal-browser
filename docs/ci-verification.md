# Verifying the two-repository Windows CI

The Windows job in `.github/workflows/release.yml` was rewritten to build from
two checkouts: this repository and the `fukuyori/pixel` commit that
`pixel.commit` names. The second run on 2026-09-21 passed the Windows build,
tests, installer creation and artifact upload. See
[the successful run](#second-run-2026-09-21) and the remaining checks below.

Use `verify_windows=true` for this check. It runs only preparation and the
Windows job, saving ZIP/installer artifacts in GitHub Actions without signing,
creating tags, publishing to R2/GitHub Releases, or deploying the worker.
Push the current workflow fixes to the branch before starting a new run.

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
nothing else in the job runs. On 2026-09-21, both terminal-browser `326c74b`
and the pinned Pixel `5bb53b956ec2b9d1373e56f8c0c8869a720668bd` were present
on GitHub. The second verification run used those commits and passed with the
`pixel-store` build-order fix.

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

Use these checks to assess each run. The second run passed all six. The first
run passed items 1–4 and stopped in the application typecheck in item 5.

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

The first run passed the check against the pinned Pixel SHA in the runner's
detached checkout. A mismatch throws
`pixel is at <a> but pixel.commit asks for <b>`.

### 3. pixel builds on the runner

Still inside step **Build Windows payload and ZIP**: the script installs pixel
with `--frozen-lockfile`, builds its TypeScript, then builds the native addon
with `--release`.

`CARGO_TARGET_DIR` is set for the whole job to a directory outside the
workspace. pixel's `build-native.mjs` reads it, so the built library should be
found there rather than under `pixel/engine/target`. The first run built
successfully with this configuration.

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
on `pixel/engine`, `pixel-store`'s build, this repository's typecheck, and this
repository's tests. Each command's exit status is checked before continuing.

The payload uses esbuild to bundle directly from `store/src`, so it does not
create `store/dist/index.d.ts`, which the workspace packages need. Running
`store`'s `typecheck` does not create it either (`tsc --noEmit`). A clean local
checkout needs the same preparation before checking types:

```powershell
corepack pnpm --filter pixel-store build
if ($LASTEXITCODE -ne 0) { throw "pixel-store build failed" }
corepack pnpm -r typecheck
```

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

### 6. The installer is built with the payload version in its filename

Step **Build Windows installer** runs `package-windows-inno.ps1`, which needs
the Inno Setup that the earlier choco step installed, and which maps
`0.11.1-win.1` to `0.11.1.1`. A verification run's `verify-<sha>` version
is not that format, so the installer version falls back to `0.0.0.0`.
That is expected for a verification run and is not a failure.
The ZIP and EXE filenames both use the payload version, including `verify-<sha>`.
The installer manifest uses that value for `version` and the numeric Windows
version for `installerVersion`. Earlier run records below retain the filenames
produced before this naming change.

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

## First run: 2026-09-21

[Run 35551427952](https://github.com/fukuyori/terminal-browser/actions/runs/35551427952)
checked terminal-browser `bcac8d69236c9a6193a583fafe6b1d98f73fa474` with
Pixel `5bb53b956ec2b9d1373e56f8c0c8869a720668bd`.

- Preparation resolved `verify-bcac8d6` on the dev channel. The macOS/Linux,
  worker, release and signing steps/jobs were skipped.
- Both checkouts, toolchain setup, Inno Setup installation, and the Windows
  payload/ZIP build succeeded, including the build script's native-copy hash check.
- Pixel typecheck passed; its JavaScript tests passed 51 with 15 skips and no
  failures. Rust reported 268 plus 51 passed, with one ignored test.
- The application typecheck failed with TS2307 (`Cannot find module
  'pixel-store'`) and cascading type errors because `store/dist` had not been
  generated. Its tests, installer creation and artifact upload did not run.
- The run took about 16 minutes before failing. The ZIP was built on the
  runner but was not uploaded, so downloadable artifacts remain unverified.

The fix adds `corepack pnpm --filter pixel-store build` and an exit-code check
immediately before the application's recursive typecheck. Package scripts
retain their existing `typecheck` semantics. Local verification temporarily
removed `store/dist`, `cli/dist` and `browser/dist`, reproduced TS2307, then
passed the store build, recursive typecheck and recursive tests (88 passed,
one clipboard skip). The original generated directories were restored.
Local evidence is under `tools/stall-diagnostics/clean-typecheck-d393fd5aede6439ebbf398af11b946cb/`
(ignored diagnostic output). This verifies the missing-output case locally,
not the complete runner or a fresh dependency installation.

## Second run: 2026-09-21

[Run 35552876822](https://github.com/fukuyori/terminal-browser/actions/runs/35552876822)
passed at terminal-browser `326c74b13309be7e8321a197cc7ad1b791fcede0` with
Pixel `5bb53b956ec2b9d1373e56f8c0c8869a720668bd`.

- Preparation took four seconds and resolved `verify-326c74b` on the dev channel.
  The Windows job took 21 minutes 57 seconds, including payload/ZIP build,
  tests, installer creation and artifact upload.
- The macOS/Linux, worker and release jobs and signing step were skipped.
  GitHub still listed only tags `0.8.0-win.1` and `0.5.8-win.1` and release
  `0.5.8-win.1` after the run.
- The installer version fell back to `0.0.0.0` as expected for the verification
  version. The unsigned artifacts are for CI validation, not distribution.

| Runner suite | Passed | Skipped/ignored | Failed |
| --- | --- | --- | --- |
| Pixel JavaScript | 51 | 15 | 0 |
| Pixel Rust | 268 + 51 | 1 ignored | 0 |
| store | 21 | 0 | 0 |
| browser | 32 | 0 | 0 |
| cli | 35 | 1 | 0 |

The uploaded artifact is `windows-release-windows-x64` (ID `10619402837`),
352,746,437 bytes, expiring at `2026-12-20T02:03:24Z`. Stage 5's Windows CI
execution passed; this does not verify the stable release path.

### Downloaded artifact checks

The artifact was downloaded on 2026-09-21. The first download failed with a
connection reset; the retry completed. Both contained files matched their
respective manifests:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `terminal-browser-verify-326c74b-windows-x64.zip` | 209303292 | `333d69b4ac37c42587810e5eace854b74180fb6243d3965722d28becd7378595` |
| `terminal-browser-0.0.0.0-windows-x64.exe` | 144321384 | `eefc79fffc8993d5eea2f1c38448c6e62a6921a42b209e22b617c25e89547046` |

The ZIP's entries were checked before extraction. The payload contained its
launcher, Node runtime, CLI/browser bundles, Electron and native addon.
`VERSION` was `verify-326c74b`, `CHANNEL` was `dev`, and the extracted launcher
returned `terminal-browser verify-326c74b` for `--version`; `--help` also passed.
The installer's product/file version was `0.0.0.0` and Authenticode status was
`NotSigned`. The user subsequently launched the downloaded installer and
confirmed its initial setup screen appeared, then confirmed cancellation and
closure without installing.

Downloaded files, the extracted payload and `verification.json` are under
`tools/stall-diagnostics/ci-run-35552876822/` (ignored local diagnostic output).

## Known gaps

Local validation on 2026-09-21 passed `actionlint` 1.7.12 and eleven executions
of the actual version-resolution Bash step with Git writes replaced by a
recording stub. These covered verification on a branch/main, rejection of
release bumps/worker deployment/tag refs, and ordinary branch/main/tag/release
version resolution. Job and signing gates were also checked. The ignored
local harness is `tools/stall-diagnostics/check-verification-workflow.cjs`.

- macOS/Linux builds and publishing are outside this Windows-only check.
- Installation/uninstallation from the CI artifact remains unverified. Opening
  its initial setup screen and cancelling without installation were confirmed.
  Installation/uninstallation of the later local signed package passed in
  [a separate retest](windows-device-checks.md#signed-package-retest-on-2026-09-21);
  that does not validate installation from this CI artifact.
- Stable tag/bump dispatch, R2 publishing and GitHub Release creation were not run.
- Nothing here checks signing, because a verification run does not sign. The
  payload's signatures are checked by `sign-windows.ps1` during a signed build.
