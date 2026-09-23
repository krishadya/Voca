import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AggregateMetrics, ProcessingMode } from '../shared/ipc'
import { normalizeVocabulary } from './developer-vocabulary'
import { EMPTY_AGGREGATE_METRICS, sanitizeAggregateMetrics } from './performance-metrics'

export interface AppSettings {
  processingMode: ProcessingMode
  autoPaste: boolean
  developerVocabulary: string[]
  aggregateMetrics: AggregateMetrics
}

const DEFAULT_SETTINGS: AppSettings = {
  processingMode: 'clean',
  autoPaste: true,
  developerVocabulary: [],
  aggregateMetrics: EMPTY_AGGREGATE_METRICS
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
        developerVocabulary?: unknown
        aggregateMetrics?: unknown
      }
      return {
        processingMode: isProcessingMode(settings.processingMode)
          ? settings.processingMode
          : DEFAULT_SETTINGS.processingMode,
        autoPaste:
          typeof settings.autoPaste === 'boolean' ? settings.autoPaste : DEFAULT_SETTINGS.autoPaste,
        developerVocabulary: normalizeVocabulary(settings.developerVocabulary),
        aggregateMetrics: sanitizeAggregateMetrics(settings.aggregateMetrics)
      }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') console.warn('[settings] Could not load saved settings:', error)
      return {
        ...DEFAULT_SETTINGS,
        developerVocabulary: [],
        aggregateMetrics: { ...EMPTY_AGGREGATE_METRICS }
      }
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
