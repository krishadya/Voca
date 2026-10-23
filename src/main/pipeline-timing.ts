import { performance } from 'node:perf_hooks'
import type { RecordingDiagnostic } from '../shared/recording-diagnostics'

export const epochNow = (): number => performance.timeOrigin + performance.now()

/** Per-session, in-memory diagnostics only. Never accepts user/provider content. */
export class PipelineTiming {
  private readonly marks = new Map<string, number>()
  constructor(
    readonly sessionId: number,
    private readonly report: (stage: string, durationMs: number) => void,
    private readonly now: () => number = epochNow,
    private readonly enabled = true
  ) {}

  mark(stage: string, atMs = this.now()): void {
    if (this.enabled) this.marks.set(stage, atMs)
  }

  span(label: string, from: string, to: string): void {
    const start = this.marks.get(from)
    const end = this.marks.get(to)
    if (start !== undefined && end !== undefined && end >= start) {
      this.report(label, Math.round((end - start) * 100) / 100)
    }
  }

  async measure<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    if (!this.enabled) return operation()
    const start = this.now()
    try { return await operation() }
    finally { this.report(stage, Math.round((this.now() - start) * 100) / 100) }
  }

  recorder(event: RecordingDiagnostic): void {
    if (event.sessionId !== this.sessionId) return
    this.mark(event.stage, event.atMs)
    if (event.stage === 'stop-requested') this.span('release-to-stop-request', 'release', 'stop-requested')
    if (event.stage === 'media-stopped') {
      this.span('release-to-recorder-stop', 'release', 'media-stopped')
      this.span('recorder-finalization', 'stop-requested', 'media-stopped')
    }
    if (event.stage === 'buffer-ready') {
      this.span('recorder-stop-to-audio-ready', 'media-stopped', 'buffer-ready')
      // Also handles diagnostic delivery arriving after the audio invoke.
      this.span('audio-ipc', 'buffer-ready', 'audio-received')
    }
  }
}
