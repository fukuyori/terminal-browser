// we cannot use libraries inside the claude code sandbox, hence this gross code


export type Placed = { imageId: number; cols: number; rows: number }

export type BridgeState = {
  placed: Placed | null
  title: string
  url: string | null
  alive: boolean
  error: string | null
  inbox: number
}

export type LaunchReport =
  | { port: number; token: string }
  | { error: string; code: 'tty' | 'start' }

export type SizeMessage = { type: 'size'; cols: number; rows: number }
export type InputMessage = { type: 'input'; events: unknown[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const isBridgeState = (value: unknown): value is BridgeState =>
  isRecord(value) && typeof value.alive === 'boolean' && 'placed' in value

export const isLaunchReport = (value: unknown): value is LaunchReport =>
  isRecord(value) && (typeof value.port === 'number' || typeof value.error === 'string')

export const isSizeMessage = (data: unknown): data is SizeMessage =>
  isRecord(data) && data.type === 'size' && Number.isInteger(data.cols) && Number.isInteger(data.rows)

export const isInputMessage = (data: unknown): data is InputMessage =>
  isRecord(data) && data.type === 'input' && Array.isArray(data.events)

export const takenTexts = (value: unknown): string[] =>
  isRecord(value) && Array.isArray(value.texts) ? value.texts.filter((t): t is string => typeof t === 'string') : []
