import type { RecordingPayload } from '../../shared/ipc'
import type { RecordingDiagnostic } from '../../shared/recording-diagnostics'

interface RecorderDependencies {
  acquireStream: () => Promise<MediaStream>
  createRecorder: (stream: MediaStream) => MediaRecorder
  now: () => number
  onComplete: (payload: RecordingPayload) => Promise<void>
  onError: (sessionId: number, category: string) => void
  onDiscard: (sessionId: number) => void
  onDiagnostic: (event: RecordingDiagnostic) => void
}

interface RecordingSession {
  id: number
  stream?: MediaStream
  recorder?: MediaRecorder
  chunks: Blob[]
  startedAt: number
  stoppedAt: number | null
  discarded: boolean
  finished: boolean
}

/** One owner for asynchronous microphone startup, release, and recorder teardown. */
export class RecordingController {
  private current: RecordingSession | null = null

  constructor(private readonly dependencies: RecorderDependencies) {}

  update(listening: boolean, sessionId: number): void {
    if (!listening) {
      if (this.current?.id === sessionId) this.stop(this.current)
      return
    }
    if (this.current?.id === sessionId) return
    this.dispose()
    const session: RecordingSession = {
      id: sessionId, chunks: [], startedAt: 0, stoppedAt: null, discarded: false, finished: false
    }
    this.current = session
    this.diagnostic(session, 'start-requested')
    void this.start(session)
  }

  dispose(): void {
    const session = this.current
    this.current = null
    if (!session) return
    session.discarded = true
    this.stop(session)
    this.releaseStream(session)
    session.chunks.length = 0
  }

  private diagnostic(session: RecordingSession, stage: RecordingDiagnostic['stage'],
    measurements: Pick<RecordingDiagnostic, 'durationMs' | 'bytes'> = {}): void {
    this.dependencies.onDiagnostic({
      stage, sessionId: session.id,
      atMs: performance.timeOrigin + performance.now(), ...measurements
    })
  }

  private releaseStream(session: RecordingSession): void {
    session.stream?.getTracks().forEach((track) => track.stop())
    session.stream = undefined
  }

  private discard(session: RecordingSession): void {
    if (session.discarded) return
    session.discarded = true
    session.chunks.length = 0
    this.diagnostic(session, 'discarded')
    this.dependencies.onDiscard(session.id)
  }

  private fail(session: RecordingSession, category: string): void {
    if (session.discarded || session.finished) return
    this.diagnostic(session, 'recorder-error')
    session.discarded = true
    this.stop(session)
    session.finished = true
    this.releaseStream(session)
    session.chunks.length = 0
    this.dependencies.onError(session.id, category)
  }

  private async start(session: RecordingSession): Promise<void> {
    try {
      const stream = await this.dependencies.acquireStream()
      session.stream = stream
      if (session.discarded || this.current !== session) {
        this.releaseStream(session)
        return
      }
      this.diagnostic(session, 'microphone-ready')
      const recorder = this.dependencies.createRecorder(stream)
      session.recorder = recorder
      recorder.addEventListener('start', () => this.diagnostic(session, 'media-started'))
      recorder.addEventListener('dataavailable', (event) => {
        if (!session.discarded && event.data.size > 0) session.chunks.push(event.data)
      })
      recorder.addEventListener('error', () => this.fail(session, 'media-recorder-error'))
      recorder.addEventListener('stop', () => { void this.finish(session) })
      session.startedAt = this.dependencies.now()
      recorder.start(250)
    } catch {
      this.fail(session, 'microphone-start-failed')
    }
  }

  private stop(session: RecordingSession): void {
    if (session.stoppedAt !== null || session.finished) return
    session.stoppedAt = this.dependencies.now()
    this.diagnostic(session, 'stop-requested')
    if (!session.recorder) {
      // Release during getUserMedia: never start late or submit an empty clip.
      this.discard(session)
      return
    }
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop()
    } catch {
      this.fail(session, 'media-stop-failed')
    }
  }

  private async finish(session: RecordingSession): Promise<void> {
    this.releaseStream(session)
    if (session.finished) return
    this.diagnostic(session, 'media-stopped')
    if (session.discarded || this.current !== session) return
    if (session.stoppedAt === null) {
      // Unexpected device/recorder termination isn't a successful dictation.
      this.fail(session, 'media-stopped-before-release')
      return
    }
    session.finished = true
    const durationMs = Math.max(0, session.stoppedAt - session.startedAt)
    const mimeType = session.recorder?.mimeType || 'audio/webm'
    const blob = new Blob(session.chunks, { type: mimeType })
    session.chunks.length = 0
    this.diagnostic(session, 'audio-ready', { durationMs, bytes: blob.size })
    if (blob.size === 0) {
      this.discard(session)
      return
    }
    try {
      const audioData = await blob.arrayBuffer()
      if (session.discarded || this.current !== session) return
      this.diagnostic(session, 'buffer-ready', { durationMs, bytes: audioData.byteLength })
      await this.dependencies.onComplete({ sessionId: session.id, durationMs, mimeType, audioData })
    } catch {
      if (!session.discarded && this.current === session) {
        this.dependencies.onError(session.id, 'audio-delivery-failed')
      }
    }
  }
}
