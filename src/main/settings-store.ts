import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProcessingMode } from '../shared/ipc'

export interface AppSettings {
  processingMode: ProcessingMode
  autoPaste: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  processingMode: 'clean',
  autoPaste: true
}

function isProcessingMode(value: unknown): value is ProcessingMode {
  return value === 'raw' || value === 'clean' || value === 'dev-prompt'
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  load(): AppSettings {
    try {
      const settings = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
        processingMode?: unknown
        autoPaste?: unknown
      }
      return {
        processingMode: isProcessingMode(settings.processingMode)
          ? settings.processingMode
          : DEFAULT_SETTINGS.processingMode,
        autoPaste:
          typeof settings.autoPaste === 'boolean' ? settings.autoPaste : DEFAULT_SETTINGS.autoPaste
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') console.warn('[settings] Could not load saved settings:', error)
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(settings: AppSettings): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      console.error('[settings] Could not save settings:', error)
    }
  }
}
