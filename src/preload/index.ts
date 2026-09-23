import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppState,
  OverlayStyle,
  PermissionSettingsTarget,
  ProcessingMode,
  ProviderActionResult,
  ProviderId,
  RecordingErrorPayload,
  RecordingPayload
} from '../shared/ipc'
import type { HotkeyActionResult, HotkeyConfig } from '../shared/hotkey'

const api = {
  getAppState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getAppState),
  toggleListening: (): Promise<void> => ipcRenderer.invoke(IPC.toggleListening),
  setProcessingMode: (mode: ProcessingMode): Promise<void> =>
    ipcRenderer.invoke(IPC.setProcessingMode, mode),
  setAutoPaste: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.setAutoPaste, enabled),
  setOverlayStyle: (style: OverlayStyle): Promise<void> =>
    ipcRenderer.invoke(IPC.setOverlayStyle, style),
  addVocabularyTerm: (term: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.addVocabularyTerm, term),
  removeVocabularyTerm: (term: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.removeVocabularyTerm, term),
  beginHotkeyCapture: (): Promise<HotkeyActionResult> =>
    ipcRenderer.invoke(IPC.beginHotkeyCapture),
  cancelHotkeyCapture: (): Promise<HotkeyActionResult> =>
    ipcRenderer.invoke(IPC.cancelHotkeyCapture),
  setHotkey: (hotkey: HotkeyConfig): Promise<HotkeyActionResult> =>
    ipcRenderer.invoke(IPC.setHotkey, hotkey),
  resetHotkey: (): Promise<HotkeyActionResult> => ipcRenderer.invoke(IPC.resetHotkey),
  setProviderKey: (provider: ProviderId, key: string): Promise<ProviderActionResult> =>
    ipcRenderer.invoke(IPC.setProviderKey, provider, key),
  removeProviderKey: (provider: ProviderId): Promise<ProviderActionResult> =>
    ipcRenderer.invoke(IPC.removeProviderKey, provider),
  validateProvider: (provider: ProviderId): Promise<ProviderActionResult> =>
    ipcRenderer.invoke(IPC.validateProvider, provider),
  openProviderKeyPage: (provider: ProviderId): Promise<void> =>
    ipcRenderer.invoke(IPC.openProviderKeyPage, provider),
  requestMicrophonePermission: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.requestMicrophonePermission),
  requestAccessibilityPermission: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.requestAccessibilityPermission),
  openPermissionSettings: (target: PermissionSettingsTarget): Promise<void> =>
    ipcRenderer.invoke(IPC.openPermissionSettings, target),
  completeOnboarding: (): Promise<boolean> => ipcRenderer.invoke(IPC.completeOnboarding),
  onListeningChanged: (callback: (state: AppState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => callback(state)
    ipcRenderer.on(IPC.listeningChanged, listener)
    return () => ipcRenderer.removeListener(IPC.listeningChanged, listener)
  },
  transcribeRecording: (recording: RecordingPayload): Promise<void> => {
    return ipcRenderer.invoke(IPC.transcribeRecording, recording)
  },
  reportRecordingError: (error: RecordingErrorPayload): void => {
    ipcRenderer.send(IPC.recordingError, error)
  }
}

contextBridge.exposeInMainWorld('voca', api)

export type VocaApi = typeof api
