# terminal-browser


A real browser that runs inside your terminal

### Windows support (experimental)

This fork adds a native Windows x64 build. It has been tested in PowerShell 7 with WezTerm
nightly. For the fastest rendering path, enable the kitty keyboard and graphics protocols in
`wezterm.lua`, then restart WezTerm:

```lua
config.enable_kitty_keyboard = true
config.enable_kitty_graphics = true
```

Press `Ctrl+Q` to quit. If `Ctrl+Q` is assigned to WezTerm as a leader key, use
`Ctrl+Shift+Q` instead.

Windows-specific changes in this fork include:

- A Windows x64 installer, and an optional portable ZIP, carrying Electron, Node.js,
  `pixel.node`, and a `.cmd` launcher
- Win32 Console and ConPTY input, resize, mouse-coordinate, wake-up, and terminal-restore handling
- Windows named pipes for daemon/session IPC and native Windows path/executable handling
- Windows clipboard-image and `file://` path support
- Fast kitty file-frame transport with WezTerm nightly
- An iTerm2 PNG fallback for Windows terminals where kitty graphics replies do not pass through
  ConPTY; this compatibility path is limited to about 15 FPS, so WezTerm nightly is recommended
- Explicit image/screen cleanup on exit so the final browser frame does not remain over the shell



<video src="https://github.com/user-attachments/assets/abe2f43e-fc50-4866-b753-33388967945d" controls></video>



### Install (macOS & Linux):

```bash
curl -fsSl https://terminal-browser.sh/install | bash
```

### Install on Windows with the installer (experimental)

Every Windows release is published as an installer on this fork's
[releases page](https://github.com/fukuyori/terminal-browser/releases), named
`terminal-browser-<version>-windows-x64.exe`.

terminal-browser draws with the kitty graphics protocol, so it needs a terminal that speaks
it. Install WezTerm nightly first and apply the settings above — the installer neither
installs nor configures WezTerm.

1. Download the installer and run it. Windows may show a SmartScreen warning until the
   release has been downloaded enough times; choose **More info > Run anyway**.
2. Pick English or Japanese, then accept the license.
3. Choose where to install. The default is `%LOCALAPPDATA%\Programs\terminal-browser`, a
   per-user location that needs no administrator rights.
4. Choose the additional tasks:
   - **Add terminal-browser to the user PATH** — keep this to launch by name from any
     terminal. It takes effect in terminals opened after the install.
   - **Create a Start menu shortcut for WezTerm** — offered only when WezTerm is already
     installed. The shortcut opens a WezTerm window with terminal-browser running in it.

The installer does not launch the browser when it finishes.

### Launch it

Open a **new** WezTerm window, so it picks up the `PATH` the installer wrote, then:

```powershell
terminal-browser                        # opens the browser
terminal-browser https://example.com    # opens a url
```

The Start menu entry **terminal-browser (WezTerm)** does the same in a fresh WezTerm window.

If `terminal-browser` is not found, the window predates the install — open another one. To run
it without touching `PATH` at all, call the launcher directly:

```powershell
& "$env:LOCALAPPDATA\Programs\terminal-browser\bin\terminal-browser.cmd" https://example.com
```

### Uninstall

Open **Settings > Apps > Installed apps**, select `terminal-browser`, and choose
**Uninstall**; the Start menu uninstall shortcut does the same. It removes the `PATH` entry
the installer added.

### Build Windows from source (experimental)

```powershell
corepack pnpm install --frozen-lockfile
.\scripts\build-windows.ps1
.\scripts\package-windows-inno.ps1
```

The build writes `dist-release\terminal-browser`. Add `-Zip` to also pack that directory into
`dist-release\terminal-browser-win32-x64.zip` for people who want a portable copy — it
compresses about 190 MB and nothing in the build needs it, so it is off by default. Add
`-AgentBrowserPath C:\path\to\agent-browser.exe` to include the optional `action` command
dependency.

The packaging step compiles `installer\terminal-browser.iss` into
`dist-release\terminal-browser-<version>-windows-x64.exe` and needs Inno Setup 6. That
installer offers English and Japanese, installs per user, can add the command to `PATH`, and
creates a WezTerm Start menu shortcut when WezTerm is installed.

### Signing

Releases are signed and a plain source build is not. Both scripts take an off-by-default
`-Sign`, and both reach for `scripts\sign-windows.ps1`, so one place knows about
certificates:

```powershell
$env:CODESIGN_CERT = "<the certificate's subject name>"
.\scripts\build-windows.ps1 -Sign           # pixel.node and the Electron binaries
.\scripts\package-windows-inno.ps1 -Sign    # the installer and its uninstaller
```

`CODESIGN_CERT` names the certificate to sign with: the subject name on its own, so
`Example Ltd` for `CN=Example Ltd, O=…`. Signing stops rather than carrying on when the
variable is unset or nothing matches it, which is also what a certificate on a token that
nobody plugged in looks like.

The build signs before packaging because the installer embeds those files, and packaging
hands the script to Inno Setup instead of running it afterwards because Inno builds the
uninstaller at compile time and nothing can reach that one later. `sign-windows.ps1` signs
everything in one call, so a token asks for its PIN once per step, and it passes over files
that already carry a valid signature. Run it alone to sign named files, or pass
`-NoElectron` to leave the Electron binaries as their publisher shipped them.

A ZIP carries no signature. Publish the `sha256` from `manifest-win32-x64.json` beside it.

### Versioning

A release is named after the upstream version this fork builds on plus its own revision, so
`0.5.8-win.2` is the second Windows release built on upstream `v0.5.8`. The current one is the
`-Version` default at the top of `scripts\build-windows.ps1`; edit that line to cut a new
release, or pass `-Version` for a one-off build. It ends up in `VERSION`, which is what
`terminal-browser --version` prints.

Inno Setup wants four numbers, so the fork revision becomes the fourth one and `0.5.8-win.2`
installs as `0.5.8.2`. A version that does not follow this shape still packages, as `0.0.0.0`.

`terminal-browser upgrade` only installs the upstream macOS and Linux builds, so on Windows
it refuses and points at this fork's releases instead.

### Usage
```
terminal-browser # launches the browser
terminal-browser open <url> # opens the browser at a url
terminal-browser --split right # opens the browser in a split pane to the right
terminal-browser ls # lists open browsers
terminal-browser action # an agent-browser compatible cli for interacting with open terminal-browsers
```




### Use cases:
- You can have a coding agent and website scoped to the same terminal tab
- Your agent has full access to interact with open terminal-browsers, which gives your agent the capability to use the web
- You can ask an agent to make HTML plans and then open them inside terminal-browser, which will automatically open in a split pane next to your agent
- terminal-browser works over SSH, which allows you to preview websites running on remote machines easily

### Shortcuts

| Action | macOS | Linux |
| --- | --- | --- |
| Quit | ctrl+q or ctrl+c | ctrl+q |
| New tab | cmd+t | ctrl+t |
| Edit URL | cmd+l | ctrl+l |
| Command palette | cmd+p | ctrl+k or alt+k |
| Find in page | cmd+shift+f | ctrl+shift+f |
| Next / previous match | enter / shift+enter | enter / shift+enter |
| Reload | cmd+r | ctrl+r |
| Back / forward | cmd+[ / cmd+] or ctrl+[ / ctrl+] | ctrl+[ / ctrl+] |
| Zoom in / out / reset | your terminal's zoom keybind | your terminal's zoom keybind |
| Devtools | cmd+shift+i or f12 | ctrl+shift+i or f12 |
| Devtools console | cmd+alt+j | ctrl+alt+j |
| Copy / paste / cut | cmd+c / cmd+v / cmd+x | ctrl+c / ctrl+v / ctrl+x |
| Record page (start/stop) | ctrl+r | ctrl+shift+r |
| Complete recording review | ctrl+enter | ctrl+enter |
| Close popup / overlay | escape | escape |



### How does it work?
Terminals that support the kitty graphics protocol, including ghostty, kitty, cmux, vscode and many more, allow a program running in a terminal to display pixels in your terminal. We use this capability to display pixels generated by chromium.

We use [electrons offscreen rendering API](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) to read pixels generated by chromium directly from the GPU. This allows terminal-browser to render smoothly without dropping any frames.

After the browser engine starts and is displaying pixels in the terminal, it needs to be able to read user input for websites to actually work. terminal-browser listens to mouse clicks, mouse position, and keyboard events from the terminal, and then sends synthetic events to chromium based on that data. For any user input events that are not retrievable from the terminal, we read directly from the operating system using a background swift app to listen for input events (non intrusively). This is what allows terminal-browser to implement smooth scrolling, and listen to trackpad events (websites with infinite canvases work great inside terminal-browser!)

The outer UI of the browser is implemented using a graphics engine built on top of rust. The actual UI is defined inside react with a custom react renderer, which allows us to build the UI for the browser using typescript. The UI of the outer browser and the browser content itself is all drawn to the same shared canvas inside the rust engine, which allows us to layer UI on top of the browser.


### App Mode
terminal-browser can be used to build apps in the terminal using browser technology. You can reference `terminal-code` as a production usage example - https://github.com/zenbu-labs/terminal-code

This is accessible by using the `--app-mode` option when spawning terminal-browser, and optionally using the `preload` and `main-script` options that use electron's [preload scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload) and main script under the hood. 

The following options are the full set of app related options available for `terminal-browser open`
```
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

```


### Roadmap
- linux support ✅
- chrome extensions
- design mode

### Contributing

- PR **descriptions** must be authored by humans and explained well, otherwise we will close them
- When making a PR, the motivation must be clearly defined in the description
- Minimize the size of your PR for the best chance to get it landed

To get a local development setup of terminal-browser, the recommended way is to ask a coding agent.

### Adding enhanced support for a new terminal
`terminal-browser`'s cli includes sub commands that rely on terminal/multiplexer scripting features. 
To implement support for a terminal/multiplexer not yet supported, reference existing implementations
located here https://github.com/zenbu-labs/terminal-browser/tree/main/terminals/src/terminals

### [Discord](https://discord.gg/t3jzHHfc6z)

### Acknowledgments
- the [kitty](https://github.com/kovidgoyal/kitty) project for developing the kitty graphics protocol
- [awrit](https://github.com/chase/awrit) - the first attempt to embed chromium inside a terminal
