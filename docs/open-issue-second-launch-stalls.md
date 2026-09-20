# A second launch in the same pane stops the first one drawing

Found while working through group C of `windows-device-checks.md`. The browser
stopped drawing and stopped responding.

The cause was confirmed and fixed on 2026-09-20 in the adjacent Pixel checkout.
Native Windows integration checks pass; a repeat on a visible Ghostty pane is
still needed. See [Fix and verification](#fix-and-verification).

Seen on 2026-09-20, Windows 11, Ghostty 1.3.2-windows.9, at
terminal-browser `ffd23da` with pixel `7002209`.

## What happens

1. In pane 1: `node cli\dist\main.js https://example.com`. It draws.
2. In another tab, with `PIXEL_TTY` set to pane 1's console id:
   `node cli\dist\main.js https://example.org`.
3. The second command prints no error and exits after about 12 seconds.
4. Pane 1 now shows two tabs, both named `terminal-browser`, and goes black.
5. The tabs cannot be switched. Nothing in the pane responds.

## What was found while it was stuck

**The processes are alive and idle.** Four `pixel.exe`, one parent and three
children, all reporting `Responding: True`, and none of them using any CPU at
all over a 1.5 second sample:

```
12468: 0.000s   21416: 0.000s   33128: 0.000s   34760: 0.000s
```

All 40 threads of the main process were in `Wait`: 28 `UserRequest`, 8
`EventPairLow`, 4 `Unknown`.

**The frame files had old timestamps.** The frame files' last write was
13:04:02, three minutes before they were listed. There were sixteen of them,
two generations of eight:

| Generation | Size each |
| --- | --- |
| 47 | 1529280 |
| 48 | 1503360 |

A generation is made when the frame size changes. `write_frame_file` frees
the old generation on its next call, not on a terminal acknowledgement. Two
generations alone therefore do not prove a missing acknowledgement. The sizes
say the surface got smaller, consistent with adding a tab strip.

The follow-up check also found that these memory-mapped files can change
contents without changing their last-write timestamps on Windows. Compare
frame contents, not timestamps, when checking whether drawing continues.

**The endpoints are all there.** Nothing had gone away:

```
\\.\pipe\terminal-browser-<scope>-daemon-0x2b496545210e79e9
\\.\pipe\terminal-browser-<scope>-instance-21416-1
\\.\pipe\pixel-<scope>-CONIN__0x2b496545210e79e9
```

The daemon and the pixel instance are both scoped by Ghostty's surface id,
which is the identifier added in this migration working as intended.

**Nothing in `stderr.log`.** It holds twenty lines, all `DevTools listening
on ...`. No error, no stack.

**`chromium.log` has something.** Written by the same process, 21416, as it
started:

```
[21416:0920/125859.636:INFO:CONSOLE:2] "Electron sandboxed_renderer.bundle.js script failed to run"
[21416:0920/125859.636:INFO:CONSOLE:2] "TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null."
```

The same pair appears for every launch in that log, including ones that went
on to draw, so on its own it does not explain the stall. It does say a
sandboxed renderer fails to initialise on every run here, which is worth its
own look.

## Confirmed cause

The original classification as browser-tab adoption was incorrect. The quoted
`tryAdopt` branch belongs to `newTabCommand`. The reported command uses
`openCommand`, whose `PIXEL_TTY` branch calls `openHere` before adoption is
considered. Pixel's host shell is also the source of the two tabs labelled
`terminal-browser`.

The original owner process, PID 21416, was still available for inspection.
A non-invasive native stack showed `CrBrowserMain` waiting in a Windows
dialog. Reading the dialog's DirectUI accessibility tree revealed:

```text
A JavaScript error occurred in the main process
Uncaught Exception:
Error: shared memory frames are not supported on this platform
    at Surface.present (.../pixel/dist/react/surface.js:28:23)
    at guest.onFrame (.../pixel/dist/host/guest.js:61:21)
    at route (.../pixel/dist/host/server.js:247:27)
```

`GuestView` always submitted frame files as Unix shared-memory descriptors.
The native `update_surface_shm` API is built only under `cfg(unix)`, so
Windows `Surface.present` threw on the first guest frame. Electron displayed
its default uncaught-exception dialog, blocking the main thread instead of
writing that exception to `stderr.log`. The drawing and control callbacks
could no longer run.

This is the host/guest frame path exercised by group C. It is an uncaught
exception with a blocked dialog, not evidence of a native deadlock.

## Found on the way: chromium logging is still on here

That `chromium.log` should not exist on Windows. Stage 1 found that
`--enable-logging` points chromium's own stdout and stderr at the console on
Windows, which writes over the frames the engine draws there, and took the
switch out of pixel's `bootstrap.ts`.

At the time of the failure, these two lines were still in this repository, in
`browser/src/main.tsx:23`:

```ts
app.commandLine.appendSwitch("enable-logging", "file");
app.commandLine.appendSwitch("log-file", path.join(LOGS_DIR, "chromium.log"));
```

The CLI starts electron on `browser/src/main.tsx` rather than through pixel's
bootstrap, so that fix did not apply to it. The browser entry point now also
enables these switches only outside Windows. This is separate from the stall.

## Fix and verification

Pixel's `packages/pixel/src/host/frame.ts` now reads Windows guest frame files
as BGRA buffers and uses the existing native bitmap submission API. That API
copies the pixels before returning; the descriptor is then closed and the
guest is acknowledged. Unix retains shared-memory submission and acknowledges
when the surface is released.

Failed reads or submissions close the descriptor and acknowledge once.
`GuestView` records the error on stderr instead of letting it reach Electron's
modal exception handler. Later frames can still be submitted.

Six regression tests cover bitmap submission, resizing, acknowledgement
ordering, Unix release timing, unreadable files, and failed submissions.
The Pixel TypeScript suite passes 49 tests, with 15 platform skips.
The terminal-browser build and suites pass 51 tests, with one clipboard skip.

An isolated Windows integration check used real Electron processes, the CLI's
second-launch path, named pipes, and the installed native engine. A test
connection supplied terminal size and input; frame contents were inspected
directly. It verified:

- Owner and guest page pixels reach the owner's output frame files.
- Alt+1 and Alt+2 switch between owner and guest.
- Resizing from 640x480 to 512x400 produces resized guest frames.
- A key delivered through the owner reaches the guest page's input field.
- Opening a browser tab remains a separate working path.
- Both daemons respond to control requests and shut down.
- No `chromium.log` is created on Windows.

The check passed both with the normal `PIXEL_TTY` launch and with
`TERMINAL_BROWSER_NO_MERGE=1`. The latter also checked both daemons every second
for 14 seconds after resizing and confirmed that frame contents kept changing,
past the approximately 12-second failure reported originally.

The dependency was rebuilt and refreshed in this checkout. The fix spans this
repository and `../pixel`; `pixel.commit` still names the existing committed
revision, since no commit was requested. Update the pin after the Pixel fix
has been committed before making a reproducible release.

## Remaining device check

Repeat group C in a visible Ghostty pane with the refreshed development build.
The native integration check does not establish visible terminal rendering,
real mouse behavior, or the owner-to-guest handoff when the owner quits first.
Keep adoption disabled explicitly when checking the host path:

```powershell
$env:TERMINAL_BROWSER_NO_MERGE = '1'
$env:PIXEL_TTY = '<pane 1 console id>'
node cli\dist\main.js https://example.org
```

The `PIXEL_TTY` fast path already bypasses adoption in the current CLI; the
environment flag makes the intended host-path check explicit. The historical
v0.8.0 behavior and the renderer preload warning have not been investigated.
