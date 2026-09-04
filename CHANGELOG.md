# Changelog

[README](README.md) · [日本語](CHANGELOG.ja.md)

Notable changes to the Windows fork of terminal-browser are documented here.

## 0.8.0-win.1

Based on upstream terminal-browser v0.8.0. The entries below describe changes since
`0.5.8-win.1`.

### Added

- Added the refreshed browser chrome, tab strip, context menus, fuzzy command search, and app interoperability from upstream releases through v0.8.0.
- Added agent-browser-compatible actions, element selection, browser targeting, and agent activity visualization.
- Added SSH proxy and remote bundle support on Windows.
- Added Windows-compatible skill generation and setup.
- Added GitHub Actions automation for building, testing, signing, and publishing Windows releases.
- Added a version number to portable ZIP names, such as `terminal-browser-0.8.0-win.1-windows-x64.zip`.

### Changed

- Improved terminal and agent detection across supported terminals and multiplexers.
- Hid the progress indicator when no overlays are requested.
- Standardized Windows artifact identifiers as `windows-x64`.
- Changed installer packaging with `-Sign` to sign unsigned payload executables before Inno Setup signs the installer and uninstaller.
- Suppressed the bundled Node.js SQLite experimental warning when launching terminal-browser on Windows.

### Fixed

- Fixed mouse-wheel events using stale pointer coordinates on Windows.
- Fixed console windows appearing while terminal commands are queried or launched in the background.
- Fixed Windows SSH argument handling, process startup, and cleanup.

## 0.5.8-win.1

Based on upstream terminal-browser v0.5.8. This was the first Windows fork release.

### Added

- Added a native Windows x64 build for PowerShell and WezTerm.
- Added Win32 Console and ConPTY handling for input, resizing, mouse coordinates, wake-up, and terminal restoration.
- Added Windows named-pipe IPC, native path and executable handling, clipboard images, and `file://` paths.
- Added a per-user Inno Setup installer with English and Japanese UI, optional user `PATH` registration, WezTerm shortcuts, and uninstall support.
- Added a portable ZIP containing Electron, Node.js, `pixel.node`, and the Windows launcher.
- Added signing support for payload executables, the installer, and the uninstaller.
- Added fast kitty file-frame transport for WezTerm and an iTerm2 PNG compatibility fallback.

### Fixed

- Fixed resized frame files being removed before WezTerm consumed them.
- Fixed temporary frame files accumulating after an interrupted or killed process.
- Fixed the final browser frame remaining visible after exit.
- Changed the Start menu shortcut to launch `wezterm-gui.exe` without an extra console window.
- Stopped launching terminal-browser automatically when installation finishes.
