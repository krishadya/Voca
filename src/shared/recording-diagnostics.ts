export const RECORDING_STAGES = [
  'start-requested', 'microphone-ready', 'media-started', 'stop-requested',
  'media-stopped', 'audio-ready', 'buffer-ready', 'discarded', 'recorder-error'
] as const

export interface RecordingDiagnostic {
  stage: typeof RECORDING_STAGES[number]
  sessionId: number
  atMs: number
  durationMs?: number
  bytes?: number
}

// Explicit allowlist: renderer diagnostics cannot smuggle content into logs.
export function sanitizeRecordingDiagnostic(value: unknown): RecordingDiagnostic | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<RecordingDiagnostic>
  if (!RECORDING_STAGES.includes(input.stage!) || !Number.isInteger(input.sessionId) ||
      typeof input.atMs !== 'number' || !Number.isFinite(input.atMs)) return null
  const result: RecordingDiagnostic = { stage: input.stage!, sessionId: input.sessionId!, atMs: input.atMs }
  for (const key of ['durationMs', 'bytes'] as const) {
    const number = input[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) result[key] = number
  }
  return result
}
