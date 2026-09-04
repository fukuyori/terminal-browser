# Changelog

Notable changes to the Windows fork of terminal-browser are documented here.

## 0.8.0-win.1

Based on upstream terminal-browser v0.8.0.

### Added

- Added an experimental native Windows x64 build for PowerShell and WezTerm.
- Added Win32 Console and ConPTY handling for input, resizing, mouse coordinates, wake-up, and terminal restoration.
- Added Windows named-pipe IPC, native path and executable handling, clipboard images, and `file://` paths.
- Added a per-user Inno Setup installer with English and Japanese UI, optional user `PATH` registration, WezTerm shortcuts, and uninstall support.
- Added a portable ZIP containing Electron, Node.js, `pixel.node`, `agent-browser`, and the Windows launcher.
- Added SSH proxy support on Windows.
- Added agent-browser-compatible actions, browser targeting, and agent activity visualization.
- Added Windows-compatible skill generation and setup.
- Added GitHub Actions automation for building, testing, signing, and publishing Windows releases.

### Changed

- Refreshed the browser chrome, tab strip, context menus, navigation behavior, and app interoperability.
- Improved kitty graphics transport on WezTerm and added an iTerm2 PNG fallback for terminals where kitty replies do not pass through ConPTY.
- Hid the progress indicator when no overlays are requested.
- Changed Windows artifact identifiers from `win32-x64` to `windows-x64`.
- Added the release version to portable ZIP names, such as `terminal-browser-0.8.0-win.1-windows-x64.zip`.
- Changed installer packaging with `-Sign` to sign any unsigned payload executables before Inno Setup signs the installer and uninstaller.
- Changed the Start menu shortcut to launch `wezterm-gui.exe`, and stopped launching the browser automatically when installation finishes.

### Fixed

- Fixed mouse-wheel events using stale pointer coordinates on Windows.
- Fixed console windows appearing while terminal commands are queried or launched in the background.
- Fixed frame files being deleted before WezTerm consumed an in-flight resized frame.
- Fixed temporary frame files accumulating after an interrupted or killed process.
- Fixed cleanup so the final browser frame does not remain visible after exit.
