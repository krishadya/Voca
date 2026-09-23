import type { ProviderId } from '../shared/ipc'

export class MissingProviderKeyError extends Error {
  constructor(readonly provider: ProviderId) {
    super(`${provider === 'groq' ? 'Groq' : 'Gemini'} API key is missing.`)
    this.name = 'MissingProviderKeyError'
  }
}
