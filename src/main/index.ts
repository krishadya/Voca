import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { config as loadEnvironment } from 'dotenv'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { HotkeyService } from './hotkey-service'
import { GroqTranscriptionService } from './groq-transcription-service'
import { GeminiProcessingService } from './gemini-processing-service'
import type { GeminiProcessingContext } from './gemini-processing-service'
import { ActiveAppService } from './active-app-service'
import { SelectedTextService } from './selected-text-service'
import {
  MAX_VOCABULARY_TERMS,
  normalizeVocabularyTerm
} from './developer-vocabulary'
import {
  addRecordingMetrics,
  countWords,
  EMPTY_AGGREGATE_METRICS,
  logRecordingMetrics,
  summarizeMetrics
} from './performance-metrics'
import { SettingsStore } from './settings-store'
import { APIKeyStore } from './api-key-store'
import { ProviderCredentialsService } from './provider-credentials-service'
import { MissingProviderKeyError } from './provider-errors'
import { TextInsertionService } from './text-insertion-service'
import { createTrayImage } from './tray-icon'
import { IPC } from '../shared/ipc'
import {
  copyHotkey,
  DEFAULT_HOTKEY,
  formatHotkey,
  normalizeHotkey,
  validateHotkey
} from '../shared/hotkey'
import type { HotkeyActionResult, HotkeyConfig } from '../shared/hotkey'
import type {
  AppState,
  AggregateMetrics,
  HotkeyMode,
  OverlayPhase,
  ProcessingMode,
  RecordingErrorPayload,
  RecordingPayload,
  PermissionSettingsTarget,
  ProviderId
} from '../shared/ipc'

loadEnvironment({ path: join(process.cwd(), '.env'), quiet: true })

const COMPACT_OVERLAY_WIDTH = 390
const COMPACT_OVERLAY_HEIGHT = 118
const RESULT_OVERLAY_WIDTH = 520
const RESULT_OVERLAY_HEIGHT = 200
const OVERLAY_BOTTOM_GAP = 72
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const RECORDING_DELIVERY_TIMEOUT_MS = 5_000
const ERROR_DISPLAY_MS = 2_200

const transcriptionService = new GroqTranscriptionService(() =>
  providerCredentialsService?.getKey('groq')
)
const geminiProcessingService = new GeminiProcessingService(() =>
  providerCredentialsService?.getKey('gemini')
)
const textInsertionService = new TextInsertionService()
const activeAppService = new ActiveAppService()
const selectedTextService = new SelectedTextService()

let settingsWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hotkeyService: HotkeyService | null = null
let settingsStore: SettingsStore | null = null
let providerCredentialsService: ProviderCredentialsService | null = null
let listening = false
let pendingStartToken: number | null = null
let transitionToken = 0
let hotkeyMode: HotkeyMode = 'toggle'
let hotkeyMessage = 'Starting keyboard shortcut…'
let hotkey: HotkeyConfig = copyHotkey(DEFAULT_HOTKEY)
let hotkeyCaptureActive = false
let microphoneStatus = 'unknown'
let accessibilityGranted = false
let onboardingComplete = false
let processingMode: ProcessingMode = 'clean'
let autoPaste = true
let developerVocabulary: string[] = []
let aggregateMetrics: AggregateMetrics = { ...EMPTY_AGGREGATE_METRICS }
let recordingProcessingMode: ProcessingMode = 'clean'
let recordingAutoPaste = true
let recordingVocabulary: string[] = []
let recordingHasExternalTarget = true
let recordingSessionId = 0
let recordingContextPromise: Promise<GeminiProcessingContext> = Promise.resolve({})
let recordingReleasedAtMs = 0
let lastMetricsSessionId = 0
let overlayPhase: OverlayPhase = 'hidden'
let overlayText = ''
let recordingDeliveryTimer: ReturnType<typeof setTimeout> | null = null
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null
let quitting = false

function loadRenderer(window: BrowserWindow, route: 'settings' | 'overlay'): void {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL

  if (developmentUrl) {
    void window.loadURL(`${developmentUrl}#/${route}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
  }
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: 'Voca Settings',
    backgroundColor: '#111114',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
      app.dock?.hide()
    }
  })

  window.on('hide', () => {
    if (hotkeyCaptureActive) cancelHotkeyCapture()
  })

  loadRenderer(window, 'settings')
  return window
}

function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: COMPACT_OVERLAY_WIDTH,
    height: COMPACT_OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setIgnoreMouseEvents(true)
  loadRenderer(window, 'overlay')
  return window
}

function createTray(): Tray {
  const image = createTrayImage()

  if (!app.isPackaged) {
    const size = image.getSize()
    console.info(`[tray] template icon ready (${size.width}×${size.height})`)
  }

  const menuBar = new Tray(image)
  menuBar.setToolTip('Voca')
  return menuBar
}

function currentState(): AppState {
  return {
    listening,
    hotkeyMode,
    hotkeyMessage,
    hotkey: copyHotkey(hotkey),
    microphoneStatus,
    accessibilityGranted,
    onboardingComplete,
    providers: providerCredentialsService?.getStates() ?? {
      groq: { id: 'groq', status: 'missing', validation: 'not-tested', source: 'none' },
      gemini: { id: 'gemini', status: 'missing', validation: 'not-tested', source: 'none' }
    },
    processingMode,
    autoPaste,
    developerVocabulary: [...developerVocabulary],
    stats: summarizeMetrics(aggregateMetrics),
    recordingSessionId,
    overlayPhase,
    overlayText
  }
}

function updateTrayMenu(): void {
  if (!tray) return

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Voca', enabled: false },
      { type: 'separator' },
      {
        label: listening ? 'Stop Listening' : 'Start Listening',
        enabled: !hotkeyCaptureActive,
        click: () => void toggleListening('menu')
      },
      { label: `Shortcut: ${formatHotkey(hotkey)}`, enabled: false },
      {
        label: 'Mode',
        submenu: [
          {
            label: 'Raw',
            type: 'radio',
            checked: processingMode === 'raw',
            click: () => setProcessingMode('raw')
          },
          {
            label: 'Clean',
            type: 'radio',
            checked: processingMode === 'clean',
            click: () => setProcessingMode('clean')
          },
          {
            label: 'Dev Prompt',
            type: 'radio',
            checked: processingMode === 'dev-prompt',
            click: () => setProcessingMode('dev-prompt')
          }
        ]
      },
      {
        label: 'Auto Paste',
        type: 'checkbox',
        checked: autoPaste,
        click: () => setAutoPaste(!autoPaste)
      },
      { label: 'Settings…', click: showSettings },
      { type: 'separator' },
      {
        label: 'Quit Voca',
        accelerator: 'Command+Q',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function broadcastState(): void {
  const state = currentState()
  settingsWindow?.webContents.send(IPC.listeningChanged, state)
  overlayWindow?.webContents.send(IPC.listeningChanged, state)
  updateTrayMenu()
}

function showSettings(): void {
  app.dock?.show()
  settingsWindow?.show()
  settingsWindow?.focus()
}

function positionOverlay(): void {
  if (!overlayWindow) return

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const overlayBounds = overlayWindow.getBounds()
  overlayWindow.setPosition(
    Math.round(x + (width - overlayBounds.width) / 2),
    Math.round(y + height - overlayBounds.height - OVERLAY_BOTTOM_GAP),
    false
  )
}

function setProcessingMode(mode: ProcessingMode): void {
  if (processingMode === mode) return
  processingMode = mode
  saveSettings()
  console.info(`[mode] ${mode}`)
  broadcastState()
}

function setAutoPaste(enabled: boolean): void {
  if (autoPaste === enabled) return
  autoPaste = enabled
  saveSettings()
  console.info(`[auto-paste] ${enabled ? 'on' : 'off'}`)
  broadcastState()
}

function beginHotkeyCapture(): HotkeyActionResult {
  if (listening || pendingStartToken !== null) {
    return { success: false, message: 'Stop listening before changing the shortcut.' }
  }
  if (!hotkeyService) return { success: false, message: 'The shortcut service is not ready.' }
  if (hotkeyCaptureActive) return { success: true, message: 'Press your new shortcut…' }

  hotkeyService.suspend()
  hotkeyCaptureActive = true
  updateTrayMenu()
  return { success: true, message: 'Press your new shortcut…' }
}

function cancelHotkeyCapture(): HotkeyActionResult {
  if (!hotkeyCaptureActive) return { success: true, message: hotkeyMessage }
  hotkeyCaptureActive = false

  const result = hotkeyService?.resume() ?? {
    success: false,
    message: 'The shortcut service is not ready.'
  }
  hotkeyMessage = result.message
  broadcastState()
  return result
}

function setHotkey(value: unknown): HotkeyActionResult {
  if (listening || pendingStartToken !== null) {
    return { success: false, message: 'Stop listening before changing the shortcut.' }
  }

  const nextHotkey = normalizeHotkey(value)
  const validationError = nextHotkey ? validateHotkey(nextHotkey) : 'That shortcut is not supported.'

  if (!nextHotkey || validationError) {
    const resumeResult = cancelHotkeyCapture()
    return {
      success: false,
      message: resumeResult.success ? validationError ?? 'That shortcut is not supported.' : resumeResult.message
    }
  }

  if (!hotkeyService) {
    hotkeyCaptureActive = false
    return { success: false, message: 'The shortcut service is not ready.' }
  }

  const result = hotkeyService.reconfigure(nextHotkey)
  hotkeyCaptureActive = false
  hotkeyMessage = result.message

  if (result.success) {
    hotkey = copyHotkey(nextHotkey)
    saveSettings()
    console.info(`[hotkey] Changed to ${formatHotkey(hotkey)}`)
  }

  broadcastState()
  return result
}

function resetHotkey(): HotkeyActionResult {
  return setHotkey(copyHotkey(DEFAULT_HOTKEY))
}

function addVocabularyTerm(value: string): boolean {
  const term = normalizeVocabularyTerm(value)
  if (!term || developerVocabulary.length >= MAX_VOCABULARY_TERMS) return false
  if (
    developerVocabulary.some(
      (existing) => existing.toLocaleLowerCase('en-US') === term.toLocaleLowerCase('en-US')
    )
  ) {
    return false
  }

  developerVocabulary = [...developerVocabulary, term]
  saveSettings()
  broadcastState()
  return true
}

function removeVocabularyTerm(value: string): boolean {
  const comparisonKey = normalizeVocabularyTerm(value).toLocaleLowerCase('en-US')
  const nextVocabulary = developerVocabulary.filter(
    (term) => term.toLocaleLowerCase('en-US') !== comparisonKey
  )
  if (!comparisonKey || nextVocabulary.length === developerVocabulary.length) return false

  developerVocabulary = nextVocabulary
  saveSettings()
  broadcastState()
  return true
}

function saveSettings(): void {
  settingsStore?.save({
    processingMode,
    autoPaste,
    developerVocabulary,
    aggregateMetrics,
    hotkey,
    onboardingComplete
  })
}

function clearRecordingDeliveryTimer(): void {
  if (recordingDeliveryTimer) {
    clearTimeout(recordingDeliveryTimer)
    recordingDeliveryTimer = null
  }
}

function clearOverlayHideTimer(): void {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer)
    overlayHideTimer = null
  }
}

function setOverlay(phase: OverlayPhase, text = ''): void {
  overlayPhase = phase
  overlayText = text

  if (phase === 'hidden') {
    overlayWindow?.hide()
  } else {
    const isResult = phase === 'transcript' || phase === 'copied'
    overlayWindow?.setSize(
      isResult ? RESULT_OVERLAY_WIDTH : COMPACT_OVERLAY_WIDTH,
      isResult ? RESULT_OVERLAY_HEIGHT : COMPACT_OVERLAY_HEIGHT,
      false
    )
    positionOverlay()
    overlayWindow?.showInactive()
  }

  broadcastState()
}

function scheduleOverlayHide(sessionId: number, delayMs: number): void {
  clearOverlayHideTimer()
  overlayHideTimer = setTimeout(() => {
    overlayHideTimer = null
    if (recordingSessionId === sessionId && !listening) setOverlay('hidden')
  }, delayMs)
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showOperationFailure(
  sessionId: number,
  error: unknown,
  overlayMessage = 'Transcription failed',
  operation = 'transcription'
): void {
  if (error instanceof MissingProviderKeyError) {
    const name = error.provider === 'groq' ? 'Groq' : 'Gemini'
    overlayMessage = `${name} API key required — open Settings`
    operation = `${error.provider} credentials`
    showSettings()
  }
  console.error(`[${operation}] Failed:`, readableError(error))
  if (sessionId !== recordingSessionId) return

  clearRecordingDeliveryTimer()
  listening = false
  setOverlay('error', overlayMessage)
  scheduleOverlayHide(sessionId, ERROR_DISPLAY_MS)
}

async function captureRecordingContext(): Promise<GeminiProcessingContext> {
  const activeApplication = await activeAppService.capture()
  console.info(
    `[context] app: ${
      activeApplication
        ? `${activeApplication.name}${
            activeApplication.bundleIdentifier
              ? ` (${activeApplication.bundleIdentifier})`
              : ''
          }`
        : 'unavailable'
    }`
  )

  const selectedText = await selectedTextService.capture()
  console.info(`[context] selected text: ${selectedText?.length ?? 0} chars`)

  return {
    ...(activeApplication ? { activeApplication } : {}),
    ...(selectedText ? { selectedText } : {})
  }
}

function setListening(next: boolean, source: string): void {
  if (listening === next) return

  listening = next
  console.info(`[listening] ${next ? 'started' : 'stopped'} by ${source}`)

  if (next) {
    clearRecordingDeliveryTimer()
    clearOverlayHideTimer()
    recordingSessionId += 1
    recordingProcessingMode = processingMode
    recordingAutoPaste = autoPaste
    recordingVocabulary = [...developerVocabulary]
    recordingHasExternalTarget = BrowserWindow.getFocusedWindow() === null
    recordingReleasedAtMs = 0
    recordingContextPromise = captureRecordingContext()
    setOverlay('listening')
  } else {
    const stoppedSessionId = recordingSessionId
    recordingReleasedAtMs = performance.now()
    setOverlay('transcribing')
    clearRecordingDeliveryTimer()
    recordingDeliveryTimer = setTimeout(() => {
      recordingDeliveryTimer = null
      showOperationFailure(stoppedSessionId, new Error('Recorder did not provide audio'))
    }, RECORDING_DELIVERY_TIMEOUT_MS)
  }
}

async function ensureMicrophonePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    microphoneStatus = 'prompted by the browser'
    return true
  }

  microphoneStatus = systemPreferences.getMediaAccessStatus('microphone')

  if (microphoneStatus === 'not-determined') {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    microphoneStatus = granted ? 'granted' : systemPreferences.getMediaAccessStatus('microphone')
  }

  broadcastState()
  return microphoneStatus === 'granted'
}

async function startListening(source: string): Promise<void> {
  if (listening || pendingStartToken !== null || hotkeyCaptureActive) return

  const token = ++transitionToken
  pendingStartToken = token
  const permissionGranted = await ensureMicrophonePermission()

  if (pendingStartToken !== token) return
  pendingStartToken = null

  if (!permissionGranted) {
    showSettings()
    void dialog.showMessageBox(settingsWindow!, {
      type: 'warning',
      title: 'Microphone Access Required',
      message: 'Voca needs microphone access to listen.',
      detail: 'Enable Voca in System Settings → Privacy & Security → Microphone, then try again.',
      buttons: ['OK']
    })
    return
  }

  setListening(true, source)
}

function stopListening(source: string): void {
  if (pendingStartToken !== null) {
    ++transitionToken
    pendingStartToken = null
  }

  setListening(false, source)
}

async function toggleListening(source: string): Promise<void> {
  if (listening || pendingStartToken !== null) {
    stopListening(source)
  } else {
    await startListening(source)
  }
}

function isRecordingPayload(value: unknown): value is RecordingPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<RecordingPayload>
  return (
    Number.isInteger(payload.sessionId) &&
    typeof payload.durationMs === 'number' &&
    typeof payload.mimeType === 'string' &&
    payload.audioData instanceof ArrayBuffer
  )
}

async function transcribeRecording(payload: RecordingPayload): Promise<void> {
  if (payload.sessionId !== recordingSessionId || listening) {
    console.info(`[recording] Ignored stale session ${payload.sessionId}`)
    return
  }

  clearRecordingDeliveryTimer()
  const contextPromise = recordingContextPromise
  const releaseStartedAtMs = recordingReleasedAtMs || performance.now()
  const audio = Buffer.from(payload.audioData)

  if (audio.byteLength === 0) {
    showOperationFailure(payload.sessionId, new Error('Recording was empty'))
    return
  }

  if (audio.byteLength > MAX_AUDIO_BYTES) {
    showOperationFailure(payload.sessionId, new Error('Recording exceeds the 25 MB upload limit'))
    return
  }

  if (!app.isPackaged) {
    console.info(
      `[recording] ${Math.round(payload.durationMs)}ms, ${audio.byteLength} bytes, ${payload.mimeType}`
    )
  }

  setOverlay('transcribing')

  try {
    const transcriptionStartedAtMs = performance.now()
    const rawTranscript = await transcriptionService.transcribe({
      audio,
      mimeType: payload.mimeType,
      vocabulary: recordingVocabulary
    })
    const transcriptionLatencyMs = performance.now() - transcriptionStartedAtMs

    if (payload.sessionId !== recordingSessionId || listening) return

    console.info(`[transcription:raw] ${rawTranscript}`)

    let finalOutput = rawTranscript
    let processingLatencyMs = 0
    let usedGemini = false
    if (recordingProcessingMode !== 'raw') {
      setOverlay('processing')
      try {
        const processingContext: GeminiProcessingContext =
          recordingProcessingMode === 'dev-prompt'
            ? { ...(await contextPromise), vocabulary: recordingVocabulary }
            : { vocabulary: recordingVocabulary }

        if (payload.sessionId !== recordingSessionId || listening) return

        const processingStartedAtMs = performance.now()
        finalOutput = await geminiProcessingService.process(
          rawTranscript,
          recordingProcessingMode,
          processingContext
        )
        processingLatencyMs = performance.now() - processingStartedAtMs
        usedGemini = true
      } catch (error) {
        showOperationFailure(payload.sessionId, error, 'Processing failed', 'processing')
        return
      }
    }

    if (payload.sessionId !== recordingSessionId || listening) return

    // Ensure selection capture has restored the clipboard before insertion.
    await contextPromise

    if (payload.sessionId !== recordingSessionId || listening) return

    const recordingMetrics = {
      recordingDurationMs: payload.durationMs,
      transcriptionLatencyMs,
      processingLatencyMs,
      totalLatencyMs: performance.now() - releaseStartedAtMs,
      wordCount: countWords(finalOutput),
      usedGemini
    }

    if (lastMetricsSessionId !== payload.sessionId) {
      lastMetricsSessionId = payload.sessionId
      aggregateMetrics = addRecordingMetrics(aggregateMetrics, recordingMetrics)
      saveSettings()
      if (!app.isPackaged) logRecordingMetrics(recordingMetrics)
    }

    console.info(`[output:${recordingProcessingMode}] ${finalOutput}`)
    setOverlay('transcript', finalOutput)

    const insertionResult = await textInsertionService.insert(
      finalOutput,
      recordingAutoPaste && recordingHasExternalTarget
    )

    if (payload.sessionId !== recordingSessionId || listening) return

    if (insertionResult.status === 'pasted') {
      console.info(
        `[insertion] Pasted; clipboard ${insertionResult.clipboardRestored ? 'restored' : 'not restored'}`
      )
      setOverlay('pasted', 'Pasted')
      scheduleOverlayHide(payload.sessionId, 1_400)
      return
    }

    if (insertionResult.error) {
      console.error('[insertion] Auto-paste unavailable:', insertionResult.error)
    }

    const copiedMessage =
      insertionResult.status === 'copied'
        ? `Copied — paste manually\n\n${finalOutput}`
        : `Copy failed — final text:\n\n${finalOutput}`
    setOverlay('copied', copiedMessage)
    const displayTimeMs = Math.min(15_000, Math.max(7_000, finalOutput.length * 40))
    scheduleOverlayHide(payload.sessionId, displayTimeMs)
  } catch (error) {
    showOperationFailure(payload.sessionId, error)
  }
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'groq' || value === 'gemini'
}

function isPermissionSettingsTarget(value: unknown): value is PermissionSettingsTarget {
  return value === 'microphone' || value === 'accessibility' || value === 'input-monitoring'
}

function isSettingsSender(webContentsId: number): boolean {
  return webContentsId === settingsWindow?.webContents.id
}

function installIpcHandlers(): void {
  ipcMain.handle(IPC.getAppState, () => currentState())
  ipcMain.handle(IPC.toggleListening, () => toggleListening('settings'))
  ipcMain.handle(IPC.addVocabularyTerm, (event, term: unknown) => {
    if (event.sender.id !== settingsWindow?.webContents.id || typeof term !== 'string') return false
    return addVocabularyTerm(term)
  })
  ipcMain.handle(IPC.removeVocabularyTerm, (event, term: unknown) => {
    if (event.sender.id !== settingsWindow?.webContents.id || typeof term !== 'string') return false
    return removeVocabularyTerm(term)
  })
  ipcMain.handle(IPC.beginHotkeyCapture, (event) => {
    if (event.sender.id !== settingsWindow?.webContents.id) {
      return { success: false, message: 'Shortcut capture is only available in Settings.' }
    }
    return beginHotkeyCapture()
  })
  ipcMain.handle(IPC.cancelHotkeyCapture, (event) => {
    if (event.sender.id !== settingsWindow?.webContents.id) {
      return { success: false, message: 'Shortcut capture is only available in Settings.' }
    }
    return cancelHotkeyCapture()
  })
  ipcMain.handle(IPC.setHotkey, (event, value: unknown) => {
    if (event.sender.id !== settingsWindow?.webContents.id) {
      return { success: false, message: 'Shortcut changes are only available in Settings.' }
    }
    return setHotkey(value)
  })
  ipcMain.handle(IPC.resetHotkey, (event) => {
    if (event.sender.id !== settingsWindow?.webContents.id) {
      return { success: false, message: 'Shortcut changes are only available in Settings.' }
    }
    return resetHotkey()
  })
  ipcMain.handle(IPC.setProviderKey, async (event, provider: unknown, key: unknown) => {
    if (!isSettingsSender(event.sender.id) || !isProviderId(provider) || typeof key !== 'string') {
      throw new Error('Invalid provider key request')
    }
    if (!providerCredentialsService) throw new Error('Credential storage is not ready')
    const result = await providerCredentialsService.setKey(provider, key)
    broadcastState()
    return result
  })
  ipcMain.handle(IPC.removeProviderKey, async (event, provider: unknown) => {
    if (!isSettingsSender(event.sender.id) || !isProviderId(provider)) {
      throw new Error('Invalid provider key request')
    }
    if (!providerCredentialsService) throw new Error('Credential storage is not ready')
    const result = await providerCredentialsService.removeKey(provider)
    broadcastState()
    return result
  })
  ipcMain.handle(IPC.validateProvider, async (event, provider: unknown) => {
    if (!isSettingsSender(event.sender.id) || !isProviderId(provider)) {
      throw new Error('Invalid provider validation request')
    }
    if (!providerCredentialsService) throw new Error('Credential storage is not ready')
    const result = await providerCredentialsService.validate(provider)
    broadcastState()
    return result
  })
  ipcMain.handle(IPC.openProviderKeyPage, async (event, provider: unknown) => {
    if (!isSettingsSender(event.sender.id) || !isProviderId(provider)) return
    const url =
      provider === 'groq'
        ? 'https://console.groq.com/keys'
        : 'https://aistudio.google.com/app/apikey'
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.requestMicrophonePermission, async (event) => {
    if (!isSettingsSender(event.sender.id)) return false
    return ensureMicrophonePermission()
  })
  ipcMain.handle(IPC.requestAccessibilityPermission, (event) => {
    if (!isSettingsSender(event.sender.id)) return false
    accessibilityGranted =
      process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(true) : true
    broadcastState()
    return accessibilityGranted
  })
  ipcMain.handle(IPC.openPermissionSettings, async (event, target: unknown) => {
    if (!isSettingsSender(event.sender.id) || !isPermissionSettingsTarget(target)) return
    const pane =
      target === 'microphone'
        ? 'Privacy_Microphone'
        : target === 'accessibility'
          ? 'Privacy_Accessibility'
          : 'Privacy_ListenEvent'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  })
  ipcMain.handle(IPC.completeOnboarding, (event) => {
    if (!isSettingsSender(event.sender.id)) return false
    if (!providerCredentialsService?.hasAllRequiredKeys()) return false
    onboardingComplete = true
    saveSettings()
    broadcastState()
    return true
  })

  ipcMain.handle(IPC.transcribeRecording, async (event, payload: unknown) => {
    if (event.sender.id !== settingsWindow?.webContents.id) {
      throw new Error('Audio submissions are only accepted from the recorder window')
    }

    if (!isRecordingPayload(payload)) {
      showOperationFailure(recordingSessionId, new Error('Recorder sent invalid audio data'))
      return
    }

    await transcribeRecording(payload)
  })

  ipcMain.on(IPC.recordingError, (event, payload: RecordingErrorPayload) => {
    if (event.sender.id !== settingsWindow?.webContents.id) return
    if (!payload || payload.sessionId !== recordingSessionId) return
    showOperationFailure(payload.sessionId, new Error(payload.message), 'Transcription failed', 'recording')
  })
}

function configureMediaPermissions(): void {
  const isSettingsRenderer = (webContentsId: number): boolean =>
    settingsWindow?.webContents.id === webContentsId

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' && webContents !== null && isSettingsRenderer(webContents.id)
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const onlyAudioRequested =
      permission === 'media' &&
      'mediaTypes' in details &&
      Array.isArray(details.mediaTypes) &&
      !details.mediaTypes.includes('video')
    callback(Boolean(onlyAudioRequested && isSettingsRenderer(webContents.id)))
  })
}

void app.whenReady().then(async () => {
  app.setName('Voca')
  app.dock?.hide()

  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  const savedSettings = settingsStore.load()
  providerCredentialsService = new ProviderCredentialsService(
    new APIKeyStore(join(app.getPath('userData'), 'provider-keys.json')),
    {
      ...(process.env.GROQ_API_KEY?.trim() ? { groq: process.env.GROQ_API_KEY.trim() } : {}),
      ...(process.env.GEMINI_API_KEY?.trim() ? { gemini: process.env.GEMINI_API_KEY.trim() } : {})
    }
  )
  await providerCredentialsService.initialize()
  processingMode = savedSettings.processingMode
  autoPaste = savedSettings.autoPaste
  developerVocabulary = savedSettings.developerVocabulary
  aggregateMetrics = savedSettings.aggregateMetrics
  hotkey = savedSettings.hotkey
  onboardingComplete = savedSettings.onboardingComplete
  if (!savedSettings.onboardingStateWasPresent) {
    // Existing development installs with both .env keys stay configured after this migration.
    onboardingComplete = providerCredentialsService.hasAllRequiredKeys()
    saveSettings()
  }
  console.info(`[mode] ${processingMode}`)
  console.info(`[auto-paste] ${autoPaste ? 'on' : 'off'}`)
  console.info(`[vocabulary] ${developerVocabulary.length} terms loaded`)

  settingsWindow = createSettingsWindow()
  settingsWindow.once('ready-to-show', () => {
    if (!onboardingComplete) showSettings()
  })
  overlayWindow = createOverlayWindow()
  tray = createTray()
  installIpcHandlers()
  configureMediaPermissions()

  hotkeyService = new HotkeyService({
    shortcut: hotkey,
    onPressed: () => void startListening('hotkey press'),
    onReleased: () => stopListening('hotkey release'),
    onToggle: () => void toggleListening('hotkey toggle')
  })

  const status = hotkeyService.start()
  hotkeyMode = status.mode
  hotkeyMessage = status.message
  console.info(`[hotkey] ${status.message}`)
  microphoneStatus =
    process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown'
  accessibilityGranted =
    process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
  broadcastState()
})

app.on('before-quit', () => {
  quitting = true
  clearRecordingDeliveryTimer()
  clearOverlayHideTimer()
  hotkeyService?.stop()
})

// Keep the menu-bar app alive when the settings window is hidden.
app.on('window-all-closed', () => {})
