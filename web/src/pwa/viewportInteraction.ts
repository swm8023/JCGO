const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  let lastOrientation = viewportOrientation(windowViewportSize(windowTarget))

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const updateAppHeight = (viewport: ViewportSize) => {
    const currentOrientation = viewportOrientation(viewport)
    if (currentOrientation !== lastOrientation) {
      lastOrientation = currentOrientation
      stableHeight = viewport.height
    } else if (!hasCoarsePointer(windowTarget)) {
      stableHeight = viewport.height
    } else {
      stableHeight = Math.max(stableHeight, viewport.height)
    }
    documentTarget.documentElement.style.setProperty(appWidthVariable, `${viewport.width}px`)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const handleOrientationChange = () => {
    stableHeight = windowTarget.innerHeight
    lastOrientation = viewportOrientation(windowViewportSize(windowTarget))
    const viewport = windowViewportSize(windowTarget)
    documentTarget.documentElement.style.setProperty(appWidthVariable, `${viewport.width}px`)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const updateAppHeightFromWindow = () => updateAppHeight(windowViewportSize(windowTarget))
  const updateAppHeightFromVisualViewport = () => {
    const viewport = windowTarget.visualViewport
    if (viewport) updateAppHeight({ width: viewport.width, height: viewport.height })
  }

  updateAppHeightFromWindow()
  for (const eventName of gestureEvents) {
    windowTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
    documentTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
  }
  documentTarget.addEventListener('touchmove', preventMultiTouchMove, nonPassiveListener)
  windowTarget.addEventListener('resize', updateAppHeightFromWindow)
  windowTarget.visualViewport?.addEventListener('resize', updateAppHeightFromVisualViewport)

  const portraitQuery = windowTarget.matchMedia?.('(orientation: portrait)')
  portraitQuery?.addEventListener?.('change', handleOrientationChange)

  return () => {
    for (const eventName of gestureEvents) {
      windowTarget.removeEventListener(eventName, preventGestureZoom)
      documentTarget.removeEventListener(eventName, preventGestureZoom)
    }
    documentTarget.removeEventListener('touchmove', preventMultiTouchMove)
    windowTarget.removeEventListener('resize', updateAppHeightFromWindow)
    windowTarget.visualViewport?.removeEventListener('resize', updateAppHeightFromVisualViewport)
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
