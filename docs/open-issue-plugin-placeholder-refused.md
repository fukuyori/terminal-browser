# Claude Code refuses the character the plugin draws with

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

`claude-code-plugin/hooks/placeholders.ts` draws with U+10EEEE, the kitty
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

It cannot go where the drawing is now. A surface module draws with
`ClientElements`, and that is the terminal's elements **less** `Client`,
`Raster` and `Image`:

```ts
export type ClientElements = Omit<Elements['terminal'], 'Client' | 'Raster' | 'Image'>;
```

So the picture has to be drawn by the hooks module, `register.tsx`, in its
`ui.render` for the pane, rather than inside `surface.tsx`. Today that render
returns a `Client` wrapping `surface.tsx`, and the surface draws the
placeholder rows and takes the pointer and key events.

Moving to `Image` means splitting those two: the picture from the hooks
module, the input from somewhere that still receives it. How the second half
is meant to work is not yet known.

It is a candidate, not an answer. Nothing has been tried, and two things have
to hold before it is one: that a frame can reach `Image` on Windows, and that
input still finds the page once the drawing leaves the surface module.

## What is not known

- Whether this is Windows only. Nothing here is platform specific, and the
  same Claude Code build on another OS has not been tried. It cannot be called
  a Windows problem yet.
- Which Claude Code version started refusing it, and whether the plugin ever
  drew on this one.
- Where the frames would come from for `Image`. The bridge hands the engine a
  frame file today; `{ file, format }` and `{ shm, format, width, height }`
  are both accepted sources, so one of them may already fit.
- How input reaches the page once the drawing leaves `surface.tsx`.

## Next

Group E stays open. It stops at "the bridge starts and answers; the drawing
does not reach the pane".

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
