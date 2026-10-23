import { app, globalShortcut, systemPreferences } from 'electron'
import { join } from 'node:path'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import type { HotkeyMode } from '../shared/ipc'
import {
  copyHotkey,
  formatHotkey,
  hotkeyToAccelerator,
  validateHotkey
} from '../shared/hotkey'
import type { HotkeyActionResult, HotkeyConfig, HotkeyModifier, StandardHotkeyKey } from '../shared/hotkey'
import { FnControlMonitor, FN_ACCESS_MESSAGE } from './fn-control-monitor'
import { logPtt } from './ptt-diagnostics'

interface HotkeyServiceOptions {
  shortcut: HotkeyConfig
  onPressed: () => void
  onReleased: () => void
  onToggle: () => void
  onStatusChanged: (status: HotkeyStatus) => void
  onNativeReleaseObserved?: (atMs: number) => void
}

export interface HotkeyStatus {
  mode: HotkeyMode
  message: string
}

const KEY_CODES: Record<StandardHotkeyKey, number> = {
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
  private reconfiguring = false
  private readonly fnMonitor: FnControlMonitor

  private readonly onKeyDown = (event: UiohookKeyboardEvent): void => {
    if (this.shortcut.key === 'FnControl' || this.suspended || this.held) return
    if (event.keycode !== KEY_CODES[this.shortcut.key]) return
    if (!modifiersMatch(event, this.shortcut)) return
    this.updateHeld(true)
  }

  private readonly onKeyUp = (event: UiohookKeyboardEvent): void => {
    if (this.shortcut.key === 'FnControl' || !this.held) return
    const mainKeyReleased = event.keycode === KEY_CODES[this.shortcut.key]
    const requiredModifierReleased = this.shortcut.modifiers.some((modifier) =>
      MODIFIER_KEY_CODES[modifier].includes(event.keycode)
    )
    if (mainKeyReleased || requiredModifierReleased) this.updateHeld(false)
  }

  constructor(private readonly options: HotkeyServiceOptions) {
    this.shortcut = copyHotkey(options.shortcut)
    const executable = app.isPackaged
      ? join(process.resourcesPath, 'voca-fn-control')
      : join(__dirname, '../../build/native/voca-fn-control')
    this.fnMonitor = new FnControlMonitor(executable, (held) => {
      if (this.shortcut.key !== 'FnControl') return
      if (held && (this.suspended || this.reconfiguring)) return
      this.updateHeld(held)
    }, () => {
      if (this.started && this.shortcut.key === 'FnControl') this.publishStatus()
    }, app.isPackaged ? undefined : (event) => {
      // Diagnostics only: keep the native protocol and chord state untouched.
      const release = /^native timeMs=(\d+).* transition=-1$/.exec(event)
      if (release) this.options.onNativeReleaseObserved?.(Number(release[1]))
      logPtt(event)
    })
  }

  async start(): Promise<HotkeyStatus> {
    this.started = true

    if (this.shortcut.key === 'FnControl') {
      if (process.platform === 'darwin') await this.fnMonitor.start()
      return this.currentStatus()
    }

    this.startStandardShortcut()
    return this.currentStatus()
  }

  private startStandardShortcut(): void {
    if (process.platform === 'darwin') {
      const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true)

      if (accessibilityGranted) {
        try {
          this.startNativeHook()
          return
        } catch (error) {
          console.warn('[hotkey] Native hook failed; using toggle fallback.', error)
        }
      } else {
        console.info('[hotkey] Accessibility access is not enabled; using toggle fallback.')
      }
    }

    this.registerToggleFallback()
  }

  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.updateHeld(false)

    if (!this.usingNativeHook) {
      const accelerator = hotkeyToAccelerator(this.shortcut)
      if (accelerator) globalShortcut.unregister(accelerator)
    }
  }

  resume(): HotkeyActionResult {
    if (!this.suspended) return { success: true, message: this.currentStatus().message }
    this.suspended = false

    if (this.shortcut.key === 'FnControl') {
      return { success: this.fnMonitor.ready, message: this.currentStatus().message }
    }

    if (!this.usingNativeHook && !this.registerToggleFallback()) {
      return {
        success: false,
        message: `${formatHotkey(this.shortcut)} is unavailable; use the menu-bar control.`
      }
    }

    return { success: true, message: this.currentStatus().message }
  }

  async reconfigure(nextShortcut: HotkeyConfig): Promise<HotkeyActionResult> {
    if (this.reconfiguring) return { success: false, message: 'A shortcut change is already in progress.' }
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

    if (nextShortcut.key === 'FnControl') {
      this.reconfiguring = true
      this.suspend()
      const ready = process.platform === 'darwin' && await this.fnMonitor.start()
      this.reconfiguring = false
      if (!this.started) return { success: false, message: 'Voca is shutting down.' }
      if (!ready) {
        this.resume()
        this.publishStatus()
        return { success: false, message: FN_ACCESS_MESSAGE }
      }
      this.stopStandardShortcut()
      this.shortcut = copyHotkey(nextShortcut)
      this.suspended = false
      this.publishStatus()
      return { success: true, message: this.currentStatus().message }
    }

    if (previousShortcut.key === 'FnControl') {
      this.suspend()
      this.shortcut = copyHotkey(nextShortcut)
      this.suspended = false
      this.startStandardShortcut()
      const accelerator = hotkeyToAccelerator(nextShortcut)!
      if (!this.usingNativeHook && !globalShortcut.isRegistered(accelerator)) {
        this.shortcut = previousShortcut
        this.publishStatus()
        return { success: false, message: `${formatHotkey(nextShortcut)} could not be registered.` }
      }
      this.fnMonitor.stop()
      this.publishStatus()
      return { success: true, message: this.currentStatus().message }
    }

    if (this.usingNativeHook) {
      this.shortcut = copyHotkey(nextShortcut)
      this.suspended = false
      this.updateHeld(false)
      this.publishStatus()
      return { success: true, message: this.currentStatus().message }
    }

    const previousAccelerator = hotkeyToAccelerator(previousShortcut)!
    const nextAccelerator = hotkeyToAccelerator(nextShortcut)!

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
    this.publishStatus()
    return { success: true, message: this.currentStatus().message }
  }

  stop(): void {
    this.started = false
    this.updateHeld(false)
    this.fnMonitor.stop()
    this.stopStandardShortcut()
    this.suspended = false
  }

  private stopStandardShortcut(): void {
    if (this.usingNativeHook) {
      uIOhook.off('keydown', this.onKeyDown)
      uIOhook.off('keyup', this.onKeyUp)
      uIOhook.stop()
      this.usingNativeHook = false
    } else {
      const accelerator = hotkeyToAccelerator(this.shortcut)
      if (accelerator) globalShortcut.unregister(accelerator)
    }
  }

  private currentStatus(): HotkeyStatus {
    const display = formatHotkey(this.shortcut)

    if (this.shortcut.key === 'FnControl') {
      return this.fnMonitor.ready
        ? { mode: 'hold', message: 'Hold Fn + Control to talk; release either key to stop' }
        : { mode: 'unavailable', message: FN_ACCESS_MESSAGE }
    }

    if (this.usingNativeHook) {
      return { mode: 'hold', message: `Hold ${display} to talk` }
    }

    const registered = globalShortcut.isRegistered(hotkeyToAccelerator(this.shortcut)!)
    return {
      mode: 'toggle',
      message: registered
        ? `${display} toggles listening (enable Accessibility access for hold-to-talk)`
        : `${display} is unavailable; use the menu-bar control`
    }
  }

  private startNativeHook(): void {
    uIOhook.on('keydown', this.onKeyDown)
    uIOhook.on('keyup', this.onKeyUp)
    try {
      uIOhook.start()
      this.usingNativeHook = true
    } catch (error) {
      uIOhook.off('keydown', this.onKeyDown)
      uIOhook.off('keyup', this.onKeyUp)
      throw error
    }
  }

  private updateHeld(held: boolean): void {
    if (this.held === held) return
    this.held = held
    logPtt(held ? 'hotkey PTT_DOWN' : 'hotkey PTT_UP', { shortcut: formatHotkey(this.shortcut) })
    if (held) this.options.onPressed()
    else this.options.onReleased()
  }

  private publishStatus(): void {
    this.options.onStatusChanged(this.currentStatus())
  }

  private registerToggleFallback(): boolean {
    if (!this.started || this.suspended) return false
    const accelerator = hotkeyToAccelerator(this.shortcut)
    if (!accelerator) return false
    if (globalShortcut.isRegistered(accelerator)) return true
    return globalShortcut.register(accelerator, this.options.onToggle)
  }
}
