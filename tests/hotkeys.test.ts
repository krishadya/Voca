import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_HOTKEY, F8_HOTKEY, formatHotkey, normalizeHotkey, validateHotkey, hotkeyToAccelerator } from '../src/shared/hotkey'
import { SettingsStore } from '../src/main/settings-store'
import { HotkeyService } from '../src/main/hotkey-service'
import { FnControlMonitor as RealMonitor } from '../src/main/fn-control-monitor'
import { access, FnControlMonitor, globalShortcut, uIOhook, UiohookKey } from './hotkey-fakes'
import './recording.test'
import './latency.test'

test('default, serialization, validation, and native-only accelerator', () => {
  assert.equal(formatHotkey(DEFAULT_HOTKEY), 'Fn + Control')
  assert.equal(hotkeyToAccelerator(DEFAULT_HOTKEY), null)
  assert.equal(validateHotkey(DEFAULT_HOTKEY), null)
  assert.notEqual(validateHotkey({ key: 'FnControl', modifiers: ['Control'] }), null)
  assert.deepEqual(normalizeHotkey(JSON.parse(JSON.stringify(DEFAULT_HOTKEY))), DEFAULT_HOTKEY)
  assert.equal(hotkeyToAccelerator(F8_HOTKEY), 'F8')
  assert.equal(normalizeHotkey({ key: 'RightOption', modifiers: [] }), null)
  assert.notEqual(validateHotkey({ key: 'A', modifiers: [] }), null)
  assert.equal(validateHotkey({ key: 'Space', modifiers: ['Control'] }), null)
})

test('migrate only identifiable defaults; preserve custom and ambiguous legacy F8', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voca-settings-test-'))
  try {
    const path = join(dir, 'settings.json')
    const store = new SettingsStore(path)
    assert.deepEqual(store.load().hotkey, DEFAULT_HOTKEY)
    for (const input of [{}, { hotkey: F8_HOTKEY, hotkeyPreference: 'default' }]) {
      writeFileSync(path, JSON.stringify(input))
      assert.deepEqual(store.load().hotkey, DEFAULT_HOTKEY)
    }
    for (const hotkey of [F8_HOTKEY, { key: 'F7', modifiers: [] }, { key: 'Space', modifiers: ['Control'] }]) {
      for (const extra of [{}, { hotkeyPreference: 'custom' }]) {
        writeFileSync(path, JSON.stringify({ ...extra, hotkey, autoPaste: false, onboardingComplete: true }))
        const loaded = store.load()
        assert.deepEqual(loaded.hotkey, hotkey)
        assert.equal(loaded.hotkeyPreference, 'custom')
        assert.equal(loaded.autoPaste, false)
        assert.equal(loaded.onboardingComplete, true)
        store.save(loaded)
        assert.deepEqual(store.load().hotkey, hotkey)
      }
    }
    writeFileSync(path, JSON.stringify({ hotkey: { key: 'F7', modifiers: [] }, hotkeyPreference: 'default' }))
    assert.deepEqual(store.load().hotkey, { key: 'F7', modifiers: [] })
    assert.equal(store.load().hotkeyPreference, 'custom')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Fn hold/release, F8 switching, custom shortcut, capture, failure and fallback', async () => {
  const events: string[] = []
  const service = new HotkeyService({
    shortcut: DEFAULT_HOTKEY,
    onPressed: () => events.push('press'), onReleased: () => events.push('release'),
    onToggle: () => events.push('toggled'), onStatusChanged: (status) => events.push(status.mode)
  })
  const key = (keycode: number, ctrlKey = false) => ({ keycode, ctrlKey, altKey: false, metaKey: false, shiftKey: false })
  try {
    assert.equal((await service.start()).mode, 'hold')
    assert.equal(globalShortcut.isRegistered('FnControl'), false)
    const fn = FnControlMonitor.current
    fn.onChange(true); fn.onChange(true); fn.onChange(false); fn.onChange(false)
    assert.deepEqual(events, ['press', 'release'])
    events.length = 0
    service.suspend(); fn.onChange(true); fn.onChange(false); service.resume()
    assert.deepEqual(events, [])
    fn.onChange(true); fn.fail()
    assert.deepEqual(events, ['press', 'release', 'unavailable'])
    events.length = 0
    assert.equal((await service.reconfigure(F8_HOTKEY)).success, true)
    assert.equal(uIOhook.listenerCount('keydown'), 1)
    uIOhook.emit('keydown', key(UiohookKey.F8)); uIOhook.emit('keydown', key(UiohookKey.F8))
    uIOhook.emit('keyup', key(UiohookKey.F8))
    assert.deepEqual(events, ['hold', 'press', 'release'])
    events.length = 0
    access.fnReady = false
    assert.equal((await service.reconfigure(DEFAULT_HOTKEY)).success, false)
    uIOhook.emit('keydown', key(UiohookKey.F8)); uIOhook.emit('keyup', key(UiohookKey.F8))
    assert.deepEqual(events, ['hold', 'press', 'release'])
    access.fnReady = true
    assert.equal((await service.reconfigure({ key: 'Space', modifiers: ['Control'] })).success, true)
    events.length = 0
    uIOhook.emit('keydown', key(UiohookKey.Space, true))
    uIOhook.emit('keyup', key(UiohookKey.Ctrl))
    assert.deepEqual(events, ['press', 'release'])
    assert.equal((await service.reconfigure(DEFAULT_HOTKEY)).success, true)
    assert.equal(uIOhook.listenerCount('keydown'), 0)
    events.length = 0
    uIOhook.emit('keydown', key(UiohookKey.F8))
    fn.onChange(true); fn.onChange(false)
    assert.deepEqual(events, ['press', 'release'])
    access.trusted = false
    assert.equal((await service.reconfigure(F8_HOTKEY)).success, true)
    assert.equal(globalShortcut.isRegistered('F8'), true)
    assert.equal((await service.reconfigure(DEFAULT_HOTKEY)).success, true)
    assert.equal(globalShortcut.isRegistered('F8'), false)
    assert.equal(events.includes('toggled'), false)
  } finally { service.stop(); access.trusted = true; access.fnReady = true }
})

test('Fn access failure never registers a toggle', async () => {
  access.fnReady = false
  const service = new HotkeyService({ shortcut: DEFAULT_HOTKEY,
    onPressed() { assert.fail('unexpected recording') }, onReleased() {},
    onToggle() { assert.fail('unexpected toggle') }, onStatusChanged() {} })
  try {
    assert.equal((await service.start()).mode, 'unavailable')
    assert.equal(globalShortcut.isRegistered('FnControl'), false)
    assert.equal(globalShortcut.isRegistered('F8'), false)
  } finally { service.stop(); access.fnReady = true }
})

test('standard hook failure cleans listeners and preserves fallback registration on rejected changes', async () => {
  access.nativeFails = true
  const service = new HotkeyService({ shortcut: F8_HOTKEY,
    onPressed() {}, onReleased() {}, onToggle() {}, onStatusChanged() {} })
  try {
    assert.equal((await service.start()).mode, 'toggle')
    assert.equal(uIOhook.listenerCount('keydown'), 0)
    assert.equal(globalShortcut.isRegistered('F8'), true)
    access.registrationFails = true
    assert.equal((await service.reconfigure({ key: 'F7', modifiers: [] })).success, false)
    assert.equal(globalShortcut.isRegistered('F8'), true)
    access.registrationFails = false
    assert.equal((await service.reconfigure(DEFAULT_HOTKEY)).success, true)
    assert.equal(globalShortcut.isRegistered('F8'), false)
  } finally { service.stop(); access.nativeFails = false; access.registrationFails = false }
})

test('actual monitor handles missing/failed helper without crashing', async () => {
  for (const executable of ['/nonexistent/voca-fn-control', '/usr/bin/false']) {
    let failures = 0
    const monitor = new RealMonitor(executable, () => {}, () => failures++)
    assert.equal(await monitor.start(), false)
    assert.equal(monitor.ready, false)
    assert.equal(failures, 1)
    monitor.stop()
  }
})

test('actual helper pipe handles split lines and reports PTT receipt separately from diagnostics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voca-pipe-test-'))
  const executable = join(dir, 'test-helper')
  // No input monitoring or synthetic key injection: only the process protocol.
  writeFileSync(executable, `#!${process.execPath}\n
    process.stdout.write('ready\\ndiagnostic tap-reset\\nPTT_');
    setTimeout(() => process.stdout.write('DOWN\\nPTT_UP\\n'), 10);
    setInterval(() => process.stdout.write('alive\\n'), 1000);
  `, { mode: 0o700 })
  const received: boolean[] = []
  const logs: string[] = []
  let done!: () => void
  const complete = new Promise<void>((resolve) => { done = resolve })
  const monitor = new RealMonitor(executable, (held) => {
    received.push(held)
    if (!held) done()
  }, () => assert.fail('helper unexpectedly failed'), (event) => logs.push(event))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    assert.equal(await monitor.start(), true)
    await Promise.race([complete, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('protocol timeout')), 2000)
    })])
    assert.deepEqual(received, [true, false])
    assert.ok(logs.includes('Electron received PTT_DOWN'))
    assert.ok(logs.includes('Electron received PTT_UP'))
    assert.ok(logs.includes('native tap-reset'))
  } finally {
    clearTimeout(timeout)
    monitor.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
