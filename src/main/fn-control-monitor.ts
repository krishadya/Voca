import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export const FN_ACCESS_MESSAGE =
  'Fn + Control needs native keyboard access. Enable Accessibility/Input Monitoring and retry, or select F8 in Settings.'

interface HelperRun {
  closed: Promise<void>
  terminate: () => void
}

interface MonitorTiming {
  heartbeatTimeoutMs: number
  watchdogMs: number
  killGraceMs: number
}

/** Single owner of the helper. A replacement cannot spawn until the old child closes. */
export class FnControlMonitor {
  private run: HelperRun | null = null
  private generation = 0
  private starting: Promise<boolean> | null = null
  ready = false

  constructor(
    private readonly executable: string,
    private readonly onChange: (held: boolean) => void,
    private readonly onFailure: () => void,
    private readonly diagnostic?: (event: string) => void,
    private readonly timing: MonitorTiming = {
      heartbeatTimeoutMs: 4000, watchdogMs: 1000, killGraceMs: 500
    }
  ) {}

  start(forceRestart = false): Promise<boolean> {
    if (!forceRestart && this.starting) return this.starting
    if (!forceRestart && this.ready) return Promise.resolve(true)
    const generation = ++this.generation
    this.ready = false
    const old = this.run
    old?.terminate()
    const pending = (async () => {
      await old?.closed
      if (generation !== this.generation) return false
      return this.launch(generation)
    })().catch(() => {
      if (generation === this.generation) {
        this.ready = false
        this.run?.terminate()
        this.diagnostic?.('native helper startup failed')
        this.onFailure()
      }
      return false
    })
    this.starting = pending
    void pending.finally(() => {
      if (this.starting === pending) this.starting = null
    })
    return pending
  }

  stop(): Promise<void> {
    ++this.generation
    this.ready = false
    this.starting = null
    this.run?.terminate()
    return this.run?.closed ?? Promise.resolve()
  }

  private launch(generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.executable, this.diagnostic ? ['--diagnostics'] : [], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: '/usr/bin:/bin' }
      })
      const lines = createInterface({ input: child.stdout! })
      let lastHeartbeat = Date.now()
      const startedAt = lastHeartbeat
      let inactive = false
      let closed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let resolveClosed!: () => void
      const closedPromise = new Promise<void>((done) => { resolveClosed = done })
      const deactivate = (): void => {
        inactive = true
        clearInterval(watchdog)
        lines.close()
        if (this.run === run) this.ready = false
        resolve(false)
      }
      const terminate = (): void => {
        if (inactive) return
        deactivate()
        if (!closed) {
          child.kill()
          // Never start a replacement just because kill() returned; await close.
          killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL') }, this.timing.killGraceMs)
        }
      }
      const fail = (reason: string): void => {
        if (inactive || generation !== this.generation) return
        this.diagnostic?.(reason)
        terminate()
        // Loss of the listener is NOT a physical PTT_UP; the owner cancels audio.
        this.onFailure()
      }
      const watchdog = setInterval(() => {
        if ((!this.ready && Date.now() - startedAt > this.timing.heartbeatTimeoutMs) ||
            Date.now() - lastHeartbeat > this.timing.heartbeatTimeoutMs) {
          fail('heartbeat timeout')
        }
      }, this.timing.watchdogMs)
      const run: HelperRun = { closed: closedPromise, terminate }
      this.run = run
      child.on('error', () => fail('native helper spawn/error'))
      child.once('exit', (code, signal) => {
        this.diagnostic?.(`native helper exit code=${code} signal=${signal} expected=${inactive}`)
        fail('native helper exited unexpectedly')
      })
      child.once('close', () => {
        closed = true
        fail('native helper pipe closed unexpectedly')
        deactivate()
        clearTimeout(killTimer)
        if (this.run === run) this.run = null
        resolveClosed()
      })
      lines.on('line', (line) => {
        if (inactive || generation !== this.generation) return
        if (line === 'ready') {
          this.diagnostic?.('helper ready')
          this.ready = true
          lastHeartbeat = Date.now()
          resolve(true)
        } else if (line === 'alive') {
          lastHeartbeat = Date.now()
        } else if (line === 'unavailable') {
          fail('native event tap unavailable')
        } else if (this.ready && (line === 'PTT_DOWN' || line === 'PTT_UP')) {
          this.diagnostic?.(`Electron received ${line}`)
          this.onChange(line === 'PTT_DOWN')
        } else if (line.startsWith('diagnostic ') && line.length < 500) {
          this.diagnostic?.(`native ${line.slice(11)}`)
        }
      })
    })
  }
}
