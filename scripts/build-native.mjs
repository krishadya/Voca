import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function buildNativeHotkey() {
  if (process.platform !== 'darwin') throw new Error('Voca native shortcuts must be built on macOS.')
  const root = fileURLToPath(new URL('../', import.meta.url))
  mkdirSync(`${root}build/native`, { recursive: true })
  execFileSync('xcrun', ['clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0',
    `${root}native/fn-control.c`, '-framework', 'ApplicationServices', '-framework', 'Carbon',
    '-o', `${root}build/native/voca-fn-control`], { stdio: 'inherit' })
}

buildNativeHotkey()
