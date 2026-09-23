import { globalShortcut, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { HotkeyMode } from '../shared/ipc'

interface HotkeyServiceOptions {
  onPressed: () => void
  onReleased: () => void
  onToggle: () => void
}

export interface HotkeyStatus {
  mode: HotkeyMode
  message: string
}

const FALLBACK_ACCELERATOR = 'F8'

/**
 * Owns the platform-specific keyboard monitoring implementation.
 * Consumers only deal with press/release/toggle callbacks so this can be
 * replaced without touching the listening state machine.
 */
export class HotkeyService {
  private held = false
  private usingNativeHook = false

  constructor(private readonly options: HotkeyServiceOptions) {}

  start(): HotkeyStatus {
    if (process.platform === 'darwin') {
      const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true)

      if (accessibilityGranted) {
        try {
          this.startNativeHook()
          return {
            mode: 'hold',
            message: 'Hold F8 to talk'
          }
        } catch (error) {
          console.warn('[hotkey] Native hook failed; using toggle fallback.', error)
        }
      } else {
        console.info('[hotkey] Accessibility access is not enabled; using toggle fallback.')
      }
    }

    return this.startToggleFallback()
  }

  stop(): void {
    if (this.usingNativeHook) {
      uIOhook.removeAllListeners('keydown')
      uIOhook.removeAllListeners('keyup')
      uIOhook.stop()
      this.usingNativeHook = false
      this.held = false
    }

    globalShortcut.unregister(FALLBACK_ACCELERATOR)
  }

  private startNativeHook(): void {
    uIOhook.on('keydown', (event) => {
      if (event.keycode !== UiohookKey.F8 || this.held) return

      this.held = true
      this.options.onPressed()
    })

    uIOhook.on('keyup', (event) => {
      if (event.keycode !== UiohookKey.F8 || !this.held) return

      this.held = false
      this.options.onReleased()
    })

    uIOhook.start()
    this.usingNativeHook = true
  }

  private startToggleFallback(): HotkeyStatus {
    const registered = globalShortcut.register(FALLBACK_ACCELERATOR, this.options.onToggle)

    if (!registered) {
      return {
        mode: 'toggle',
        message: 'F8 is unavailable; use the menu-bar control'
      }
    }

    return {
      mode: 'toggle',
      message: 'F8 toggles listening (enable Accessibility access for hold-to-talk)'
    }
  }
}
