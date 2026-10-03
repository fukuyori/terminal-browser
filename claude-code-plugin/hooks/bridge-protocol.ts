// we cannot use libraries inside the claude code sandbox, hence this gross code


import type { ImageSource } from 'claude-code'

export type FrameInfo = { sequence: number; cols: number; rows: number }
export type Frame = FrameInfo & { source: ImageSource }

export type BridgeState = {
  frame: FrameInfo | null
  title: string
  url: string | null
  alive: boolean
  error: string | null
  inbox: number
}

export type LaunchReport =
  | { port: number; token: string }
  | { error: string; code: 'tty' | 'start' }

export type SurfaceMessage = { type: 'surface'; cols: number; rows: number; events: unknown[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const isBridgeState = (value: unknown): value is BridgeState =>
  isRecord(value) && typeof value.alive === 'boolean' && 'frame' in value

export const isFrame = (value: unknown): value is Frame => {
  if (!isRecord(value) || !Number.isSafeInteger(value.sequence) || !Number.isInteger(value.cols) || !Number.isInteger(value.rows) || !isRecord(value.source)) return false
  const source = value.source
  return typeof source.png === 'string' || (typeof source.rgba === 'string' && Number.isInteger(source.width) && Number.isInteger(source.height))
}

export const isLaunchReport = (value: unknown): value is LaunchReport =>
  isRecord(value) && (typeof value.port === 'number' || typeof value.error === 'string')

export const isSurfaceMessage = (data: unknown): data is SurfaceMessage =>
  isRecord(data) && data.type === 'surface' && Number.isInteger(data.cols) && Number.isInteger(data.rows) && Array.isArray(data.events)

export const takenTexts = (value: unknown): string[] =>
  isRecord(value) && Array.isArray(value.texts) ? value.texts.filter((t): t is string => typeof t === 'string') : []
