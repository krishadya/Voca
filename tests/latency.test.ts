import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PipelineTiming } from '../src/main/pipeline-timing'
import { captureContextForMode } from '../src/main/recording-context'
import { ClipboardCoordinator, clipboardCoordinator } from '../src/main/clipboard-coordinator'
import { TextInsertionService } from '../src/main/text-insertion-service'
import { SelectedTextService } from '../src/main/selected-text-service'
import { GeminiProcessingService, GEMINI_MODEL } from '../src/main/gemini-processing-service'
import { GroqTranscriptionService } from '../src/main/groq-transcription-service'
import { clipboard, uIOhook, UiohookKey, access } from './hotkey-fakes'

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve() }

test('session timings include recorder finalization and buffer preparation; reject stale events', async () => {
  let now = 1000
  const samples: Array<[string, number]> = []
  const timing = new PipelineTiming(7, (stage, ms) => samples.push([stage, ms]), () => now)
  timing.mark('release')
  timing.recorder({ sessionId: 8, stage: 'stop-requested', atMs: 1002 })
  assert.equal(samples.length, 0)
  timing.recorder({ sessionId: 7, stage: 'stop-requested', atMs: 1004 })
  timing.recorder({ sessionId: 7, stage: 'media-stopped', atMs: 1015 })
  timing.recorder({ sessionId: 7, stage: 'audio-ready', atMs: 1016 })
  timing.recorder({ sessionId: 7, stage: 'buffer-ready', atMs: 1020 })
  assert.deepEqual(samples, [
    ['release-to-stop-request', 4], ['release-to-recorder-stop', 15],
    ['recorder-finalization', 11], ['recorder-stop-to-audio-ready', 5]
  ])
  await assert.rejects(timing.measure('groq-total', async () => { now += 200; throw new Error('test') }))
  assert.deepEqual(samples.at(-1), ['groq-total', 200])
  const disabled = new PipelineTiming(1, () => assert.fail('production diagnostic'), () => now, false)
  disabled.mark('release'); disabled.mark('paste'); disabled.span('total', 'release', 'paste')
  await disabled.measure('request', async () => 1)
})

test('Raw/Clean skip context; Dev Prompt starts both captures concurrently and preserves results', async () => {
  for (const mode of ['raw', 'clean'] as const) {
    assert.deepEqual(await captureContextForMode(mode,
      async () => assert.fail('unused active-app capture'),
      async () => assert.fail('unused clipboard capture')), {})
  }
  const appReady = gate()
  let selectionStarted = false
  const pending = captureContextForMode('dev-prompt',
    async () => { await appReady.promise; return { name: 'Notes' } },
    async () => { selectionStarted = true; return 'selected reference' })
  await flush()
  assert.equal(selectionStarted, true)
  appReady.release()
  assert.deepEqual(await pending, { activeApplication: { name: 'Notes' }, selectedText: 'selected reference' })
})

test('paste notification precedes the 900ms cleanup without shortening clipboard safety waits', async (t) => {
  await clipboard.writeText('original clipboard')
  const restore = gate()
  let now = 0
  let pastedAt = -1
  const waits: number[] = []
  const tap = t.mock.method(uIOhook, 'keyTap', () => {})
  const service = new TextInsertionService(async (ms) => {
    waits.push(ms)
    if (ms === 900) await restore.promise
    now += ms
  })
  const result = service.insert('generated', true, { onPasted: () => { pastedAt = now } })
  await flush()
  assert.equal(pastedAt, 100)
  assert.equal(await clipboard.readText(), 'generated')
  assert.deepEqual(waits, [100, 900])
  assert.equal(tap.mock.callCount(), 1)
  let selectionStarted = false
  const next = clipboardCoordinator.run(async () => { selectionStarted = true; return clipboard.readText() })
  await flush()
  assert.equal(selectionStarted, false)
  restore.release()
  assert.equal((await result).clipboardRestored, true)
  assert.equal(await next, 'original clipboard')
  assert.equal(now - pastedAt, 900)
})

test('stale insertion cancels while queued or settling, without pasting or losing original clipboard', async (t) => {
  const tap = t.mock.method(uIOhook, 'keyTap', () => assert.fail('stale paste'))
  for (const stage of ['queued', 'settling']) {
    await clipboard.writeText('keep')
    const paused = gate()
    const block = stage === 'queued' ? clipboardCoordinator.run(() => paused.promise) : Promise.resolve()
    let current = true
    const service = new TextInsertionService(() => paused.promise)
    const pending = service.insert('stale', true, { isCurrent: () => current })
    await flush()
    current = false
    paused.release()
    await block
    assert.equal((await pending).status, 'cancelled')
    assert.equal(await clipboard.readText(), 'keep')
  }
  assert.equal(tap.mock.callCount(), 0)
})

test('auto-paste off and failed paste retain manual-copy behavior; external copies survive cleanup', async (t) => {
  const service = new TextInsertionService(async () => {})
  const tap = t.mock.method(uIOhook, 'keyTap', () => { throw new Error('input unavailable') })
  const manual = await service.insert('manual', false)
  assert.equal(manual.status, 'copied')
  assert.equal(tap.mock.callCount(), 0)
  const fallback = await service.insert('fallback', true)
  assert.equal(fallback.status, 'copied')
  assert.equal(await clipboard.readText(), 'fallback')
  tap.mock.restore()
  const externalCopy = new TextInsertionService(async (ms) => {
    if (ms === 900) await clipboard.writeText('user copied something new')
  })
  assert.equal((await externalCopy.insert('generated', true)).clipboardRestored, false)
  assert.equal(await clipboard.readText(), 'user copied something new')
})

test('selection capture and insertion share the same clipboard lock and preserve context', async (t) => {
  await clipboard.writeText('original')
  const holding = gate()
  const previous = clipboardCoordinator.run(() => holding.promise)
  const tap = t.mock.method(uIOhook, 'keyTap', (key: number) => {
    if (key === UiohookKey.C) void clipboard.writeText('selected reference')
  })
  access.trusted = true
  const selection = new SelectedTextService().capture()
  await flush()
  assert.equal(tap.mock.callCount(), 0)
  holding.release()
  await previous
  assert.equal(await selection, 'selected reference')
  assert.equal(await clipboard.readText(), 'original')
})

test('clipboard queue survives failed operations', async () => {
  const queue = new ClipboardCoordinator()
  await assert.rejects(queue.run(async () => { throw new Error('test') }))
  assert.equal(await queue.run(async () => 42), 42)
})

test('superseded queued context capture never sends Command+C or changes clipboard', async (t) => {
  await clipboard.writeText('keep')
  const blocked = gate()
  const previous = clipboardCoordinator.run(() => blocked.promise)
  let current = true
  const tap = t.mock.method(uIOhook, 'keyTap', () => assert.fail('stale selection'))
  const pending = new SelectedTextService().capture(() => current)
  current = false
  blocked.release()
  await previous
  assert.equal(await pending, null)
  assert.equal(await clipboard.readText(), 'keep')
  assert.equal(tap.mock.callCount(), 0)
})

test('provider instrumentation leaves models, vocabulary, context and outputs intact', async (t) => {
  const stages: string[] = []
  const record = (stage: string, ms: number) => { assert.ok(ms >= 0); stages.push(stage) }
  const mock = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('groq.com')) {
      const body = init.body as FormData
      assert.equal(body.get('model'), 'whisper-large-v3-turbo')
      assert.equal(body.get('language'), 'en')
      assert.equal(body.get('temperature'), '0')
      assert.ok(String(body.get('prompt')).includes('Voca'))
      return new Response(JSON.stringify({ text: 'test transcript' }))
    }
    assert.ok(url.includes(GEMINI_MODEL))
    const body = JSON.parse(init.body as string)
    assert.equal(body.generationConfig.maxOutputTokens, 2048)
    assert.ok(body.contents[0].parts[0].text.includes('selected reference'))
    assert.ok(body.contents[0].parts[0].text.includes('Voca'))
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'processed output' }] } }] }))
  })
  assert.equal(await new GroqTranscriptionService(() => 'test-key').transcribe({
    audio: Buffer.from('fake'), mimeType: 'audio/webm', vocabulary: ['Voca'], onTiming: record
  }), 'test transcript')
  assert.equal(await new GeminiProcessingService(() => 'test-key').process('test transcript', 'dev-prompt', {
    selectedText: 'selected reference', vocabulary: ['Voca'], activeApplication: { name: 'Notes' }
  }, record), 'processed output')
  assert.equal(mock.mock.callCount(), 2)
  assert.deepEqual(stages, ['prepare', 'request', 'decode', 'prepare', 'request', 'decode'])
})
