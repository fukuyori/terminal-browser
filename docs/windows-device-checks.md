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
the next run clears out the ones whose owner is gone. The count alone will not
show it, because both runs keep eight; the process id in the name is what
changes.

A killed run also leaves its last frame on the terminal, since nothing gets to
leave the alternate screen. That is the same missing cleanup, not a separate
fault, and the next launch draws over it.

It does leave that shell unusable, though, so kill a run only where the point
is to see what a kill leaves behind. Everywhere else, quit with Ctrl+Shift+Q,
which puts the terminal back. A shell already stuck that way is easiest to
replace with a new tab.

Confirmed on 2026-09-20 in Ghostty: eight files while running, none after
quitting, and after a kill the eight from the dead process were gone once the
next run started, replaced by eight of its own.

## C. A second app in the same terminal

The first app owns the terminal; a second one joins it over a named pipe and
hands its frames to the first.

Run the first one, note the pane, then from another shell:

```powershell
$env:PIXEL_TTY = "CONIN$#<the surface or pane id of the first>"
$env:TERMINAL_BROWSER_NO_MERGE = "1"
node cli\dist\main.js https://example.org
```

The second-launch stall found here was an unsupported shared-memory frame
submission on Windows. It is fixed in the local Pixel dependency; see
[the diagnosis and verification](open-issue-second-launch-stalls.md).
Remove the two environment variables from the second shell after this group.

Ask pane 1 what it is called, for `PIXEL_TTY`:

```powershell
node -e "const{createRequire}=require('module');const path=require('path');const req=createRequire(path.join(process.cwd(),'browser','index.js'));console.log(req('@zenbu-labs/pixel/terminal').windowsConsoleId())"
```

**The second app draws into pane 1, not into its own tab.** Its own tab shows
nothing but the running command, so watch pane 1 and type there.

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Start the second app | It does not fail with `host did not accept the frame stream` |
| C2 | Watch pane 1 | A second tab appears, showing the second app |
| C3 | Type and click in pane 1, and press Alt+1 and Alt+2 | The input reaches the second app, and the tabs switch |
| C4 | Resize the window | Both tabs reflow |
| C5 | Press Ctrl+C in the second app's own tab | Pane 1 goes back to one tab and its own page |
| C6 | With both up, end the first app from a third tab | The second one ends too, leaving no process and no pipe |

C5 is Ctrl+C rather than the browser's own quit: the browser's keys go to
pane 1, where the second app is only a guest.

C6 needs the first app ended from outside, because quitting it from pane 1
closes the terminal along with it in Ghostty:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*example.com*" } | Select-Object ProcessId
Stop-Process -Id <that id>
```

That leaves pane 1 the way any killed run does, with mouse reporting still on,
so moving the mouse prints the reports as text. It is the cleanup that never
happened, not a fault of its own. Close the tab, or put the terminal back:

```powershell
[Console]::Write("`e[?1003l`e[?1006l`e[?1016l`e[?1004l`e[?2004l`e[?25h`e[?1049l")
```

Then nothing should be left:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*cli\dist\main.js*" }
Get-Process pixel -ErrorAction SilentlyContinue
[System.IO.Directory]::GetFiles("\\.\pipe\") | Where-Object { $_ -like "*terminal-browser*" -or $_ -like "*pixel*" }
```

### Two daemons, one drawing

While both apps run there are two daemons, one per tab:

```
\\.\pipe\terminal-browser-<scope>-daemon-<pane 1's surface>
\\.\pipe\terminal-browser-<scope>-daemon-<pane 2's surface>
```

`PIXEL_TTY` tells the engine where to draw; the daemon's name comes from the
environment, so the second tab starts one of its own. The daemon carries
control between the CLI and the browser and takes no part in drawing, so this
costs nothing. It does show that two panes alive at once get different scopes,
which is what group G asks for.

Done on 2026-09-20 in Ghostty with the frame-path fix in place: all six
passed, and ending the owner left no process and no pipe behind.

On 2026-09-21, the real-process integration check passed again at
terminal-browser `05fef3e` with Pixel `5bb53b9`. Owner/guest frame contents,
switching, resizing, guest input, drawing beyond the original 12-second
failure, browser-tab creation, and shutdown all passed. Both daemon shutdowns
were recorded in lifecycle logs, and no `pixel.exe` remained. This was an
automated regression check, not a repeat of the visible Ghostty checks above.
The stale "device check pending" text in the issue was corrected accordingly.

## D. SSH, agents and the clipboard

| # | Do this | Expect |
| --- | --- | --- |
| D1 | `node cli\dist\main.js open --ssh <user@host> <url>` | The page loads through the remote host |
| D2 | A host alias from your ssh config | It is accepted as the target |
| D3 | Paste a picture into a page, both ways: see [how to](#pasting-a-picture-into-a-page) | The picture arrives in the page |
| D4 | `node cli\dist\main.js action` against an open browser | It lists targets and can open a tab |

### Pasting a picture into a page

Two things can be on the clipboard, and the engine takes both:

| On the clipboard | What the engine makes of it |
| --- | --- |
| A picture, copied from an image editor or a snip | pixels, saved as a png |
| A `.png` file, copied in Explorer | that file, by its path |

Either way `web/input.ts` hands it to the page with `contents().paste()`.

Open a page that takes a picture. https://imgbb.com and
https://postimages.org both accept a paste, and so does any page with a
rich-text editor. Then:

1. Copy a picture. Win+Shift+S takes a snip straight to the clipboard.
2. Click into the page where a picture would go.
3. Press Ctrl+V.

**Pass:** the picture appears in the page, the right way up and the right
size.

Then do it again with a file: copy a `.png` in Explorer with Ctrl+C, and paste
into the same place.

The engine's half of this is covered by tests in `clipboard_image.rs`, which
put a picture and a file on the real clipboard and read them back. They are
skipped unless `PIXEL_TEST_CLIPBOARD=1`, because writing the clipboard takes
over what the person had on it; they put text back afterwards, and cannot put
back a picture.

Done on 2026-09-20 in Ghostty, both ways, on imgbb: a snip taken with
Win+Shift+S pasted into the page, and so did a `.png` copied in Explorer. The
engine tests passed the same day. A page that takes an upload takes a paste
too, which is not obvious from looking at one.

### Where group D stands

The initial checks on 2026-09-20 at `07e8470`, with Pixel `7dd8282`, used the
development CLI and real Electron with an embedded test transport. Later
manual checks are recorded separately below.

| # | Result |
| --- | --- |
| D1 | SSH, remote page loading and frame generation confirmed; the user also confirmed example.com displayed with the direct SSH target |
| D2 | The host alias in a temporary SSH config passed with `-F` works; the user also confirmed example.com displayed with that alias |
| D3 | Both ways reach the page: a snip and a copied `.png` each pasted into imgbb |
| D4 | Passed in Ghostty: first snapshot in 471.55 ms, visible link navigation, tab creation, Japanese input, click, eval and manual input after `action done`. Controlled integration also passed |

D1 and D2 used a temporary HTTP server bound only to the SSH server's
loopback address. Its URL was unreachable locally without the tunnel. Both
CLI launches loaded its unique page text, the remote server logged the
requests, and the engine produced 800 by 600 RGBA frames containing the
page's background colour. The temporary server stopped after the checks,
and both browser launches and SSH tunnels were closed. The alias config
lives under the ignored diagnostic directory; the user's SSH config was
not changed.

On 2026-09-20, the user confirmed that `https://example.com` displayed in
both manual runs: D1 with `--ssh fuk@192.168.12.12`, and D2 with
`--ssh "ssh -F D:/home/source/rust/terminal-browser/tools/stall-diagnostics/ssh-zqp7u3/ssh_config tb-d2-probe"`.
This completes the display check for D1 and D2. Link interaction and return
to the terminal after closing were not included in that report.

This test process inherited an `SSH_AUTH_SOCK` pointing to a missing WezTerm
agent socket. Removing that variable only from the test subprocesses let
Windows OpenSSH use the running Windows ssh-agent. Key authentication then
worked without a prompt. No permanent environment setting was changed.

D3 was written the wrong way round. `clipboard_image.rs` reads an image
*from* the clipboard and hands it to the page: `from_paste` takes bitmap
clipboard contents, and `image_path_from_paste` takes a copied file path or
`file://` url and loads the picture behind it. Nothing there copies a picture
out of a page, and the page's context menu has no such item either, so the row
as first written asked for something that does not exist. The row above now
asks for the direction the code has.

For D4, the original fresh agent-browser 0.33.0 session did not return from the first
`action -- tab list --json` within 45 seconds. A second fresh session also
stalled and was stopped after 15 seconds. Retrying in that same session
returned in 425 ms; snapshot, Japanese text entry, clicking, evaluating the
result and `action done` then succeeded. The browser and agent processes
created for the check were stopped afterward.

Before the local timeout change, `runAgent` in `cli/src/action.ts` called
`spawnSync` with no `timeout`, so the recovery in `agentTabs` could not run
while the first call was stuck. The local change gives each internal call
20 seconds and treats a timeout as a failed call eligible for the existing
reconnection path.

The real agent-browser 0.33.0 was checked again with that change. A fresh
session's first `action -- tab list --json` returned successfully after
20,299 ms, without the test driver retrying the CLI command. Snapshot,
Japanese text entry, clicking, evaluating the result and `action done`
then passed in 205 to 270 ms each. The test driver shut down its browser
and stopped its agent daemon after the check. That confirmed recovery, before
the cause below was isolated.

The Windows stall was waiting for output pipes to close. In a direct check,
agent-browser wrote successful JSON after 258 ms and exited with code 0 after
261 ms, but its detached daemon retained inherited output handles. The pipes
closed only when that daemon was stopped. Either stdout or stderr alone could
hold the call open. A minimal Rust reproduction using the same daemon spawn
options showed the same delay; clearing inheritance on the original standard
handles removed it. This was not a command still working for twenty seconds.

`runAgent` now captures stdout and stderr in separate temporary files on
Windows. It waits for the command process, reads its output and removes the
files, without waiting for the daemon to close inherited pipe handles. Other
platforms retain pipe capture. The existing timeout still bounds a command
that really does not exit.

With this change on top of `4a6daeb`, the real agent-browser 0.33.0 in a fresh
session completed the first `action --tab 2 -- tab list --json` in 507 ms,
without a timeout or a manual retry. Snapshot, Japanese input, clicking,
evaluating the result and `action done` passed in 190 to 241 ms each. This
used real Electron with an embedded test transport; terminal appearance
was not checked. The test browser and agent daemon were stopped afterward.

The user then completed the manual D4 check in Ghostty on 2026-09-20.
Browser `11440-1` was opened with `open https://example.com --no-merge`;
commands were run from PowerShell in another Ghostty tab with an explicit
`--browser` selector. The first snapshot returned Example Domain in
471.55 ms. Clicking the quoted selector `'@e2'` visibly navigated to the
IANA page. `action -- open` created tab 2 with the local input test page.
Filling its input with `日本語 D4 確認` and clicking its button both appeared
on screen. The user subsequently changed the text and pressed the button;
`eval` returned the matching `今日の天気はどうですか`. After `action done`,
the user confirmed that clicking the input and typing manually worked.

`agent-timeout.test.js` now calls the code it is about. Five of its tests
drive `agentTabs` with a stand-in for the agent, so the reconnect, the order
of the calls, the limit on attempts and the wording of what it reports are all
the product's own. Writing that sequence separately had hidden a fault: the
first version of the message carried the value of `--session` in it, which
only showed once the real function was the one being asked.

The timeout tests drive `runAgent` itself through a child, because it blocks
on `spawnSync` and a deadline inside the test process could never fire while it
did. The child has its own deadline, so a `runAgent` that stopped passing one
to `spawnSync` fails the test instead of hanging the suite. Taking the timeout
out of `action.ts` was tried: both tests fail in about 20 seconds with
"it is not giving spawnSync a deadline", and the suite finishes.

A Windows regression test lets a detached child retain stdout and stderr
after its caller exits. It checks successful return while that child is still
alive, Japanese output on both streams, and removal of the capture files.
Restoring pipe capture makes this test fail with a timeout. Capture cleanup
is also checked after a timeout and a failure to start the command.

`TERMINAL_BROWSER_AGENT_TIMEOUT_MS` shortens the deadline, which is how those
tests stall for a second and a half rather than twenty. It takes a whole number
of milliseconds and ignores anything else, because `spawnSync` refuses a
fractional one.

### D4 validation limits

- **Other platforms.** The cause and correction above were checked on Windows;
  equivalent first-launch checks have not been run elsewhere.
- **Automatic splitting in Ghostty on Windows.** The attempted `--split right`
  launch failed with `could not work out which ghostty pane you are in`.
  The current Ghostty adapter supports automatic splitting only on macOS.
  The manual D4 check used separate Ghostty tabs instead.

Local evidence, kept outside Git:

- `tools/stall-diagnostics/ssh-zqp7u3/`: D1/D2 results, remote request log,
  temporary SSH config, browser listings and captured RGBA frames.
- `tools/stall-diagnostics/d4-ERbqTC/`: the 45-second first-call timeout.
- `tools/stall-diagnostics/d4-ADDILq/`: the 15-second timeout and successful
  retry, including each command's output and timing.
- `tools/stall-diagnostics/d4-DJa1d2/`: automatic recovery with the real
  agent-browser and the local 20-second timeout change.
- `tools/stall-diagnostics/d4-diagnosis-vkJdlY/`: command exit and pipe-close
  timings, including direct agent-browser checks with file capture.
- `tools/stall-diagnostics/d4-cause.txt`: diagnosis and minimal Rust evidence.
- `tools/stall-diagnostics/output-regression-mutation.log`: the regression
  test failing when pipe capture is restored.
- `tools/stall-diagnostics/d4-QgO8S2/`: the 507 ms first call and subsequent
  successful operations with the Windows file capture change.

## E. The Claude Code plugin

This is the bridge, and it is separate from D4. The bridge starts detached and
then attaches to the console that called it. That startup path has been
verified; the new Image rendering path still needs production device checks.

| # | Do this | Expect |
| --- | --- | --- |
| E1 | From Claude Code, open a page through the plugin | It draws in Claude Code's own terminal |
| E2 | Click and type | The input reaches the page |
| E3 | Select text on the page | It reaches the Windows clipboard |
| E4 | Copy Japanese and something with line breaks | Both survive, with the line breaks intact |
| E5 | Close it | The page is hidden; the bridge stays for the next open |

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*claude-bridge*" } |
  Select-Object ProcessId, ParentProcessId
```

E5 does not empty that. Closing hides the page, and the bridge waits for the
next one. It ends by itself after a minute with nothing talking to it, but
Claude Code keeps polling while it is up, so in practice the bridge lasts as
long as Claude Code does.

### Where group E stands

Initial result on 2026-09-20 with Claude Code 2.1.278 on Windows 11,
before the Image migration:

| # | Result |
| --- | --- |
| E1 | Not reached. This Claude Code refuses the character the plugin draws with |
| E2, E3, E4 | Not tried; they need E1 |
| E5 | As implemented, once the expectation above was corrected |

The bridge itself works: it started, attached to the caller's console, and
answered `GET /state` throughout. That is the part this migration changed,
and it is confirmed separately from the drawing.

The drawing is a disagreement between the plugin's method and this build of
Claude Code. See
[the diagnosis](open-issue-plugin-placeholder-refused.md). Group E stays open
until a page is actually drawn and E2 to E4 can be done.

A separate Image API probe passed in Ghostty on 2026-09-20: direct base64
PNG and RGBA displayed, and an overlaid input Client received pointer down/up
at `(5, 1)` and the `a` key while the image stayed visible. Escape followed
by `/imgprobe close` closed the pane. WezTerm showed alternative text in the
PNG check. A subsequent `$.ui.blit` probe visibly animated a white block while
receiving clicks and the `a` key. It stopped at 1,257 accepted updates with
zero denials, reopened successfully, and stopped again at 198 accepted updates
with zero denials. These counts are API acceptances, not a frame-rate
measurement. This is an isolated plugin check, not a pass for browser E1/E2;
browser frame transport, bridge input forwarding and clipboard behavior remain
to be checked. Details are in the diagnosis linked above.

The ignored probe now has a `/browserprobe` command for a real 512 by 512
browser, with an Image and an overlaid Client. A controlled adapter check
received the browser's pixels, measured movement of its animated white block,
delivered mouse/key/Japanese paste events to the page, and verified process
exit after close. The detached launch and plugin type check passed. These
checks did not run through Claude Code. The user subsequently confirmed the
real page displayed in Claude Code on Ghostty, accepted `abc` in its field,
displayed it after clicking Apply, and continued animating. Multi-character
IME commits failed; only individually confirmed characters entered. The probe
mapper discarded multi-character text and has been corrected. A synthetic
`日本語テスト` event passed through the corrected mapper to the real page;
the user then passed the physical IME retest. The Client log shows `日`
followed by `本語入力テスト`; both are now forwarded. Selecting the two
Japanese lines on the probe page and pasting into Notepad preserved their
text and line break. Close/reopen restored the page and animation, and
`再開テスト` entered correctly after reopening. The second close also passed.
Image update counters at close were 1198 accepted / 0 denied and 493 accepted
/ 0 denied; these are API counts, not frame rates. Both browser exits were 0,
and neither diagnostic host nor browser process remained at the subsequent
check. Evidence is in `tools/stall-diagnostics/image-probe/manual-close-check.json`
and the linked diagnosis.

The diagnostic results do not mark production E1-E5 as passed. The diagnostic adapter stops its host
and browser on close; production E5 deliberately hides and reuses them.

The production `/browser` is now migrated in the working tree. Controlled
checks against its real bridge/browser passed at 48x24, 90x40, 32x16 and
150x35 cells, including input after resize and two hide/reopen cycles with
page contents retained. PNG is used normally; oversized images are reduced
to RGBA within the Image API limit. Claude Code loaded the production plugin
and fetched frames; the automation terminal was WezTerm, where Image remains
refused. The subsequent production Ghostty check displayed Example Domain,
followed its link by mouse, and opened the D4 input page. Actual IME input
failed: the user reported a missing first character and duplicated remaining
text; the screenshot shows `語入力テスト語入力テスト`. Input events were not
logged in that run, so the failing layer is still undetermined. Production
E2 is incomplete; clipboard, close/reopen and visual resize checks remain.
Two subsequent physical IME attempts after restarting with input logging
enabled produced the correct DOM value. The bridge received each text part
once, and page events confirmed the second insertion without duplication.
No input fix was applied between runs; the earlier failure remains unresolved.
Directly replacing selected text with `再入力テスト` also passed on the third
attempt, confirmed by the user, bridge log and DOM insertion events.
The Apply button displayed that text, but E3 failed: selecting it and pasting
into Notepad produced `慌eQ娚ﾆ0ｹ0ﾈ0`. The same corruption was reproduced through
the production bridge's `clip.exe` writer. It now uses explicit UTF-8 input
decoding and PowerShell `Set-Clipboard`. Real clipboard regression checks pass
for Japanese, multiline text with a trailing newline, ASCII, emoji, shell
metacharacters and empty text; CLI 28 passed / 0 skipped with the clipboard
test enabled. The production Notepad retest after restart is still pending.
On restart, input and Apply passed, but drag selection failed. At inspection
the browser was gone and the bridge reported `alive:false`, with no error;
mouse events were still being received. The plugin retained a stale image.
That display defect is fixed, and all browser exits are now logged/reported.
Plugin regressions and a controlled real-browser termination passed; CLI 29
passed / 1 clipboard test skipped. The original exit reason is unknown, and
the manual clipboard retest was incomplete at that point.
After the next restart, the user confirmed IME input, Apply, drag selection,
and pasting `再入力テスト` into Notepad without corruption. E3 now passes its
production manual check. The bridge logged the final six-character selection,
and browser `30408-1` remained live when inspected. E4 also passed: in the
production `/browser`, the user selected `日本語のコピー` and `2行目のテキスト`
together on `image-probe/browser-page.html` and confirmed the Notepad paste
preserved Japanese text and the line break. E5's manual close/reopen check
also passed: `/browser close` returned to the Claude input, `/browser`
restored the animated page, and `再開テスト` entered correctly after reopening.
The browser registry still showed `30408-1`, confirming reuse of the same
browser. Shrinking the window preserved animation and the Apply button worked.
Enlarging again stalled at `Loading browser…`; the browser remained alive but
the bridge kept producing frames at the smaller 49x35-cell size. A controlled
Client regression reproduced size notifications being overwritten by input
posts within one frame. Size and input are now posted together, with size
forwarded first. CLI 30 passed / 1 clipboard test skipped; plugin type checking
passed. The physical resize retest then passed: animation continued at the
original size, after shrinking and after enlarging again. The bridge logged
89x53 -> 49x35 -> 89x53 cells (`production-resize-retest.log`). After enlargement,
the user entered `サイズ変更テスト` through the IME, clicked Apply, and confirmed
the same text appeared below the button. The resize and subsequent input checks
passed; browser `31764-1` was still live at inspection. The earlier IME duplication
and unexplained browser exit remain unresolved despite successful retries.
This requires the local Pixel `PIXEL_EMBED_FRAMES` change, not yet represented
by `pixel.commit`. Details and evidence are in the diagnosis linked above.

Final pane close and Claude session exit passed. The tracked bridge, attached
CLI and browser were all gone by 2026-09-20T13:22:06Z; evidence is in
`tools/stall-diagnostics/production-session-exit.json`.

The IME failure was then reproduced in a controlled real-browser check:
two multi-character commits (`日本`, `語入力テスト`) became two copies of the
second string. Mapping commits to clipboard pastes raced clipboard replacement.
Commits now use Pixel's existing text-insertion key path. A repeated check also
exposed unawaited insertions replacing each other; Pixel now dispatches keys
in order after pending focus/insertion completes. Four chunk patterns repeated
three times passed, as did input at four sizes and after two reopen cycles.
All 18 recorded commits left the clipboard unchanged. Evidence:
`tools/stall-diagnostics/e-production-run-opztL3/ime-chunks.json`.
CLI 31 passed / 1 clipboard test skipped; two Pixel input tests, the Pixel build
and plugin type checking passed. The new physical IME retest passed: the user
entered `日本語入力テスト` and replaced it with `再入力テスト` after Ctrl+A,
without missing or duplicate text. The bridge logged the corrected
`key:unknown` text-insertion path (`production-ime-final-manual.log`).
The previous unexpected browser exit remains unexplained. Pixel's additional
input-ordering change is local and also absent from `pixel.commit`.

The final IME-verification session also closed cleanly. At
2026-09-20T13:36:06Z, bridge 8168, attached CLI 30352, browser 36480 and
its console process 37852 were all gone. The bridge logged intentional
shutdown (`stopping:true`) at 13:36:04Z. Evidence:
`tools/stall-diagnostics/production-final-session-exit.json`.

Current manual results after the fixes:

| Check | Result |
| --- | --- |
| E1 | Passed: real pages draw in Claude Code on Ghostty |
| E2 | Passed on retest: click, IME entry and selected-text replacement; split commits also passed controlled regressions |
| E3 | Passed after encoding fix: selected Japanese text pasted correctly into Notepad |
| E4 | Passed: Japanese text and line break preserved in Notepad |
| E5 | Passed: hide/reopen reused the browser; session exit left no tracked process |
| Resize | Passed after notification fix: shrink/enlarge, animation, IME and clicking after enlargement |

The earlier unexplained browser exit remains an open reliability issue;
these manual passes do not identify its cause. F and G remain separate checks.

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

### Package and installer results on 2026-09-21

F1-F7 passed with the signed artifacts built by the user using the commands
above. The repository HEAD was `1d68925d581b68c9f8880720d5cbe743b836063c`,
with `pixel.commit` set to `5bb53b956ec2b9d1373e56f8c0c8869a720668bd`.
The pending change in this repository was the G-group record in this document.

| Artifact under `dist-release/` | Bytes | SHA-256 |
| --- | --- | --- |
| `terminal-browser-0.11.1-win.1-windows-x64.zip` | 210137449 | `f8cc4a249f3eb58ddcbbba0711f083897e2bdd00ac82b750f60007f230e4a2c4` |
| `terminal-browser-0.11.1.1-windows-x64.exe` | 145088376 | `046a713e7683308054c44ee74465f3ec431d496d917ab2d6886ccf2d5685a5ed` |

Both artifacts matched their manifest sizes and hashes. The installer had a
`Valid` Authenticode signature and file/product version `0.11.1.1`.
The payload launcher reported `terminal-browser 0.11.1-win.1` and its help
command completed successfully.

| Check | Observed result |
| --- | --- |
| F1 | Payload `electron/pixel.exe` and native `pixel.node` signatures were `Valid`; bundled Node and agent-browser signatures were also `Valid` |
| F2 | User confirmed Example Domain displayed from the payload launcher in Ghostty; Ctrl+Shift+Q returned to PowerShell |
| F3 | Existing `0.8.0-win.1` installation was upgraded at `%LOCALAPPDATA%/Programs/terminal-browser`; installed VERSION and launcher reported `0.11.1-win.1`, and uninstall registration reported `0.11.1.1` |
| F4 | User confirmed the installed `terminal-browser (WezTerm)` Start menu shortcut opened the terminal and browser, then closed successfully |
| F5 | A new Ghostty PowerShell resolved `terminal-browser` to the installed `bin/terminal-browser.cmd`; user confirmed Example Domain displayed and Ctrl+Shift+Q returned to PowerShell |
| F6 | Installed `unins000.exe` signature was `Valid`; installed `pixel.exe` and `pixel.node` signatures were also `Valid` |
| F7 | After the user uninstalled, the installation directory, user PATH entry, HKCU uninstall registration and Start menu directory were all absent |

This exercised an upgrade followed by uninstall, not installation on a clean
machine. The application was left uninstalled after F7; the artifacts remain
under `dist-release/`. F4 used the standalone browser in WezTerm, not the
Claude Code Image path whose capability restriction remains separate.

The build log supplied by the user included unsupported-platform warnings
for macOS/Linux native packages and a missing `pixel` bin target under the
Pixel example's `node_modules/.bin`. The script removes Pixel's generated
`dist` before installation and builds it afterward; this order is consistent
with the missing target during installation. The installed local dependency's
`dist/bin.js` existed after the build. The summarized nine other warnings
were not supplied and were not assessed. The checks above validate the
completed artifacts, not every example's generated command link.

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

### Manual results on 2026-09-21

G1-G3 passed in Ghostty using the development CLI. The user reported the
outputs and confirmed the visible behavior; WezTerm was not checked in this run.

For G1, `scope` remained `0x0d752eacbe284059` after ordinary commands,
window resizing and moving focus away and back. It matched
`GHOSTTY_SURFACE_ID`, and `daemonName()` returned
`daemon-0x0d752eacbe284059`. A child `cmd` inherited the same surface id.
The initial `WEZTERM_PANE` and `WT_SESSION` values were both null.

For G2, the original pane stayed open while the other surfaces were created:

| Surface | Scope |
| --- | --- |
| Original pane | `0x0d752eacbe284059` |
| New tab | `0xf65b842f4bc3783e` |
| Split pane | `0x9475d8d7a41a7692` |
| New window | `0x94ee87e1743ecfb1` |

All four scopes differed. The split was performed through Ghostty itself;
this does not validate the CLI's automatic split support.

For G3, the process lists before and after closing all Ghostty windows and
restarting showed node PIDs 1564 and 30344, both with the same reported
start time of 2026-09-21 08:41:01. Neither list contained a pixel process.
These lists did not identify which node processes were terminal-browser
daemons, so reuse of an old daemon was not established.

In the restarted terminal, the development CLI displayed
`tools/stall-diagnostics/d4-manual-input.html`. Clicking its input, entering
`再起動テスト` and pressing Apply displayed the same text below the button.
Ctrl+Shift+Q returned to PowerShell; no launch or exit hang was reported.
These results do not resolve the separate unexpected browser exit in group E.

## What to report

Per group: which steps passed, and for anything that did not, what was on the
screen and what was in
`%USERPROFILE%\.local\state\pixel\logs\<app>.stderr.log`.
