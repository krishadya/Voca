import type { ProcessingMode } from '../shared/ipc'

export const GEMINI_MODEL = 'gemini-3.5-flash-lite'

const GENERATE_CONTENT_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const REQUEST_TIMEOUT_MS = 30_000

const CLEAN_SYSTEM_INSTRUCTION = `You are a voice dictation cleanup engine.
Convert messy spoken English into clean written text.
Remove filler words, false starts, and accidental repetition.
Fix punctuation, capitalization, and obvious grammar.
Preserve the user's tone and exact meaning.
Do not add new ideas.
Return only the cleaned text.`

const DEV_PROMPT_SYSTEM_INSTRUCTION = `You convert spoken developer intent into a clear prompt for an AI coding agent.
Preserve all requirements, constraints, technologies, filenames, and instructions the user mentions.
Remove filler and repetition.
Structure the request when helpful using short sections or bullets.
Do not invent requirements or implementation details the user did not request.
Do not answer the coding request yourself.
Return only the final coding-agent prompt.`

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>
    }
  }>
  error?: {
    message?: unknown
  }
}

function instructionFor(mode: Exclude<ProcessingMode, 'raw'>): string {
  return mode === 'clean' ? CLEAN_SYSTEM_INSTRUCTION : DEV_PROMPT_SYSTEM_INSTRUCTION
}

function apiErrorMessage(response: GeminiResponse, status: number): string {
  const message = response.error?.message
  return typeof message === 'string' && message.length > 0
    ? `Gemini returned ${status}: ${message}`
    : `Gemini returned HTTP ${status}`
}

export class GeminiProcessingService {
  constructor(private readonly apiKey: string | undefined) {}

  async process(text: string, mode: Exclude<ProcessingMode, 'raw'>): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is missing. Add it to the local .env file and restart Voca.')
    }

    const response = await fetch(GENERATE_CONTENT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: instructionFor(mode) }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 2048
        }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })

    const result = (await response.json().catch(() => ({}))) as GeminiResponse

    if (!response.ok) {
      throw new Error(apiErrorMessage(result, response.status))
    }

    const output =
      result.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim() ?? ''

    if (!output) throw new Error('Gemini returned an empty response')
    return output
  }
}
