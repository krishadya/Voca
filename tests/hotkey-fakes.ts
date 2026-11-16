import { EventEmitter } from 'node:events'

export const app = { isPackaged: false }
export const access = { trusted: true, nativeFails: false, registrationFails: false, fnReady: true }
const registrations = new Map<string, () => void>()
export const globalShortcut = {
  register: (key: string, callback: () => void): boolean => {
    if (access.registrationFails) return false
    registrations.set(key, callback)
    return true
  },
  unregister: (key: string): void => { registrations.delete(key) },
  isRegistered: (key: string): boolean => registrations.has(key)
}
export const systemPreferences = { isTrustedAccessibilityClient: (): boolean => access.trusted }
export const uIOhook = Object.assign(new EventEmitter(), {
  start: (): void => { if (access.nativeFails) throw new Error('Test native failure') },
  stop: (): void => {},
  keyTap: (_key: number, _modifiers: number[]): void => {}
})
// Unique key codes are sufficient for matching tests; actual native constants stay in production.
export const UiohookKey = new Proxy({} as Record<string, number>, {
  get(target, property: string): number { return target[property] ??= Object.keys(target).length + 1 }
})
export class FnControlMonitor {
  static current: FnControlMonitor
  ready = false
  starts = 0
  forceStarts = 0
  pendingStart: Promise<boolean> | null = null
  private generation = 0
  constructor(_path: string, readonly onChange: (held: boolean) => void, readonly onFailure: () => void) {
    FnControlMonitor.current = this
  }
  async start(force = false): Promise<boolean> {
    this.starts++
    if (force) this.forceStarts++
    const generation = ++this.generation
    const ready = this.pendingStart ? await this.pendingStart : access.fnReady
    if (generation !== this.generation) return false
    this.ready = ready
    return ready
  }
  async stop(): Promise<void> { ++this.generation; this.ready = false }
  fail(): void { this.ready = false; this.onFailure() }
}
export const FN_ACCESS_MESSAGE = 'Fn + Control needs native keyboard access. Select F8.'

export class ClipboardItem {
  constructor(private readonly values: Record<string, string | Blob>) {}
  get types(): string[] { return Object.keys(this.values) }
  async getType(type: string): Promise<string | Blob> { return this.values[type] }
}
let clipboardItems: ClipboardItem[] = []
export const clipboard = {
  async read(): Promise<ClipboardItem[]> { return clipboardItems },
  async write(items: ClipboardItem[]): Promise<void> { clipboardItems = items },
  async writeText(text: string): Promise<void> { clipboardItems = [new ClipboardItem({ 'text/plain': text })] },
  async readText(): Promise<string> {
    const value = await clipboardItems[0]?.getType('text/plain')
    return typeof value === 'string' ? value : value instanceof Blob ? value.text() : ''
  },
  clear(): void { clipboardItems = [] }
}
