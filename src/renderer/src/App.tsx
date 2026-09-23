import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/ipc'
import { AudioRecorder } from './AudioRecorder'

const initialState: AppState = {
  listening: false,
  hotkeyMode: 'toggle',
  hotkeyMessage: 'Starting keyboard shortcut…',
  microphoneStatus: 'unknown',
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
          <div className="brand-row">
            <span className="pulse-dot" />
            <span className="brand-label">VOCA</span>
          </div>
          <p
            className={
              state.overlayPhase === 'transcript' || state.overlayPhase === 'copied'
                ? 'transcript-text'
                : ''
            }
          >
            {message}
          </p>
        </div>
        {state.overlayPhase === 'listening' && <ListeningBars />}
        {state.overlayPhase === 'transcribing' && <ListeningBars transcribing />}
        {state.overlayPhase === 'processing' && <ListeningBars transcribing />}
        {state.overlayPhase === 'transcript' && <span className="result-mark">✓</span>}
        {state.overlayPhase === 'pasted' && <span className="result-mark">✓</span>}
        {state.overlayPhase === 'copied' && <span className="copy-mark">⌘V</span>}
        {state.overlayPhase === 'error' && <span className="error-mark">!</span>}
      </section>
    </main>
  )
}

function Settings({ state }: { state: AppState }): React.JSX.Element {
  const [vocabularyTerm, setVocabularyTerm] = useState('')
  const permissionLabel =
    state.microphoneStatus === 'granted'
      ? 'Microphone ready'
      : state.microphoneStatus === 'not-determined'
        ? 'Microphone permission will be requested on first use'
        : `Microphone: ${state.microphoneStatus}`

  const formatLatency = (milliseconds: number | null): string => {
    if (milliseconds === null) return '—'
    return milliseconds < 1_000
      ? `${Math.round(milliseconds)} ms`
      : `${(milliseconds / 1_000).toFixed(2)} s`
  }

  const addVocabularyTerm = async (): Promise<void> => {
    const term = vocabularyTerm.trim()
    if (!term) return

    const added = await window.voca.addVocabularyTerm(term)
    if (added) setVocabularyTerm('')
  }

  return (
    <main className="settings-shell">
      <AudioRecorder listening={state.listening} sessionId={state.recordingSessionId} />

      <header className="settings-header">
        <div className="app-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">VOCA</p>
          <h1>Voice, at your fingertips.</h1>
        </div>
      </header>

      <section className={`status-card ${state.listening ? 'is-listening' : ''}`}>
        <div className="status-title-row">
          <span className="status-dot" />
          <div>
            <p className="status-label">
              {state.listening
                ? 'Listening'
                : state.overlayPhase === 'transcribing'
                  ? 'Transcribing'
                  : state.overlayPhase === 'processing'
                    ? 'Processing'
                    : 'Ready'}
            </p>
            <p className="status-detail">
              {state.listening
                ? 'Release the shortcut to stop'
                : state.overlayPhase === 'transcribing'
                  ? 'Converting your recording to text…'
                  : state.overlayPhase === 'processing'
                    ? `Applying ${state.processingMode === 'clean' ? 'Clean' : 'Dev Prompt'} mode…`
                    : state.hotkeyMessage}
            </p>
          </div>
        </div>

        <button type="button" onClick={() => void window.voca.toggleListening()}>
          {state.listening ? 'Stop Listening' : 'Start Listening'}
        </button>
      </section>

      <section className="details-grid" aria-label="Voca status">
        <article>
          <p className="detail-heading">Shortcut</p>
          <p className="keycap-row">
            <kbd>F8</kbd>
          </p>
          <p>{state.hotkeyMode === 'hold' ? 'Hold to talk' : 'Toggle mode'}</p>
        </article>
        <article>
          <p className="detail-heading">Microphone</p>
          <p className="permission-state">{permissionLabel}</p>
          <p>Audio is sent to Groq after recording</p>
        </article>
      </section>

      <section className="settings-section" aria-labelledby="vocabulary-heading">
        <div className="section-heading-row">
          <div>
            <h2 id="vocabulary-heading">Developer Vocabulary</h2>
            <p>Help Voca preserve the spelling of project and technology names.</p>
          </div>
          <span>{state.developerVocabulary.length}/50</span>
        </div>

        <form
          className="vocabulary-form"
          onSubmit={(event) => {
            event.preventDefault()
            void addVocabularyTerm()
          }}
        >
          <label className="visually-hidden" htmlFor="vocabulary-term">
            Developer vocabulary term
          </label>
          <input
            id="vocabulary-term"
            value={vocabularyTerm}
            onChange={(event) => setVocabularyTerm(event.target.value)}
            placeholder="e.g. useEffect or Supabase"
            maxLength={64}
            disabled={state.developerVocabulary.length >= 50}
          />
          <button
            type="submit"
            disabled={!vocabularyTerm.trim() || state.developerVocabulary.length >= 50}
          >
            Add
          </button>
        </form>

        {state.developerVocabulary.length > 0 ? (
          <ul className="vocabulary-list" aria-label="Saved developer vocabulary">
            {state.developerVocabulary.map((term) => (
              <li key={term.toLocaleLowerCase('en-US')}>
                <span>{term}</span>
                <button
                  type="button"
                  onClick={() => void window.voca.removeVocabularyTerm(term)}
                  aria-label={`Remove ${term}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No custom terms yet.</p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="stats-heading">
        <div className="section-heading-row">
          <div>
            <h2 id="stats-heading">Stats</h2>
            <p>Aggregate performance stored only on this Mac.</p>
          </div>
        </div>

        <div className="stats-grid">
          <article>
            <strong>{state.stats.totalSuccessfulDictations.toLocaleString()}</strong>
            <span>Dictations</span>
          </article>
          <article>
            <strong>{state.stats.totalWordsGenerated.toLocaleString()}</strong>
            <span>Words</span>
          </article>
          <article>
            <strong>{formatLatency(state.stats.averageTranscriptionLatencyMs)}</strong>
            <span>Avg. transcription</span>
          </article>
          <article>
            <strong>{formatLatency(state.stats.averageProcessingLatencyMs)}</strong>
            <span>Avg. Gemini</span>
          </article>
          <article>
            <strong>{formatLatency(state.stats.averageTotalLatencyMs)}</strong>
            <span>Avg. total</span>
          </article>
        </div>
      </section>

      <footer>
        Mode:{' '}
        {state.processingMode === 'dev-prompt'
          ? 'Dev Prompt'
          : state.processingMode[0].toUpperCase() + state.processingMode.slice(1)}{' '}
        · Auto Paste {state.autoPaste ? 'On' : 'Off'} · Recordings are not saved by Voca.
      </footer>
    </main>
  )
}

function SettingsRoute(): React.JSX.Element {
  const state = useVocaState()
  return <Settings state={state} />
}

function OverlayRoute(): React.JSX.Element {
  const state = useVocaState()
  return <Overlay state={state} />
}

export function App(): React.JSX.Element {
  return window.location.hash === '#/overlay' ? <OverlayRoute /> : <SettingsRoute />
}
