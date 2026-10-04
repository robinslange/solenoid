import { Application, Graphics, GraphicsContext } from 'pixi.js'
import {
  GRID_SPACING_DESKTOP,
  GRID_SPACING_MOBILE,
  LINE_LENGTH,
  LINE_COLOR,
  BRIGHT_COLOR,
  ACCENT_COLOR,
  ACCENT_MIX,
  LINE_WIDTH,
  ORBIT_RADIUS,
  ORBIT_SPEED,
  PROXIMITY_THRESHOLD,
  CROWD_STRENGTH,
  CROWD_RETURN_FACTOR,
  MOBILE_INTENSITY_SCALE,
} from '@/lib/pixi/field-config'
import { isMobileDevice, hexToPixi } from '@/lib/pixi/utils'
import { colors } from '@/lib/design-tokens'

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

export async function initFieldRenderer(
  canvas: HTMLCanvasElement
): Promise<() => void> {
  const app = new Application()

  await app.init({
    canvas,
    resizeTo: window,
    backgroundColor: hexToPixi(colors.background),
    antialias: false,
    preference: 'webgl',
  })

  const isMobile = isMobileDevice()
  const spacing = isMobile ? GRID_SPACING_MOBILE : GRID_SPACING_DESKTOP

  const cols = Math.ceil(window.innerWidth / spacing)
  const rows = Math.ceil(window.innerHeight / spacing)
  const totalSegments = cols * rows

  // White stroke — actual color controlled via tint
  const sharedContext = new GraphicsContext()
    .moveTo(0, -LINE_LENGTH)
    .lineTo(0, LINE_LENGTH)
    .stroke({ color: 0xffffff, width: LINE_WIDTH, pixelLine: true })

  const segments: Graphics[] = []
  const homeX = new Float32Array(totalSegments)
  const homeY = new Float32Array(totalSegments)

  let idx = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const segment = new Graphics(sharedContext)
      const x = col * spacing + spacing / 2
      const y = row * spacing + spacing / 2
      segment.x = x
      segment.y = y
      segment.tint = LINE_COLOR
      segment.alpha = 0.6
      homeX[idx] = x
      homeY[idx] = y
      app.stage.addChild(segment)
      segments.push(segment)
      idx++
    }
  }

  let mouseX = window.innerWidth / 2
  let mouseY = window.innerHeight / 2
  let orbitAngle = 0
  let scrollY = 0

  function handleMouseMove(e: MouseEvent) {
    mouseX = e.clientX
    mouseY = e.clientY
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      app.ticker.stop()
    } else {
      app.ticker.start()
    }
  }

  function handleScroll() {
    scrollY = window.scrollY
  }

  if (!isMobile) {
    window.addEventListener('mousemove', handleMouseMove)
  } else {
    window.addEventListener('scroll', handleScroll, { passive: true })
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  app.ticker.add((ticker) => {
    let focusX: number, focusY: number

    if (isMobile) {
      orbitAngle += ORBIT_SPEED * ticker.deltaTime
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2 + scrollY
      focusX = centerX + Math.cos(orbitAngle) * ORBIT_RADIUS
      focusY = centerY + Math.sin(orbitAngle) * ORBIT_RADIUS
    } else {
      focusX = mouseX
      focusY = mouseY
    }

    const proximityThresholdSq = PROXIMITY_THRESHOLD * PROXIMITY_THRESHOLD

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const hx = homeX[i]
      const hy = homeY[i]

      const dx = focusX - hx
      const dy = focusY - hy
      const distSq = dx * dx + dy * dy

      // Snappy rotation — direct atan2, no lerp
      segment.rotation = Math.atan2(dy, dx) + Math.PI / 2

      if (distSq < proximityThresholdSq) {
        const dist = Math.sqrt(distSq)
        const rawProximity = 1 - dist / PROXIMITY_THRESHOLD
        const proximity = isMobile
          ? rawProximity * MOBILE_INTENSITY_SCALE
          : rawProximity

        // Brightness glow with subtle accent tint — single interpolation
        const baseColor = interpolateColor(LINE_COLOR, BRIGHT_COLOR, proximity)
        const accentBlend = proximity * ACCENT_MIX
        segment.tint = interpolateColor(baseColor, ACCENT_COLOR, accentBlend)
        segment.alpha = 0.6 + 0.4 * proximity

        // Mild crowding — segments shift slightly toward focus
        const shift = CROWD_STRENGTH * spacing * proximity
        const norm = dist > 0 ? 1 / dist : 0
        segment.x = hx + dx * norm * shift
        segment.y = hy + dy * norm * shift
      } else {
        segment.tint = LINE_COLOR
        segment.alpha = 0.6

        // Return to home position
        segment.x += (hx - segment.x) * CROWD_RETURN_FACTOR
        segment.y += (hy - segment.y) * CROWD_RETURN_FACTOR
      }
    }
  })

  return () => {
    if (!isMobile) {
      window.removeEventListener('mousemove', handleMouseMove)
    } else {
      window.removeEventListener('scroll', handleScroll)
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    app.destroy(true, { children: true })
  }
}
