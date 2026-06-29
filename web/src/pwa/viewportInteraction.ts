const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appHeightVariable = '--app-height'

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let viewportMode = viewportOrientation(windowTarget)
  let stableHeight = windowTarget.innerHeight

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const updateAppHeight = () => {
    const nextMode = viewportOrientation(windowTarget)
    if (nextMode !== viewportMode) {
      viewportMode = nextMode
      stableHeight = windowTarget.innerHeight
    } else if (!hasCoarsePointer(windowTarget)) {
      stableHeight = windowTarget.innerHeight
    } else {
      stableHeight = Math.max(stableHeight, windowTarget.innerHeight)
    }
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }

  updateAppHeight()
  for (const eventName of gestureEvents) {
    windowTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
    documentTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
  }
  documentTarget.addEventListener('touchmove', preventMultiTouchMove, nonPassiveListener)
  windowTarget.addEventListener('resize', updateAppHeight)
  windowTarget.addEventListener('orientationchange', updateAppHeight)

  return () => {
    for (const eventName of gestureEvents) {
      windowTarget.removeEventListener(eventName, preventGestureZoom)
      documentTarget.removeEventListener(eventName, preventGestureZoom)
    }
    documentTarget.removeEventListener('touchmove', preventMultiTouchMove)
    windowTarget.removeEventListener('resize', updateAppHeight)
    windowTarget.removeEventListener('orientationchange', updateAppHeight)
  }
}

function viewportOrientation(windowTarget: Window) {
  return windowTarget.innerWidth >= windowTarget.innerHeight ? 'landscape' : 'portrait'
}

function hasCoarsePointer(windowTarget: Window) {
  return windowTarget.matchMedia?.('(pointer: coarse)').matches ?? false
}
