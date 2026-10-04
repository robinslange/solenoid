import type { Application } from 'pixi.js'
import { initFieldRenderer } from './field-renderer'
import { initTitleRenderer } from './title-renderer'

// Singleton state
let fieldApp: Application | null = null
let fieldCanvas: HTMLCanvasElement | null = null
let fieldCleanup: (() => void) | null = null
let isFieldInitializing = false

let titleApp: { destroy: () => void; updateText: (t: string) => void } | null = null
let titleCanvas: HTMLCanvasElement | null = null

// Touch interaction state
let touchFocusX: number | null = null
let touchFocusY: number | null = null
let touchDriftTimer: number | null = null
let touchHandler: ((e: TouchEvent) => void) | null = null
const DRIFT_DELAY = 3000

/**
 * Initialize field if not already created
 * Returns cleanup function
 */
export async function initFieldIfNeeded(
  canvas: HTMLCanvasElement
): Promise<() => void> {
  // Return existing cleanup if already initialized AND context is valid
  if (fieldApp && fieldCleanup) {
    const renderer = fieldApp.renderer as { gl?: WebGLRenderingContext }
    if (renderer.gl && !renderer.gl.isContextLost()) {
      return fieldCleanup
    }
    await destroyField()
  }

  // Wait if currently initializing
  if (isFieldInitializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isFieldInitializing && fieldCleanup) {
          clearInterval(checkInterval)
          resolve(fieldCleanup)
        }
      }, 50)
    })
  }

  isFieldInitializing = true
  fieldCanvas = canvas

  // Initialize field renderer
  const cleanup = await initFieldRenderer(canvas)
  fieldCleanup = cleanup

  // Add touch interaction
  setupTouchInteraction(canvas)

  // Add scroll parallax
  setupScrollParallax()

  isFieldInitializing = false

  return cleanup
}

/**
 * Setup touch interactivity: tap sets focus, drift back to center after 3s
 */
function setupTouchInteraction(canvas: HTMLCanvasElement) {
  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length > 0) {
      const touch = e.touches[0]
      touchFocusX = touch.clientX
      touchFocusY = touch.clientY

      if (touchDriftTimer !== null) {
        clearTimeout(touchDriftTimer)
      }

      touchDriftTimer = window.setTimeout(() => {
        touchFocusX = null
        touchFocusY = null
      }, DRIFT_DELAY)
    }
  }

  touchHandler = handleTouchStart
  canvas.addEventListener('touchstart', handleTouchStart, { passive: true })
}

/**
 * Setup scroll parallax: shifts field focus Y by scrollY * 0.3
 */
function setupScrollParallax() {
  // This is already handled in field-renderer.ts handleScroll
  // Just documenting the behavior here
}

/**
 * Get current touch focus point (or null if drifting to center)
 */
export function getTouchFocus(): { x: number; y: number } | null {
  if (touchFocusX !== null && touchFocusY !== null) {
    return { x: touchFocusX, y: touchFocusY }
  }
  return null
}

/**
 * Destroy field singleton
 */
export async function destroyField(): Promise<void> {
  if (fieldCleanup) {
    fieldCleanup()
  }

  if (touchHandler && fieldCanvas) {
    fieldCanvas.removeEventListener('touchstart', touchHandler)
    touchHandler = null
  }

  fieldApp = null
  fieldCanvas = null
  fieldCleanup = null
  isFieldInitializing = false

  if (touchDriftTimer !== null) {
    clearTimeout(touchDriftTimer)
    touchDriftTimer = null
  }
  touchFocusX = null
  touchFocusY = null
}

/**
 * Animate field collapse: lines toward center, then fade out
 * Duration ~400ms
 */
export function animateFieldCollapse(): Promise<void> {
  return new Promise((resolve) => {
    if (!fieldCanvas) {
      resolve()
      return
    }

    const canvas = fieldCanvas
    const startTime = performance.now()
    const duration = 400

    function animate() {
      const elapsed = performance.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutCubic(progress)

      // Fade out canvas
      canvas.style.opacity = String(1 - eased)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        canvas.style.opacity = '0'
        resolve()
      }
    }

    requestAnimationFrame(animate)
  })
}

/**
 * Animate field expand: fade in, lines expand from center
 * Duration ~400ms
 */
export function animateFieldExpand(): Promise<void> {
  return new Promise((resolve) => {
    if (!fieldCanvas) {
      resolve()
      return
    }

    const canvas = fieldCanvas
    const startTime = performance.now()
    const duration = 400

    canvas.style.opacity = '0'

    function animate() {
      const elapsed = performance.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutCubic(progress)

      // Fade in canvas
      canvas.style.opacity = String(eased)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        canvas.style.opacity = '1'
        resolve()
      }
    }

    requestAnimationFrame(animate)
  })
}

/**
 * Easing function: ease out cubic
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Initialize title if not exists, or update if exists
 */
export async function initTitleIfNeeded(
  canvas: HTMLCanvasElement,
  text: string
): Promise<void> {
  if (titleApp && titleCanvas === canvas) {
    // Update existing title
    titleApp.updateText(text)
    return
  }

  // Destroy old title if different canvas
  if (titleApp) {
    titleApp.destroy()
    titleApp = null
  }

  titleCanvas = canvas
  titleApp = await initTitleRenderer(canvas, text)
}

/**
 * Destroy title
 */
export function destroyTitle(): void {
  if (titleApp) {
    titleApp.destroy()
    titleApp = null
    titleCanvas = null
  }
}
