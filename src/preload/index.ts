import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppState, RecordingErrorPayload, RecordingPayload } from '../shared/ipc'

const api = {
  getAppState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getAppState),
  toggleListening: (): Promise<void> => ipcRenderer.invoke(IPC.toggleListening),
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
