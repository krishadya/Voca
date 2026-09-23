import { buildGroqVocabularyPrompt } from './developer-vocabulary'

const TRANSCRIPTIONS_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const REQUEST_TIMEOUT_MS = 60_000

interface TranscriptionInput {
  audio: Buffer
  mimeType: string
  vocabulary?: readonly string[]
}

interface GroqTranscriptionResponse {
  text?: unknown
  error?: {
    message?: unknown
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

function errorMessage(response: GroqTranscriptionResponse, status: number): string {
  const apiMessage = response.error?.message
  return typeof apiMessage === 'string' && apiMessage.length > 0
    ? `Groq returned ${status}: ${apiMessage}`
    : `Groq returned HTTP ${status}`
}

export class GroqTranscriptionService {
  constructor(private readonly apiKey: string | undefined) {}

  async transcribe({ audio, mimeType, vocabulary = [] }: TranscriptionInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is missing. Add it to the local .env file and restart Voca.')
    }

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

    const response = await fetch(TRANSCRIPTIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    const result = (await response.json().catch(() => ({}))) as GroqTranscriptionResponse

    if (!response.ok) {
      throw new Error(errorMessage(result, response.status))
    }

    if (typeof result.text !== 'string' || result.text.trim().length === 0) {
      throw new Error('Groq returned an empty transcript')
    }

    return result.text.trim()
  }
}
