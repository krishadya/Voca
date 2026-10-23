<p align="center">
  <img src="build/voca-icon-source.png" width="128" alt="Voca app icon">
</p>

<h1 align="center">Voca</h1>

<p align="center">
  <strong>Voice to intent, instantly.</strong>
</p>

<p align="center">
  <img alt="macOS Apple Silicon and Intel" src="https://img.shields.io/badge/macOS-Apple_Silicon_%2B_Intel-19191C?style=flat-square&logo=apple&logoColor=E8BC68">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-19191C?style=flat-square&logo=electron&logoColor=E8BC68">
  <img alt="React" src="https://img.shields.io/badge/React-19191C?style=flat-square&logo=react&logoColor=E8BC68">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-19191C?style=flat-square&logo=typescript&logoColor=E8BC68">
  <img alt="Groq Whisper" src="https://img.shields.io/badge/Groq-Whisper-19191C?style=flat-square">
  <img alt="Gemini" src="https://img.shields.io/badge/Gemini-AI-19191C?style=flat-square&logo=googlegemini&logoColor=E8BC68">
  <a href="https://github.com/krishadya/Voca/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/v/release/krishadya/Voca?style=flat-square&color=E8BC68&labelColor=19191C">
  </a>
</p>

<p align="center">
  Voca is a macOS menu-bar utility that turns natural speech into raw transcripts,
  polished text, or structured developer prompts and inserts the result directly
  into the app you're already using.
</p>

<p align="center">
  <a href="https://krishadya.github.io/Voca/"><strong>Website</strong></a>
  ·
  <a href="https://github.com/krishadya/Voca/releases/latest"><strong>Download</strong></a>
  ·
  <a href="https://github.com/krishadya/Voca"><strong>GitHub</strong></a>
</p>

<p align="center">
  <img src="docs/assets/voca-hero.png" width="960" alt="Voca General settings">
</p>

## Demo

See Voca go from **speech → transcription → developer intent → automatic insertion**.

[Watch the Voca demo](https://youtu.be/BrCJY8J4uFc)

## Features

- Configurable global hold-to-talk shortcut with a Fn + Control default; F8 remains selectable
- Groq `whisper-large-v3-turbo` transcription
- Raw, Clean, and Dev Prompt processing modes
- Active-app and selected-text context for developer prompts
- Automatic insertion into the active application
- Custom developer vocabulary for technical names and casing
- Detailed and Minimal floating overlays
- First-run onboarding with encrypted API-key storage
- Local aggregate performance stats without transcript history

## Modes

| Mode | Behavior |
| --- | --- |
| **Raw** | Returns the Groq transcript unchanged. Gemini is not called. |
| **Clean** | Removes filler and repetition while correcting punctuation, capitalization, and obvious grammar without changing meaning. |
| **Dev Prompt** | Turns spoken developer intent into a concise coding-agent prompt using active-app and selected-text context when relevant. |

## Product showcase

### Dev Prompt in context

<p align="center">
  <img src="docs/assets/voca-dev-prompt.png" width="920" alt="Voca Dev Prompt mode in a developer workflow">
</p>

<p align="center">
  <sub>Turn spoken requirements and surrounding context into a focused coding-agent prompt.</sub>
</p>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/voca-vocabulary.png" width="100%" alt="Voca Developer Vocabulary settings">
      <br>
      <sub><strong>Developer Vocabulary</strong><br>Preserve technical names and exact casing.</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/voca-stats.png" width="100%" alt="Voca local performance statistics">
      <br>
      <sub><strong>Local Stats</strong><br>Track aggregate usage and latency.</sub>
    </td>
  </tr>
</table>

## How it works

```text
Voice
  → Groq Whisper transcription
  → optional selected-text + active-app context
  → Gemini intent processing
  → clipboard + native paste
  → active application
```

Raw mode skips Gemini. Selected-text and active-app context are used only in Dev Prompt mode.

## Architecture

```mermaid
flowchart LR
    User["Push-to-talk shortcut"]
    Hotkey["HotkeyService<br/>uiohook-napi"]
    Main["Electron main process<br/>workflow orchestration"]
    Preload["Context-isolated preload<br/>narrow IPC bridge"]
    Renderer["React renderer<br/>UI + MediaRecorder"]
    Groq["Groq transcription"]
    Context["ActiveAppService<br/>SelectedTextService"]
    Gemini["Gemini processing"]
    Insert["TextInsertionService<br/>clipboard + Command-V"]
    Target["Active macOS application"]
    Settings["Local settings"]
    Keys["Electron safeStorage"]

    User --> Hotkey
    Hotkey --> Main
    Main <--> Preload
    Preload <--> Renderer
    Renderer -->|audio ArrayBuffer| Main
    Main -->|audio in memory| Groq
    Groq --> Main
    Context --> Main
    Main -->|Clean or Dev Prompt| Gemini
    Main --> Insert
    Insert --> Target
    Settings <--> Main
    Keys <--> Main
```

The renderer runs with `contextIsolation` enabled and without Node integration. Provider credentials and API requests remain in the main process behind a narrowly scoped preload bridge.

## Privacy & Security

- Groq and Gemini API keys are encrypted locally with Electron `safeStorage`.
- Audio is processed in memory and is not saved to disk by Voca.
- Transcript content is not persisted.
- Transcript logging is disabled in packaged builds.
- Only aggregate counts and latency data are stored for Stats.
- Voca has no accounts, backend, analytics service, or database.

Relevant audio, text, and context are still sent to the configured provider APIs when required and are subject to their respective policies.

## Installation

The latest release, **Voca v0.1.3**, is available for both Apple Silicon and Intel Macs:

- Apple Silicon Macs: `Voca-0.1.3-arm64.dmg`
- Intel Macs: `Voca-0.1.3-x64.dmg`

1. Download the latest DMG from [GitHub Releases](https://github.com/krishadya/Voca/releases/latest).
2. Open it and drag **Voca** into **Applications**.
3. Launch Voca and complete onboarding with your own Groq and Gemini API keys.
4. Grant **Microphone** and **Accessibility** permission. Some Macs may also require **Input Monitoring**.

### Push-to-talk shortcut

Hold **Fn + Control** to record, then release either key to stop. Either Control key works,
and F8 does not need to be held. The Fn shortcut is hold-only: it never falls back to toggling.
Select **Fn + Control (default)**, **Use F8**, or **Change** in General Settings or onboarding.
If your keyboard does not expose macOS Fn/Globe events, use F8 or another supported shortcut.
F8 and custom shortcuts retain their existing Accessibility-dependent hold/toggle fallback.

Fn + Control uses a passive macOS keyboard listener. If access is unavailable, Voca shows
a permission message instead of registering a toggle. Enable Accessibility/Input Monitoring
for Voca (or the development app/helper if macOS lists it), then select **Fn + Control (default)**
to retry. macOS Fn/Globe actions remain active; set “Press Fn/Globe key to” to “Do Nothing”
in Keyboard settings if its system action interferes.

New profiles use Fn + Control. Settings without a shortcut, or explicitly marked as using
the default, migrate automatically. Legacy saved F8 choices are ambiguous because older
versions did not record whether they were customized; they are preserved. Select the new
default once to switch. Explicit custom shortcuts, including F8, stay saved across restarts.

### Gatekeeper

The current build is unsigned and not notarized.

On first launch, macOS may block Voca. Control-click **Voca.app**, choose **Open**, and confirm.

If it is still blocked, go to:

**System Settings → Privacy & Security → Open Anyway**

## Development

Requires macOS, Node.js 22.12 or newer, npm, and Xcode Command Line Tools (`xcode-select --install`).
`npm run dev` and `npm run build` compile the passive Fn listener for both arm64 and x64;
packaging includes this universal executable alongside the app.

```bash
git clone https://github.com/krishadya/Voca.git
cd Voca

npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm run build
```

Shortcut regression checks: `npm run test:hotkeys`. On Apple Silicon with Rosetta,
`npm run test:hotkeys -- --x64` also executes the tests as x64. This is not a substitute
for testing real keyboards on an Intel Mac.

Before releasing the new default, manually test on both Apple Silicon and Intel:
Fn-first and Control-first presses, release either key first, short taps, repeated
dictations, fullscreen apps, permission denial/recovery, and switching between
Fn + Control, F8, and a custom shortcut. Verify a fresh profile defaults to Fn + Control
and a saved custom shortcut survives restarting. Test an external keyboard without
macOS Fn events using the F8 alternative.

## Known limitations

- macOS only
- The app and DMG are unsigned and not notarized
- Groq and Gemini require internet access and user-provided API keys
- Fn + Control requires a keyboard that exposes macOS Fn events; Fn alone and arbitrary chords such as `Space + P` are unsupported

## Tech stack

| Area | Technology |
| --- | --- |
| Desktop | Electron, Electron Builder |
| UI | React, TypeScript, CSS |
| Build | electron-vite, Vite, npm |
| Speech-to-text | Groq API, `whisper-large-v3-turbo` |
| Intent processing | Gemini API |
| Global input | `uiohook-napi`, Electron `globalShortcut` fallback |
| Secure storage | Electron `safeStorage` |

## Author

**Krish Adya**

- GitHub: [github.com/krishadya](https://github.com/krishadya)
- Portfolio: [krish.copasite.in](https://krish.copasite.in)
- LinkedIn: [linkedin.com/in/krish-adya-91a4822b3](https://www.linkedin.com/in/krish-adya-91a4822b3/)
