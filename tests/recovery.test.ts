import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HotkeyService } from '../src/main/hotkey-service'
import { FnControlMonitor as RealMonitor } from '../src/main/fn-control-monitor'
import { DEFAULT_HOTKEY, F8_HOTKEY } from '../src/shared/hotkey'
import { access, FnControlMonitor, uIOhook, UiohookKey } from './hotkey-fakes'

const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function serviceFixture() {
  const events: string[] = []
  const service = new HotkeyService({ shortcut: DEFAULT_HOTKEY,
    onPressed: () => events.push('down'), onReleased: () => events.push('up'),
    onInterrupted: () => events.push('cancel'), onToggle: () => assert.fail('Fn toggled'),
    onStatusChanged: (status) => events.push(status.mode) })
  return { service, events, monitor: FnControlMonitor.current }
}

test('five sleep/wake cycles force fresh helpers after a bounded wake delay; stale held state is cancelled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, events, monitor } = serviceFixture()
  try {
    await service.start()
    for (let cycle = 0; cycle < 5; cycle++) {
      monitor.onChange(true)
      service.systemSuspend()
      service.systemSuspend() // duplicate suspend is harmless
      assert.equal(events.filter((event) => event === 'cancel').length, cycle + 1)
      assert.equal(events.includes('up'), false)
      monitor.onChange(true) // late pipe message while asleep
      service.systemResume()
      t.mock.timers.tick(749); await flush()
      assert.equal(monitor.starts, cycle + 1)
      t.mock.timers.tick(1); await flush()
      assert.equal(monitor.starts, cycle + 2)
      assert.equal(monitor.forceStarts, cycle + 1)
      assert.equal(monitor.ready, true)
    }
    monitor.onChange(true); monitor.onChange(false)
    assert.deepEqual(events.slice(-2), ['down', 'up'])
  } finally { service.stop() }
})

test('resume force-restarts a ready-but-stale helper even if suspend was missed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, monitor } = serviceFixture()
  try {
    await service.start()
    service.systemResume()
    assert.equal(monitor.ready, false)
    t.mock.timers.tick(750); await flush()
    assert.equal(monitor.forceStarts, 1)
    assert.equal(monitor.ready, true)
  } finally { service.stop() }
})

test('unexpected failure recovers; failed attempts and ready/exit crash loops have bounded backoff', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, monitor } = serviceFixture()
  try {
    await service.start()
    monitor.fail()
    t.mock.timers.tick(500); await flush()
    assert.equal(monitor.ready, true)
    // Success followed by an immediate crash does not reset the retry budget.
    access.fnReady = false
    monitor.fail()
    for (const ms of [1000, 2000, 4000]) {
      const starts = monitor.starts
      t.mock.timers.tick(ms - 1); await flush()
      assert.equal(monitor.starts, starts)
      t.mock.timers.tick(1); await flush()
      assert.equal(monitor.starts, starts + 1)
    }
    const attempts = monitor.starts
    t.mock.timers.tick(60_000); await flush()
    assert.equal(monitor.starts, attempts)
    assert.equal(monitor.ready, false)
  } finally { access.fnReady = true; service.stop() }
})

test('changing to F8 during in-flight recovery invalidates late startup and preserves custom shortcuts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, monitor, events } = serviceFixture()
  const key = (keycode: number, ctrlKey = false) => ({ keycode, ctrlKey, altKey: false, metaKey: false, shiftKey: false })
  try {
    await service.start()
    const pending = deferred<boolean>()
    monitor.pendingStart = pending.promise
    service.systemResume()
    t.mock.timers.tick(750); await flush()
    assert.equal((await service.reconfigure(F8_HOTKEY)).success, true)
    pending.resolve(true); await flush()
    assert.equal(monitor.ready, false)
    events.length = 0
    service.systemSuspend(); service.systemResume()
    events.length = 0
    uIOhook.emit('keydown', key(UiohookKey.F8)); uIOhook.emit('keyup', key(UiohookKey.F8))
    assert.deepEqual(events, ['down', 'up'])
    assert.equal((await service.reconfigure({ key: 'Space', modifiers: ['Control'] })).success, true)
    service.systemSuspend(); service.systemResume()
    events.length = 0
    uIOhook.emit('keydown', key(UiohookKey.Space, true)); uIOhook.emit('keyup', key(UiohookKey.Ctrl))
    assert.deepEqual(events, ['down', 'up'])
    const starts = monitor.starts
    t.mock.timers.tick(20_000); await flush()
    assert.equal(monitor.starts, starts)
  } finally { service.stop() }
})

test('shutdown cancels both pending timers and asynchronous recovery completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  for (const inFlight of [false, true]) {
    const { service, monitor, events } = serviceFixture()
    await service.start()
    const pending = deferred<boolean>()
    monitor.pendingStart = pending.promise
    service.systemResume()
    if (inFlight) { t.mock.timers.tick(750); await flush() }
    service.stop()
    const starts = monitor.starts
    events.length = 0
    pending.resolve(true)
    t.mock.timers.tick(60_000); await flush()
    assert.equal(monitor.starts, starts)
    assert.equal(monitor.ready, false)
    assert.deepEqual(events, [])
  }
})

test('idle suspend stops watchdog ownership, and a new wake cancels an older pending recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, monitor, events } = serviceFixture()
  try {
    await service.start()
    service.systemSuspend()
    monitor.fail() // late failure delivered while sleeping must not schedule a retry
    t.mock.timers.tick(60_000); await flush()
    assert.equal(monitor.starts, 1)
    service.systemResume()
    const pending = deferred<boolean>()
    monitor.pendingStart = pending.promise
    t.mock.timers.tick(750); await flush()
    service.systemSuspend()
    pending.resolve(true); await flush()
    assert.equal(monitor.ready, false)
    monitor.pendingStart = null
    service.systemResume()
    t.mock.timers.tick(750); await flush()
    assert.equal(monitor.ready, true)
    assert.equal(events.includes('down'), false)
    assert.equal(events.includes('up'), false)
  } finally { service.stop() }
})

test('sleep invalidates a manual asynchronous Fn selection without replacing the saved standard shortcut', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { service, monitor } = serviceFixture()
  try {
    await service.start()
    await service.reconfigure(F8_HOTKEY)
    const pending = deferred<boolean>()
    monitor.pendingStart = pending.promise
    const change = service.reconfigure(DEFAULT_HOTKEY)
    service.systemSuspend(); service.systemResume()
    pending.resolve(true)
    assert.equal((await change).success, false)
    monitor.pendingStart = null
    assert.equal((await service.reconfigure(DEFAULT_HOTKEY)).success, true)
  } finally { service.stop() }
})

// Real subprocess protocol tests: no keyboard input, event taps, or API calls.
function helperFixture(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'voca-recovery-test-'))
  const executable = join(dir, 'helper')
  writeFileSync(executable, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  return { dir, executable }
}

test('real monitor detects heartbeat timeout and unexpected exit without emitting a false PTT_UP', async () => {
  for (const body of [
    "process.stdout.write('ready\\nPTT_DOWN\\n'); setInterval(() => {}, 1000)",
    "process.stdout.write('ready\\nPTT_DOWN\\n'); setTimeout(() => process.exit(7), 30)"
  ]) {
    const fixture = helperFixture(body)
    const failure = deferred<void>()
    const events: boolean[] = []
    const logs: string[] = []
    const monitor = new RealMonitor(fixture.executable, (held) => events.push(held),
      () => failure.resolve(), (event) => logs.push(event),
      { heartbeatTimeoutMs: 1000, watchdogMs: 25, killGraceMs: 100 })
    try {
      assert.equal(await monitor.start(), true)
      await failure.promise
      await monitor.stop()
      assert.equal(monitor.ready, false)
      assert.deepEqual(events, [true])
      assert.ok(logs.some((line) => line.includes('heartbeat timeout') || line.includes('exited unexpectedly')))
    } finally { await monitor.stop(); rmSync(fixture.dir, { recursive: true, force: true }) }
  }
})

test('real monitor single-flights starts and awaits child close before force replacement; stop cancels restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voca-exclusive-helper-'))
  const executable = join(dir, 'helper')
  const lock = join(dir, 'exclusive.lock')
  writeFileSync(executable, `#!${process.execPath}\n
    const fs = require('node:fs');
    const lock = ${JSON.stringify(lock)};
    try { fs.closeSync(fs.openSync(lock, 'wx')); } catch { process.exit(9); }
    process.on('SIGTERM', () => setTimeout(() => { fs.unlinkSync(lock); process.exit(0); }, 50));
    setInterval(() => process.stdout.write('alive\\n'), 25);
    process.stdout.write('ready\\n');
  `, { mode: 0o700 })
  let failures = 0
  const monitor = new RealMonitor(executable, () => {}, () => failures++)
  try {
    const first = monitor.start()
    assert.equal(monitor.start(), first)
    assert.equal(await first, true)
    assert.equal(await monitor.start(true), true)
    assert.equal(failures, 0) // lock acquisition would fail if children overlapped
    const pending = monitor.start(true)
    await monitor.stop()
    assert.equal(await pending, false)
    assert.equal(existsSync(lock), false)
    assert.equal(monitor.ready, false)
  } finally { await monitor.stop(); rmSync(dir, { recursive: true, force: true }) }
})

test('real monitor forcibly terminates an unresponsive child before resolving stop', async () => {
  const fixture = helperFixture(`
    process.on('SIGTERM', () => {});
    setInterval(() => process.stdout.write('alive\\n'), 100);
    process.stdout.write('ready\\n');
  `)
  const logs: string[] = []
  const monitor = new RealMonitor(fixture.executable, () => {}, () => assert.fail('intentional stop failed'),
    (message) => logs.push(message), { heartbeatTimeoutMs: 4000, watchdogMs: 1000, killGraceMs: 50 })
  try {
    assert.equal(await monitor.start(), true)
    await monitor.stop()
    assert.ok(logs.some((line) => line.includes('signal=SIGKILL')))
    assert.equal(monitor.ready, false)
  } finally { await monitor.stop(); rmSync(fixture.dir, { recursive: true, force: true }) }
})
