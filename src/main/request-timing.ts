import { performance } from 'node:perf_hooks'

export type RequestTiming = (stage: 'prepare' | 'request' | 'decode', durationMs: number) => void

/** Wraps the existing request; reports failures too without inspecting content. */
export async function timeRequest<T>(
  stage: 'request' | 'decode', operation: () => Promise<T>, report?: RequestTiming
): Promise<T> {
  const started = performance.now()
  try { return await operation() }
  finally { report?.(stage, performance.now() - started) }
}
