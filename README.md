# Voca

Voca is a macOS-first desktop voice tool. Hold F8 to record, release it to transcribe the recording with Groq, and optionally transform the text with Gemini.

This milestone includes transcription and lightweight text processing. It does not include auto-paste, accounts, history, repository context, commands, or a database.

## Current milestone

- Electron + React + TypeScript, built with electron-vite
- Context-isolated renderer with a narrow preload IPC bridge
- Menu-bar controls for starting/stopping, opening Settings, and quitting
- F8 shortcut
- Hold-to-talk when macOS Accessibility access is available
- Automatic F8 toggle fallback when native key monitoring cannot start
- Microphone capture with `MediaRecorder`; recordings are not saved to disk
- Groq speech-to-text using `whisper-large-v3-turbo`
- Optional Gemini processing using `gemini-3.5-flash-lite`
- Raw, Clean, and Dev Prompt modes selected from the menu bar
- Non-focusable overlay with Listening, Transcribing, Processing, result, and failure states

## Install and run

Requirements: macOS, Node.js 22.12 or newer, and npm.

```bash
npm install
cp .env.example .env
# Add your GROQ_API_KEY and GEMINI_API_KEY to .env
npm run dev
```

Both API keys are loaded only by the Electron main process and are never exposed to the React renderer. Do not commit `.env`.

The app runs in the menu bar. Click the Voca microphone icon for controls or choose **Settings…**.

## Processing modes

Choose **Mode** from the Voca menu-bar menu:

- **Raw** displays Groq's transcript unchanged and does not call Gemini.
- **Clean** removes speech artifacts and fixes basic writing while preserving meaning. This is the default.
- **Dev Prompt** turns spoken developer intent into a concise coding-agent prompt without adding requirements.

The selected mode is saved in Voca's local Electron user-data directory and restored at the next launch.

Other useful commands:

```bash
npm run typecheck   # TypeScript checks for Electron and React
npm run build       # Type-check and create the production bundles in out/
npm run preview     # Run the production bundles locally
npm run package:mac # Create unsigned macOS distributables in release/
```

## macOS permissions

Voca requests only the permissions needed for this milestone:

1. **Microphone** — requested the first time listening starts. If denied, enable Voca (or Electron while running in development) in **System Settings → Privacy & Security → Microphone**.
2. **Accessibility** — requested for reliable global key-down/key-up monitoring. Enable Voca (or Electron while running in development) in **System Settings → Privacy & Security → Accessibility**, then restart the app.

Depending on the macOS version and how the app is launched, macOS may place the native keyboard hook under **Input Monitoring** instead. If F8 does not respond after enabling Accessibility, also enable Voca/Electron in **System Settings → Privacy & Security → Input Monitoring** and restart.

Voca continues to work without Accessibility/Input Monitoring access: F8 switches to toggle mode, and the menu-bar Start/Stop control always remains available. The Settings screen shows which shortcut mode is active.

## Current shortcut

- **Hold mode:** hold **F8** to listen; release F8 to stop.
- **Fallback mode:** press **F8** once to start and again to stop.

## Known limitations

- This milestone targets macOS only and is not code-signed or notarized.
- Permission changes generally require restarting the app.
- Development permission entries belong to the Electron development binary; a packaged Voca app receives its own entries.
- The native hook can require both Accessibility and Input Monitoring on some macOS versions. The app falls back cleanly to toggle behavior when Accessibility access is unavailable or hook startup fails.
- Recordings are held in memory, uploaded to Groq for transcription, and not stored permanently by Voca.
- English is fixed as the transcription language for now.
- Groq currently accepts direct uploads up to 25 MB on its free tier; Voca rejects larger recordings.
- Clean and Dev Prompt require network access and a valid Gemini API key. Raw mode requires only Groq.
- Final output stays visible for roughly 4.5–12 seconds based on its length, then disappears without being saved.
