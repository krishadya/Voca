import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { ProviderId } from '../shared/ipc'

interface StoredKeysFile {
  version: 1
  keys: Partial<Record<ProviderId, string>>
}

const EMPTY_FILE: StoredKeysFile = { version: 1, keys: {} }

function isStoredKeysFile(value: unknown): value is StoredKeysFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { version?: unknown; keys?: unknown }
  return candidate.version === 1 && Boolean(candidate.keys) && typeof candidate.keys === 'object'
}

/** Stores only safeStorage ciphertext on disk. Decrypted values never leave the main process. */
export class APIKeyStore {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(provider: ProviderId): Promise<string | undefined> {
    const file = await this.read()
    const encoded = file.keys[provider]
    if (!encoded) return undefined

    try {
      const encrypted = Buffer.from(encoded, 'base64')
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted)
      if (shouldReEncrypt) await this.set(provider, result)
      return result.trim() || undefined
    } catch {
      console.warn(`[credentials] Could not decrypt the saved ${provider} key.`)
      return undefined
    }
  }

  async set(provider: ProviderId, key: string): Promise<void> {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) throw new Error('Secure credential storage is unavailable on this Mac.')

    const encrypted = await safeStorage.encryptStringAsync(key)
    await this.mutate(async () => {
      const file = await this.read()
      file.keys[provider] = encrypted.toString('base64')
      await this.write(file)
    })
  }

  async remove(provider: ProviderId): Promise<void> {
    await this.mutate(async () => {
      const file = await this.read()
      if (!file.keys[provider]) return
      delete file.keys[provider]
      await this.write(file)
    })
  }

  private async read(): Promise<StoredKeysFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      return isStoredKeysFile(parsed) ? parsed : { ...EMPTY_FILE, keys: {} }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') console.warn('[credentials] Could not read encrypted key storage.')
      return { ...EMPTY_FILE, keys: {} }
    }
  }

  private async write(file: StoredKeysFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, this.filePath)
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.catch(() => undefined)
    await next
  }
}
