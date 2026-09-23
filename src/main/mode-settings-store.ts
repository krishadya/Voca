import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProcessingMode } from '../shared/ipc'

const DEFAULT_MODE: ProcessingMode = 'clean'

function isProcessingMode(value: unknown): value is ProcessingMode {
  return value === 'raw' || value === 'clean' || value === 'dev-prompt'
}

export class ModeSettingsStore {
  constructor(private readonly filePath: string) {}

  load(): ProcessingMode {
    try {
      const settings = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
        processingMode?: unknown
      }
      return isProcessingMode(settings.processingMode) ? settings.processingMode : DEFAULT_MODE
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') console.warn('[settings] Could not load saved mode:', error)
      return DEFAULT_MODE
    }
  }

  save(processingMode: ProcessingMode): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify({ processingMode }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      console.error('[settings] Could not save selected mode:', error)
    }
  }
}
