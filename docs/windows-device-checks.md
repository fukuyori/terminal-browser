# Windows device checks for the v0.11.1 migration

What has to be tried by hand on a real terminal before this migration is done.
Everything here needs a person watching a screen, which is why none of it is a
test.

Work through a group at a time and note what happened. A group that fails
tells you more than a whole list half-finished.

The build is ready: `corepack pnpm -r build` has been run, and `cli/dist` and
`browser/dist` are current. If you change anything, run it again.

## How to run it

In Ghostty or WezTerm, from the repository:

```powershell
node cli\dist\main.js https://example.com
```

That is the development path: the CLI finds electron through the pixel
package in `node_modules`. Groups D and E use a built package instead, which
is the maintainer's to build with `-Sign`.

Quit with Ctrl+Shift+Q. Ctrl+Q is taken by the terminal itself.

## A. Drawing and input

| # | Do this | Expect |
| --- | --- | --- |
| A1 | Launch with a url | The page is drawn in the pane |
| A2 | Scroll with the wheel | The page scrolls, without tearing |
| A3 | Click a link | It follows the link, and the click lands where the pointer is |
| A4 | Type into a text field | The characters arrive, including Japanese through the IME. See [where the IME box goes](#where-the-ime-box-goes) |
| A5 | Drag to select text | The selection follows the pointer |
| A6 | Resize the terminal window | The page reflows to the new size, and nothing is left drawn outside it |
| A7 | Quit with Ctrl+Shift+Q | The shell comes back with its scrollback, and no image is left over it |

A3 covers upstream's mouse coordinate change (`#105`). If clicks land at an
offset from the pointer, say where the pointer was and where the click went.

### Where the IME box goes

Typing Japanese works, and the text lands in the field once it is committed.
The box that shows what is being composed does not: it appears at the top of
the terminal window rather than beside the caret on the page.

The IME belongs to the terminal, not to the page. The terminal puts the box at
its own cursor, and the engine hides that cursor on startup
(`\x1b[?25l`, `engine/crates/pixel-core/src/terminal.rs`), so the box lands at
the top. Where the caret sits on the page is never something the terminal is
told.

This is how it has always worked here rather than something the v0.11.1 move
brought in; the escape is upstream's and predates the fork. Moving the box
would mean putting the terminal's cursor where the page's caret is, which
nothing does today.

Confirmed on 2026-09-20 in Ghostty: composing shows the box at the top, and
committing puts the text in the field.

## B. Frame files

The engine hands frames to the terminal as files and deletes them after.

| # | Do this | Expect |
| --- | --- | --- |
| B1 | While it runs, list the frame files | Only a handful, not one per frame |
| B2 | Quit and list again | They are gone |
| B3 | Kill the process instead of quitting, then launch again | The next launch removes what the killed one left |

```powershell
Get-ChildItem $env:TEMP -Filter "terminal-browser-*.rgba" | Measure-Object | Select-Object Count
```

B3 is the sweep on startup: a killed process never deletes its own files, so
the next run clears out the ones whose owner is gone.

## C. A second app in the same terminal

The first app owns the terminal; a second one joins it over a named pipe and
hands its frames to the first.

Run the first one, note the pane, then from another shell:

```powershell
$env:PIXEL_TTY = "CONIN$#<the surface or pane id of the first>"
node cli\dist\main.js https://example.org
```

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Start the second app | It does not fail with `host did not accept the frame stream` |
| C2 | Watch the first pane | It shows the second app |
| C3 | Type and click | The input reaches the second app |
| C4 | Resize the window | The second app reflows |
| C5 | Quit the second app | The first app's own page comes back |
| C6 | Quit the first app while the second is still up | The second one notices and does not hang |

## D. SSH, agents and the clipboard

| # | Do this | Expect |
| --- | --- | --- |
| D1 | `node cli\dist\main.js open --ssh <user@host> <url>` | The page loads through the remote host |
| D2 | A host alias from your ssh config | It is accepted as the target |
| D3 | Copy an image from a page | It pastes into another app as an image |
| D4 | `node cli\dist\main.js action` against an open browser | It lists targets and can open a tab |

## E. The Claude Code plugin

This is the bridge, and it is separate from D4. The bridge starts detached and
then attaches to the console that called it, which is the part that has never
been seen working.

| # | Do this | Expect |
| --- | --- | --- |
| E1 | From Claude Code, open a page through the plugin | It draws in Claude Code's own terminal |
| E2 | Click and type | The input reaches the page |
| E3 | Select text on the page | It reaches the Windows clipboard |
| E4 | Copy Japanese and something with line breaks | Both survive, with the line breaks intact |
| E5 | Close it | The terminal comes back, and no bridge process is left |

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*claude-bridge*" } |
  Select-Object ProcessId, CommandLine
```

E5 should leave that empty. A bridge with nothing talking to it also exits on
its own after a minute.

## F. The built package and the installer

These need a package built with `-Sign`, which is the maintainer's step.

```powershell
.\scripts\build-windows.ps1 -Zip -Sign -RequireCleanPixel
.\scripts\package-windows-inno.ps1 -Sign
```

| # | Do this | Expect |
| --- | --- | --- |
| F1 | Check the signatures in the payload | `Get-AuthenticodeSignature` says `Valid` for `electron\pixel.exe` and the `pixel.node` under `browser\node_modules` |
| F2 | Run `bin\terminal-browser.cmd` from the payload | It launches and draws |
| F3 | Install with the installer | It installs under `%LOCALAPPDATA%\Programs\terminal-browser` |
| F4 | Launch from the Start menu shortcut | A terminal opens with the browser in it |
| F5 | Launch `terminal-browser` from a new shell | The installed launcher is on `PATH` and works |
| F6 | Check the uninstaller's signature | `Valid` |
| F7 | Uninstall | It removes the program and its `PATH` entry |

F2 and F5 are the other two places electron is resolved from, after the
development path that groups A to E use. All three have to reach a
`pixel.exe`.

## G. The console identifier

Ghostty and WezTerm name their panes differently, and a terminal that names no
pane puts every window on one daemon. Record what each one reports.

```powershell
node -e "const{consoleScope,daemonName}=require('D:/home/source/rust/terminal-browser/store/dist/paths.js');console.log(JSON.stringify({GHOSTTY_SURFACE_ID:process.env.GHOSTTY_SURFACE_ID??null,WEZTERM_PANE:process.env.WEZTERM_PANE??null,WT_SESSION:process.env.WT_SESSION??null,scope:consoleScope(),daemon:daemonName()}))"
```

Paste the whole line each time; the last few characters of an id are not
enough to tell two apart.

### G1. One pane, over its life

Run it in a pane, then again after each of: running a few commands, resizing
the window, focusing another window and coming back. In a `cmd` inside that
same pane, use `echo %GHOSTTY_SURFACE_ID%`.

**Pass:** the `scope` is the same every time, and `cmd` inherits the same id.

A scope that changes mid-life would move the daemon out from under a running
app.

### G2. Panes that exist at the same time

Leave the first pane open. Open a new tab, split the first pane, and open a
new window, recording in each.

**Pass:** all four scopes differ.

The same scope twice means two panes share a daemon, and a Windows daemon can
only draw into one console.

### G3. After restarting the terminal

List the daemons before and after:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'pixel.exe'" |
  Where-Object { $_.CommandLine -like "*terminal-browser*" } |
  Select-Object ProcessId, CommandLine | Format-List
```

An id that comes back after a restart is not a fault, and reaching an old
daemon is not one either: the engine takes a console again when no session
holds one. Judge it by whether the terminal works.

| # | Look at | Pass |
| --- | --- | --- |
| G3-1 | Whether an old daemon is still running | Either way; note which |
| G3-2 | Launching after the restart | It draws in the new console |
| G3-3 | Keyboard and mouse | They work in the new console |
| G3-4 | Quitting | The shell comes back |
| G3-5 | Waiting | Neither launching nor quitting hangs |

Only G3-2 through G3-5 failing needs fixing.

## What to report

Per group: which steps passed, and for anything that did not, what was on the
screen and what was in
`%USERPROFILE%\.local\state\pixel\logs\<app>.stderr.log`.
