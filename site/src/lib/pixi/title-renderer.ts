import { Application, Graphics, GraphicsContext } from 'pixi.js'
import {
  LINE_LENGTH,
  LINE_COLOR,
  BRIGHT_COLOR,
  ACCENT_COLOR,
  ACCENT_MIX,
  LINE_WIDTH,
  PROXIMITY_THRESHOLD,
  CROWD_STRENGTH,
  CROWD_RETURN_FACTOR,
} from '@/lib/pixi/field-config'

function interpolateColor(
  color1: number,
  color2: number,
  t: number
): number {
  const r1 = (color1 >> 16) & 0xff
  const g1 = (color1 >> 8) & 0xff
  const b1 = color1 & 0xff

  const r2 = (color2 >> 16) & 0xff
  const g2 = (color2 >> 8) & 0xff
  const b2 = color2 & 0xff

  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)

  return (r << 16) | (g << 8) | b
}

interface TextBounds {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

function splitLines(text: string, viewportWidth: number): string[] {
  if (viewportWidth >= 640) return [text]

  if (text.includes('.')) {
    const lastDotIndex = text.lastIndexOf('.')
    return [text.substring(0, lastDotIndex + 1), text.substring(lastDotIndex + 1)]
  }

  if (text.length >= 8) {
    const mid = Math.ceil(text.length / 2)
    return [text.substring(0, mid), text.substring(mid)]
  }

  return [text]
}

function createTextMask(lines: string[], fontSize: number): TextBounds {
  const offscreenCanvas = document.createElement('canvas')
  const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true })!

  ctx.font = `900 ${fontSize}px Archivo, sans-serif`

  const lineMetrics = lines.map(line => ({
    text: line,
    metrics: ctx.measureText(line),
  }))

  const maxWidth = Math.max(...lineMetrics.map(lm => lm.metrics.width))
  const lineHeight = lineMetrics[0].metrics.actualBoundingBoxAscent +
                      lineMetrics[0].metrics.actualBoundingBoxDescent
  const lineGap = fontSize * 0.15
  const totalHeight = lineHeight * lines.length + lineGap * (lines.length - 1)

  offscreenCanvas.width = Math.ceil(maxWidth) + 40
  offscreenCanvas.height = Math.ceil(totalHeight) + 40

  ctx.font = `900 ${fontSize}px Archivo, sans-serif`
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const startY = offscreenCanvas.height / 2 - totalHeight / 2 + lineHeight / 2

  lineMetrics.forEach((lm, i) => {
    const y = startY + i * (lineHeight + lineGap)
    ctx.fillText(lm.text, offscreenCanvas.width / 2, y)
  })

  const imageData = ctx.getImageData(
    0,
    0,
    offscreenCanvas.width,
    offscreenCanvas.height
  )

  return {
    width: offscreenCanvas.width,
    height: offscreenCanvas.height,
    pixels: imageData.data,
  }
}

interface TitleRendererHandle {
  destroy: () => void
  updateText: (newText: string) => void
}

interface SegmentState {
  segments: Graphics[]
  homeX: number[]
  homeY: number[]
  mouseX: number
  mouseY: number
  handleMouseMove: (e: MouseEvent) => void
  handleVisibilityChange: () => void
  tickerFn: () => void
}

function buildSegments(
  app: Application,
  canvas: HTMLCanvasElement,
  textBounds: TextBounds,
  spacing: number,
): SegmentState {
  const sharedContext = new GraphicsContext()
    .moveTo(0, -LINE_LENGTH)
    .lineTo(0, LINE_LENGTH)
    .stroke({ color: 0xffffff, width: LINE_WIDTH, pixelLine: true })

  const segments: Graphics[] = []
  const homeX: number[] = []
  const homeY: number[] = []

  for (let y = 0; y < textBounds.height; y += spacing) {
    for (let x = 0; x < textBounds.width; x += spacing) {
      const pixelIndex = (y * textBounds.width + x) * 4
      const alpha = textBounds.pixels[pixelIndex + 3]

      if (alpha > 128) {
        const segment = new Graphics(sharedContext)
        segment.x = x
        segment.y = y
        segment.tint = LINE_COLOR
        homeX.push(x)
        homeY.push(y)
        app.stage.addChild(segment)
        segments.push(segment)
      }
    }
  }

  let mouseX = 0
  let mouseY = 0

  function handleMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    mouseX = e.clientX - rect.left
    mouseY = e.clientY - rect.top
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      app.ticker.stop()
    } else {
      app.ticker.start()
    }
  }

  const tickerFn = () => {
    const focusX = mouseX
    const focusY = mouseY
    const proximityThresholdSq = PROXIMITY_THRESHOLD * PROXIMITY_THRESHOLD

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const hx = homeX[i]
      const hy = homeY[i]

      const dx = focusX - hx
      const dy = focusY - hy
      const distSq = dx * dx + dy * dy

      segment.rotation = Math.atan2(dy, dx) + Math.PI / 2

      if (distSq < proximityThresholdSq) {
        const dist = Math.sqrt(distSq)
        const proximity = 1 - dist / PROXIMITY_THRESHOLD

        const baseColor = interpolateColor(LINE_COLOR, BRIGHT_COLOR, proximity)
        const accentBlend = proximity * ACCENT_MIX
        segment.tint = interpolateColor(baseColor, ACCENT_COLOR, accentBlend)

        const shift = CROWD_STRENGTH * spacing * proximity
        const norm = dist > 0 ? 1 / dist : 0
        segment.x = hx + dx * norm * shift
        segment.y = hy + dy * norm * shift
      } else {
        segment.tint = LINE_COLOR

        segment.x += (hx - segment.x) * CROWD_RETURN_FACTOR
        segment.y += (hy - segment.y) * CROWD_RETURN_FACTOR
      }
    }
  }

  return {
    segments,
    homeX,
    homeY,
    mouseX,
    mouseY,
    handleMouseMove,
    handleVisibilityChange,
    tickerFn,
  }
}

export async function initTitleRenderer(
  canvas: HTMLCanvasElement,
  text: string
): Promise<TitleRendererHandle> {
  await document.fonts.ready

  const vw = window.innerWidth
  const lines = splitLines(text, vw)
  const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '')
  const charCount = longestLine.length
  const maxWidthFraction = 0.85
  const targetWidth = vw * maxWidthFraction
  const fontSize = Math.min(Math.max(targetWidth / (charCount * 0.6), 32), 140)

  const textBounds = createTextMask(lines, fontSize)
  canvas.width = textBounds.width
  canvas.height = textBounds.height

  const app = new Application()

  await app.init({
    canvas,
    width: textBounds.width,
    height: textBounds.height,
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    antialias: false,
    preference: 'webgl',
  })

  const spacing = 8

  let state: SegmentState | null = buildSegments(app, canvas, textBounds, spacing)
  let isDestroyed = false

  function cleanup() {
    if (state) {
      window.removeEventListener('mousemove', state.handleMouseMove)
      document.removeEventListener('visibilitychange', state.handleVisibilityChange)
      app.ticker.remove(state.tickerFn)
    }
  }

  window.addEventListener('mousemove', state.handleMouseMove)

  document.addEventListener('visibilitychange', state.handleVisibilityChange)

  app.ticker.add(state.tickerFn)

  return {
    updateText: (newText: string) => {
      if (isDestroyed) return

      cleanup()

      const vw = window.innerWidth
      const lines = splitLines(newText, vw)
      const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '')
      const charCount = longestLine.length
      const maxWidthFraction = 0.85
      const targetWidth = vw * maxWidthFraction
      const fontSize = Math.min(Math.max(targetWidth / (charCount * 0.6), 32), 140)

      const newTextBounds = createTextMask(lines, fontSize)
      canvas.width = newTextBounds.width
      canvas.height = newTextBounds.height
      app.renderer.resize(newTextBounds.width, newTextBounds.height)

      app.stage.removeChildren()

      state = buildSegments(app, canvas, newTextBounds, spacing)

      window.addEventListener('mousemove', state.handleMouseMove)
      document.addEventListener('visibilitychange', state.handleVisibilityChange)
      app.ticker.add(state.tickerFn)
    },
    destroy: () => {
      if (isDestroyed) return
      isDestroyed = true

      cleanup()
      state = null
      app.destroy(true, { children: true })
    },
  }
}
