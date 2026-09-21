# terminal-browser claude code plugin

> This plugin is experimental and does have some [known limitations](#caveats)




https://github.com/user-attachments/assets/a79e7667-6fcb-49a4-9967-44d0f942102c



## Installation

For the local Windows fork under development, use Ghostty and load this checkout
for the session. The Image migration requires the matching local Pixel build;
the upstream marketplace does not supply these uncommitted changes.

```powershell
$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
claude --plugin-dir D:\home\source\rust\terminal-browser\claude-code-plugin
```

Then run `/browser` in Claude Code. `/browser close` hides the pane and keeps
the browser for reuse. The bridge exits after 60 seconds without requests;
Claude Code continues polling while the session is running.

Install terminal-browser
```
curl -fsSL https://terminal-browser.sh/install | bash # or brew install terminal-browser
```

Ensure you are on the latest version of claude code
```
claude update
```

Enable claude code UI plugins by adding this to `~/.claude/settings.json`:
```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
}
```




Install the terminal-browser plugin
```
# set the marketplace
claude plugin marketplace add zenbu-labs/terminal-browser

# install the plugin
claude plugin install terminal-browser@terminal-browser
```

Now you can run "/browser" inside claude code to open the browser

### Updating

Update the claude code plugin
```
claude plugin update terminal-browser@terminal-browser
```

Update terminal-browser
```
terminal-browser upgrade
```

### Configuration

You can configure the terminal-browser plugin to include a tool that claude can use to open the browser. This is by default off, since claude can already use the `terminal-browser` CLI to open the browser inside the terminal through a split pane. You can enable the tool by adding the following to your ` ~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "terminal-browser@terminal-browser": {
      "options": {
        "agentTool": true
      }
    }
  }
}
```


## terminal-browser plugin API

The terminal-browser plugin comes with an API you can use within another claude code plugin to programatically open the browser and load a URL. Some examples of useful plugins you can build with this are:
- `/tldraw` slash command that opens tldraw in the claude code split pane
- `/open-pr` slash command that opens the PR associated with the branch you are working on

```typescript
export type BrowserOpenInput = { url?: string }

export type BrowserOpenResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

export type Browser = {
  open: (input: BrowserOpenInput) => Promise<BrowserOpenResult>
  close: (input?: Record<string, never>) => Promise<boolean>
}

// usage: in your plugin's hooks module
on('command.run', { command: 'tldraw' }, async ($) => {
  const result = await $.browser.open({ url: 'https://www.tldraw.com/' })
  return { text: result.ok ? 'Opened tldraw' : result.error }
})
```

## How does it work?

The hooks module renders an `Image` and overlays an empty `Client` for pointer
and key input. `ui.blit` updates the Image; the plugin no longer puts Kitty
placeholder characters into Client text. Claude Code owns the terminal graphics
output. The detached bridge receives browser frames through Pixel's host
connection, copies each frame before acknowledging it, and serves it over
authenticated loopback HTTP.

The plugin polls every 100 ms while open. Frames are encoded as PNG when they
fit the 2 MiB inline Image limit and 2048-pixel dimension bound. Otherwise a
reduced RGBA image fits those bounds. Input coordinates still map to the full
browser viewport, so a larger view can look less sharp without changing where
clicks land. The pane is limited to 255 columns and rows; actual update rate
depends on browser, encoding and terminal performance.

terminal-browser's internals have been extracted to a javascript library - https://github.com/zenbu-labs/pixel - if you would like to build your own graphical application inside claude code/the terminal


## Supported terminals

The terminal-browser claude code plugin will only work in terminals that support the [kitty graphics protocol], and implement [kitty unicode placeholders](https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders). The most popular terminals that support this feature are:
- [ghostty](https://ghostty.org)
- [kitty](https://sw.kovidgoyal.net/kitty/)

If your terminal does not support the required features, trying to open the browser inside claude code may garble the TUI

In addition any terminals that are built on libghostty will support this feature, some examples are:
- [cmux](https://cmux.com/)
- [supacode](https://supacode.sh/)

You can find more libghostty based terminals here: [awesome-libghostty](https://github.com/Uzaaft/awesome-libghostty)

Even if your terminal supports the required graphics feature, if you are running a multiplexer, the plugin may not work. This is because multiplexers rewrite the output of terminal programs and breaks terminal graphics commands. tmux support will be arriving soon (terminal-browser currently works in tmux, just not through the claude code plugin yet), and within herdr performance is very bad when running through the claude code plugin, but will likely improve soon. Other multiplexers I have not tested, so if it does not work please file an issue and I will see if we can support this.




## Caveats:
- depends on your terminal supporting the [kitty graphics protocol]
- the Image path is validated in the diagnostic plugin on Ghostty with Claude Code 2.1.278; the production `/browser` still needs its manual device checks
- WezTerm is rejected by the Image capability check in the tested Claude Code build; see [the investigation](../docs/open-issue-plugin-placeholder-refused.md)
- pointer fractions are used when Claude Code supplies them; otherwise input targets the centre of the terminal cell
- the plugin needs to make fetch requests to a local http server to communicate with the terminal-browser CLI, which may cause a prompt to show in your OS that your terminal wants to access the local network
- claude code sets a very high min width for the chat area, so its sometimes not possible to resize the browser to the size you want
- the plugin depends on the experimental function hooks claude code API, which is unstable, so the plugin may break between releases

## Diagnosing an unexpected exit

The CLI, daemon and bridge write `lifecycle-<pid>-<run>.jsonl` files in the
installation's `LOGS_DIR` automatically, without enabling input debugging.
Each record has a UTC timestamp, PID, parent PID and process-run identifier.
CLI session records also identify the daemon PID and session; the bridge
records the PID of its attached CLI child.

For a development checkout, locate the directory from its root:

```powershell
node -p "require('./store/dist/paths.js').LOGS_DIR"
```

By default it is under `~/.local/state/terminal-browser-dev-<id>/logs` for a
checkout and `~/.local/state/terminal-browser-<id>/logs` for an installed copy.
`XDG_STATE_HOME` changes the base directory. Preserve the lifecycle files,
`stderr.log`, and `~/.terminal-browser/logs/claude-code-plugin-bridge.log`
before restarting after a failure. See the [exit investigation](../docs/open-issue-plugin-placeholder-refused.md#exit-logging-on-2026-09-21)
for how to distinguish the recorded paths.

Lifecycle records omit command arguments, URLs, authentication tokens, input
and clipboard contents. Existing debug/stderr logs have separate contents.
They record shutdown requests and exits, not every frame. A forced process
termination or machine failure may prevent the final record; a missing exit
record alone does not prove a crash. Failure to write a lifecycle log does
not stop the application.

Each process keeps two generations: `lifecycle-<pid>-<run>.jsonl` and
`lifecycle-<pid>-<run>.1.jsonl`, each at most 1 MiB. Rotation replaces the
previous generation before appending a complete record to a new current file.
A single oversized record is replaced by a small size-only diagnostic entry.
Preserve both generations when investigating a failure.

Logs belonging to stopped processes are kept for at most seven days since
their last write, with an additional limit of 128 files and 32 MiB combined.
Oldest files are removed first; both generations count toward these limits.
Cleanup runs on the first write, on later writes at most once per minute,
and during normal process exit. After a forced termination, the next writer
performs cleanup. No background cleanup process is started.

Files belonging to live PIDs, or PIDs whose status cannot be established, are
protected and excluded from the stopped-process limits. PID reuse therefore
may delay cleanup of an older run. Only recognized lifecycle filenames that
are regular files are removed; other logs, directories and symbolic links
are left alone. Failed cleanup is retried on a subsequent cleanup pass.
If rotation fails, the pending record is dropped rather than growing the file
past its limit; subsequent writes retry rotation.

[kitty graphics protocol]: https://sw.kovidgoyal.net/kitty/graphics-protocol/
