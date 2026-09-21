# terminal-browser for Windows

[日本語](README.ja.md) · [Changelog](CHANGELOG.md)

A real browser that runs inside your Windows terminal.

<video src="https://github.com/user-attachments/assets/abe2f43e-fc50-4866-b753-33388967945d" controls></video>

## Relationship to the original project

This repository is a Windows-specific fork of
[zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser). The current
development branch is based on upstream v0.11.1. This README covers the Windows fork only; documentation for
other platforms remains in the original project.

| Area | Upstream v0.11.1 | This Windows fork |
| --- | --- | --- |
| Runtime | Original terminal and process integrations | Windows x64 port using Win32 Console, ConPTY, named pipes, and Windows paths |
| Graphics | Kitty graphics rendering | WezTerm file-frame transport and a Windows-specific iTerm2 PNG fallback |
| Distribution | Original release process | Maintainer-signed Inno Setup installer and versioned portable ZIP, with separate Windows CI verification |
| SSH and setup | Original SSH and skill workflows | Windows OpenSSH and `tar.exe` handling, plus Windows-compatible skill setup |
| Version | `v0.11.1` | `0.11.1-win.1`, identifying the upstream base and Windows revision |

Features incorporated from upstream and changes unique to each Windows release are listed in the
[changelog](CHANGELOG.md).

[0.11.1-win.1](https://github.com/fukuyori/terminal-browser/releases/tag/0.11.1-win.1)
was published on 2026-09-21 with the locally built, signed and verified ZIP and
installer. CI builds are unsigned and are for verification only. See the
[CI results](docs/ci-verification.md) and [device checks](docs/windows-device-checks.md).

## Windows support (experimental)

This fork provides a native Windows x64 build. Device checks cover Ghostty on
Windows and the standalone browser in WezTerm, using PowerShell.

Windows support includes:

- A per-user installer and an optional portable ZIP containing Electron, Node.js,
  `pixel.node`, `agent-browser`, and a `.cmd` launcher
- Win32 Console and ConPTY input, resize, mouse-coordinate, wake-up, and terminal-restore handling
- Windows named pipes for daemon and session IPC
- Native Windows path, executable, clipboard-image, and `file://` handling
- Fast kitty file-frame transport with WezTerm nightly
- An iTerm2 PNG fallback when kitty graphics replies do not pass through ConPTY; this path is
  limited to about 15 FPS, so WezTerm nightly is recommended
- Image and screen cleanup on exit
- SSH proxy and remote bundle support

### Requirements

Use Ghostty on Windows or WezTerm nightly for the standalone browser. The Claude
Code plugin's embedded Image path was validated on Ghostty with Claude Code 2.1.278;
WezTerm support for that path is [deferred](https://github.com/fukuyori/terminal-browser/issues/2).
For the WezTerm file-frame path, enable the kitty keyboard and graphics
protocols in `wezterm.lua`, then restart WezTerm:

```lua
config.enable_kitty_keyboard = true
config.enable_kitty_graphics = true
```

The installer does not install or configure WezTerm.

### Install on Windows

Download `terminal-browser-<version>-windows-x64.exe` from this fork's
[releases page](https://github.com/fukuyori/terminal-browser/releases) and run it.

1. If Windows shows a SmartScreen warning, choose **More info > Run anyway**.
2. Select English or Japanese and accept the license.
3. Choose the installation directory. The default is
   `%LOCALAPPDATA%\Programs\terminal-browser`, which does not require administrator rights.
4. Choose the additional tasks:
   - **Add terminal-browser to the user PATH** makes the command available in terminals opened
     after installation.
   - **Create a Start menu shortcut for WezTerm** is available when WezTerm is installed.

The installer does not launch terminal-browser when it finishes.

### Launch on Windows

Open a new WezTerm window so it receives the updated `PATH`, then run:

```powershell
terminal-browser
terminal-browser https://example.com
```

The Start menu entry **terminal-browser (WezTerm)** opens terminal-browser in a new WezTerm
window.

If the command is not found, open another terminal or call the launcher directly:

```powershell
& "$env:LOCALAPPDATA\Programs\terminal-browser\bin\terminal-browser.cmd" https://example.com
```

### Exit on Windows

Press `Ctrl+Q` in the terminal-browser pane. If `Ctrl+Q` is assigned to WezTerm as a leader
key, use `Ctrl+Shift+Q`. You can also press `Ctrl+C` in the PowerShell session that launched
terminal-browser.

### Uninstall on Windows

Open **Settings > Apps > Installed apps**, select **terminal-browser**, and choose
**Uninstall**. The Start menu uninstall shortcut performs the same operation. Uninstalling also
removes the user `PATH` entry added by the installer.

### Claude code plugin

[Install instructions here](/claude-code-plugin/README.md)

On Windows, start the plugin from a terminal console. The bridge keeps that console
attached after its launcher exits; if it cannot attach, startup returns an error.
The CLI and Pixel native binary must come from matching builds. Production
Ghostty checks passed for drawing, IME input, Japanese/multiline copying,
resize/input, hide/reopen and session-exit cleanup. An earlier
[unexpected browser exit](https://github.com/fukuyori/terminal-browser/issues/1)
remains unexplained; those passes do not establish sustained reliability.

### Build Windows from source

Place a checkout of [fukuyori/pixel](https://github.com/fukuyori/pixel) at
`../pixel`, checked out at the full SHA in [pixel.commit](pixel.commit).
The build script installs and builds Pixel before installing this workspace.
Run from the terminal-browser repository:

```powershell
.\scripts\build-windows.ps1 -RequireCleanPixel
.\scripts\package-windows-inno.ps1
```

The build writes the unpacked payload to `dist-release\terminal-browser`. Add `-Zip` to create
`dist-release\terminal-browser-<version>-windows-x64.zip`:

```powershell
.\scripts\build-windows.ps1 -Zip -RequireCleanPixel
```

The ZIP is optional, is about 209 MB in the verified CI build, and is not required to create the installer. The pinned
`agent-browser` dependency is built and included automatically. Use
`-AgentBrowserPath C:\path\to\agent-browser.exe` only to override that binary.

`package-windows-inno.ps1` requires Inno Setup 6 and creates
`dist-release\terminal-browser-<version>-windows-x64.exe`. The installer supports English and
Japanese, installs per user, can update the user `PATH`, and can create a WezTerm shortcut.

These commands produce unsigned development artifacts. For distribution, the
maintainer adds `-Sign` to both scripts; see the
[version and release checklist](docs/version-update-checklist.md). On 2026-09-21,
the maintainer rebuilt signed packages with lifecycle logging and the installer
filename fix. Installation, Ghostty launch/display/exit, and uninstall checks
passed; see the [signed package retest](docs/windows-device-checks.md#signed-package-retest-on-2026-09-21)
for exact artifacts and checks not repeated on this build.

### Windows versioning

Windows fork versions combine the upstream version and a fork revision. For example,
`0.11.1-win.1` is the first Windows release based on upstream v0.11.1.

Set the default with `Version` in `scripts\build-windows.ps1`, or pass `-Version` for a one-off
build. The value is written to `VERSION` and displayed by `terminal-browser --version`.

Inno Setup requires a numeric four-part version, so `0.11.1-win.1` becomes `0.11.1.1` in the
installer. Versions outside this format use `0.0.0.0` for the installer version.
The ZIP and EXE filenames both keep the payload version, for example
`terminal-browser-0.11.1-win.1-windows-x64.zip` and
`terminal-browser-0.11.1-win.1-windows-x64.exe`. The installer manifest records
that version in `version` and the numeric Windows version in `installerVersion`.
The packaging script's `-Version` overrides only the numeric Windows version.

`terminal-browser upgrade` does not update the Windows fork. On Windows it stops and directs
users to this fork's releases page.

## Usage

```text
terminal-browser
terminal-browser open <url>
terminal-browser --split right
terminal-browser open --ssh <user@host> <url>
terminal-browser ls
terminal-browser action
```

- `terminal-browser` launches the browser.
- `open <url>` opens a URL.
- `--split right` opens the browser in a pane to the right.
- `open --ssh` routes browser network requests through a remote server.
- `ls` lists open browsers.
- `action` provides an agent-browser-compatible CLI for interacting with open browsers.

## Use cases

- Keep a coding agent and a website in the same terminal tab.
- Let an agent interact with an open terminal-browser.
- Open HTML plans beside an agent automatically.
- Preview services running on a remote machine over SSH.

## Agent integration

### Install the agent skill

Run setup after installing terminal-browser:

```powershell
terminal-browser setup
```

Setup links the packaged `terminal-browser` skill into supported agent directories that already
exist. The generated manifest supports Claude Code, Codex, Cursor, and Gemini, and also installs
the shared skill under `.agents\skills`. Setup also applies supported terminal and editor settings.

The skill tells an agent how to open a page beside the conversation and operate an existing
browser. A typical split-pane launch is:

```powershell
terminal-browser open https://example.com --split right
```

### Control an open browser

Agents can use the agent-browser-compatible `action` command. With no selector, it targets the
browser in the current terminal tab and that browser's active tab.

```powershell
terminal-browser ls
terminal-browser action -- snapshot
terminal-browser action -- click @e14
terminal-browser action -- fill @e3 "hello"
terminal-browser action -- eval "document.title"
terminal-browser action done
```

`terminal-browser ls` prints browser keys and tab IDs. Use them when more than one browser or tab
is open:

```powershell
terminal-browser action --browser 90107-1 --tab 2 --follow -- fill @e3 "hello"
```

- `--browser <key>` selects a running browser.
- `--tab <id>` selects one of its tabs.
- `--target <id>` selects a CDP target directly.
- `--follow` brings the selected tab to the front before running the command.
- `terminal-browser action done` immediately clears the agent-control indicator. The indicator
  otherwise disappears automatically after a period without agent actions.

### Send a page element to an agent

Press `Ctrl+G`, or choose **send to agent** from the page menu, then select an element. The
selected content is copied to the clipboard and sent to a detected coding-agent pane in the same
terminal tab. If no agent pane can be found, the content remains on the clipboard for manual
pasting.

## Windows shortcuts

| Action | Shortcut |
| --- | --- |
| Quit | `Ctrl+Q` or `Ctrl+Shift+Q` when `Ctrl+Q` is the WezTerm leader key |
| New tab | `Ctrl+T` |
| Command palette | `Ctrl+K` or `Alt+K` |
| Find in page | `Ctrl+Shift+F` |
| Next / previous match | `Enter` / `Shift+Enter` |
| Back / forward | `Ctrl+[` / `Ctrl+]` |
| DevTools | `Ctrl+Shift+I` or `F12` |
| DevTools console | `Ctrl+Alt+J` |
| Start / stop recording | `Ctrl+Shift+R` |
| Complete recording review | `Ctrl+Enter` |
| Select an element to send to an agent | `Ctrl+G` |
| Close popup or overlay | `Escape` |

## How it works

Terminals including Ghostty, kitty, cmux, VS Code, and WezTerm can display pixels using the
kitty graphics protocol. terminal-browser uses this capability to show frames generated by
Chromium.

Electron's offscreen rendering API reads Chromium's pixels directly from the GPU. The browser
then converts terminal mouse, pointer, and keyboard input into synthetic Chromium events. On
Windows, the Rust engine obtains this input through Win32 Console and ConPTY handling.

The outer browser UI runs on a Rust graphics engine. React and a custom renderer define the UI
in TypeScript. Browser content and browser chrome share the same canvas, allowing UI elements to
be layered over the page.

## SSH

```text
terminal-browser open --ssh <user@host> <url>
```

Chromium and rendering remain on the local computer while browser network requests are routed
through the remote SSH server. Services bound to the remote server's `localhost` are therefore
available to the local browser.

Running terminal-browser directly inside an SSH session also works, but every frame and all
input must cross the network. The terminal also cannot use the kitty graphics protocol's
[local-client optimizations](https://sw.kovidgoyal.net/kitty/graphics-protocol/#local-client).

On Windows, OpenSSH Client must be available on `PATH`. SSH host aliases work.

## Contributing

- PR descriptions must be authored and explained by humans.
- Define the motivation for each change clearly.
- Keep PRs small enough to review effectively.

For local development setup, the recommended approach is to ask a coding agent.

### Adding enhanced support for a terminal

Some terminal-browser CLI subcommands rely on terminal or multiplexer scripting features. To
add support for another terminal, refer to the
[Pixel terminal implementations](https://github.com/fukuyori/pixel/tree/windows-v0.11.1/packages/pixel/src/terminal/terminals).

## Community

[Discord](https://discord.gg/t3jzHHfc6z)

## Acknowledgments

- [kitty](https://github.com/kovidgoyal/kitty) for the kitty graphics protocol
- [awrit](https://github.com/chase/awrit), the first attempt to embed Chromium in a terminal
