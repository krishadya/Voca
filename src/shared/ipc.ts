export const IPC = {
  getAppState: 'voca:get-app-state',
  listeningChanged: 'voca:listening-changed',
  toggleListening: 'voca:toggle-listening',
  transcribeRecording: 'voca:transcribe-recording',
  recordingError: 'voca:recording-error'
} as const

export type HotkeyMode = 'hold' | 'toggle'
export type ProcessingMode = 'raw' | 'clean' | 'dev-prompt'
export type OverlayPhase =
  | 'hidden'
  | 'listening'
  | 'transcribing'
  | 'processing'
  | 'transcript'
  | 'error'

export interface AppState {
  listening: boolean
  hotkeyMode: HotkeyMode
  hotkeyMessage: string
  microphoneStatus: string
  processingMode: ProcessingMode
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
