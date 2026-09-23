export const IPC = {
  getAppState: 'voca:get-app-state',
  listeningChanged: 'voca:listening-changed',
  toggleListening: 'voca:toggle-listening',
  addVocabularyTerm: 'voca:add-vocabulary-term',
  removeVocabularyTerm: 'voca:remove-vocabulary-term',
  transcribeRecording: 'voca:transcribe-recording',
  recordingError: 'voca:recording-error'
} as const

export type HotkeyMode = 'hold' | 'toggle'
export type ProcessingMode = 'raw' | 'clean' | 'dev-prompt'

export interface AggregateMetrics {
  totalSuccessfulDictations: number
  totalWordsGenerated: number
  cumulativeTranscriptionLatencyMs: number
  cumulativeProcessingLatencyMs: number
  processingSampleCount: number
  cumulativeTotalLatencyMs: number
}

export interface StatsSummary {
  totalSuccessfulDictations: number
  totalWordsGenerated: number
  averageTranscriptionLatencyMs: number | null
  averageProcessingLatencyMs: number | null
  averageTotalLatencyMs: number | null
}

export type OverlayPhase =
  | 'hidden'
  | 'listening'
  | 'transcribing'
  | 'processing'
  | 'transcript'
  | 'pasted'
  | 'copied'
  | 'error'

export interface AppState {
  listening: boolean
  hotkeyMode: HotkeyMode
  hotkeyMessage: string
  microphoneStatus: string
  processingMode: ProcessingMode
  autoPaste: boolean
  developerVocabulary: string[]
  stats: StatsSummary
  recordingSessionId: number
  overlayPhase: OverlayPhase
  overlayText: string
}

export interface RecordingPayload {
  sessionId: number
  durationMs: number
  mimeType: string
  audioData: ArrayBuffer
}

export interface RecordingErrorPayload {
  sessionId: number
  message: string
}
