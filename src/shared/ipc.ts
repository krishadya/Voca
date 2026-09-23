import type { HotkeyConfig } from './hotkey'

export const IPC = {
  getAppState: 'voca:get-app-state',
  listeningChanged: 'voca:listening-changed',
  toggleListening: 'voca:toggle-listening',
  setProcessingMode: 'voca:set-processing-mode',
  setAutoPaste: 'voca:set-auto-paste',
  setOverlayStyle: 'voca:set-overlay-style',
  addVocabularyTerm: 'voca:add-vocabulary-term',
  removeVocabularyTerm: 'voca:remove-vocabulary-term',
  beginHotkeyCapture: 'voca:begin-hotkey-capture',
  cancelHotkeyCapture: 'voca:cancel-hotkey-capture',
  setHotkey: 'voca:set-hotkey',
  resetHotkey: 'voca:reset-hotkey',
  setProviderKey: 'voca:set-provider-key',
  removeProviderKey: 'voca:remove-provider-key',
  validateProvider: 'voca:validate-provider',
  openProviderKeyPage: 'voca:open-provider-key-page',
  requestMicrophonePermission: 'voca:request-microphone-permission',
  requestAccessibilityPermission: 'voca:request-accessibility-permission',
  openPermissionSettings: 'voca:open-permission-settings',
  completeOnboarding: 'voca:complete-onboarding',
  transcribeRecording: 'voca:transcribe-recording',
  recordingError: 'voca:recording-error'
} as const

export type HotkeyMode = 'hold' | 'toggle'
export type ProcessingMode = 'raw' | 'clean' | 'dev-prompt'
export type OverlayStyle = 'detailed' | 'minimal'
export type ProviderId = 'groq' | 'gemini'
export type ProviderStatus = 'connected' | 'missing' | 'invalid'
export type ProviderValidationState = 'valid' | 'invalid' | 'not-tested'
export type ProviderKeySource = 'secure-store' | 'environment' | 'none'
export type PermissionSettingsTarget = 'microphone' | 'accessibility' | 'input-monitoring'

export interface ProviderConnectionState {
  id: ProviderId
  status: ProviderStatus
  validation: ProviderValidationState
  source: ProviderKeySource
}

export interface ProviderActionResult {
  success: boolean
  message: string
  state: ProviderConnectionState
}

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
  appVersion: string
  listening: boolean
  hotkeyMode: HotkeyMode
  hotkeyMessage: string
  hotkey: HotkeyConfig
  microphoneStatus: string
  accessibilityGranted: boolean
  onboardingComplete: boolean
  providers: Record<ProviderId, ProviderConnectionState>
  processingMode: ProcessingMode
  autoPaste: boolean
  overlayStyle: OverlayStyle
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
