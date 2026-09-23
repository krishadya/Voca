/// <reference types="vite/client" />

import type { VocaApi } from '../../preload'

declare global {
  interface Window {
    voca: VocaApi
  }
}

export {}
