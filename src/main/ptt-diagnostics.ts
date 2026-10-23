import { app } from 'electron'

// Callers supply lifecycle metadata only, never audio, text, or provider bodies.
export function logPtt(event: string, details: Record<string, string | number | boolean> = {}): void {
  if (!app.isPackaged) console.info(`[ptt ${new Date().toISOString()}] ${event} ${JSON.stringify(details)}`)
}
