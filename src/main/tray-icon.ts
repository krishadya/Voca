import { nativeImage } from 'electron'

const LOGICAL_WIDTH = 24
const LOGICAL_HEIGHT = 18
const SCALE_FACTOR = 2
const SUBPIXEL_SAMPLES = 4

type Point = readonly [number, number]

const V_SHAPE: readonly Point[] = [
  [1, 2],
  [5.2, 2],
  [9.1, 11.7],
  [12.9, 2],
  [17.1, 2],
  [11.2, 16],
  [7, 16]
]

function isInsidePolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [currentX, currentY] = points[index]
    const [previousX, previousY] = points[previous]
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    if (intersects) inside = !inside
  }
  return inside
}

function isInsideMicrophone(x: number, y: number): boolean {
  const centerX = 20.5
  const capsuleRadius = 1.45
  const nearestCapsuleY = Math.max(5.2, Math.min(y, 9.4))
  const body = (x - centerX) ** 2 + (y - nearestCapsuleY) ** 2 <= capsuleRadius ** 2
  const arcDistance = Math.sqrt(((x - centerX) / 3.1) ** 2 + ((y - 9.4) / 3.1) ** 2)
  const receiver = y >= 9.2 && arcDistance >= 0.72 && arcDistance <= 1
  const stem = x >= 20 && x <= 21 && y >= 12.2 && y <= 15.2
  const base = x >= 18.7 && x <= 22.3 && y >= 14.5 && y <= 15.5
  return body || receiver || stem || base
}

function isInsideMark(x: number, y: number): boolean {
  return isInsidePolygon(x, y, V_SHAPE) || isInsideMicrophone(x, y)
}

/** Creates a monochrome V + microphone template icon for either macOS menu-bar theme. */
export function createTrayImage(): Electron.NativeImage {
  const pixelWidth = LOGICAL_WIDTH * SCALE_FACTOR
  const pixelHeight = LOGICAL_HEIGHT * SCALE_FACTOR
  const bitmap = Buffer.alloc(pixelWidth * pixelHeight * 4)

  for (let pixelY = 0; pixelY < pixelHeight; pixelY += 1) {
    for (let pixelX = 0; pixelX < pixelWidth; pixelX += 1) {
      let coveredSamples = 0
      for (let sampleY = 0; sampleY < SUBPIXEL_SAMPLES; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUBPIXEL_SAMPLES; sampleX += 1) {
          const x = (pixelX + (sampleX + 0.5) / SUBPIXEL_SAMPLES) / SCALE_FACTOR
          const y = (pixelY + (sampleY + 0.5) / SUBPIXEL_SAMPLES) / SCALE_FACTOR
          if (isInsideMark(x, y)) coveredSamples += 1
        }
      }

      const offset = (pixelY * pixelWidth + pixelX) * 4
      bitmap[offset + 3] = Math.round(
        (coveredSamples / (SUBPIXEL_SAMPLES * SUBPIXEL_SAMPLES)) * 255
      )
    }
  }

  const image = nativeImage.createFromBitmap(bitmap, {
    width: pixelWidth,
    height: pixelHeight,
    scaleFactor: SCALE_FACTOR
  })
  image.setTemplateImage(true)
  if (image.isEmpty()) throw new Error('Unable to create the Voca menu-bar icon')
  return image
}
