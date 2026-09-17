/* @jsx h */
import type { EngineInterface, Register } from 'claude-code'
import type { Browser } from './browser'
import type { Props as SurfaceProps } from './surface.tsx'
import { normalizeUrl } from './urls.ts'
import {
  isBridgeState,
  isInputMessage,
  isLaunchReport,
  isSizeMessage,
  takenTexts,
  type BridgeState,
} from './bridge-protocol.ts'



const PANE = 'browser'
const OPEN_TOOL = 'mcp__terminal-browser__open'
const CLOSE_TOOL = 'mcp__terminal-browser__close'
const START_URL = 'terminal-browser://start'
const SETUP_URL = 'https://github.com/zenbu-labs/terminal-browser/tree/main/claude-code-plugin#setup'
const POLL_MS = 250
const IDLE_POLL_MS = 600


const state = {
  port: null as number | null,
  token: null as string | null,
  open: false,
  pendingUrl: null as string | null,
  region: null as { cols: number; rows: number } | null,
  last: null as BridgeState | null,
  stopPolling: null as (() => void) | null,
  // a hack to programatically trigger agent input focus
  viewGeneration: 0,
}

const bridgeUrl = (path: string) => `http://127.0.0.1:${state.port}${path}`
const authHeaders = () => ({ authorization: `Bearer ${state.token}` })
const viewKey = () => `view${state.viewGeneration}`


async function terminalBrowserCommand($: EngineInterface): Promise<string[]> {
  const checkoutCli = `${$.plugin.root}/../cli/dist/main.js`
  if (await $.fs.exists(checkoutCli)) return ['node', checkoutCli] // dev case
  return ['terminal-browser']
}

async function startBridge($: EngineInterface): Promise<{ ok: true } | { ok: false; error: string }> {
  const command = await terminalBrowserCommand($)
  let report: unknown = null
  try {
    const { stdout, stderr, exitCode } = await $.process.run([...command, 'claude-bridge', 'launch'], { timeoutMs: 20_000 })
    const line = stdout.split('\n').find((text: string) => text.startsWith('{'))
    report = line ? JSON.parse(line) : { error: stderr.trim() || `exit ${exitCode}`, code: 'start' }
  } catch (err) {
    report = { error: String(err), code: 'start' }
  }
  if (!isLaunchReport(report)) return { ok: false, error: 'terminal-browser could not start' }
  if ('port' in report) {
    state.port = report.port
    state.token = report.token
    startPolling($)
    return { ok: true }
  }
  const error =
    report.code === 'version'
      ? `${report.error} · setup: ${SETUP_URL}]`
      : `terminal-browser could not start: ${report.error}]`
  return { ok: false, error }
}

async function post($: EngineInterface, path: string, body: unknown): Promise<unknown> {
  if (state.port === null) return null
  try {
    const response = await $.http.fetch(bridgeUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    return response.ok ? JSON.parse(response.text || '{}') : null
  } catch {
    return null
  }
}

async function fetchState($: EngineInterface): Promise<BridgeState | null> {
  if (state.port === null) return null
  try {
    const response = await $.http.fetch(bridgeUrl('/state'), { headers: authHeaders() })
    const parsed: unknown = response.ok ? JSON.parse(response.text) : null
    return isBridgeState(parsed) ? parsed : null
  } catch {
    return null
  }
}


async function openBrowser($: EngineInterface, raw: string | null): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (state.port === null) {
    const started = await startBridge($)
    if (!started.ok) return started
  }
  const alive = state.last?.alive === true
  const url = raw ? normalizeUrl(raw) : (alive && state.last?.url ? state.last.url : START_URL)
  const wasOpen = state.open
  state.pendingUrl = url
  state.open = true
  await $.ui.open({ id: PANE, title: 'browser', focus: true, rows: 24 })
  $.ui.invalidate('ui.render')
  if (state.region) {
    state.pendingUrl = null
    await post($, '/open', { url, ...state.region })
  }
  if (!wasOpen) startPolling($)
  return { ok: true, url }
}

async function closeBrowser($: EngineInterface): Promise<boolean> {
  if (!state.open) return false
  await $.ui.close({ id: PANE })
  return true
}

async function browserClosed($: EngineInterface): Promise<void> {
  state.open = false
  state.pendingUrl = null
  state.region = null
  // hides the pane but keeps the browser (and its tabs) alive for an instant
  // resume; the poll keeps state.last (alive, url, placed) current
  await post($, '/browser/close', {})
  if (state.port !== null) startPolling($)
}

function startPolling($: EngineInterface): void {
  state.stopPolling?.()
  const timer = $.clock.every(state.open ? POLL_MS : IDLE_POLL_MS, () => {
    void poll($)
  })
  state.stopPolling = () => timer.cancel()
}

async function poll($: EngineInterface): Promise<void> {
  const fresh = await fetchState($)
  if (!fresh) return
  if (fresh.inbox > 0) await deliverAgentText($)
  const previous = state.last
  state.last = fresh
  if (!state.open) return
  const changed =
    !previous
    || JSON.stringify(previous.placed) !== JSON.stringify(fresh.placed)
    || previous.title !== fresh.title
    || previous.alive !== fresh.alive
    || previous.error !== fresh.error
  if (!changed) return
  $.ui.invalidate('ui.render')
  if (fresh.title) await $.ui.open({ id: PANE, title: fresh.title.slice(0, 40) })
}


async function deliverAgentText($: EngineInterface): Promise<void> {
  const lines = takenTexts(await post($, '/inbox/take', {}))
    .filter(text => text.trim() !== '')
    .map(text => `> ${text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()}`)
  if (lines.length === 0) return
  const { isFilled } = await $.prompt.fill({ text: `${lines.join('\n')}\n` })
  if (!isFilled) {
    // would need to see a case this happens before shipping
    // $.ui.toast('copied to clipboard')
    return
  }
  state.viewGeneration += 1
  $.ui.invalidate('ui.render')
}

function surfaceProps(cols: number, rows: number): SurfaceProps {
  const last = state.last
  return {
    placed: last?.placed ?? null,
    cols,
    rows,
    title: last?.title ?? '',
  }
}


export const register: Register = (on, options) => {
  const agentToolEnabled = options.agentTool === true

// this is a hack because the plugin api does not allow $ or the result of next to be passed to functions
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    const servedByHooks = () => { throw new Error('the browser noun is served by its hooks') }
    const browser: Browser = { open: servedByHooks, close: servedByHooks }
    return { ...built, browser }
  })

  on('browser.open', async ($, e) => {
    const opened = await openBrowser($, e.url ?? null)
    return { value: opened }
  })

  on('browser.close', async ($) => {
    return { value: await closeBrowser($) }
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    let surfaces: readonly string[] = []
    try {
      surfaces = await $.session.surfaces()
    } catch {}
    if (!surfaces.includes('terminal')) return r
    await $.command.register({
      name: 'browser',
      description: 'Open a browser to the right',
      argumentHint: '[url]',
      immediate: true,
    }).catch(err => $.ui.log(`terminal-browser: /browser not registered: ${err}`))
    if (agentToolEnabled) {
      await $.tool.register({
        name: 'open',
        description: 'Open terminal-browser directly inside claude code. Control the open page with the terminal-browser action CLI.',
        inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The page to open, as a full url or a host name' } } },
      }).catch(err => $.ui.log(`terminal-browser: open tool not registered: ${err}`))
      await $.tool.register({ name: 'close', description: 'Close the terminal-browser pane.' }).catch(err => $.ui.log(`terminal-browser: close tool not registered: ${err}`))
    }
    return r
  })

  on('command.run', { command: 'browser' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'close' || (!arg && state.open)) {
      await closeBrowser($)
      return { text: 'Closed terminal-browser' }
    }
    const opened = await openBrowser($, arg || null)
    return { text: opened.ok ? 'Opened terminal-browser' : opened.error }
  })

  on('tool.call', { tool: OPEN_TOOL }, async ($, e) => {
    const url = (e as { url?: unknown }).url
    const opened = await openBrowser($, typeof url === 'string' ? url : null)
    if (!opened.ok) return { deny: `could not open the browser: ${opened.error}` }
    return { result: [{ type: 'text', text: `opened ${opened.url} ` }] }
  })

  on('tool.call', { tool: CLOSE_TOOL }, async ($) => {
    const closed = await closeBrowser($)
    return { result: [{ type: 'text', text: closed ? 'browser pane closed' : 'no browser pane was open (maybe the user closed it?)' }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Box } = await $.ui.resolve(e)
      return <Box />
    }
    const { Box, Client } = await $.ui.resolve(e)
    const rows = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : Math.max(8, (e.viewport?.rows ?? 30) - 8)
    const cols = Math.max(1, e.props.bodyColumns > 0 ? e.props.bodyColumns : (e.viewport?.columns ?? 80))
    return (
      <Box flexDirection="column">
        <Client key={viewKey()} module="./surface.tsx" width={cols} height={rows} props={surfaceProps(cols, rows)} />
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || state.port === null) return next(e)
    if (isSizeMessage(e.data)) {
      state.region = { cols: e.data.cols, rows: e.data.rows }
      if (state.pendingUrl) {
        const url = state.pendingUrl
        state.pendingUrl = null
        await post($, '/open', { url, ...state.region })
      } else {
        await post($, '/size', state.region)
      }
    } else if (isInputMessage(e.data)) {
      await post($, '/input', { events: e.data.events })
    }
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    await browserClosed($)
    return r
  })
}
