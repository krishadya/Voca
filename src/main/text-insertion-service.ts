import { clipboard, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { restoreClipboard, snapshotClipboard } from './clipboard-utils'
import type { ClipboardSnapshot } from './clipboard-utils'
import { clipboardCoordinator } from './clipboard-coordinator'

const CLIPBOARD_SETTLE_MS = 100
const CLIPBOARD_RESTORE_MS = 900

export interface TextInsertionResult {
  status: 'pasted' | 'copied' | 'copy-failed' | 'cancelled'
  clipboardRestored: boolean
  error?: string
}

interface InsertionOptions {
  isCurrent?: () => boolean
  // Command+V dispatched, not proof that another app has rendered the text.
  onPasted?: () => void
  onQueueReady?: () => void
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function copyForManualPaste(text: string, error?: unknown): Promise<TextInsertionResult> {
  try {
    await clipboard.writeText(text)
    return {
      status: 'copied',
      clipboardRestored: false,
      error: error instanceof Error ? error.message : error ? String(error) : undefined
    }
  } catch (copyError) {
    return {
      status: 'copy-failed',
      clipboardRestored: false,
      error: copyError instanceof Error ? copyError.message : String(copyError)
    }
  }
}

export class TextInsertionService {
  constructor(private readonly delay: (ms: number) => Promise<void> = wait) {}

  insert(text: string, autoPaste: boolean, options: InsertionOptions = {}): Promise<TextInsertionResult> {
    return clipboardCoordinator.run(() => {
      options.onQueueReady?.()
      return this.insertNow(text, autoPaste, options)
    })
  }

  private async insertNow(text: string, autoPaste: boolean, options: InsertionOptions): Promise<TextInsertionResult> {
    const isCurrent = options.isCurrent ?? (() => true)
    const cancelled: TextInsertionResult = { status: 'cancelled', clipboardRestored: false }
    if (!isCurrent()) return cancelled
    if (!autoPaste) return copyForManualPaste(text)

    if (
      process.platform === 'darwin' &&
      !systemPreferences.isTrustedAccessibilityClient(false)
    ) {
      return copyForManualPaste(text, new Error('Accessibility permission is not enabled'))
    }

    let clipboardSnapshot: ClipboardSnapshot | null = null
    try {
      clipboardSnapshot = await snapshotClipboard()
    } catch (error) {
      console.warn('[insertion] Could not snapshot every clipboard format:', error)
    }

    if (!isCurrent()) return cancelled
    try {
      await clipboard.writeText(text)
      await this.delay(CLIPBOARD_SETTLE_MS)
      if (!isCurrent()) {
        const restored = await this.restore(text, clipboardSnapshot)
        return { ...restored, status: 'cancelled' }
      }
      uIOhook.keyTap(UiohookKey.V, [UiohookKey.Meta])
    } catch (error) {
      if (!isCurrent()) return cancelled
      return copyForManualPaste(text, error)
    }

    // Let the UI/latency metrics finish at paste dispatch, not 900ms later.
    // Restoration still holds the shared clipboard transaction until safe.
    try { options.onPasted?.() }
    catch { console.warn('[insertion] Paste notification failed.') }
    await this.delay(CLIPBOARD_RESTORE_MS)
    return this.restore(text, clipboardSnapshot)
  }

  private async restore(text: string, clipboardSnapshot: ClipboardSnapshot | null): Promise<TextInsertionResult> {
    if (clipboardSnapshot === null) {
      return { status: 'pasted', clipboardRestored: false }
    }

    try {
      const currentClipboardText = await clipboard.readText()
      if (currentClipboardText !== text) {
        console.info('[insertion] Clipboard changed after paste; skipped restoration.')
        return { status: 'pasted', clipboardRestored: false }
      }

      await restoreClipboard(clipboardSnapshot)
      return { status: 'pasted', clipboardRestored: true }
    } catch (error) {
      console.warn('[insertion] Paste succeeded, but clipboard restoration failed:', error)
      return {
        status: 'pasted',
        clipboardRestored: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
