import type { ProcessingMode } from '../shared/ipc'
import type { ActiveAppInfo } from './active-app-service'
import type { GeminiProcessingContext } from './gemini-processing-service'

/** Called at recording start, never on release. Only Dev Prompt uses context. */
export async function captureContextForMode(
  mode: ProcessingMode,
  activeApp: () => Promise<ActiveAppInfo | null>,
  selection: () => Promise<string | null>
): Promise<GeminiProcessingContext> {
  if (mode !== 'dev-prompt') return {}
  const [activeApplication, selectedText] = await Promise.all([activeApp(), selection()])
  return {
    ...(activeApplication ? { activeApplication } : {}),
    ...(selectedText ? { selectedText } : {})
  }
}
