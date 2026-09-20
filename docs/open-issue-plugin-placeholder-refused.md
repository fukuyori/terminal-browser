# Claude Code refuses the character the plugin draws with

Current status (2026-09-20): the production plugin has been migrated to
Image/blit in the working tree. Production Ghostty drawing, Japanese copying,
resize/input and close/reopen checks passed. The fix for split IME commits
also passed controlled checks and the physical IME retest; an
earlier unexpected browser exit remains unexplained. The original failure and diagnostic checks below are retained as
evidence; see [the production migration](#production-migration).

Found working through group E of `windows-device-checks.md`. The bridge starts
and answers, but nothing is drawn: Claude Code rejects the tree the plugin's
surface returns.

```
terminal-browser: Client hooks/surface.tsx: returned a tree that does not
validate (a text child holds a control character (an escape sequence));
the instance unmounted
```

Seen on 2026-09-20 with Claude Code 2.1.278 on Windows 11, at
terminal-browser `ffd23da` with the local pixel build.

## Why

The former `claude-code-plugin/hooks/placeholders.ts` drew with U+10EEEE, the kitty
graphics placeholder, and encodes the row and column in combining marks. The
terminal replaces each of those cells with the matching part of the image.

Claude Code 2.1.278 refuses that character. Its own validator names it:

```js
var mq = {
  escape: String.raw`\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f`,
  placeholder: String.raw`\u{10eeee}`,
  loneSurrogate: String.raw`\ud800-\udfff`
};
var gq = new RegExp(`[${String.raw`\t\n\r`}${mq.escape}${mq.loneSurrogate}${mq.placeholder}...`)
```

It sits in the same rejected class as control characters and lone surrogates,
under the name `placeholder`. This is deliberate, not a misread of the
surrogate pair.

A minimal plugin confirmed it, one `Text` child at a time:

| What the text held | Result |
| --- | --- |
| ASCII, a colour, an emoji, combining marks | accepted |
| U+10EEED, U+10EEEF (either neighbour) | accepted |
| U+10EEEE alone | rejected |
| U+10EEEE with combining marks | rejected |

The neighbours passing is what rules out everything else: not the surrogate
pair, not the plane, not the combining marks, not a page title leaking in.

Recorded in `tools/stall-diagnostics/surface-probe-evidence.json`, with the
Claude Code build's sha256 beside the excerpts.

The character carries no control character in the Unicode sense, by code
point or by UTF-16 unit. "Holds no control character" and "passes this
validator" are not the same question, and only the second one decides.

## What still works

The bridge is fine. Through the whole failure `GET /state` answered 200 and
`ui.open ... placed` succeeded, so starting detached and then attaching to the
caller's console does work. What fails is the drawing after that.

## About closing

`/browser close` hides the page; it does not end anything. That is what
`Bridge.hide()` does, and the processes stay for the next open. They do end on
their own after a minute with nothing talking to them, but while Claude Code
is up its polling keeps that from happening, so they last as long as it does.

The E5 row in `windows-device-checks.md` expected them to go at once. That
expectation was wrong, not the behaviour.

## There is an API for this

`Image`, with `$.ui.blit` to swap what it shows. Its own example is this very
job:

```tsx
<Image key="view" source={{ shm: '/tb-7', format: 'rgb', width: 960,
  height: 600 }} columns={80} rows={25} alt="the page" />
```

`$.ui.blit` swaps a keyed `Image` at the frame rate, which is what a browser
pane needs.

It could not go in the old drawing location. A surface module draws with
`ClientElements`, and that is the terminal's elements **less** `Client`,
`Raster` and `Image`:

```ts
export type ClientElements = Omit<Elements['terminal'], 'Client' | 'Raster' | 'Image'>;
```

So the picture has to be drawn by the hooks module, `register.tsx`, in its
`ui.render` for the pane, rather than inside `surface.tsx`. The old render
returned a `Client` wrapping `surface.tsx`, and the surface drew the
placeholder rows and took the pointer and key events.

Moving to `Image` means splitting those two: the picture from the hooks
module, the input from a separate `Client`. The isolated check below confirms
that these can occupy the same region in Ghostty, including during continuous
image updates. Production integration results follow below.

## Isolated Image and input check

On 2026-09-20, the user tested the ignored plugin at
`tools/stall-diagnostics/image-probe/` in Claude Code 2.1.278 on Windows.
It passes a 64 by 32 image directly as base64, without a frame file or shared
memory. The image has an orange top-left block, a yellow horizontal line,
a white bottom-right block and a blue background.

- In Ghostty, `/imgprobe png` and `/imgprobe rgba` both displayed the image.
- In WezTerm, the PNG check showed the `png probe` alternative text. The
  Claude Code binary's image capability predicate accepts kitty and Ghostty,
  but not WezTerm. The extracted predicate and its results are in
  `tools/stall-diagnostics/image-capability-evidence.json`. Related work is
  tracked in https://github.com/fukuyori/wezterm/issues/1.
- `/imgprobe overlay` put an empty input `Client` above the `Image` using
  an absolutely positioned sibling Box. The image remained visible.
- Clicking the orange block produced pointer `down` and `up` messages with
  coordinates `(5, 1)`. Movement and leave events were also visible in the log.
- Pressing `a` produced `{"kind":"key","key":"a"}` while the image remained
  visible. The user then pressed Escape and ran `/imgprobe close`; the pane
  closed successfully.

The installed probe's command modes had changed to `overlay`, `under` and
`beside`; an earlier `/imgprobe input` fell through to the PNG branch and
did not test input. The confirmed input results above are from `overlay`.
The other layouts were not needed for this result.

The subsequent `/imgprobe blit` check used generated RGBA frames with a white
block moving horizontally, requesting `$.ui.blit` every 100 ms. The user
confirmed visible motion. During updates, clicking produced `down` and `up`
at `(5, 0)`, and pressing `a` produced the key event. Escape followed by
`/imgprobe close` closed the pane and logged:

```text
imgprobe-blit stopped sequence=1 accepted=1257 denied=0
imgprobe-start 2 close
```

Reopening with `/imgprobe blit` resumed visible motion. Closing it again logged:

```text
imgprobe-blit stopped sequence=3 accepted=198 denied=0
imgprobe-start 4 close
```

The counters count API acceptances, not measured displayed frames per second.
This confirms continuous image updates with pointer/key delivery and a
close/reopen/close cycle in the isolated plugin. It does not yet establish
browser input delivery through Claude Code, resizing, Japanese key input,
text selection or clipboard transfer through the new rendering path.

## Real-browser probe validation

The same ignored plugin now also registers `/browserprobe` and
`/browserprobe close`. It runs a separate browser at 512 by 512 pixels, draws
its RGBA frames through Image/blit, and forwards the overlaid Client's input.
The 32-column by 16-row probe uses fixed 16 by 32 pixel cells; it does not
test resizing. Each raw frame is 1 MiB, within Image's documented 2 MiB
inline-byte limit. This is a diagnostic adapter, not a migration of the
production `/browser` command.

`browser-host.cjs` uses Pixel's existing owner/guest transport and reads the
native engine's BGRA frame files. It copies and converts each frame to RGBA
before acknowledging it, so later reuse of the native file cannot change a
frame already held by the adapter. It sends base64 bytes to the plugin;
the terminal does not read these files. The adapter runs under its own
profile, state and temporary directories below the ignored probe directory.

On 2026-09-20, `check-browser.cjs launch` passed against the actual browser:

- A 512 by 512 browser frame contained the page's expected blue pixels.
- Pixel sampling within the page's animation track found the white block
  moving from x=53 to x=73; this was not merely a change of frame sequence.
- Mouse coordinates sent through the adapter focused the input field.
- Key events entered `abc`; a paste event delivered Japanese text. Clicking
  the page button displayed `abc日本語 2行目`. The single-line HTML input
  replaced the pasted newline; this is not a clipboard/newline acceptance test.
- Closing the adapter stopped its detached host and browser processes.
- The plugin type check passed. The detached launch route was exercised.

Evidence is under
`tools/stall-diagnostics/image-probe/browser-run-zgw3lQ/` (raw first/final
frames, results, close status and browser log). These checks exercised the
native browser and adapter without Claude Code. At that point manual
display/input/close checks in Claude Code on Ghostty were still pending.

The first manual launch reported `Unknown command: /browserprobe`. A debug
launch of Claude Code 2.1.278 established that `hooks.json.modules` accepts
only one entry; the two-module probe was refused before command registration.
Subsequent runtime checks also rejected duplicate unfiltered `session.start`
handlers and passing `$` to a helper imported from another file. The probe
now has one registration file, one session-start handler and one message
handler. The type checker alone had not caught these runtime restrictions.

After this correction, a real Claude Code startup logged
`$.command.register (tb-image-probe): /browserprobe listed`.
`/browserprobe close` executed, and `/browserprobe` launched the adapter and
received its first 512 by 512 frame. The automation terminal was identified
as WezTerm, so Image/blit was denied by the known capability check; this does
not establish Ghostty display. The close command then stopped the adapter.
Debug evidence is in the ignored probe directory's `registration-debug.log`
and `registration-fixed*.log`.

After restarting in Ghostty, the user confirmed that `/browserprobe` displayed
the real page, clicking its field allowed `abc` to be entered, clicking Apply
displayed `abc`, and the white block kept moving. Japanese IME input did not
pass: the user could enter one converted character at a time, but could not
commit multiple characters together.

Inspection found that the probe's key mapper discarded every multi-character
string except named special keys. It now preserves such text using the native
host's paste event, while keeping single-character and special-key events.
The native-browser test feeds `日本語テスト` through this same mapper and
verifies the page result equals `abc日本語テスト`; it passed, as did mapper
checks and type checking. Evidence is in `browser-run-T2RGXG/` under the probe.
This was synthetic committed text, not a physical IME test. The probe also
logs the raw Client key and its mapped event for the manual check below.

### Ghostty manual result after the input fix

On 2026-09-20 the user restarted Claude Code with the corrected probe and
confirmed:

- The real page displayed and its animated white block continued moving.
- IME conversion could commit a whole Japanese phrase; clicking Apply
  displayed the complete phrase below the button.
- Selecting `日本語のコピー` and `2行目のテキスト` together and pasting into
  Notepad preserved both Japanese lines and their line break.
- Closing the pane, reopening it, and entering `再開テスト` worked. The
  animated white block moved again after reopening. The second close worked.

The actual Client log records `日` as one key event followed by
`本語入力テスト` as a multi-character event. After the fix the latter was
forwarded as paste. On reopening, it records `再` followed by `開テスト`,
again forwarded without dropping the multi-character tail. These logs
explain why the earlier mapper left only the first character.

The close counters were:

```text
browserprobe stopped generation=1 accepted=1198 denied=0
browserprobe stopped generation=2 accepted=493 denied=0
```

These are Image API acceptances, not measured frame rates. The adapter's
`closed.json` records browser exit 0 and no error for both runs. A subsequent
process check found neither host nor browser PID alive. The evidence is in
`browser-run-bM9jLd/`, `browser-run-7NWZb6/`, `manual-ime-and-close.log` and
`manual-close-check.json` under the ignored probe directory.

This establishes display, input including multi-character IME, multiline
Japanese clipboard transfer, and close/reopen for the fixed-size diagnostic
adapter on Ghostty. Group E for the production command remains open. The diagnostic
adapter stops its processes on close, unlike the production bridge's
hide-and-reuse behavior specified by E5.

## Production migration

The working tree now uses the same Image/Client separation in the production
plugin. `surface.tsx` only handles size and input; the rejected placeholder
generator was removed. The shared production input mapper preserves
multi-character commits and sub-cell pointer coordinates.

The bridge now implements Pixel's existing file-frame host protocol, requests
RGBA, copies files before acknowledging them, and publishes sequence/size
metadata through `/state` and inline image bytes through `/frame`. Native frame
files are restricted to the host's temporary directory and validated for size.
PNG normally retains full resolution. Frames exceeding 2048 pixels on a side
or 2 MiB compressed use reduced RGBA bounded by those same limits; pointer
coordinates refer to the original viewport. In-flight old-size frames are
discarded after a resize. Polling is serialized and stale responses after a
pane close/reopen are ignored. Image refusal is displayed as an error.

Pixel's `packages/pixel/src/root.tsx` now recognizes `PIXEL_EMBED_FRAMES=1` to
deliver frames to the host instead of writing graphics to the caller's TTY.
No native rebuild was needed. This local Pixel change is not committed, and
`pixel.commit` still names `7dd82824000cf93f2f57b63efa3baa78d6062dbc`; that pin
alone does not reproduce the new mode. Both Pixel changes were later committed and
`pixel.commit` now names `5bb53b956ec2b9d1373e56f8c0c8869a720668bd`. The local TypeScript build and installed
file dependency were refreshed for these checks. The pre-existing Pixel
clipboard change was left intact.

`tools/stall-diagnostics/check-e-production.cjs` exercises the production
bridge and real browser. It passed at 48x24, 90x40, 32x16 and 150x35 cells;
each resize was followed by pointer focus, Japanese input through the
production mapper, and a button click verified in the DOM. The first three
used PNG; the largest used 2,093,008 RGBA bytes after reduction. Two
hide/reopen cycles preserved page contents and accepted new Japanese input.
The bridge exited after the explicit shutdown. Evidence is in
`tools/stall-diagnostics/e-production-run-HqbZos/`, including `normal.png` and
`results.json`. The decoded PNG was also visually inspected.

A Claude Code 2.1.278 startup loaded the production plugin, registered
`/browser`, opened its pane and fetched real frames. The automation terminal
was identified as WezTerm, so the known Image capability refusal was shown;
this is not a Ghostty rendering pass. Evidence is in
`tools/stall-diagnostics/production-plugin-debug.log`. After closing the
pane and exiting that Claude session, the bridge disappeared after its idle
period.

Checks: store 8 passed, browser 32 passed, CLI 27 passed / 1 clipboard test
skipped. New regression checks cover frame-file ownership and copying before
acknowledgement, PNG pixel preservation, incompressible/oversized frame bounds,
IME chunks and pointer fractions. Plugin type checking and the Pixel
TypeScript build passed. Production Ghostty E1-E5 and visual resizing are
still pending; the earlier diagnostic passes do not replace them.

The subsequent production Ghostty check displayed Example Domain, followed
its link on a mouse click, and opened `d4-manual-input.html`. Actual IME input
then failed: the user reported the first character disappearing and the rest
appearing twice. The screenshot shows `語入力テスト語入力テスト` in the input.
This does not establish which layer dropped or repeated text. Input logging
was not enabled for that run, so the next check must capture the events
received by the production bridge. E2 remains incomplete despite the earlier
injected-input checks passing.

After restarting with `CC_BROWSER_DEBUG=1`, two physical IME attempts
produced the correct DOM value `日本語入力テスト`. Both bridge batches contained
one key event for `日` followed by one paste event for `本語入力テスト`.
For the second attempt, page event tracing also confirmed a single insertion
of each part. Before that commit, `ni` was typed and removed with Backspace,
so this run did not test replacing selected text directly with an IME commit.
Evidence is in `tools/stall-diagnostics/production-ime-retries.log` and
`production-ime-retry-dom.json`. No input behavior was changed between the
failure and these retries; the original missing/duplicated text remains
unexplained and must not be marked fixed.

A third attempt directly replaced the selected text with `再入力テスト`.
The user confirmed replacement, and DOM tracing showed `再` replacing the
selection once, followed by one paste of `入力テスト`. The bridge received
the same two parts once. Evidence: `production-ime-replacement-dom.json`
in the same diagnostic directory. The initial failure remains unresolved.

The Apply button then displayed `再入力テスト`. Selecting that output and
pasting into Notepad produced `慌eQ娚ﾆ0ｹ0ﾈ0`. The bridge logged one clipboard
message of six characters. Independently sending `再入力テスト` through the
existing writer reproduced the exact corruption: BOM-less UTF-16 passed to
`clip.exe` was decoded incorrectly. The older, longer Japanese test string
did not expose this. Adding a BOM avoided the corruption but retained U+FEFF
in the clipboard, so that alternative was rejected. Evidence:
`production-clipboard-encoding.json` in the diagnostic directory.

The writer now invokes a fixed PowerShell script that explicitly decodes
UTF-8 from stdin and calls `Set-Clipboard`; copied text is never interpolated
into the script. Empty text clears the clipboard. The regression test sends
copy requests through the actual bridge and reads back the Windows clipboard.
It failed before the fix with the exact reported corruption, then passed for
the short Japanese string, multiline text including a trailing newline, ASCII,
emoji, shell metacharacters and empty text. Comparisons are exact, without
trimming or normalizing line endings. The original clipboard text was restored.
With `TB_TEST_CLIPBOARD=1`, all 28 CLI tests passed, with no skips. Restarting
the production plugin and repeating the Notepad check is still required.

On that restart, input and Apply were reported successful, but dragging the
output was not. The bridge received mouse down, left-button movement and up;
no new clipboard message followed. At inspection, `/state` reported
`alive:false`, `frame:null`, `error:null`, the browser registry was empty,
and the browser process was absent. Its exit time and cause were not recorded,
so this does not establish whether it exited before or during the drag.
Evidence: `production-drag-failure-state.json`.

The plugin had retained its cached Image when bridge frames disappeared.
It now drops that image and reports a stopped browser when alive changes to
false. The bridge also reports an unrequested zero-code exit as stopped and
logs all child exits and frame disconnections. Two regression tests execute
the production plugin handlers for a stopped browser and a temporary frame
loss, including recovery of a new frame. CLI: 29 passed, 1 clipboard test
skipped; plugin type checking passed. A controlled real-browser termination
reported no frame and an explicit stopped error; its attached CLI exited 0.
That controlled exit is not a reproduction of the user's unexplained exit.
Evidence: `e-production-run-lmCyQy/browser-exit.json`. E3's manual retest is
blocked at that point on restoring a live browser and checking drag selection.

After another restart, the user confirmed input, Apply, drag selection and
Notepad paste of `再入力テスト` without corruption. E3's production manual
retest passed. The bridge logged the final six-character selection at
2026-09-20T13:07:58.376Z; browser `30408-1` was still live at inspection.
Multiline copying (E4) then passed in the production `/browser`: the user
selected the two Japanese lines on `image-probe/browser-page.html` and
confirmed Notepad preserved both their text and the line break. Close/reopen
(E5) then passed: the pane closed, reopened with the animation running, and
accepted `再開テスト` through the physical IME. The registry still showed
browser `30408-1`, confirming reuse. Visual resizing remains pending.
These passes do not resolve the earlier IME duplication or unexplained exit.

Shrinking the Ghostty window kept the animation running, and clicking Apply
still displayed `再開テスト`. Enlarging it again left only `Loading browser…`.
Unlike the earlier stopped browser, this browser remained alive without an
error. Two bridge samples 300 ms apart showed frame sequences 14523 and 14542,
both still at the smaller 49x35-cell size. Evidence:
`production-resize-stall-state.json` and `production-resize-stall.png`.

The Client posted sizes during render and input during its timer. Claude's
`ClientSurface.post` contract says a later post in the same frame replaces an
undelivered one. A regression executing the production Client with that
documented behavior reproduced a lost resize when a pointer tick followed it.
The Client now posts size and input together from one timer, and the hook
forwards a changed size before its accompanying input. Checks also cover
resize without input, rejection of old-size frames, and rendering a new-size
frame. CLI: 30 passed, 1 clipboard test skipped; plugin type checking passed.
The bridge now logs requested size changes in debug mode. This proves the
notification defect in a controlled reproduction; the physical enlarge/shrink
retest is still required to establish that it resolves the reported stall.

The subsequent physical retest passed: the user confirmed animation before
shrinking, after shrinking and after enlarging again, without the Loading
stall. Bridge logs show 89x53 -> 49x35 -> 89x53 cells, with the final resize
received at 2026-09-20T13:18:31.345Z. Evidence:
`production-resize-retest.log`. After enlargement, the user entered
`サイズ変更テスト` through the IME and clicked Apply; the same text appeared
below the button. Browser `31764-1` remained live at inspection. The resize
and subsequent input checks passed; this single cycle does not resolve the separate
earlier IME duplication or unexplained exit.

After the final pane close and Claude session exit, the bridge (38976), its
attached CLI (32676) and browser (31764) all disappeared. The bridge recorded
its intentional shutdown at 2026-09-20T13:22:04Z; no tracked process remained
at 13:22:06Z. Evidence: `production-session-exit.json`.

Further controlled testing reproduced the exact IME symptom without requiring
another physical attempt: `日本` followed by `語入力テスト` produced
`語入力テスト語入力テスト` through the production mapper, bridge and browser.
Both multi-character commits had been mapped to paste events. Pixel wrote
each string to the shared clipboard and requested asynchronous pastes, allowing
the second string to replace the first before it was read. Evidence:
`e-production-run-AXg4Cf/ime-chunks.json`. The original failing physical run
had no input trace, so its precise chunk boundaries remain unknown.

Multi-character commits now use Pixel's existing `unknown` key with a `text`
payload, which reaches Electron `insertText` without the clipboard. Repeated
checks exposed a second ordering defect: unawaited insertions could replace
one another while replacing selected text (`e-production-run-XvvP3P/ime-chunks.json`).
Pixel's `packages/pixel/src/web/input.ts` now waits for focus and insertion
completion before dispatching the next key. Two Pixel regression tests cover
ordering, subsequent keys and recovery after a rejected insertion.

With both changes, four chunk patterns repeated three times passed against
the real browser. Four resized viewports and two hide/reopen input checks also
passed, for 18 recorded input cases. Each commit preserved the clipboard in
the final run (`e-production-run-opztL3/ime-chunks.json`); an earlier whole-run
clipboard comparison included mouse-selection operations, so it was replaced
by before/after comparisons around each commit. CLI: 31 passed, 1 clipboard
test skipped; plugin type checking, Pixel TypeScript build and two Pixel input
tests passed. This adds a second required local Pixel change beyond
`PIXEL_EMBED_FRAMES`; `pixel.commit` still does not include either change.
It does as of `5bb53b956ec2b9d1373e56f8c0c8869a720668bd`.
The physical IME retest then passed: the user entered `日本語入力テスト` and
replaced it using Ctrl+A with `再入力テスト`, with no missing or duplicated text.
The bridge logged a single-character key followed by `key:unknown` text in
each case, confirming use of the corrected insertion path rather than paste.
Evidence: `production-ime-final-manual.log` at 2026-09-20T13:33:05Z and
13:33:26Z. The unexplained earlier browser exit is independent of these
insertion results and remains open.

The final physical-IME session closed its pane and exited Claude. Bridge
8168, attached CLI 30352, browser 36480 and console process 37852 were gone
by 2026-09-20T13:36:06Z. Its shutdown was logged as intentional. Evidence:
`production-final-session-exit.json`. This is the second observed clean
session-exit cleanup; it does not explain the earlier unexpected exit.

## What is not known

- Whether this is Windows only. Nothing here is platform specific, and the
  same Claude Code build on another OS has not been tried. It cannot be called
  a Windows problem yet.
- Which Claude Code version started refusing it, and whether the plugin ever
  drew on this one.
- How the production PNG/RGBA transport performs during sustained use in
  Claude Code on Ghostty. Larger frames, resizing and the inline-byte limit
  passed controlled checks, but visual quality and responsiveness still need
  manual confirmation. The type definitions restrict `shm` to POSIX terminals.
- Whether the updated production plugin consistently preserves actual IME input
  and pointer alignment during visual resizing.
  Single-line and multiline Japanese copying passed manually after the encoding fix; the
  split-commit failure now has a controlled reproduction and fix, and its
  physical IME retest passed. Longer use has not been established by these checks.

## Next

Group E stays open. The Image/Client diagnostic adapter has passed the manual
checks above, and the production migration has passed controlled integration
checks. Production E1, E3, E4, close/reopen, resizing and input after resizing
now pass manually, as do session-exit cleanup and the corrected split IME
commits. The earlier unexplained browser exit remains open.

This is a compatibility problem between the plugin's way of drawing and this
build of Claude Code, not a fault placed on either. Whether the same Claude
Code refuses it on macOS or Linux has not been tried, so it is not known to
be a Windows problem, and the plugin has not been shown to be wrong anywhere
else. Saying whose to fix it is would be ahead of what has been seen.

What would settle it:

- Run the same plugin against Claude Code 2.1.278 on another OS. If it is
  refused there too, the drawing method and this build simply disagree.
- Find which Claude Code version began refusing U+10EEEE, and whether the
  plugin drew on the one before it.
