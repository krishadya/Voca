# Voca

Voca is a macOS-first desktop voice tool. Hold the configured push-to-talk shortcut to record, release it to transcribe with Groq, and optionally transform and insert the text with Gemini.

This milestone includes first-run setup, secure local API-key management, transcription, lightweight text processing, auto-paste, session-scoped app/selection context, custom developer vocabulary, and local aggregate performance stats. It does not include accounts, history, repository indexing, commands, analytics, or a database.

## Current milestone

- Electron + React + TypeScript, built with electron-vite
- Context-isolated renderer with a narrow preload IPC bridge
- First-run onboarding for providers, permissions, shortcut selection, and a voice test
- Groq and Gemini key management backed by Electron `safeStorage`
- Menu-bar controls for starting/stopping, opening Settings, and quitting
- Customizable push-to-talk shortcut (F8 by default)
- Hold-to-talk when macOS Accessibility access is available
- Automatic toggle fallback when native key monitoring cannot start
- Microphone capture with `MediaRecorder`; recordings are not saved to disk
- Groq speech-to-text using `whisper-large-v3-turbo`
- Optional Gemini processing using `gemini-3.5-flash-lite`
- Raw, Clean, and Dev Prompt modes selected from the menu bar
- Frontmost-app and selected-text context in Dev Prompt mode
- Persistent developer vocabulary hints for Groq and Gemini
- Local aggregate timing and word-count stats
- Optional automatic insertion into the currently focused macOS text field
- Non-focusable overlay with Listening, Transcribing, Processing, result, and failure states

## Install and run

Requirements: macOS, Node.js 22.12 or newer, and npm.

```bash
npm install
npm run dev
```

On first launch, Voca opens its setup flow. Add Groq and Gemini keys there; no `.env` editing is required. Both keys are handled by the Electron main process and are not returned to the React renderer after entry.

For development, `.env` remains an optional fallback:

```bash
cp .env.example .env
# Optionally add GROQ_API_KEY and GEMINI_API_KEY
```

A key saved in Settings takes priority over the matching `.env` value. Removing a saved key returns that provider to the `.env` fallback when one exists. Do not commit `.env`.

The app runs in the menu bar. Click the Voca microphone icon for controls or choose **Settings…**.

## Onboarding and API keys

Voca shows onboarding until setup is completed. It covers the voice workflow, Groq and Gemini keys, macOS permissions, the current push-to-talk shortcut, and a short voice test. Completion is stored as a boolean in Voca's local `settings.json`; existing development installs with both `.env` keys are migrated as already configured.

In **Settings… → Providers / API Keys**, each provider shows Connected, Missing, or Invalid plus a Valid, Invalid, or Not tested connection state. **Test Connection** performs a lightweight authenticated model-list request to that provider. It does not upload audio or prompt text.

User-entered keys are encrypted with Electron `safeStorage` before Voca writes them to `provider-keys.json` in the app's user-data directory. On macOS, `safeStorage` uses Keychain-backed encryption. Only encrypted ciphertext is stored in that file; keys are decrypted only in the main process when needed. Groq receives its key only for Groq requests, and Google receives its key only for Gemini requests.

## Processing modes

Choose **Mode** from the Voca menu-bar menu:

- **Raw** displays Groq's transcript unchanged and does not call Gemini.
- **Clean** removes speech artifacts and fixes basic writing while preserving meaning. This is the default.
- **Dev Prompt** turns spoken developer intent into a concise coding-agent prompt without adding requirements. It can use the app and selected text captured when listening starts.

The selected mode is saved in Voca's local Electron user-data directory and restored at the next launch.

## Developer vocabulary

Open **Settings…** from the menu bar and add up to 50 technology, API, or project terms under **Developer Vocabulary**. Terms are stored in Voca's local `settings.json`, preserve the casing you enter, and can be removed at any time.

Voca passes a concise subset of the terms to Groq's supported transcription `prompt` parameter to improve recognition of unfamiliar spelling. The full list is passed to Gemini in Clean and Dev Prompt modes as reference-only spelling context. Both prompts explicitly say to use a term only when the spoken input actually refers to it.

## Performance stats

Each successful dictation measures recording duration, Groq transcription latency, Gemini processing latency, total time from shortcut release to final output, and final word count. Raw mode reports Gemini processing as not applicable.

The Settings **Stats** section shows successful dictations, total words, and average transcription, Gemini, and total latency. Only cumulative counts and timing totals are persisted in `settings.json`; per-recording metrics appear in development logs but transcript content is never added to metrics. Voca does not send metrics anywhere.

## Dev Prompt context

At the start of each recording, Voca takes a one-time snapshot of the frontmost app's display name and bundle identifier. It also attempts to read selected text by snapshotting the clipboard, issuing Command+C without changing focus, reading up to 8,000 characters, and immediately restoring the clipboard. Raw and Clean never send this context to Gemini.

Selected text is treated as supporting context; the spoken request remains the primary instruction. Voca does not inspect the current repository, run commands, or continuously monitor applications.

## Auto Paste

**Auto Paste** is enabled by default in the Voca menu-bar menu and is saved between launches.

- When enabled, Voca snapshots the clipboard, puts the final text on it, sends Command+V through the native input hook, and restores the previous clipboard after a short delay.
- When disabled, Voca copies the final text and shows **Copied — paste manually** without sending Command+V.
- If Accessibility permission is unavailable or insertion throws an error, Voca falls back to the same copy-only behavior.

The overlay is non-focusable, so the application and text field active when recording begins remain focused during transcription and processing.

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
2. **Accessibility** — requested for reliable global key-down/key-up monitoring, selection capture, and auto-paste. Enable Voca (or Electron while running in development) in **System Settings → Privacy & Security → Accessibility**, then restart the app.

Depending on the macOS version and how the app is launched, macOS may place the native keyboard hook under **Input Monitoring** instead. If the configured shortcut does not respond after enabling Accessibility, also enable Voca/Electron in **System Settings → Privacy & Security → Input Monitoring** and restart.

Voca continues to work without Accessibility/Input Monitoring access: the configured shortcut switches to toggle mode, and the menu-bar Start/Stop control always remains available. The Settings screen shows which shortcut mode is active.

## Push-to-talk shortcut

The default shortcut is **F8**. Open **Settings… → Push-to-Talk Shortcut**, choose **Change Shortcut**, then press the new combination. Escape cancels capture, and **Reset to F8** restores the default. Changes apply immediately and are saved in the same local `settings.json` as the other preferences.

Supported base keys are F1–F12, Space, and A–Z. Space and letter keys require at least one Command, Control, Option, or Shift modifier. Modifier-only and selected macOS/app-reserved shortcuts are rejected without replacing the working shortcut.

- **Hold mode:** hold the configured shortcut to listen; release its base key or a required modifier to stop.
- **Fallback mode:** press the configured shortcut once to start and again to stop.

## Known limitations

- This milestone targets macOS only and is not code-signed or notarized.
- Secure key storage uses the macOS Keychain. Because development builds are unsigned, macOS may show Keychain prompts again when the Electron binary changes; a consistently signed production build avoids that behavior.
- Provider validation requires network access. Temporary provider/network failures remain **Not tested**; explicit authentication rejections are shown as **Invalid**.
- Validation state is session-only and returns to **Not tested** after restart; keys and onboarding completion remain persisted.
- Completing onboarding requires both provider keys. At runtime, Raw mode only needs Groq, while Clean and Dev Prompt also need Gemini.
- Permission changes generally require restarting the app.
- Development permission entries belong to the Electron development binary; a packaged Voca app receives its own entries.
- The native hook can require both Accessibility and Input Monitoring on some macOS versions. The app falls back cleanly to toggle behavior when Accessibility access is unavailable or hook startup fails.
- Recordings are held in memory, uploaded to Groq for transcription, and not stored permanently by Voca.
- English is fixed as the transcription language for now.
- Groq currently accepts direct uploads up to 25 MB on its free tier; Voca rejects larger recordings.
- Clean and Dev Prompt require network access and a valid Gemini API key. Raw mode requires only Groq.
- Successful automatic insertion briefly shows **Pasted**. Copy-only results stay visible for roughly 7–15 seconds, then disappear without being saved.
- Auto Paste requires macOS Accessibility permission. Depending on macOS, Input Monitoring may also be required by the native hook.
- Voca restores clipboard formats that Electron can read and materialize. Platform-specific or application-private clipboard formats may not be restorable.
- Clipboard restoration is skipped if the clipboard changes during the paste delay, preventing Voca from overwriting a newer user copy operation.
- Voca cannot reliably detect a target application that accepts Command+V but ignores the paste. In that rare case the operation may still be reported as pasted.
- Because Voca never takes focus, insertion normally returns to the original field. If the user deliberately switches apps or moves focus while processing, Command+V goes to the newly focused field.
- Selected-text capture uses a brief Command+C clipboard fallback. Apps that copy a whole line when nothing is selected may provide that line as context.
- Selection context is limited to 8,000 characters and only Electron-readable clipboard formats can be preserved and restored.
- Secure/password fields and applications that block synthetic copy events provide no selection context; recording and processing continue normally.
- Frontmost-app metadata is captured once when recording starts and is not updated if the user changes apps during processing.
- Groq limits transcription prompts to 224 tokens, so Voca bounds its spelling hint; unusually large vocabulary lists may not fit entirely in the Groq hint. Gemini still receives the full saved list.
- Average Gemini latency includes only successful Clean and Dev Prompt requests. Raw dictations are excluded from that average.
- The native hook observes shortcuts but does not suppress them. A combination already used by the frontmost app may perform that app action as well, so function keys or otherwise unused combinations are safest.
- Some Mac keyboards treat F1–F12 as hardware/media controls unless the Fn key or the system's standard-function-key setting is enabled.
