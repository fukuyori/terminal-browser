# terminal-browser for Windows

[日本語](README.ja.md) · [Changelog](CHANGELOG.md)

A real browser that runs inside your Windows terminal.

<video src="https://github.com/user-attachments/assets/abe2f43e-fc50-4866-b753-33388967945d" controls></video>

## Relationship to the original project

This repository is a Windows-specific fork of
[zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser). The current
release is based on upstream v0.8.0. This README covers the Windows fork only; documentation for
other platforms remains in the original project.

| Area | Upstream v0.8.0 | This Windows fork |
| --- | --- | --- |
| Runtime | Original terminal and process integrations | Windows x64 port using Win32 Console, ConPTY, named pipes, and Windows paths |
| Graphics | Kitty graphics rendering | WezTerm file-frame transport and a Windows-specific iTerm2 PNG fallback |
| Distribution | Original release process | Inno Setup installer, versioned portable ZIP, Authenticode signing, and automated Windows release jobs |
| SSH and setup | Original SSH and skill workflows | Windows OpenSSH and `tar.exe` handling, plus Windows-compatible skill setup |
| Version | `v0.8.0` | `0.8.0-win.1`, identifying the upstream base and Windows revision |

Features incorporated from upstream and changes unique to each Windows release are listed in the
[changelog](CHANGELOG.md).

## Windows support (experimental)

This fork provides a native Windows x64 build. It has been tested with PowerShell 7 and
WezTerm nightly.

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

Install WezTerm nightly. For the fastest rendering path, enable the kitty keyboard and graphics
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

### Build Windows from source

```powershell
corepack pnpm install --frozen-lockfile
.\scripts\build-windows.ps1
.\scripts\package-windows-inno.ps1
```

The build writes the unpacked payload to `dist-release\terminal-browser`. Add `-Zip` to create
`dist-release\terminal-browser-<version>-windows-x64.zip`:

```powershell
.\scripts\build-windows.ps1 -Zip
```

The ZIP is optional, is about 190 MB, and is not required to create the installer. The pinned
`agent-browser` dependency is built and included automatically. Use
`-AgentBrowserPath C:\path\to\agent-browser.exe` only to override that binary.

`package-windows-inno.ps1` requires Inno Setup 6 and creates
`dist-release\terminal-browser-<version>-windows-x64.exe`. The installer supports English and
Japanese, installs per user, can update the user `PATH`, and can create a WezTerm shortcut.

### Sign Windows packages

Local builds are unsigned unless `-Sign` is specified:

```powershell
$env:CODESIGN_CERT = "<certificate subject name>"
.\scripts\build-windows.ps1 -Zip -Sign
.\scripts\package-windows-inno.ps1 -Sign
```

`CODESIGN_CERT` is a subject-name fragment, such as `Example Ltd` for
`CN=Example Ltd, O=…`. `CODESIGN_CERT_THUMBPRINT` can identify the certificate by thumbprint
instead. Signing stops if no matching code-signing certificate is available.

The build signs unsigned payload executables before creating the ZIP. Packaging checks the
payload again, then passes the signer to Inno Setup so the installer and generated uninstaller
are signed. Files with valid signatures are skipped. Pass `-NoElectron` directly to
`sign-windows.ps1` to leave Electron binaries as their publisher shipped them.

A ZIP cannot carry an Authenticode signature. Publish the SHA-256 value from
`manifest-windows-x64.json` with it.

The release workflow builds and tests the Windows payload, ZIP, and installer on
`windows-latest`. Stable releases require the `WINDOWS_CODESIGN_PFX` secret containing a
base64-encoded PFX and the `WINDOWS_CODESIGN_PASSWORD` secret. Development workflow runs remain
unsigned.

### Windows versioning

Windows fork versions combine the upstream version and a fork revision. For example,
`0.8.0-win.1` is the first Windows release based on upstream v0.8.0.

Set the default with `Version` in `scripts\build-windows.ps1`, or pass `-Version` for a one-off
build. The value is written to `VERSION` and displayed by `terminal-browser --version`.

Inno Setup requires a numeric four-part version, so `0.8.0-win.1` becomes `0.8.0.1` in the
installer. Versions outside this format use `0.0.0.0` for the installer version.

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

On Windows, OpenSSH Client and `tar.exe` must be available on `PATH`. SSH host aliases work.
`--ssh-bundle` targets a Unix remote and may open multiple SSH connections on Windows, so key
authentication or `ssh-agent` is recommended.

## App mode

terminal-browser can build terminal applications using browser technology. See
[terminal-code](https://github.com/zenbu-labs/terminal-code) for a production example.

Use `--app-mode` when opening terminal-browser. The optional `--preload` and `--main-script`
arguments use Electron's [preload scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
and main process.

The complete app-related options for `terminal-browser open` are:

```text
  --preload=<path>      Run a script inside the context of a web page before it loads (uses electron's preload feature under the hood, runs in an isolated world).
                        terminal-browser specific api's are exposed on globalThis.terminalBrowser
                        {
                          theme: () => { background: [r,g,b], foreground: [r,g,b], ansi: ([r,g,b] | null)[] } | null, // null until the terminal reports its colors
                          onTheme: (cb: (theme: Theme) => void) => () => void, // returns unsubscribe
                          quit: () => void // closes this browser window
                        }
                        --terminal-browser-session=<key> is passed as extra arguments to the renderer process, available via process.argv
  --main-script=<path>  Run a node.js script in the same process as the browser (this is an electron main process)
  --open-tabs-in-popup-stack Links that would open a new tab open a popup over the
                        page instead.
  --allow-clipboard-read
                        Lets websites read from clipboard.
  --no-toolbar          No toolbar or tab strip
  --no-shortcuts        No browser shortcuts, keys go to the page
  --no-context-menu     No right-click menu
  --no-overlays         No toasts or HUDs drawn over the page
  --no-frame            No border or padding, the page fills the pane
  --app-mode            Shorthand for --no-toolbar --no-shortcuts
                        --no-context-menu --no-overlays --no-frame
                        --allow-clipboard-read --open-tabs-in-popup-stack
  --ssh-bundle <dir>    Install and execute a bundle on a remote Unix server. This is useful with
                        --app-mode and --ssh, allowing you to run an application server on a
                        remote machine, then view the output over ssh
  --ssh-bundle-dir <dir>
                        Remote installation base for --ssh-bundle. Defaults to
                        ${XDG_DATA_HOME:-~/.local/share}/terminal-browser/bundles
```

## Contributing

- PR descriptions must be authored and explained by humans.
- Define the motivation for each change clearly.
- Keep PRs small enough to review effectively.

For local development setup, the recommended approach is to ask a coding agent.

### Adding enhanced support for a terminal

Some terminal-browser CLI subcommands rely on terminal or multiplexer scripting features. To
add support for another terminal, refer to the
[existing implementations](https://github.com/zenbu-labs/terminal-browser/tree/main/terminals/src/terminals).

## Community

[Discord](https://discord.gg/t3jzHHfc6z)

## Acknowledgments

- [kitty](https://github.com/kovidgoyal/kitty) for the kitty graphics protocol
- [awrit](https://github.com/chase/awrit), the first attempt to embed Chromium in a terminal
