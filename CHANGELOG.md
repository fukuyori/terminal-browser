# Changelog

[README](README.md) · [日本語](CHANGELOG.ja.md)

Notable changes to the Windows fork of terminal-browser are documented here.

## Unreleased

- Use the payload version in both ZIP and installer filenames. Keep the numeric
  Windows version separate as `installerVersion` in the installer manifest.

- Build `pixel-store` before the Windows CI typecheck so clean runners can
  resolve its generated declarations.

- Add a Windows-only CI verification mode that builds and tests both repositories
  and uploads ZIP/installer artifacts without signing, tagging or publishing.

- Record CLI, daemon and bridge lifecycle events with timestamps, process IDs
  and session IDs. Distinguish a session-close notification from a lost daemon
  connection, and record shutdown requests, signals and idle expiry. The earlier
  unexpected browser exit remains unexplained. Rotate each process's logs at
  1 MiB with two generations, and remove stopped-process logs beyond seven days,
  128 files or 32 MiB. Live processes' logs are protected.

- Send multi-character Claude IME commits through text insertion instead of
  shared clipboard pastes. Requires the matching Pixel key-ordering change.
  Repeated split-commit checks and physical IME entry/replacement passed
  against the real browser.

- Combine Claude Client size and input notifications so pointer events cannot
  replace a pending resize notification in the same frame. Regression checks
  and a Ghostty shrink/enlarge retest passed, including IME input and clicking
  after enlargement.

- Remove stale Claude Code browser images after the frame connection or browser
  is lost, show browser termination, and log process exits for diagnosis.

- Fix Japanese text corruption when copying from the Claude Code browser pane
  on Windows. Read UTF-8 explicitly before setting the clipboard, replacing
  `clip.exe`'s content-dependent encoding detection. Real clipboard regression
  checks include Japanese, line breaks, emoji and empty text.

- Move the Claude Code plugin to `Image` / `ui.blit`, with a separate Client
  for input. Frames travel through the Pixel host connection and an authenticated
  local bridge. Large images use a reduced RGBA image to stay within the inline
  API limit; IME commits preserve multiple characters. Resize and hide/reopen
  checks and production Ghostty E1–E5/resize checks passed. The earlier unexpected
  exit remains open. Pixel's required frame-mode and key-ordering changes are
  included in the pinned `5bb53b9` revision.

- Keep the Windows Claude Code bridge alive after its launcher exits. The bridge
  attaches to the caller's console before reporting readiness and reports a startup
  error if attachment fails. This requires the matching Pixel native build.
- Add regression coverage for launcher exit, console retention, HTTP requests,
  bridge shutdown, and startup without an accessible console. Actual Claude Code
  plugin rendering and interaction also passed the Ghostty device checks;
  sustained-use reliability remains a separate check.

## 0.11.1-win.1 (migration baseline, not yet published)

Based on upstream terminal-browser v0.11.1. The entries below describe changes since
`0.8.0-win.1`.

- **The engine moved to its own project.** Upstream split the rendering engine and the
  terminal integrations into [zenbu-labs/pixel](https://github.com/zenbu-labs/pixel). This
  fork now builds against a pixel checkout beside it, named by `pixel.commit`, with the
  Windows support carried over into that project.
- **Windows runs stock Electron.** Frames reach a Windows terminal as bitmaps, which the
  published Electron already draws, so no patched build is needed.
- **The Claude Code bridge works on Windows.** It speaks a named pipe instead of a socket
  file, starts detached and then attaches to the console that called it, and copies text
  through `clip.exe` with the encoding it reads, so Japanese and line breaks survive.
- **A terminal that names no pane no longer shares one daemon.** The console scope reads
  Ghostty's surface id as well as WezTerm's and Windows Terminal's.
- **Removed with upstream.** The app mode flags (`--app-mode`, `--preload`, `--main-script`,
  `--app-name`, `--app-id`, `--open-tabs-in-popup-stack`, `--no-toolbar`, `--no-shortcuts`,
  `--no-context-menu`, `--no-overlays`, `--no-frame`) and `--ssh-bundle` with
  `--ssh-bundle-dir` are gone; `--ssh` stays. Building an application this way moves to
  pixel.
- **Scripts that were bash are node.** `scripts/plugin-types.sh` became
  `scripts/plugin-types.mjs`, which resolves an executable Node can start on Windows.

## 0.8.0-win.1

Based on upstream terminal-browser v0.8.0. The entries below describe changes since
`0.5.8-win.1`.

### Added

- **Refreshed browser UI and app interoperability.** Incorporated the redesigned browser chrome,
  tab strip, context menus, and fuzzy command search from upstream releases through v0.8.0.
  Embedded terminal apps can use the theme and quit APIs, open app tabs, and integrate with the
  browser session without replacing the normal browsing workflow.
- **Agent-browser-compatible control.** An agent can inspect and operate an already-open browser
  with `terminal-browser action`, including `snapshot`, `click`, `fill`, and `eval`. Browser and
  tab selectors allow multiple sessions to be addressed, while an on-screen indicator shows when
  an agent is controlling a tab.
- **Element handoff to coding agents.** `Ctrl+G` or **send to agent** starts visual element
  selection. The selected page context is copied to the clipboard and sent to a detected coding
  agent in the same terminal tab when one is available.
- **SSH support on Windows.** Chromium can remain local while its network requests travel through
  a remote SSH server. Remote bundles can also be installed and started through Windows OpenSSH,
  with Windows-specific process startup, argument handling, and cleanup.
- **Windows agent skill setup.** `terminal-browser setup` links the packaged skill into detected
  Claude Code, Codex, Cursor, and Gemini directories, as well as the shared agent skill directory.
  This gives supported agents the command reference needed to open and control terminal-browser.
- **Automated Windows releases.** GitHub Actions now builds and tests the Windows payload, portable
  ZIP, and Inno Setup installer. Stable jobs can import a signing certificate and sign release
  executables before publishing them.
- **Versioned portable archives.** ZIP filenames now include the complete fork version, for example
  `terminal-browser-0.8.0-win.1-windows-x64.zip`, so downloaded releases remain identifiable after
  they are removed from the release page.

### Changed

- **Terminal and agent detection.** Updated supported terminal and multiplexer integrations so the
  browser can identify its own pane, find a nearby coding-agent pane, and route element selections
  to the appropriate conversation more reliably.
- **Progress indicator behavior.** The progress display is no longer drawn when overlays are
  disabled. App-mode sessions using `--no-overlays` therefore remain free of unexpected browser UI.
- **Windows artifact naming.** Replaced the Node-style `win32-x64` identifier with the clearer
  `windows-x64` identifier across ZIP files, manifests, installer metadata, and workflow artifacts.
- **Payload signing during packaging.** `package-windows-inno.ps1 -Sign` now checks the packaged
  payload before invoking Inno Setup and signs executables that do not already have a valid
  signature. Inno Setup then signs the installer and its generated uninstaller.
- **Third-party build output.** The bundled `agent-browser` build suppresses warnings originating
  from that pinned external package and supplies its private install directory on the child Cargo
  process `PATH`. Warnings from terminal-browser's own Rust code remain enabled.
- **Windows startup output.** The generated Windows launcher suppresses Node.js's SQLite
  `ExperimentalWarning`, which otherwise appeared every time terminal-browser started. Other Node.js
  warning categories remain enabled.

### Fixed

- **Mouse-wheel coordinates on Windows.** Wheel events now use the position carried by the wheel
  report instead of a stale pointer-move position. Scrolling works when the terminal reports mouse
  buttons and wheel input but does not send separate motion events.
- **Background console windows.** Terminal and multiplexer commands launched by the daemon now use
  hidden Windows processes, preventing brief console windows from appearing during browser startup
  and pane discovery.
- **Windows SSH lifecycle.** Corrected SSH option parsing, process invocation, remote bundle startup,
  and cleanup so Windows uses its available OpenSSH and archive tools without Unix-only process
  assumptions.

## 0.5.8-win.1

Based on upstream terminal-browser v0.5.8. This was the first Windows fork release.

### Added

- **Native Windows x64 runtime.** Ported the Rust engine, CLI, browser daemon, and launcher to run
  from PowerShell in a Windows terminal without a compatibility layer.
- **Win32 Console and ConPTY integration.** Added keyboard, mouse, resize, wake-up, console-size,
  and terminal-restoration handling for the Windows console stack.
- **Windows IPC and paths.** Replaced Unix-only session communication with Windows named pipes and
  added native executable, filesystem, clipboard-image, and `file://` path handling.
- **Windows installer and portable payload.** Added a per-user Inno Setup installer with English
  and Japanese UI, optional user `PATH` registration, WezTerm shortcuts, uninstall support, and an
  optional portable ZIP containing the complete runtime.
- **Authenticode signing.** Added opt-in signing for native payload files, the installer, and the
  generated uninstaller. Existing valid publisher signatures are preserved.
- **Windows graphics transport.** Added fast kitty file-frame transport for WezTerm and an iTerm2
  PNG fallback for environments where kitty graphics replies do not pass through ConPTY.

### Fixed

- **Resized frames.** Retained the previous frame files until WezTerm consumed the replacement
  frame, preventing in-flight image data from disappearing during a resize.
- **Interrupted-session cleanup.** Added removal of temporary frame files left by processes that
  were killed before normal cleanup could run.
- **Terminal screen restoration.** Explicitly removes terminal images and screen state on exit so
  the final browser frame does not remain over the PowerShell prompt.
- **Start menu launch behavior.** Changed the shortcut to `wezterm-gui.exe`, avoiding the additional
  console window created by `wezterm.exe`.
- **Installer completion behavior.** Stopped launching terminal-browser automatically at the end of
  installation, avoiding detached-client and misplaced log output in the installer process.
