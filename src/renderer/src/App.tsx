import { useEffect, useState } from 'react'
import type {
  AppState,
  ProcessingMode,
  ProviderConnectionState,
  ProviderId
} from '../../shared/ipc'
import {
  DEFAULT_HOTKEY,
  formatHotkey,
  HOTKEY_LIMITATION_NOTE,
  HOTKEY_USAGE_GUIDANCE,
  validateHotkey
} from '../../shared/hotkey'
import type { HotkeyConfig, HotkeyKey, HotkeyModifier } from '../../shared/hotkey'
import vocaMarkUrl from './assets/voca-mark.svg'
import { AudioRecorder } from './AudioRecorder'

type SettingsPage = 'general' | 'providers' | 'vocabulary' | 'stats' | 'about'

const missingProvider = (id: ProviderId): ProviderConnectionState => ({
  id,
  status: 'missing',
  validation: 'not-tested',
  source: 'none'
})

const initialState: AppState = {
  appVersion: '0.1.0',
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
  overlayStyle: 'detailed',
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

function modeLabel(mode: ProcessingMode): string {
  return mode === 'dev-prompt' ? 'Dev Prompt' : mode[0].toUpperCase() + mode.slice(1)
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

function BrandMark({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }): React.JSX.Element {
  return (
    <span className={`brand-mark brand-mark-${size}`} aria-hidden="true">
      <img src={vocaMarkUrl} alt="" />
    </span>
  )
}

function Icon({ name }: { name: SettingsPage | 'spark' | 'document' | 'command' }): React.JSX.Element {
  const paths: Record<typeof name, React.JSX.Element> = {
    general: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.05V3h4v.05a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
    providers: <><rect x="3" y="5" width="18" height="5" rx="2" /><rect x="3" y="14" width="18" height="5" rx="2" /><path d="M7 10v4M17 10v4" /></>,
    vocabulary: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5a3.5 3.5 0 0 1 3.5 3.5Z" /></>,
    stats: <><path d="M4 20V10M9 20V4M14 20v-7M19 20V7" /><path d="M2 20h20" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    spark: <path d="m13 2-8 12h6l-1 8 9-13h-6Z" />,
    document: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    command: <path d="M9 8V5a3 3 0 1 0-3 3h3Zm0 0h6m0 0V5a3 3 0 1 1 3 3h-3Zm0 0v8m0 0h3a3 3 0 1 1-3 3v-3Zm0 0H9m0 0v3a3 3 0 1 1-3-3h3Zm0 0V8" />
  }
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function ListeningBars({ muted = false }: { muted?: boolean }): React.JSX.Element {
  return (
    <div className={`listening-bars ${muted ? 'is-muted' : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((bar) => (
        <span key={bar} style={{ '--bar-index': bar } as React.CSSProperties} />
      ))}
    </div>
  )
}

function DetailedOverlay({ state }: { state: AppState }): React.JSX.Element {
  const isCopied = state.overlayPhase === 'copied'
  const isTranscript = state.overlayPhase === 'transcript'
  const copiedParts = isCopied ? state.overlayText.split('\n\n') : []
  const title =
    state.overlayPhase === 'transcribing'
      ? 'Transcribing…'
      : state.overlayPhase === 'processing'
        ? 'Processing…'
        : state.overlayPhase === 'pasted'
          ? 'Pasted'
          : isCopied
            ? copiedParts[0] || 'Copied — paste manually'
            : isTranscript
              ? state.overlayText
              : state.overlayPhase === 'error'
                ? state.overlayText || 'Something went wrong'
                : 'Listening'
  const detail = isCopied && copiedParts[1] ? copiedParts.slice(1).join('\n\n') : `Mode: ${modeLabel(state.processingMode)}`

  return (
    <main className="overlay-shell" aria-label={`Voca: ${title}`}>
      <section className={`voice-overlay phase-${state.overlayPhase}`}>
        <BrandMark size="small" />
        <div className="overlay-copy">
          <p className={isTranscript || isCopied ? 'overlay-result-text' : ''}>{title}</p>
          {state.overlayPhase !== 'error' && <span>{detail}</span>}
        </div>
        <div className="overlay-visual">
          {state.overlayPhase === 'listening' && <ListeningBars />}
          {state.overlayPhase === 'transcribing' && <ListeningBars muted />}
          {state.overlayPhase === 'processing' && <span className="processing-spinner" />}
          {(state.overlayPhase === 'pasted' || isTranscript) && <span className="success-indicator">✓</span>}
          {isCopied && <span className="copy-indicator">⌘V</span>}
          {state.overlayPhase === 'error' && <span className="error-indicator">!</span>}
        </div>
        <kbd className="overlay-shortcut">{formatHotkey(state.hotkey)}</kbd>
      </section>
    </main>
  )
}

function MinimalOverlay({ state }: { state: AppState }): React.JSX.Element {
  const listening = state.overlayPhase === 'listening'
  const success = state.overlayPhase === 'pasted' || state.overlayPhase === 'transcript'
  const visualState = listening ? 'listening' : success ? 'success' : 'processing'
  return (
    <main
      className="overlay-shell"
      aria-label={listening ? 'Voca is listening' : success ? 'Voca completed' : 'Voca is processing'}
    >
      <section className="minimal-overlay">
        <div className="minimal-overlay-state" key={visualState}>
          {listening
            ? <ListeningBars />
            : success
              ? <span className="success-indicator">✓</span>
              : <span className="processing-spinner" />}
        </div>
      </section>
    </main>
  )
}

function Overlay({ state }: { state: AppState }): React.JSX.Element {
  const needsReadableMessage =
    state.overlayPhase === 'copied' || state.overlayPhase === 'error'
  return state.overlayStyle === 'minimal' && !needsReadableMessage
    ? <MinimalOverlay state={state} />
    : <DetailedOverlay state={state} />
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
        setFeedback(HOTKEY_USAGE_GUIDANCE)
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
    <div className={`preference-card shortcut-card ${captureActive ? 'is-capturing' : ''}`}>
      <div className="preference-icon"><Icon name="general" /></div>
      <div className="preference-copy">
        <strong>Push-to-Talk Shortcut</strong>
        <span>{HOTKEY_USAGE_GUIDANCE}</span>
        <small className="shortcut-support-note">{HOTKEY_LIMITATION_NOTE}</small>
        {feedback && <small className="shortcut-feedback" role="status">{feedback}</small>}
      </div>
      <div className="shortcut-control">
        <kbd>{captureActive ? 'Press your new shortcut…' : formatHotkey(state.hotkey)}</kbd>
        <button type="button" className="button-secondary" onClick={() => void toggleCapture()} disabled={state.listening}>{captureActive ? 'Cancel' : 'Change'}</button>
        {formatHotkey(state.hotkey) !== 'F8' && <button type="button" className="button-quiet" onClick={() => void resetShortcut()} disabled={state.listening}>Reset to F8</button>}
      </div>
    </div>
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
        <div className={`provider-logo provider-${provider}`}>{provider === 'groq' ? 'G' : '✦'}</div>
        <div className="provider-title"><strong>{name}</strong><span>{provider === 'groq' ? 'Speech-to-text transcription' : 'Clean and Dev Prompt processing'}</span></div>
        <span className={`status-badge status-${state.status}`}>{statusLabel}</span>
      </div>
      <div className="provider-meta"><span>Connection: {validationLabel}</span>{state.source === 'environment' && <span>.env fallback</span>}{state.source === 'secure-store' && <span>Encrypted locally</span>}</div>
      {(editing || onboarding) && (
        <div className="key-entry-row">
          <label className="visually-hidden" htmlFor={`${provider}-key`}>{name} API key</label>
          <input id={`${provider}-key`} type={visible ? 'text' : 'password'} value={key} onChange={(event) => setKey(event.target.value)} placeholder={`Enter ${name} API key`} autoComplete="off" spellCheck={false} />
          <button type="button" className="button-quiet" onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
          <button type="button" className="button-primary" onClick={() => void saveKey()} disabled={busy || !key.trim()}>Save</button>
        </div>
      )}
      <div className="provider-actions">
        {!onboarding && !editing && <button type="button" className="button-secondary" onClick={() => setEditing(true)} disabled={busy}>Change Key</button>}
        <button type="button" className="button-secondary" onClick={() => void testConnection()} disabled={busy || state.status === 'missing'}>Test Connection</button>
        {!onboarding && <button type="button" className="button-danger" onClick={() => void removeKey()} disabled={busy || state.source !== 'secure-store'} title={state.source === 'environment' ? 'Remove the development fallback from .env.' : undefined}>Remove Key</button>}
        <button type="button" className="button-quiet" onClick={() => void window.voca.openProviderKeyPage(provider)}>Get a Key ↗</button>
      </div>
      {feedback && <p className="provider-feedback" role="status">{feedback}</p>}
    </article>
  )
}

function PageHeader({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <header className="page-header"><h1>{title}</h1><p>{description}</p></header>
}

function GeneralPage({ state }: { state: AppState }): React.JSX.Element {
  return (
    <>
      <PageHeader title="General" description="Configure how Voca listens, processes, and inserts your voice." />
      <div className={`utility-status ${state.listening ? 'is-listening' : ''}`}>
        <div><span className="status-dot" /><div><strong>{state.listening ? 'Listening' : 'Voca is ready'}</strong><p>{state.listening ? 'Release your shortcut to stop recording.' : state.hotkeyMessage}</p></div></div>
        <button type="button" className={state.listening ? 'button-secondary' : 'button-primary'} onClick={() => void window.voca.toggleListening()}>{state.listening ? 'Stop Listening' : 'Start Listening'}</button>
      </div>
      <section className="settings-group">
        <ShortcutEditor state={state} />
        <div className="preference-card">
          <div className="preference-icon"><Icon name="document" /></div>
          <div className="preference-copy"><strong>Mode</strong><span>Choose how Voca processes your speech.</span></div>
          <div className="segmented-control" aria-label="Processing mode">
            {(['raw', 'clean', 'dev-prompt'] as const).map((mode) => <button type="button" key={mode} className={state.processingMode === mode ? 'is-active' : ''} onClick={() => void window.voca.setProcessingMode(mode)}>{modeLabel(mode)}</button>)}
          </div>
        </div>
        <div className="preference-card">
          <div className="preference-icon"><Icon name="spark" /></div>
          <div className="preference-copy"><strong>Auto Paste</strong><span>Insert the result at your cursor automatically.</span></div>
          <button type="button" className={`toggle ${state.autoPaste ? 'is-on' : ''}`} role="switch" aria-checked={state.autoPaste} aria-label="Auto Paste" onClick={() => void window.voca.setAutoPaste(!state.autoPaste)}><span /></button>
        </div>
        <div className="preference-card">
          <div className="preference-icon"><Icon name="about" /></div>
          <div className="preference-copy"><strong>Overlay Style</strong><span>{state.overlayStyle === 'detailed' ? 'Show each stage of voice processing.' : 'Show only voice activity and processing.'}</span></div>
          <div className="segmented-control" aria-label="Overlay style">
            {(['detailed', 'minimal'] as const).map((style) => <button type="button" key={style} className={state.overlayStyle === style ? 'is-active' : ''} onClick={() => void window.voca.setOverlayStyle(style)}>{style[0].toUpperCase() + style.slice(1)}</button>)}
          </div>
        </div>
      </section>
      <section className="access-summary">
        <div><span className={state.microphoneStatus === 'granted' ? 'access-dot ready' : 'access-dot'} /><p><strong>Microphone</strong><span>{state.microphoneStatus === 'granted' ? 'Ready' : state.microphoneStatus}</span></p></div>
        <div><span className={state.accessibilityGranted ? 'access-dot ready' : 'access-dot'} /><p><strong>Accessibility</strong><span>{state.accessibilityGranted ? 'Ready' : 'Not enabled'}</span></p></div>
      </section>
    </>
  )
}

function ProvidersPage({ state }: { state: AppState }): React.JSX.Element {
  return <><PageHeader title="Providers" description="Manage the services Voca uses for transcription and processing." /><div className="privacy-note">Your API keys are encrypted locally on this Mac and sent only to their respective provider.</div><div className="provider-grid"><ProviderCard provider="groq" state={state.providers.groq} /><ProviderCard provider="gemini" state={state.providers.gemini} /></div></>
}

function VocabularyPage({ state }: { state: AppState }): React.JSX.Element {
  const [term, setTerm] = useState('')
  const add = async (): Promise<void> => {
    const value = term.trim()
    if (value && await window.voca.addVocabularyTerm(value)) setTerm('')
  }
  return (
    <>
      <PageHeader title="Developer Vocabulary" description="Help Voca recognize technology, API, and project names exactly." />
      <section className="vocabulary-panel">
        <div className="vocabulary-count"><strong>Saved terms</strong><span>{state.developerVocabulary.length} / 50</span></div>
        <form className="vocabulary-form" onSubmit={(event) => { event.preventDefault(); void add() }}><label className="visually-hidden" htmlFor="vocabulary-term">Developer vocabulary term</label><input id="vocabulary-term" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="e.g. useEffect, Supabase, FastAPI" maxLength={64} disabled={state.developerVocabulary.length >= 50} /><button type="submit" className="button-primary" disabled={!term.trim() || state.developerVocabulary.length >= 50}>Add Term</button></form>
        {state.developerVocabulary.length > 0 ? <ul className="vocabulary-list">{state.developerVocabulary.map((item) => <li key={item.toLocaleLowerCase('en-US')}><span>{item}</span><button type="button" onClick={() => void window.voca.removeVocabularyTerm(item)} aria-label={`Remove ${item}`}>×</button></li>)}</ul> : <div className="empty-state"><Icon name="vocabulary" /><strong>No custom terms yet</strong><span>Add names or jargon that speech recognition may miss.</span></div>}
      </section>
    </>
  )
}

function formatLatency(milliseconds: number | null): string {
  if (milliseconds === null) return '—'
  return milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(2)} s`
}

function StatsPage({ state }: { state: AppState }): React.JSX.Element {
  const metrics = [
    ['Dictations', state.stats.totalSuccessfulDictations.toLocaleString()],
    ['Words', state.stats.totalWordsGenerated.toLocaleString()],
    ['Avg transcription', formatLatency(state.stats.averageTranscriptionLatencyMs)],
    ['Avg Gemini', formatLatency(state.stats.averageProcessingLatencyMs)],
    ['Avg total', formatLatency(state.stats.averageTotalLatencyMs)]
  ]
  return <><PageHeader title="Stats" description="A private, local view of your Voca usage and performance." /><div className="stats-grid">{metrics.map(([label, value], index) => <article key={label} className={index === 0 ? 'stat-featured' : ''}><span>{label}</span><strong>{value}</strong>{index === 0 && <small>successful voice captures</small>}</article>)}</div><p className="stats-privacy">Only aggregate counts and timings are stored. Voca never stores transcript content in stats.</p></>
}

function AboutPage({ state }: { state: AppState }): React.JSX.Element {
  return <div className="about-page"><BrandMark size="large" /><h1>Voca</h1><p className="about-tagline">Voice to intent, instantly.</p><p className="about-description">A focused macOS voice utility for clean dictation and developer-ready prompts.</p><span className="version-label">Version {state.appVersion}</span><div className="about-divider" /><p className="privacy-copy"><strong>Private by design</strong><span>Audio and text are sent only to your configured providers when required. Voca stores no transcript history.</span></p></div>
}

const NAV_ITEMS: Array<{ id: SettingsPage; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Providers' },
  { id: 'vocabulary', label: 'Developer Vocabulary' },
  { id: 'stats', label: 'Stats' },
  { id: 'about', label: 'About' }
]

function Settings({ state }: { state: AppState }): React.JSX.Element {
  const [page, setPage] = useState<SettingsPage>('general')
  return (
    <main className="settings-shell">
      <aside className="settings-sidebar">
        <div className="sidebar-drag-region" />
        <div className="sidebar-brand"><BrandMark size="small" /><strong>Voca</strong></div>
        <nav aria-label="Settings sections">{NAV_ITEMS.map((item) => <button type="button" key={item.id} className={page === item.id ? 'is-active' : ''} onClick={() => setPage(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-footer"><span className="sidebar-ready-dot" /><span>{state.listening ? 'Listening' : 'Ready'}</span></div>
      </aside>
      <section className="settings-content">
        {page === 'general' && <GeneralPage state={state} />}
        {page === 'providers' && <ProvidersPage state={state} />}
        {page === 'vocabulary' && <VocabularyPage state={state} />}
        {page === 'stats' && <StatsPage state={state} />}
        {page === 'about' && <AboutPage state={state} />}
      </section>
    </main>
  )
}

const ONBOARDING_STEPS = ['Welcome', 'API Setup', 'Permissions', 'Shortcut', 'Test', 'Finish']

function Onboarding({ state }: { state: AppState }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [finishFeedback, setFinishFeedback] = useState('')
  const providersReady = state.providers.groq.status === 'connected' && state.providers.gemini.status === 'connected'
  const finish = async (): Promise<void> => {
    if (!await window.voca.completeOnboarding()) setFinishFeedback('Add both provider keys before finishing setup.')
  }
  const nextDisabled = step === 1 && !providersReady
  const nextLabel = step === 0 ? 'Get Started  →' : step === 5 ? 'Done' : 'Continue'

  return (
    <main className="onboarding-shell">
      <div className="onboarding-drag-region" />
      <ol className="step-indicator">{ONBOARDING_STEPS.map((label, index) => <li key={label} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}><span>{index < step ? '✓' : index + 1}</span><small>{label}</small></li>)}</ol>
      <section className={`onboarding-content onboarding-step-${step}`}>
        {step === 0 && <div className="welcome-step"><BrandMark size="large" /><h1>Welcome to Voca</h1><p>Turn your voice into clean text and developer prompts.</p><div className="value-grid"><article><span><Icon name="spark" /></span><strong>Speak anywhere</strong><p>Hold a shortcut and start talking.</p></article><article><span><Icon name="document" /></span><strong>Clean text or structured prompts</strong><p>Turn natural speech into useful output.</p></article><article><span><Icon name="command" /></span><strong>Built for developers</strong><p>Works in any app on your Mac.</p></article></div></div>}
        {step === 1 && <div className="onboarding-section"><PageHeader title="Connect your providers" description="Groq transcribes audio. Gemini powers Clean and Dev Prompt modes." /><div className="provider-grid"><ProviderCard provider="groq" state={state.providers.groq} onboarding /><ProviderCard provider="gemini" state={state.providers.gemini} onboarding /></div></div>}
        {step === 2 && <div className="onboarding-section"><PageHeader title="Grant permissions" description="Voca only asks for the macOS access required by its voice workflow." /><div className="permissions-list"><article><div className="permission-icon">●</div><div><strong>Microphone</strong><span>Record your voice while the shortcut is held.</span></div><span className={`status-badge ${state.microphoneStatus === 'granted' ? 'status-connected' : 'status-missing'}`}>{state.microphoneStatus === 'granted' ? 'Ready' : state.microphoneStatus}</span><button type="button" className="button-secondary" onClick={() => void window.voca.requestMicrophonePermission()}>Request</button><button type="button" className="button-quiet" onClick={() => void window.voca.openPermissionSettings('microphone')}>Settings</button></article><article><div className="permission-icon">⌘</div><div><strong>Accessibility</strong><span>Hold-to-talk, selection capture, and auto-paste.</span></div><span className={`status-badge ${state.accessibilityGranted ? 'status-connected' : 'status-missing'}`}>{state.accessibilityGranted ? 'Ready' : 'Not enabled'}</span><button type="button" className="button-secondary" onClick={() => void window.voca.requestAccessibilityPermission()}>Request</button><button type="button" className="button-quiet" onClick={() => void window.voca.openPermissionSettings('accessibility')}>Settings</button></article><article><div className="permission-icon">⌨</div><div><strong>Input Monitoring</strong><span>May be required for the global keyboard hook.</span></div><button type="button" className="button-secondary" onClick={() => void window.voca.openPermissionSettings('input-monitoring')}>Open Settings</button></article></div><p className="permission-note">Restart Voca after changing Accessibility or Input Monitoring permissions.</p></div>}
        {step === 3 && <div className="onboarding-section shortcut-onboarding"><PageHeader title="Choose your shortcut" description="Use the current shortcut or record a new push-to-talk combination." /><div className="shortcut-hero"><span>Current shortcut</span><kbd>{formatHotkey(state.hotkey)}</kbd><small>{state.hotkeyMode === 'hold' ? 'Hold to talk' : 'Toggle fallback mode'}</small></div><ShortcutEditor state={state} /></div>}
        {step === 4 && <div className="test-step"><BrandMark size="medium" /><h1>Test Voca</h1><p>Hold <kbd>{formatHotkey(state.hotkey)}</kbd> and say:</p><blockquote>“Voca is working.”</blockquote><ListeningBars muted={!state.listening} /><span>{state.listening ? 'Listening now… release when finished.' : state.hotkeyMessage}</span></div>}
        {step === 5 && <div className="finish-step"><div className="finish-check">✓</div><BrandMark size="medium" /><h1>You’re all set.</h1><p>Voca is ready in your menu bar. Hold <kbd>{formatHotkey(state.hotkey)}</kbd> whenever you want to speak.</p>{finishFeedback && <p className="provider-feedback">{finishFeedback}</p>}</div>}
      </section>
      <footer className={`onboarding-actions onboarding-actions-step-${step}`}><button type="button" className="button-quiet" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button><button type="button" className="button-primary onboarding-next" onClick={() => step === 5 ? void finish() : setStep(step + 1)} disabled={nextDisabled}>{nextLabel}</button></footer>
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
