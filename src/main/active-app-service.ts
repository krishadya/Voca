import { execFile } from 'node:child_process'

const LSAPPINFO_PATH = '/usr/bin/lsappinfo'
const QUERY_TIMEOUT_MS = 1_500

export interface ActiveAppInfo {
  name: string
  bundleIdentifier?: string
}

function runLsappinfo(arguments_: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      LSAPPINFO_PATH,
      arguments_,
      { encoding: 'utf8', timeout: QUERY_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(stdout)
      }
    )
  })
}

function readMetadataValue(output: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`^"${escapedKey}"="(.*)"$`, 'm'))
  return match?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, '\\') || undefined
}

/** Captures the frontmost macOS application once, on demand. */
export class ActiveAppService {
  async capture(): Promise<ActiveAppInfo | null> {
    if (process.platform !== 'darwin') return null

    try {
      const applicationToken = (await runLsappinfo(['front'])).trim().split('\n')[0]
      if (!applicationToken || applicationToken === '[ NULL ]') return null

      const metadata = await runLsappinfo([
        'info',
        '-only',
        'name,bundleid',
        applicationToken
      ])
      const name = readMetadataValue(metadata, 'LSDisplayName')
      if (!name) return null

      return {
        name,
        bundleIdentifier: readMetadataValue(metadata, 'CFBundleIdentifier')
      }
    } catch {
      return null
    }
  }
}
