import { randomUUID } from 'node:crypto'
import { clipboard, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { restoreClipboard, snapshotClipboard } from './clipboard-utils'
import { clipboardCoordinator } from './clipboard-coordinator'

const MAX_SELECTED_TEXT_CHARACTERS = 8_000
const SENTINEL_SETTLE_MS = 60
const COPY_SETTLE_MS = 220
const RESTORE_RETRY_MS = 60

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Reads selected text without taking focus. Clipboard work is serialized so a
 * rapid second recording cannot overlap the previous session's restoration.
 */
export class SelectedTextService {
  capture(isCurrent: () => boolean = () => true): Promise<string | null> {
    return clipboardCoordinator.run(() => isCurrent() ? this.captureNow(isCurrent) : Promise.resolve(null))
  }

  private async captureNow(isCurrent: () => boolean): Promise<string | null> {
    if (process.platform !== 'darwin') return null
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return null

    let snapshot
    try {
      snapshot = await snapshotClipboard()
    } catch {
      // Never overwrite a clipboard that Voca could not first preserve.
      return null
    }

    const sentinel = `voca-no-selection-${randomUUID()}`
    let selectedText: string | null = null
    if (!isCurrent()) return null

    try {
      await clipboard.writeText(sentinel)
      await wait(SENTINEL_SETTLE_MS)
      if (!isCurrent()) return null // finally still restores the snapshot
      uIOhook.keyTap(UiohookKey.C, [UiohookKey.Meta])
      await wait(COPY_SETTLE_MS)

      const copiedText = await clipboard.readText()
      if (copiedText !== sentinel && copiedText.trim().length > 0) {
        selectedText = copiedText.slice(0, MAX_SELECTED_TEXT_CHARACTERS)
      }
    } catch {
      selectedText = null
    } finally {
      try {
        await restoreClipboard(snapshot)
      } catch {
        try {
          await wait(RESTORE_RETRY_MS)
          await restoreClipboard(snapshot)
        } catch (error) {
          console.warn('[context] Clipboard restoration after selection capture failed:', error)
        }
      }
    }

    return selectedText
  }
}
