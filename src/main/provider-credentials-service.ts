import type {
  ProviderActionResult,
  ProviderConnectionState,
  ProviderId,
  ProviderValidationState
} from '../shared/ipc'
import { APIKeyStore } from './api-key-store'

const VALIDATION_TIMEOUT_MS = 12_000
const PROVIDERS: readonly ProviderId[] = ['groq', 'gemini']

const VALIDATION_ENDPOINTS: Record<ProviderId, string> = {
  groq: 'https://api.groq.com/openai/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
}

type KeyValues = Partial<Record<ProviderId, string>>

function providerName(provider: ProviderId): string {
  return provider === 'groq' ? 'Groq' : 'Gemini'
}

export class ProviderCredentialsService {
  private readonly storedKeys: KeyValues = {}
  private readonly validation: Record<ProviderId, ProviderValidationState> = {
    groq: 'not-tested',
    gemini: 'not-tested'
  }

  constructor(
    private readonly keyStore: APIKeyStore,
    private readonly environmentKeys: KeyValues
  ) {}

  async initialize(): Promise<void> {
    await Promise.all(
      PROVIDERS.map(async (provider) => {
        const key = await this.keyStore.get(provider)
        if (key) this.storedKeys[provider] = key
      })
    )
  }

  getKey(provider: ProviderId): string | undefined {
    return this.storedKeys[provider] ?? this.environmentKeys[provider]
  }

  hasAllRequiredKeys(): boolean {
    return PROVIDERS.every((provider) => Boolean(this.getKey(provider)))
  }

  getState(provider: ProviderId): ProviderConnectionState {
    const source = this.storedKeys[provider]
      ? 'secure-store'
      : this.environmentKeys[provider]
        ? 'environment'
        : 'none'
    const validation = this.validation[provider]
    return {
      id: provider,
      source,
      validation,
      status: source === 'none' ? 'missing' : validation === 'invalid' ? 'invalid' : 'connected'
    }
  }

  getStates(): Record<ProviderId, ProviderConnectionState> {
    return { groq: this.getState('groq'), gemini: this.getState('gemini') }
  }

  async setKey(provider: ProviderId, value: string): Promise<ProviderActionResult> {
    const key = value.trim()
    if (key.length < 12 || key.length > 512) {
      return {
        success: false,
        message: 'Enter a complete API key.',
        state: this.getState(provider)
      }
    }

    try {
      await this.keyStore.set(provider, key)
      this.storedKeys[provider] = key
      this.validation[provider] = 'not-tested'
      return {
        success: true,
        message: `${providerName(provider)} key saved securely.`,
        state: this.getState(provider)
      }
    } catch {
      return {
        success: false,
        message: 'Voca could not access secure credential storage.',
        state: this.getState(provider)
      }
    }
  }

  async removeKey(provider: ProviderId): Promise<ProviderActionResult> {
    try {
      await this.keyStore.remove(provider)
      delete this.storedKeys[provider]
      this.validation[provider] = 'not-tested'
      const state = this.getState(provider)
      return {
        success: true,
        message:
          state.source === 'environment'
            ? `Saved ${providerName(provider)} key removed; using the development .env fallback.`
            : `${providerName(provider)} key removed.`,
        state
      }
    } catch {
      return {
        success: false,
        message: `Could not remove the ${providerName(provider)} key.`,
        state: this.getState(provider)
      }
    }
  }

  async validate(provider: ProviderId): Promise<ProviderActionResult> {
    const key = this.getKey(provider)
    if (!key) {
      this.validation[provider] = 'not-tested'
      return {
        success: false,
        message: `Add a ${providerName(provider)} API key first.`,
        state: this.getState(provider)
      }
    }

    try {
      const headers =
        provider === 'groq'
          ? { Authorization: `Bearer ${key}` }
          : { 'x-goog-api-key': key }
      const response = await fetch(VALIDATION_ENDPOINTS[provider], {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS)
      })

      if (response.ok) {
        this.validation[provider] = 'valid'
        return {
          success: true,
          message: `${providerName(provider)} connection is valid.`,
          state: this.getState(provider)
        }
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        this.validation[provider] = 'invalid'
        return {
          success: false,
          message: `${providerName(provider)} rejected this API key.`,
          state: this.getState(provider)
        }
      }

      this.validation[provider] = 'not-tested'
      return {
        success: false,
        message: `${providerName(provider)} could not be reached (HTTP ${response.status}).`,
        state: this.getState(provider)
      }
    } catch {
      this.validation[provider] = 'not-tested'
      return {
        success: false,
        message: `Could not connect to ${providerName(provider)}. Check your network and try again.`,
        state: this.getState(provider)
      }
    }
  }
}
