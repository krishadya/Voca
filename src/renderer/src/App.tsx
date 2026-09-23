import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/ipc'
import { AudioRecorder } from './AudioRecorder'

const initialState: AppState = {
  listening: false,
  hotkeyMode: 'toggle',
  hotkeyMessage: 'Starting keyboard shortcut…',
  microphoneStatus: 'unknown',
  processingMode: 'clean',
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
          <p className={state.overlayPhase === 'transcript' ? 'transcript-text' : ''}>{message}</p>
        </div>
        {state.overlayPhase === 'listening' && <ListeningBars />}
        {state.overlayPhase === 'transcribing' && <ListeningBars transcribing />}
        {state.overlayPhase === 'processing' && <ListeningBars transcribing />}
        {state.overlayPhase === 'transcript' && <span className="result-mark">✓</span>}
        {state.overlayPhase === 'error' && <span className="error-mark">!</span>}
      </section>
    </main>
  )
}

function Settings({ state }: { state: AppState }): React.JSX.Element {
  const permissionLabel =
    state.microphoneStatus === 'granted'
      ? 'Microphone ready'
      : state.microphoneStatus === 'not-determined'
        ? 'Microphone permission will be requested on first use'
        : `Microphone: ${state.microphoneStatus}`

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

      <footer>
        Mode:{' '}
        {state.processingMode === 'dev-prompt'
          ? 'Dev Prompt'
          : state.processingMode[0].toUpperCase() + state.processingMode.slice(1)}{' '}
        · Recordings are not saved by Voca.
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
