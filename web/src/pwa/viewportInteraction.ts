const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  let isPortrait = windowTarget.matchMedia?.('(orientation: portrait)').matches ?? true

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const updateAppHeight = (viewport: ViewportSize) => {
    documentTarget.documentElement.style.setProperty(appWidthVariable, `${viewport.width}px`)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const handleResize = () => {
    const viewport = windowViewportSize(windowTarget)
    if (!hasCoarsePointer(windowTarget)) {
      stableHeight = viewport.height
    } else {
      stableHeight = Math.max(stableHeight, viewport.height)
    }
    updateAppHeight(viewport)
  }
  const handleOrientationChange = () => {
    const portraitQuery = windowTarget.matchMedia?.('(orientation: portrait)')
    isPortrait = portraitQuery?.matches ?? true
    stableHeight = windowTarget.innerHeight
    const viewport = windowViewportSize(windowTarget)
    updateAppHeight(viewport)
  }

  const handleVisualViewportResize = () => {
    const viewport = windowTarget.visualViewport
    if (viewport) {
      if (!hasCoarsePointer(windowTarget)) {
        stableHeight = viewport.height
      } else {
        stableHeight = Math.max(stableHeight, viewport.height)
      }
      documentTarget.documentElement.style.setProperty(appWidthVariable, `${viewport.width}px`)
      documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
    }
  }

  handleResize()
  for (const eventName of gestureEvents) {
    windowTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
    documentTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
  }
  documentTarget.addEventListener('touchmove', preventMultiTouchMove, nonPassiveListener)
  windowTarget.addEventListener('resize', handleResize)
  windowTarget.visualViewport?.addEventListener('resize', handleVisualViewportResize)

  const portraitQuery = windowTarget.matchMedia?.('(orientation: portrait)')
  portraitQuery?.addEventListener?.('change', handleOrientationChange)

  return () => {
    for (const eventName of gestureEvents) {
      windowTarget.removeEventListener(eventName, preventGestureZoom)
      documentTarget.removeEventListener(eventName, preventGestureZoom)
    }
    documentTarget.removeEventListener('touchmove', preventMultiTouchMove)
    windowTarget.removeEventListener('resize', handleResize)
    windowTarget.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
    portraitQuery?.removeEventListener?.('change', handleOrientationChange)
  }
}

interface ViewportSize {
  width: number
  height: number
}

function windowViewportSize(windowTarget: Window): ViewportSize {
  return { width: windowTarget.innerWidth, height: windowTarget.innerHeight }
}

function viewportOrientation(viewport: ViewportSize) {
  return viewport.width >= viewport.height ? 'landscape' : 'portrait'
}

function hasCoarsePointer(windowTarget: Window) {
  return windowTarget.matchMedia?.('(pointer: coarse)').matches ?? false
}
