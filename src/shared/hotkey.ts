export const HOTKEY_MODIFIERS = ['Command', 'Control', 'Option', 'Shift'] as const
export type HotkeyModifier = (typeof HOTKEY_MODIFIERS)[number]

export const SUPPORTED_HOTKEY_KEYS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Space',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z'
] as const

export type HotkeyKey = (typeof SUPPORTED_HOTKEY_KEYS)[number]

export interface HotkeyConfig {
  key: HotkeyKey
  modifiers: HotkeyModifier[]
}

export interface HotkeyActionResult {
  success: boolean
  message: string
}

export const DEFAULT_HOTKEY: HotkeyConfig = {
  key: 'F8',
  modifiers: []
}

export const HOTKEY_USAGE_GUIDANCE = 'Use an F-key or a shortcut with ⌘, ⌥, ⌃, or ⇧.'
export const HOTKEY_LIMITATION_NOTE =
  'Fn/Globe and multi-key chords such as Space + P are not supported.'

const RESERVED_SHORTCUTS = new Set([
  'Command+Space',
  'Command+Option+Space',
  'Command+C',
  'Command+V',
  'Command+Q',
  'Command+W',
  'Command+H',
  'Command+M',
  'Command+Control+Q'
])

function isHotkeyKey(value: unknown): value is HotkeyKey {
  return SUPPORTED_HOTKEY_KEYS.includes(value as HotkeyKey)
}

function isHotkeyModifier(value: unknown): value is HotkeyModifier {
  return HOTKEY_MODIFIERS.includes(value as HotkeyModifier)
}

export function copyHotkey(hotkey: HotkeyConfig): HotkeyConfig {
  return { key: hotkey.key, modifiers: [...hotkey.modifiers] }
}

export function normalizeHotkey(value: unknown): HotkeyConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { key?: unknown; modifiers?: unknown }
  if (!isHotkeyKey(candidate.key) || !Array.isArray(candidate.modifiers)) return null
  if (!candidate.modifiers.every(isHotkeyModifier)) return null

  const modifierSet = new Set(candidate.modifiers)
  return {
    key: candidate.key,
    modifiers: HOTKEY_MODIFIERS.filter((modifier) => modifierSet.has(modifier))
  }
}

function signature(hotkey: HotkeyConfig): string {
  return [...hotkey.modifiers, hotkey.key].join('+')
}

export function validateHotkey(hotkey: HotkeyConfig): string | null {
  if (!isHotkeyKey(hotkey.key)) return HOTKEY_USAGE_GUIDANCE
  if (!hotkey.modifiers.every(isHotkeyModifier)) return HOTKEY_USAGE_GUIDANCE

  const isFunctionKey = /^F(?:[1-9]|1[0-2])$/.test(hotkey.key)
  if (!isFunctionKey && hotkey.modifiers.length === 0) {
    return HOTKEY_USAGE_GUIDANCE
  }

  if (RESERVED_SHORTCUTS.has(signature(hotkey))) {
    return 'That shortcut is reserved by macOS or commonly used for essential app actions.'
  }

  return null
}

export function formatHotkey(hotkey: HotkeyConfig): string {
  return [...hotkey.modifiers, hotkey.key].join(' + ')
}

export function hotkeyToAccelerator(hotkey: HotkeyConfig): string {
  const modifiers = hotkey.modifiers.map((modifier) =>
    modifier === 'Option' ? 'Alt' : modifier
  )
  return [...modifiers, hotkey.key].join('+')
}
