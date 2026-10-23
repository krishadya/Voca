import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecordingController } from '../src/renderer/src/recording-controller'
import { GroqTranscriptionService, TranscriptionError } from '../src/main/groq-transcription-service'
import { sanitizeRecordingDiagnostic } from '../src/shared/recording-diagnostics'
import type { RecordingDiagnostic } from '../src/shared/recording-diagnostics'
import type { RecordingPayload } from '../src/shared/ipc'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve() }

class FakeRecorder extends EventTarget {
  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  starts = 0
  stops = 0
  data = 'fake audio bytes'
  start() { this.starts++; this.state = 'recording' }
  stop() { this.stops++; this.state = 'inactive' }
  complete() {
    const event = new Event('dataavailable')
    Object.assign(event, { data: new Blob([this.data]) })
    this.dispatchEvent(event)
    this.dispatchEvent(new Event('stop'))
  }
}

function harness() {
  const streams: ReturnType<typeof deferred<MediaStream>>[] = []
  const recorders: FakeRecorder[] = []
  const completed: RecordingPayload[] = []
  const discarded: number[] = []
  const errors: string[] = []
  const diagnostics: RecordingDiagnostic[] = []
  let now = 0
  let tracksStopped = 0
  const controller = new RecordingController({
    acquireStream() { const pending = deferred<MediaStream>(); streams.push(pending); return pending.promise },
    createRecorder() { const recorder = new FakeRecorder(); recorders.push(recorder); return recorder as unknown as MediaRecorder },
    now: () => now,
    async onComplete(payload) { completed.push(payload) },
    onDiscard: (id) => discarded.push(id),
    onError: (_id, category) => errors.push(category),
    onDiagnostic: (event) => diagnostics.push(event)
  })
  const ready = async (index: number) => {
    streams[index].resolve({ getTracks: () => [{ stop() { tracksStopped++ } }] } as unknown as MediaStream)
    await flush()
  }
  return { controller, ready, streams, recorders, completed, discarded, errors, diagnostics,
    advance: (ms: number) => { now += ms }, stoppedTracks: () => tracksStopped }
}

test('recording remains active for 10 seconds; one submission only after release/stop event', async () => {
  const h = harness()
  h.controller.update(true, 1)
  await h.ready(0)
  const recorder = h.recorders[0]
  recorder.dispatchEvent(new Event('start'))
  h.advance(10_000)
  h.controller.update(true, 1)
  assert.equal(recorder.starts, 1)
  assert.equal(recorder.stops, 0)
  assert.equal(h.completed.length, 0)
  h.controller.update(false, 1)
  h.controller.update(false, 1)
  assert.equal(recorder.stops, 1)
  assert.equal(h.completed.length, 0)
  recorder.complete()
  recorder.dispatchEvent(new Event('stop'))
  await flush()
  assert.equal(h.completed.length, 1)
  assert.equal(h.completed[0].durationMs, 10_000)
  assert.ok(h.completed[0].audioData.byteLength > 0)
  assert.deepEqual(h.errors, [])
  assert.deepEqual(h.diagnostics.map((e) => e.stage), [
    'start-requested', 'microphone-ready', 'media-started', 'stop-requested', 'media-stopped', 'audio-ready', 'buffer-ready'
  ])
})

test('release during async microphone acquisition cancels immediately and never starts late', async () => {
  const h = harness()
  h.controller.update(true, 1)
  h.controller.update(false, 1)
  h.controller.update(false, 1)
  assert.deepEqual(h.discarded, [1])
  await h.ready(0)
  assert.equal(h.recorders.length, 0)
  assert.equal(h.stoppedTracks(), 1)
  assert.deepEqual(h.completed, [])
  assert.deepEqual(h.errors, [])
})

test('release before MediaRecorder start event still stops exactly once', async () => {
  const h = harness()
  h.controller.update(true, 1)
  await h.ready(0)
  h.advance(20)
  h.controller.update(false, 1)
  h.recorders[0].dispatchEvent(new Event('start'))
  h.recorders[0].complete()
  await flush()
  assert.equal(h.recorders[0].stops, 1)
  assert.equal(h.completed.length, 1)
  assert.equal(h.completed[0].durationMs, 20)
})

test('rapid sessions, out-of-order microphone promises, and stale errors cannot replace current recording', async () => {
  const h = harness()
  h.controller.update(true, 1)
  h.controller.update(false, 1)
  h.controller.update(true, 2)
  await h.ready(1)
  await h.ready(0)
  h.controller.update(false, 1) // stale release
  assert.equal(h.recorders[0].state, 'recording')
  h.advance(100)
  h.controller.update(false, 2)
  h.recorders[0].complete()
  await flush()
  assert.deepEqual(h.completed.map((p) => p.sessionId), [2])
  h.controller.update(true, 3)
  h.controller.update(false, 3)
  h.controller.update(true, 4)
  h.streams[2].reject(new Error('old microphone denial'))
  await h.ready(3)
  assert.deepEqual(h.errors, [])
  h.controller.dispose()
})

test('superseding a recorder, including batched updates, stops old tracks without uploading stale audio', async () => {
  const h = harness()
  h.controller.update(true, 1)
  await h.ready(0)
  h.controller.update(true, 2) // React can coalesce intervening false state
  assert.equal(h.recorders[0].stops, 1)
  assert.equal(h.stoppedTracks(), 1)
  h.recorders[0].complete()
  await h.ready(1)
  h.advance(100)
  h.controller.update(false, 2)
  h.recorders[1].complete()
  await flush()
  assert.deepEqual(h.completed.map((p) => p.sessionId), [2])
})

test('unmount during startup or recording cleans up without submission', async () => {
  for (const readyFirst of [false, true]) {
    const h = harness()
    h.controller.update(true, 1)
    if (readyFirst) await h.ready(0)
    h.controller.dispose()
    if (!readyFirst) await h.ready(0)
    h.recorders[0]?.complete()
    await flush()
    assert.equal(h.stoppedTracks(), 1)
    assert.deepEqual(h.completed, [])
    assert.deepEqual(h.errors, [])
  }
})

test('empty recordings are discarded; unexpected recorder stops/errors are not submitted', async () => {
  for (const kind of ['empty', 'unexpected-stop', 'error']) {
    const h = harness()
    h.controller.update(true, 1)
    await h.ready(0)
    const recorder = h.recorders[0]
    if (kind === 'empty') {
      recorder.data = ''
      h.controller.update(false, 1)
    } else if (kind === 'error') recorder.dispatchEvent(new Event('error'))
    recorder.complete()
    await flush()
    assert.deepEqual(h.completed, [])
    if (kind === 'empty') assert.deepEqual(h.discarded, [1])
    else assert.equal(h.errors.length, 1)
  }
})

test('25 successive recordings each release tracks and submit exactly once', async () => {
  const h = harness()
  for (let id = 1; id <= 25; id++) {
    h.controller.update(true, id)
    await h.ready(id - 1)
    h.advance(250)
    h.controller.update(false, id)
    h.controller.update(false, id)
    h.recorders[id - 1].complete()
    await flush()
    assert.equal(h.completed.length, id)
    assert.equal(h.stoppedTracks(), id)
    assert.equal(h.recorders[id - 1].stops, 1)
  }
  assert.deepEqual(h.errors, [])
})

test('Groq rejects empty audio before accessing keys or making requests', async () => {
  const service = new GroqTranscriptionService(() => { assert.fail('must not read key') })
  await assert.rejects(service.transcribe({ audio: Buffer.alloc(0), mimeType: 'audio/webm' }),
    (error: unknown) => error instanceof TranscriptionError && error.category === 'empty-audio')
})

test('Groq errors retain category/status but never provider body; no retries', async (t) => {
  const cases = [
    { fetch: async () => new Response(JSON.stringify({ error: { message: 'PRIVATE CONTENT' } }), { status: 400 }), category: 'http', status: 400 },
    { fetch: async () => { throw new Error('PRIVATE CONTENT') }, category: 'network' },
    { fetch: async () => { throw new DOMException('PRIVATE CONTENT', 'TimeoutError') }, category: 'timeout' },
    { fetch: async () => new Response('not-json'), category: 'invalid-response', status: 200 },
    { fetch: async () => new Response(JSON.stringify({ text: '' })), category: 'empty-transcript', status: 200 }
  ]
  const service = new GroqTranscriptionService(() => 'test-placeholder')
  for (const fixture of cases) {
    const mock = t.mock.method(globalThis, 'fetch', fixture.fetch)
    await assert.rejects(service.transcribe({ audio: Buffer.from('test'), mimeType: 'audio/webm' }), (error: unknown) => {
      assert.ok(error instanceof TranscriptionError)
      assert.equal(error.category, fixture.category)
      assert.equal(error.status, fixture.status)
      assert.equal(error.message.includes('PRIVATE CONTENT'), false)
      return true
    })
    assert.equal(mock.mock.callCount(), 1)
    mock.mock.restore()
  }
})

test('diagnostic whitelist strips content and rejects unknown events', () => {
  assert.deepEqual(sanitizeRecordingDiagnostic({ stage: 'audio-ready', sessionId: 1, atMs: 1,
    bytes: 42, transcript: 'private', apiKey: 'private' }), { stage: 'audio-ready', sessionId: 1, atMs: 1, bytes: 42 })
  assert.equal(sanitizeRecordingDiagnostic({ stage: 'private', sessionId: 1, atMs: 1 }), null)
})
