import { buildGroqVocabularyPrompt } from './developer-vocabulary'
import { MissingProviderKeyError } from './provider-errors'
import { performance } from 'node:perf_hooks'
import { timeRequest } from './request-timing'
import type { RequestTiming } from './request-timing'

const TRANSCRIPTIONS_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const REQUEST_TIMEOUT_MS = 60_000

interface TranscriptionInput {
  audio: Buffer
  mimeType: string
  vocabulary?: readonly string[]
  onTiming?: RequestTiming
}

interface GroqTranscriptionResponse {
  text?: unknown
}

export class TranscriptionError extends Error {
  constructor(
    readonly category: 'empty-audio' | 'http' | 'network' | 'timeout' | 'invalid-response' | 'empty-transcript',
    readonly status?: number
  ) {
    // Provider response bodies can contain user content. Never put them in errors/logs.
    super(`Transcription ${category}${status === undefined ? '' : ` (HTTP ${status})`}`)
  }
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  return 'webm'
}

export class GroqTranscriptionService {
  constructor(private readonly getApiKey: () => string | undefined) {}

  async transcribe({ audio, mimeType, vocabulary = [], onTiming }: TranscriptionInput): Promise<string> {
    const preparedAt = performance.now()
    if (audio.byteLength === 0) throw new TranscriptionError('empty-audio')
    const apiKey = this.getApiKey()
    if (!apiKey) throw new MissingProviderKeyError('groq')

    const audioBytes = new Uint8Array(audio)
    const audioBlob = new Blob([audioBytes], { type: mimeType })
    const form = new FormData()
    form.append('file', audioBlob, `voca-recording.${extensionForMimeType(mimeType)}`)
    form.append('model', MODEL)
    form.append('language', 'en')
    form.append('temperature', '0')
    form.append('response_format', 'json')
    const vocabularyPrompt = buildGroqVocabularyPrompt(vocabulary)
    if (vocabularyPrompt) form.append('prompt', vocabularyPrompt)
    onTiming?.('prepare', performance.now() - preparedAt)

    let response: Response
    try {
      response = await timeRequest('request', () => fetch(TRANSCRIPTIONS_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }), onTiming)
    } catch (error) {
      throw new TranscriptionError(error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network')
    }

    if (!response.ok) {
      throw new TranscriptionError('http', response.status)
    }

    const result = (await timeRequest('decode', () => response.json().catch(() => null), onTiming)) as GroqTranscriptionResponse | null
    if (!result || typeof result.text !== 'string') throw new TranscriptionError('invalid-response', response.status)
    if (result.text.trim().length === 0) {
      throw new TranscriptionError('empty-transcript', response.status)
    }

    return result.text.trim()
  }
}
