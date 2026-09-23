import { globalShortcut, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import type { HotkeyMode } from '../shared/ipc'
import {
  copyHotkey,
  formatHotkey,
  hotkeyToAccelerator,
  validateHotkey
} from '../shared/hotkey'
import type { HotkeyActionResult, HotkeyConfig, HotkeyModifier } from '../shared/hotkey'

interface HotkeyServiceOptions {
  shortcut: HotkeyConfig
  onPressed: () => void
  onReleased: () => void
  onToggle: () => void
}

export interface HotkeyStatus {
  mode: HotkeyMode
  message: string
}

const KEY_CODES: Record<HotkeyConfig['key'], number> = {
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,
  Space: UiohookKey.Space,
  A: UiohookKey.A,
  B: UiohookKey.B,
  C: UiohookKey.C,
  D: UiohookKey.D,
  E: UiohookKey.E,
  F: UiohookKey.F,
  G: UiohookKey.G,
  H: UiohookKey.H,
  I: UiohookKey.I,
  J: UiohookKey.J,
  K: UiohookKey.K,
  L: UiohookKey.L,
  M: UiohookKey.M,
  N: UiohookKey.N,
  O: UiohookKey.O,
  P: UiohookKey.P,
  Q: UiohookKey.Q,
  R: UiohookKey.R,
  S: UiohookKey.S,
  T: UiohookKey.T,
  U: UiohookKey.U,
  V: UiohookKey.V,
  W: UiohookKey.W,
  X: UiohookKey.X,
  Y: UiohookKey.Y,
  Z: UiohookKey.Z
}

const MODIFIER_KEY_CODES: Record<HotkeyModifier, readonly number[]> = {
  Command: [UiohookKey.Meta, UiohookKey.MetaRight],
  Control: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Option: [UiohookKey.Alt, UiohookKey.AltRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight]
}

function hasModifier(hotkey: HotkeyConfig, modifier: HotkeyModifier): boolean {
  return hotkey.modifiers.includes(modifier)
}

function modifiersMatch(event: UiohookKeyboardEvent, hotkey: HotkeyConfig): boolean {
  return (
    event.metaKey === hasModifier(hotkey, 'Command') &&
    event.ctrlKey === hasModifier(hotkey, 'Control') &&
    event.altKey === hasModifier(hotkey, 'Option') &&
    event.shiftKey === hasModifier(hotkey, 'Shift')
  )
}

/**
 * Owns global shortcut matching and the permission fallback. The native hook
 * remains installed during changes and reads the current shortcut atomically.
 */
export class HotkeyService {
  private shortcut: HotkeyConfig
  private held = false
  private suspended = false
  private usingNativeHook = false
  private started = false

  constructor(private readonly options: HotkeyServiceOptions) {
    this.shortcut = copyHotkey(options.shortcut)
  }

  start(): HotkeyStatus {
    this.started = true

    if (process.platform === 'darwin') {
      const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true)

      if (accessibilityGranted) {
        try {
          this.startNativeHook()
          return this.currentStatus()
        } catch (error) {
          console.warn('[hotkey] Native hook failed; using toggle fallback.', error)
        }
      } else {
        console.info('[hotkey] Accessibility access is not enabled; using toggle fallback.')
      }
    }

    this.registerToggleFallback()
    return this.currentStatus()
  }

  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.held = false

    if (!this.usingNativeHook) {
      globalShortcut.unregister(hotkeyToAccelerator(this.shortcut))
    }
  }

  resume(): HotkeyActionResult {
    if (!this.suspended) return { success: true, message: this.currentStatus().message }
    this.suspended = false

    if (!this.usingNativeHook && !this.registerToggleFallback()) {
      return {
        success: false,
        message: `${formatHotkey(this.shortcut)} is unavailable; use the menu-bar control.`
      }
    }

    return { success: true, message: this.currentStatus().message }
  }

  reconfigure(nextShortcut: HotkeyConfig): HotkeyActionResult {
    const validationError = validateHotkey(nextShortcut)
    if (validationError) {
      const resumeResult = this.resume()
      return {
        success: false,
        message: resumeResult.success ? validationError : resumeResult.message
      }
    }

    const previousShortcut = this.shortcut
    const wasSuspended = this.suspended

    if (this.usingNativeHook) {
      this.shortcut = copyHotkey(nextShortcut)
      this.suspended = false
      this.held = false
      return { success: true, message: this.currentStatus().message }
    }

    const previousAccelerator = hotkeyToAccelerator(previousShortcut)
    const nextAccelerator = hotkeyToAccelerator(nextShortcut)

    if (!wasSuspended && previousAccelerator === nextAccelerator) {
      return { success: true, message: this.currentStatus().message }
    }

    if (!wasSuspended && !globalShortcut.register(nextAccelerator, this.options.onToggle)) {
      return {
        success: false,
        message: `${formatHotkey(nextShortcut)} could not be registered.`
      }
    }

    if (wasSuspended && !globalShortcut.register(nextAccelerator, this.options.onToggle)) {
      this.suspended = false
      const restored = this.registerToggleFallback()
      return {
        success: false,
        message: restored
          ? `${formatHotkey(nextShortcut)} could not be registered.`
          : `${formatHotkey(nextShortcut)} failed, and the previous shortcut is currently unavailable.`
      }
    }

    if (!wasSuspended) globalShortcut.unregister(previousAccelerator)
    this.shortcut = copyHotkey(nextShortcut)
    this.suspended = false
    return { success: true, message: this.currentStatus().message }
  }

  stop(): void {
    if (this.usingNativeHook) {
      uIOhook.removeAllListeners('keydown')
      uIOhook.removeAllListeners('keyup')
      uIOhook.stop()
      this.usingNativeHook = false
    } else {
      globalShortcut.unregister(hotkeyToAccelerator(this.shortcut))
    }

    this.started = false
    this.suspended = false
    this.held = false
  }

  private currentStatus(): HotkeyStatus {
    const display = formatHotkey(this.shortcut)

    if (this.usingNativeHook) {
      return { mode: 'hold', message: `Hold ${display} to talk` }
    }

    const registered = globalShortcut.isRegistered(hotkeyToAccelerator(this.shortcut))
    return {
      mode: 'toggle',
      message: registered
        ? `${display} toggles listening (enable Accessibility access for hold-to-talk)`
        : `${display} is unavailable; use the menu-bar control`
    }
  }

  private startNativeHook(): void {
    uIOhook.on('keydown', (event) => {
      if (this.suspended || this.held) return
      if (event.keycode !== KEY_CODES[this.shortcut.key]) return
      if (!modifiersMatch(event, this.shortcut)) return

      this.held = true
      this.options.onPressed()
    })

    uIOhook.on('keyup', (event) => {
      if (!this.held) return

      const mainKeyReleased = event.keycode === KEY_CODES[this.shortcut.key]
      const requiredModifierReleased = this.shortcut.modifiers.some((modifier) =>
        MODIFIER_KEY_CODES[modifier].includes(event.keycode)
      )
      if (!mainKeyReleased && !requiredModifierReleased) return

      this.held = false
      this.options.onReleased()
    })

    uIOhook.start()
    this.usingNativeHook = true
  }

  private registerToggleFallback(): boolean {
    if (!this.started || this.suspended) return false
    const accelerator = hotkeyToAccelerator(this.shortcut)
    if (globalShortcut.isRegistered(accelerator)) return true
    return globalShortcut.register(accelerator, this.options.onToggle)
  }
}
