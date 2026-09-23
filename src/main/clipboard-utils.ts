import { clipboard, ClipboardItem } from 'electron'

const BOOKMARK_MIME_TYPE = 'electron application/bookmark'

export type ClipboardSnapshot = ClipboardItem[]

/**
 * Materializes Electron-readable clipboard formats so they remain available
 * after the system clipboard changes.
 */
export async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  const currentItems = await clipboard.read()

  return Promise.all(
    currentItems.map(async (item) => {
      const materialized: Record<
        string,
        string | Electron.ClipboardBookmark | Blob | Promise<Blob | string>
      > = {}

      await Promise.all(
        item.types.map(async (type) => {
          materialized[type] =
            type === BOOKMARK_MIME_TYPE
              ? await item.getType(BOOKMARK_MIME_TYPE)
              : await item.getType(type)
        })
      )

      return new ClipboardItem(materialized)
    })
  )
}

export async function restoreClipboard(snapshot: ClipboardSnapshot): Promise<void> {
  if (snapshot.length > 0) {
    await clipboard.write(snapshot)
  } else {
    clipboard.clear()
  }
}
