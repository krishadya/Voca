import { clipboard, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { restoreClipboard, snapshotClipboard } from './clipboard-utils'
import type { ClipboardSnapshot } from './clipboard-utils'

const CLIPBOARD_SETTLE_MS = 100
const CLIPBOARD_RESTORE_MS = 900

export interface TextInsertionResult {
  status: 'pasted' | 'copied' | 'copy-failed'
  clipboardRestored: boolean
  error?: string
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
  async insert(text: string, autoPaste: boolean): Promise<TextInsertionResult> {
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

    try {
      await clipboard.writeText(text)
      await wait(CLIPBOARD_SETTLE_MS)
      uIOhook.keyTap(UiohookKey.V, [UiohookKey.Meta])
    } catch (error) {
      return copyForManualPaste(text, error)
    }

    await wait(CLIPBOARD_RESTORE_MS)

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
