import type { Application } from 'pixi.js'
import { initFieldRenderer } from './field-renderer'
import { initTitleRenderer } from './title-renderer'

// Singleton state
let fieldApp: Application | null = null
let fieldCleanup: (() => void) | null = null
let isFieldInitializing = false

let titleApp: { destroy: () => void; updateText: (t: string) => void } | null = null
let titleCanvas: HTMLCanvasElement | null = null

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

  // Initialize field renderer
  const cleanup = await initFieldRenderer(canvas)
  fieldCleanup = cleanup

  isFieldInitializing = false

  return cleanup
}

/**
 * Destroy field singleton
 */
export async function destroyField(): Promise<void> {
  if (fieldCleanup) {
    fieldCleanup()
  }

  fieldApp = null
  fieldCleanup = null
  isFieldInitializing = false
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
