/* @jsx h */
import type { ClientSurface } from 'claude-code'
import { keyEvent, pointerEvent, type InputEvent } from './input.ts'

type State = { ready: boolean }

export default function Browser(_props: unknown, surface: ClientSurface<State>) {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ ready: true })
    const queue: InputEvent[] = []
    let sentCols = 0
    let sentRows = 0
    surface.onPointer(event => {
      const mapped = pointerEvent(event)
      if (mapped) queue.push(mapped)
    })
    surface.onKey(event => {
      const mapped = keyEvent(event)
      if (mapped) queue.push(mapped)
    })
    surface.every(20, () => {
      const cols = Math.min(surface.columns, 255)
      const rows = Math.min(surface.rows, 255)
      if (cols <= 0 || rows <= 0 || (cols === sentCols && rows === sentRows && !queue.length)) return
      surface.post({ type: 'surface', cols, rows, events: queue.splice(0) as unknown as never })
      sentCols = cols
      sentRows = rows
    })
  }
  return <Box flexDirection="column" height="100%" />
}
