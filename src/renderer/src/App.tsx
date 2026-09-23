import { useEffect, useState } from 'react'
import type { AppState, ProviderConnectionState, ProviderId } from '../../shared/ipc'
import { DEFAULT_HOTKEY, formatHotkey, validateHotkey } from '../../shared/hotkey'
import type { HotkeyConfig, HotkeyKey, HotkeyModifier } from '../../shared/hotkey'
import { AudioRecorder } from './AudioRecorder'

const missingProvider = (id: ProviderId): ProviderConnectionState => ({
  id,
  status: 'missing',
  validation: 'not-tested',
  source: 'none'
})

const initialState: AppState = {
  listening: false,
  hotkeyMode: 'toggle',
  hotkeyMessage: 'Starting keyboard shortcut…',
  hotkey: DEFAULT_HOTKEY,
  microphoneStatus: 'unknown',
  accessibilityGranted: false,
  onboardingComplete: true,
  providers: { groq: missingProvider('groq'), gemini: missingProvider('gemini') },
  processingMode: 'clean',
  autoPaste: true,
  developerVocabulary: [],
  stats: {
    totalSuccessfulDictations: 0,
    totalWordsGenerated: 0,
    averageTranscriptionLatencyMs: null,
    averageProcessingLatencyMs: null,
    averageTotalLatencyMs: null
  },
  recordingSessionId: 0,
  overlayPhase: 'hidden',
  overlayText: ''
}

function hotkeyKeyFromCode(code: string): HotkeyKey | null {
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code as HotkeyKey
  if (code === 'Space') return 'Space'
  if (/^Key[A-Z]$/.test(code)) return code.slice(3) as HotkeyKey
  return null
}

function isModifierCode(code: string): boolean {
  return /^(?:Meta|Control|Alt|Shift)(?:Left|Right)$/.test(code)
}

function modifiersFromEvent(event: KeyboardEvent): HotkeyModifier[] {
  const modifiers: HotkeyModifier[] = []
  if (event.metaKey) modifiers.push('Command')
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Option')
  if (event.shiftKey) modifiers.push('Shift')
  return modifiers
}

function useVocaState(): AppState {
  const [state, setState] = useState(initialState)

  useEffect(() => {
    const unsubscribe = window.voca.onListeningChanged(setState)
    void window.voca.getAppState().then(setState)
    return unsubscribe
  }, [])

  return state
}

function ListeningBars({ transcribing = false }: { transcribing?: boolean }): React.JSX.Element {
  return (
    <div className={`listening-bars ${transcribing ? 'is-transcribing' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span key={bar} style={{ '--bar-index': bar } as React.CSSProperties} />
      ))}
    </div>
  )
}

function Overlay({ state }: { state: AppState }): React.JSX.Element {
  const message =
    state.overlayPhase === 'transcribing'
      ? 'Transcribing…'
      : state.overlayPhase === 'processing'
        ? 'Processing…'
        : state.overlayPhase === 'pasted'
          ? state.overlayText || 'Pasted'
          : state.overlayPhase === 'copied'
            ? state.overlayText
            : state.overlayPhase === 'transcript'
              ? state.overlayText
              : state.overlayPhase === 'error'
                ? state.overlayText || 'Transcription failed'
                : 'Listening…'

  return (
    <main className="overlay-shell" aria-label={`Voca: ${message}`}>
      <section className={`listening-panel phase-${state.overlayPhase}`}>
        <div className="overlay-copy">
          <div className="brand-row"><span className="pulse-dot" /><span className="brand-label">VOCA</span></div>
          <p className={state.overlayPhase === 'transcript' || state.overlayPhase === 'copied' ? 'transcript-text' : ''}>{message}</p>
        </div>
        {state.overlayPhase === 'listening' && <ListeningBars />}
        {state.overlayPhase === 'transcribing' && <ListeningBars transcribing />}
        {state.overlayPhase === 'processing' && <ListeningBars transcribing />}
        {(state.overlayPhase === 'transcript' || state.overlayPhase === 'pasted') && <span className="result-mark">✓</span>}
        {state.overlayPhase === 'copied' && <span className="copy-mark">⌘V</span>}
        {state.overlayPhase === 'error' && <span className="error-mark">!</span>}
      </section>
    </main>
  )
}

function ShortcutEditor({ state }: { state: AppState }): React.JSX.Element {
  const [captureActive, setCaptureActive] = useState(false)
  const [feedback, setFeedback] = useState('')

  const cancelCapture = async (): Promise<void> => {
    setCaptureActive(false)
    const result = await window.voca.cancelHotkeyCapture()
    setFeedback(result.success ? 'Shortcut change canceled.' : result.message)
  }

  const toggleCapture = async (): Promise<void> => {
    if (captureActive) return cancelCapture()
    const result = await window.voca.beginHotkeyCapture()
    if (result.success) {
      setCaptureActive(true)
      setFeedback('Press your new shortcut…')
    } else setFeedback(result.message)
  }

  const resetShortcut = async (): Promise<void> => {
    setCaptureActive(false)
    const result = await window.voca.resetHotkey()
    setFeedback(result.success ? 'Shortcut reset to F8.' : result.message)
  }

  useEffect(() => {
    if (!captureActive) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (event.code === 'Escape') return void cancelCapture()
      if (isModifierCode(event.code)) {
        setFeedback('Add a non-modifier key to complete the shortcut.')
        return
      }
      const key = hotkeyKeyFromCode(event.code)
      if (!key) {
        setFeedback('Use F1–F12, Space, or a letter key.')
        return
      }
      const candidate: HotkeyConfig = { key, modifiers: modifiersFromEvent(event) }
      const validationError = validateHotkey(candidate)
      if (validationError) {
        setFeedback(validationError)
        return
      }
      setCaptureActive(false)
      setFeedback(`Applying ${formatHotkey(candidate)}…`)
      void window.voca.setHotkey(candidate).then((result) => {
        setFeedback(result.success ? `Shortcut changed to ${formatHotkey(candidate)}.` : result.message)
      })
    }
    const handleBlur = (): void => void cancelCapture()
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [captureActive])

  useEffect(() => () => void window.voca.cancelHotkeyCapture(), [])

  return (
    <section className={`settings-section shortcut-section ${captureActive ? 'is-capturing' : ''}`} aria-labelledby="shortcut-heading">
      <div className="section-heading-row"><div><h2 id="shortcut-heading">Push-to-Talk Shortcut</h2><p>Hold the shortcut to listen and release it to stop.</p></div></div>
      <div className="shortcut-display" aria-live="polite"><kbd>{captureActive ? 'Press your new shortcut…' : formatHotkey(state.hotkey)}</kbd></div>
      <div className="shortcut-actions">
        <button type="button" className="primary-action" onClick={() => void toggleCapture()} disabled={state.listening}>{captureActive ? 'Cancel' : 'Change Shortcut'}</button>
        <button type="button" className="secondary-action" onClick={() => void resetShortcut()} disabled={state.listening || (!captureActive && formatHotkey(state.hotkey) === 'F8')}>Reset to F8</button>
      </div>
      <p className={`shortcut-feedback ${feedback ? 'has-message' : ''}`} role="status">{feedback || 'Supports F1–F12 and modified Space or letter keys.'}</p>
    </section>
  )
}

function ProviderCard({ provider, state, onboarding = false }: { provider: ProviderId; state: ProviderConnectionState; onboarding?: boolean }): React.JSX.Element {
  const [editing, setEditing] = useState(onboarding || state.status === 'missing')
  const [key, setKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const name = provider === 'groq' ? 'Groq' : 'Gemini'
  const statusLabel = state.status === 'invalid' ? 'Invalid' : state.status === 'missing' ? 'Missing' : 'Connected'
  const validationLabel = state.validation === 'valid' ? 'Valid' : state.validation === 'invalid' ? 'Invalid' : 'Not tested'

  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    setBusy(true)
    try {
      const result = await window.voca.setProviderKey(provider, key)
      setFeedback(result.message)
      if (result.success) {
        setKey('')
        setVisible(false)
        if (!onboarding) setEditing(false)
      }
    } finally { setBusy(false) }
  }

  const testConnection = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.voca.validateProvider(provider)
      setFeedback(result.message)
    } finally { setBusy(false) }
  }

  const removeKey = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.voca.removeProviderKey(provider)
      setFeedback(result.message)
      if (result.success) setEditing(true)
    } finally { setBusy(false) }
  }

  return (
    <article className="provider-card">
      <div className="provider-heading">
        <div><strong>{name}</strong><span>{provider === 'groq' ? 'Speech-to-text' : 'Clean and Dev Prompt modes'}</span></div>
        <span className={`provider-status status-${state.status}`}>{statusLabel}</span>
      </div>
      <div className="provider-meta">
        <span>Test: {validationLabel}</span>
        {state.source === 'environment' && <span>Using .env fallback</span>}
        {state.source === 'secure-store' && <span>Stored securely</span>}
      </div>
      {(editing || onboarding) && (
        <div className="key-entry-row">
          <label className="visually-hidden" htmlFor={`${provider}-key`}>{name} API key</label>
          <input id={`${provider}-key`} type={visible ? 'text' : 'password'} value={key} onChange={(event) => setKey(event.target.value)} placeholder={`Enter ${name} API key`} autoComplete="off" spellCheck={false} />
          <button type="button" className="key-visibility" onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
          <button type="button" onClick={() => void saveKey()} disabled={busy || !key.trim()}>Save</button>
        </div>
      )}
      <div className="provider-actions">
        {!onboarding && !editing && <button type="button" onClick={() => setEditing(true)} disabled={busy}>Change Key</button>}
        <button type="button" onClick={() => void testConnection()} disabled={busy || state.status === 'missing'}>Test Connection</button>
        {!onboarding && <button type="button" className="danger-action" onClick={() => void removeKey()} disabled={busy || state.source !== 'secure-store'} title={state.source === 'environment' ? 'Remove the development fallback from .env.' : undefined}>Remove Key</button>}
        <button type="button" onClick={() => void window.voca.openProviderKeyPage(provider)}>Get a Key ↗</button>
      </div>
      {feedback && <p className="provider-feedback" role="status">{feedback}</p>}
    </article>
  )
}

function ProviderSettings({ state }: { state: AppState }): React.JSX.Element {
  return (
    <section className="settings-section" aria-labelledby="providers-heading">
      <div className="section-heading-row"><div><h2 id="providers-heading">Providers / API Keys</h2><p>Your API keys are stored locally on this Mac and are never sent anywhere except their respective provider.</p></div></div>
      <div className="provider-list"><ProviderCard provider="groq" state={state.providers.groq} /><ProviderCard provider="gemini" state={state.providers.gemini} /></div>
    </section>
  )
}

const ONBOARDING_STEPS = ['Welcome', 'API setup', 'Permissions', 'Shortcut', 'Test Voca', 'Finish']

function Onboarding({ state }: { state: AppState }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [finishFeedback, setFinishFeedback] = useState('')
  const providersReady = state.providers.groq.status === 'connected' && state.providers.gemini.status === 'connected'
  const finish = async (): Promise<void> => {
    const completed = await window.voca.completeOnboarding()
    if (!completed) setFinishFeedback('Add both provider keys before finishing setup.')
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="app-mark" aria-hidden="true"><span /><span /><span /></div>
        <div><p className="eyebrow">VOCA SETUP</p><h1>{ONBOARDING_STEPS[step]}</h1></div>
      </header>
      <div className="step-indicator" aria-label={`Step ${step + 1} of ${ONBOARDING_STEPS.length}`}>
        {ONBOARDING_STEPS.map((label, index) => <span key={label} className={index <= step ? 'is-active' : ''} />)}
      </div>
      <section className="onboarding-content">
        {step === 0 && <div className="welcome-step"><p className="onboarding-lead">Voca turns your voice into clean text and useful developer prompts.</p><p>Hold your push-to-talk shortcut, speak naturally, then release. Voca transcribes, optionally cleans, and inserts the result where you were typing.</p></div>}
        {step === 1 && <div><p className="onboarding-copy">Groq transcribes your audio. Gemini powers Clean and Dev Prompt modes. Enter keys below; Voca never exposes them to web content.</p><div className="provider-list"><ProviderCard provider="groq" state={state.providers.groq} onboarding /><ProviderCard provider="gemini" state={state.providers.gemini} onboarding /></div></div>}
        {step === 2 && (
          <div className="permissions-list">
            <article><div><strong>Microphone</strong><span>Required to record your voice.</span></div><span className="permission-badge">{state.microphoneStatus === 'granted' ? 'Ready' : state.microphoneStatus}</span><button type="button" onClick={() => void window.voca.requestMicrophonePermission()}>Request Access</button><button type="button" onClick={() => void window.voca.openPermissionSettings('microphone')}>Open Settings</button></article>
            <article><div><strong>Accessibility</strong><span>Used for hold-to-talk, selection capture, and auto-paste.</span></div><span className="permission-badge">{state.accessibilityGranted ? 'Ready' : 'Not enabled'}</span><button type="button" onClick={() => void window.voca.requestAccessibilityPermission()}>Request Access</button><button type="button" onClick={() => void window.voca.openPermissionSettings('accessibility')}>Open Settings</button></article>
            <article><div><strong>Input Monitoring</strong><span>Some macOS versions require this for the global keyboard hook.</span></div><button type="button" onClick={() => void window.voca.openPermissionSettings('input-monitoring')}>Open Settings</button></article>
            <p className="permission-note">Restart Voca after changing Accessibility or Input Monitoring permissions.</p>
          </div>
        )}
        {step === 3 && <ShortcutEditor state={state} />}
        {step === 4 && <div className="test-step"><kbd>{formatHotkey(state.hotkey)}</kbd><p>Hold your shortcut and say:</p><blockquote>“Voca is working.”</blockquote><span>{state.listening ? 'Listening now… release when finished.' : state.hotkeyMessage}</span></div>}
        {step === 5 && <div className="finish-step"><div className="finish-mark">✓</div><p className="onboarding-lead">Voca is ready.</p><p>It will keep running from the menu bar. Open Settings there any time to change providers, shortcut, vocabulary, or other preferences.</p>{finishFeedback && <p className="provider-feedback">{finishFeedback}</p>}</div>}
      </section>
      <footer className="onboarding-actions">
        <button type="button" className="secondary-action" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
        {step < ONBOARDING_STEPS.length - 1 ? <button type="button" className="primary-action" onClick={() => setStep(step + 1)} disabled={step === 1 && !providersReady}>Continue</button> : <button type="button" className="primary-action" onClick={() => void finish()} disabled={!providersReady}>Finish Setup</button>}
      </footer>
    </main>
  )
}

function Settings({ state }: { state: AppState }): React.JSX.Element {
  const [vocabularyTerm, setVocabularyTerm] = useState('')
  const permissionLabel = state.microphoneStatus === 'granted' ? 'Microphone ready' : state.microphoneStatus === 'not-determined' ? 'Microphone permission will be requested on first use' : `Microphone: ${state.microphoneStatus}`
  const formatLatency = (milliseconds: number | null): string => milliseconds === null ? '—' : milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(2)} s`
  const addVocabularyTerm = async (): Promise<void> => {
    const term = vocabularyTerm.trim()
    if (!term) return
    if (await window.voca.addVocabularyTerm(term)) setVocabularyTerm('')
  }

  return (
    <main className="settings-shell">
      <header className="settings-header"><div className="app-mark" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">VOCA</p><h1>Voice, at your fingertips.</h1></div></header>
      <section className={`status-card ${state.listening ? 'is-listening' : ''}`}>
        <div className="status-title-row"><span className="status-dot" /><div><p className="status-label">{state.listening ? 'Listening' : state.overlayPhase === 'transcribing' ? 'Transcribing' : state.overlayPhase === 'processing' ? 'Processing' : 'Ready'}</p><p className="status-detail">{state.listening ? 'Release the shortcut to stop' : state.overlayPhase === 'transcribing' ? 'Converting your recording to text…' : state.overlayPhase === 'processing' ? `Applying ${state.processingMode === 'clean' ? 'Clean' : 'Dev Prompt'} mode…` : state.hotkeyMessage}</p></div></div>
        <button type="button" onClick={() => void window.voca.toggleListening()}>{state.listening ? 'Stop Listening' : 'Start Listening'}</button>
      </section>
      <section className="details-grid" aria-label="Voca status">
        <article><p className="detail-heading">Shortcut</p><p className="keycap-row"><kbd>{formatHotkey(state.hotkey)}</kbd></p><p>{state.hotkeyMode === 'hold' ? 'Hold to talk' : 'Toggle mode'}</p></article>
        <article><p className="detail-heading">Microphone</p><p className="permission-state">{permissionLabel}</p><p>Audio is sent to Groq after recording</p></article>
      </section>
      <ProviderSettings state={state} />
      <ShortcutEditor state={state} />
      <section className="settings-section" aria-labelledby="vocabulary-heading">
        <div className="section-heading-row"><div><h2 id="vocabulary-heading">Developer Vocabulary</h2><p>Help Voca preserve the spelling of project and technology names.</p></div><span>{state.developerVocabulary.length}/50</span></div>
        <form className="vocabulary-form" onSubmit={(event) => { event.preventDefault(); void addVocabularyTerm() }}><label className="visually-hidden" htmlFor="vocabulary-term">Developer vocabulary term</label><input id="vocabulary-term" value={vocabularyTerm} onChange={(event) => setVocabularyTerm(event.target.value)} placeholder="e.g. useEffect or Supabase" maxLength={64} disabled={state.developerVocabulary.length >= 50} /><button type="submit" disabled={!vocabularyTerm.trim() || state.developerVocabulary.length >= 50}>Add</button></form>
        {state.developerVocabulary.length > 0 ? <ul className="vocabulary-list" aria-label="Saved developer vocabulary">{state.developerVocabulary.map((term) => <li key={term.toLocaleLowerCase('en-US')}><span>{term}</span><button type="button" onClick={() => void window.voca.removeVocabularyTerm(term)} aria-label={`Remove ${term}`}>×</button></li>)}</ul> : <p className="empty-state">No custom terms yet.</p>}
      </section>
      <section className="settings-section" aria-labelledby="stats-heading">
        <div className="section-heading-row"><div><h2 id="stats-heading">Stats</h2><p>Aggregate performance stored only on this Mac.</p></div></div>
        <div className="stats-grid"><article><strong>{state.stats.totalSuccessfulDictations.toLocaleString()}</strong><span>Dictations</span></article><article><strong>{state.stats.totalWordsGenerated.toLocaleString()}</strong><span>Words</span></article><article><strong>{formatLatency(state.stats.averageTranscriptionLatencyMs)}</strong><span>Avg. transcription</span></article><article><strong>{formatLatency(state.stats.averageProcessingLatencyMs)}</strong><span>Avg. Gemini</span></article><article><strong>{formatLatency(state.stats.averageTotalLatencyMs)}</strong><span>Avg. total</span></article></div>
      </section>
      <footer>Mode: {state.processingMode === 'dev-prompt' ? 'Dev Prompt' : state.processingMode[0].toUpperCase() + state.processingMode.slice(1)} · Auto Paste {state.autoPaste ? 'On' : 'Off'} · Recordings are not saved by Voca.</footer>
    </main>
  )
}

function SettingsRoute(): React.JSX.Element {
  const state = useVocaState()
  return <><AudioRecorder listening={state.listening} sessionId={state.recordingSessionId} />{state.onboardingComplete ? <Settings state={state} /> : <Onboarding state={state} />}</>
}

function OverlayRoute(): React.JSX.Element {
  return <Overlay state={useVocaState()} />
}

export function App(): React.JSX.Element {
  return window.location.hash === '#/overlay' ? <OverlayRoute /> : <SettingsRoute />
}
