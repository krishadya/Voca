import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export const FN_ACCESS_MESSAGE =
  'Fn + Control needs native keyboard access. Enable Accessibility/Input Monitoring and retry, or select F8 in Settings.'

/** Receives chord transitions only; no characters, audio, or credentials cross this pipe. */
export class FnControlMonitor {
  private cleanup: (() => void) | null = null
  ready = false

  constructor(
    private readonly executable: string,
    private readonly onChange: (held: boolean) => void,
    private readonly onFailure: () => void,
    private readonly diagnostic?: (event: string) => void
  ) {}

  start(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    this.stop()
    return new Promise((resolve) => {
      const child = spawn(this.executable, this.diagnostic ? ['--diagnostics'] : [], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: '/usr/bin:/bin' }
      })
      const lines = createInterface({ input: child.stdout! })
      let lastHeartbeat = Date.now()
      let finished = false
      const dispose = (): void => {
        if (finished) return
        finished = true
        clearInterval(watchdog)
        lines.close()
        child.removeAllListeners('error')
        child.removeAllListeners('exit')
        // Keep an error handler until the process has fully closed.
        child.on('error', () => {})
        child.kill()
        this.ready = false
        this.cleanup = null
        resolve(false)
      }
      const fail = (): void => {
        if (finished) return
        this.diagnostic?.('helper unavailable or heartbeat lost')
        dispose()
        this.onChange(false)
        this.onFailure()
      }
      const watchdog = setInterval(() => {
        if (Date.now() - lastHeartbeat > 4000) fail()
      }, 1000)
      this.cleanup = dispose
      child.once('error', fail)
      child.once('exit', fail)
      lines.on('line', (line) => {
        if (finished) return
        if (line === 'ready') {
          this.diagnostic?.('helper ready')
          this.ready = true
          lastHeartbeat = Date.now()
          resolve(true)
        } else if (line === 'alive') {
          lastHeartbeat = Date.now()
        } else if (this.ready && (line === 'PTT_DOWN' || line === 'PTT_UP')) {
          this.diagnostic?.(`Electron received ${line}`)
          this.onChange(line === 'PTT_DOWN')
        } else if (line.startsWith('diagnostic ') && line.length < 500) {
          this.diagnostic?.(`native ${line.slice(11)}`)
        }
      })
    })
  }

  stop(): void {
    this.cleanup?.()
  }
}
