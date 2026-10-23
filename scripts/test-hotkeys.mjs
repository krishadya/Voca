import { build } from 'vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = mkdtempSync(join(tmpdir(), 'voca-hotkey-tests-'))
const fakes = join(root, 'tests/hotkey-fakes.ts')
try {
  await build({
    configFile: false,
    plugins: [{ name: 'hotkey-test-doubles', enforce: 'pre', resolveId(source, importer) {
      if (source === 'electron' || source === 'uiohook-napi' ||
          (source === './fn-control-monitor' && importer?.endsWith('/hotkey-service.ts'))) return fakes
    } }],
    build: { ssr: join(root, 'tests/hotkeys.test.ts'), outDir: output, emptyOutDir: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'hotkeys.cjs' } } }
  })
  execFileSync(process.execPath, ['--test', join(output, 'hotkeys.cjs')], { stdio: 'inherit' })
  execFileSync('xcrun', ['clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
    '-arch', 'arm64', '-arch', 'x86_64', join(root, 'tests/fn-control-state.c'),
    '-o', join(output, 'fn-state-tests')], { stdio: 'inherit' })
  execFileSync(join(output, 'fn-state-tests'), [], { stdio: 'inherit' })
  execFileSync('xcrun', ['clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
    '-arch', 'arm64', '-arch', 'x86_64', join(root, 'tests/fn-control-events.c'),
    '-framework', 'ApplicationServices', '-framework', 'Carbon',
    '-o', join(output, 'fn-event-tests')], { stdio: 'inherit' })
  execFileSync(join(output, 'fn-event-tests'), [], { stdio: 'inherit' })
  if (process.argv.includes('--x64')) {
    // Rosetta execution is an additional ABI check, not an Intel hardware test.
    execFileSync('/usr/bin/arch', ['-x86_64', process.execPath, '--test', join(output, 'hotkeys.cjs')], { stdio: 'inherit' })
    execFileSync('/usr/bin/arch', ['-x86_64', join(output, 'fn-state-tests')], { stdio: 'inherit' })
    execFileSync('/usr/bin/arch', ['-x86_64', join(output, 'fn-event-tests')], { stdio: 'inherit' })
  }
} finally { rmSync(output, { recursive: true, force: true }) }
