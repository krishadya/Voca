import type { AggregateMetrics, StatsSummary } from '../shared/ipc'

export interface RecordingMetrics {
  recordingDurationMs: number
  transcriptionLatencyMs: number
  processingLatencyMs: number
  totalLatencyMs: number
  wordCount: number
  usedGemini: boolean
}

export const EMPTY_AGGREGATE_METRICS: AggregateMetrics = {
  totalSuccessfulDictations: 0,
  totalWordsGenerated: 0,
  cumulativeTranscriptionLatencyMs: 0,
  cumulativeProcessingLatencyMs: 0,
  processingSampleCount: 0,
  cumulativeTotalLatencyMs: 0
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function sanitizeAggregateMetrics(value: unknown): AggregateMetrics {
  if (!value || typeof value !== 'object') return { ...EMPTY_AGGREGATE_METRICS }
  const candidate = value as Partial<AggregateMetrics>
  const totalSuccessfulDictations = Math.floor(
    finiteNonNegative(candidate.totalSuccessfulDictations)
  )

  return {
    totalSuccessfulDictations,
    totalWordsGenerated: Math.floor(finiteNonNegative(candidate.totalWordsGenerated)),
    cumulativeTranscriptionLatencyMs: finiteNonNegative(
      candidate.cumulativeTranscriptionLatencyMs
    ),
    cumulativeProcessingLatencyMs: finiteNonNegative(
      candidate.cumulativeProcessingLatencyMs
    ),
    processingSampleCount: Math.min(
      totalSuccessfulDictations,
      Math.floor(finiteNonNegative(candidate.processingSampleCount))
    ),
    cumulativeTotalLatencyMs: finiteNonNegative(candidate.cumulativeTotalLatencyMs)
  }
}

export function addRecordingMetrics(
  aggregate: AggregateMetrics,
  recording: RecordingMetrics
): AggregateMetrics {
  return {
    totalSuccessfulDictations: aggregate.totalSuccessfulDictations + 1,
    totalWordsGenerated: aggregate.totalWordsGenerated + recording.wordCount,
    cumulativeTranscriptionLatencyMs:
      aggregate.cumulativeTranscriptionLatencyMs + recording.transcriptionLatencyMs,
    cumulativeProcessingLatencyMs:
      aggregate.cumulativeProcessingLatencyMs + recording.processingLatencyMs,
    processingSampleCount: aggregate.processingSampleCount + (recording.usedGemini ? 1 : 0),
    cumulativeTotalLatencyMs: aggregate.cumulativeTotalLatencyMs + recording.totalLatencyMs
  }
}

export function summarizeMetrics(aggregate: AggregateMetrics): StatsSummary {
  const successful = aggregate.totalSuccessfulDictations
  const processingSamples = aggregate.processingSampleCount

  return {
    totalSuccessfulDictations: successful,
    totalWordsGenerated: aggregate.totalWordsGenerated,
    averageTranscriptionLatencyMs:
      successful > 0 ? aggregate.cumulativeTranscriptionLatencyMs / successful : null,
    averageProcessingLatencyMs:
      processingSamples > 0
        ? aggregate.cumulativeProcessingLatencyMs / processingSamples
        : null,
    averageTotalLatencyMs:
      successful > 0 ? aggregate.cumulativeTotalLatencyMs / successful : null
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

export function logRecordingMetrics(metrics: RecordingMetrics): void {
  const processing = metrics.usedGemini
    ? `${Math.round(metrics.processingLatencyMs)}ms`
    : 'n/a (Raw)'

  console.info(`[metrics]
recording: ${(metrics.recordingDurationMs / 1_000).toFixed(1)}s
transcription: ${Math.round(metrics.transcriptionLatencyMs)}ms
processing: ${processing}
total after release: ${Math.round(metrics.totalLatencyMs)}ms
words: ${metrics.wordCount}`)
}
