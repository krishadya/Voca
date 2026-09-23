import { nativeImage } from 'electron'

const LOGICAL_SIZE = 18
const SCALE_FACTOR = 2
const SUBPIXEL_SAMPLES = 4

function isInsideMicrophone(x: number, y: number): boolean {
  const centerX = LOGICAL_SIZE / 2

  // Filled microphone capsule.
  const capsuleRadius = 2.55
  const nearestCapsuleY = Math.max(4.45, Math.min(y, 8.45))
  const capsuleX = x - centerX
  const capsuleY = y - nearestCapsuleY
  const microphoneBody = capsuleX * capsuleX + capsuleY * capsuleY <= capsuleRadius ** 2

  // Lower receiver arc.
  const arcX = (x - centerX) / 5.9
  const arcY = (y - 8.55) / 5.45
  const arcDistance = Math.sqrt(arcX * arcX + arcY * arcY)
  const receiverArc = y >= 8.3 && arcDistance >= 0.76 && arcDistance <= 1

  const stem = x >= 8.25 && x <= 9.75 && y >= 13.4 && y <= 16.15
  const base = x >= 5.7 && x <= 12.3 && y >= 15.55 && y <= 17

  return microphoneBody || receiverArc || stem || base
}

function createBitmapFallback(): Electron.NativeImage {
  const pixelSize = LOGICAL_SIZE * SCALE_FACTOR
  const bitmap = Buffer.alloc(pixelSize * pixelSize * 4)

  for (let pixelY = 0; pixelY < pixelSize; pixelY += 1) {
    for (let pixelX = 0; pixelX < pixelSize; pixelX += 1) {
      let coveredSamples = 0

      for (let sampleY = 0; sampleY < SUBPIXEL_SAMPLES; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUBPIXEL_SAMPLES; sampleX += 1) {
          const x =
            (pixelX + (sampleX + 0.5) / SUBPIXEL_SAMPLES) / SCALE_FACTOR
          const y =
            (pixelY + (sampleY + 0.5) / SUBPIXEL_SAMPLES) / SCALE_FACTOR
          if (isInsideMicrophone(x, y)) coveredSamples += 1
        }
      }

      const offset = (pixelY * pixelSize + pixelX) * 4
      bitmap[offset] = 0
      bitmap[offset + 1] = 0
      bitmap[offset + 2] = 0
      bitmap[offset + 3] = Math.round(
        (coveredSamples / (SUBPIXEL_SAMPLES * SUBPIXEL_SAMPLES)) * 255
      )
    }
  }

  return nativeImage.createFromBitmap(bitmap, {
    width: pixelSize,
    height: pixelSize,
    scaleFactor: SCALE_FACTOR
  })
}

/**
 * Returns a small monochrome template image. macOS draws template images with
 * the correct contrasting color for both light and dark menu bars.
 */
export function createTrayImage(): Electron.NativeImage {
  const symbolNames = ['mic.fill', 'NSImageNameTouchBarAudioInputTemplate']

  for (const symbolName of symbolNames) {
    const symbol = nativeImage.createFromNamedImage(symbolName)
    if (symbol.isEmpty()) continue

    const resizedSymbol = symbol.resize({ height: LOGICAL_SIZE, quality: 'best' })
    resizedSymbol.setTemplateImage(true)
    return resizedSymbol
  }

  const fallback = createBitmapFallback()
  fallback.setTemplateImage(true)

  if (fallback.isEmpty()) {
    throw new Error('Unable to create the Voca menu-bar icon')
  }

  return fallback
}
