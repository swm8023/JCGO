const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'
const orientationSettleFrameCount = 8

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  let orientationChangePending = false
  let orientationSettleFramesRemaining = 0
  let rafId: number | undefined

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const applyViewport = (width: number) => {
    documentTarget.documentElement.style.setProperty(appWidthVariable, `${width}px`)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const applyCurrentViewport = () => {
    const viewport = currentViewportSize(windowTarget)
    stableHeight = viewport.height
    applyViewport(viewport.width)
  }
  const scheduleOrientationSettle = () => {
    if (rafId !== undefined) return
    rafId = windowTarget.requestAnimationFrame(runOrientationSettle)
  }
  const restartOrientationSettle = () => {
    orientationChangePending = true
    orientationSettleFramesRemaining = orientationSettleFrameCount
    scheduleOrientationSettle()
  }
  const runOrientationSettle = () => {
    rafId = undefined
    if (!orientationChangePending) return
    applyCurrentViewport()
    orientationSettleFramesRemaining -= 1
    if (orientationSettleFramesRemaining <= 0) {
      orientationChangePending = false
      return
    }
    scheduleOrientationSettle()
  }
  const handleResize = () => {
    if (orientationChangePending) {
      restartOrientationSettle()
      return
    }
    const viewport = currentViewportSize(windowTarget)
    if (!hasCoarsePointer(windowTarget)) {
      stableHeight = viewport.height
    } else {
      stableHeight = Math.max(stableHeight, viewport.height)
    }
    applyViewport(viewport.width)
  }
  const handleOrientationChange = () => {
    restartOrientationSettle()
  }
  const handleVisualViewportResize = () => {
    if (orientationChangePending) {
      restartOrientationSettle()
      return
    }
    const viewport = windowTarget.visualViewport
    if (!viewport) return
    const windowSize = currentViewportSize(windowTarget)
    if (!hasCoarsePointer(windowTarget)) {
      stableHeight = windowSize.height
    } else {
      stableHeight = Math.max(stableHeight, windowSize.height)
    }
    applyViewport(windowSize.width)
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
    if (rafId !== undefined) windowTarget.cancelAnimationFrame(rafId)
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

function currentViewportSize(windowTarget: Window): ViewportSize {
  const viewport = windowViewportSize(windowTarget)
  if (!hasCoarsePointer(windowTarget)) return viewport
  const visualViewport = windowTarget.visualViewport
  if (!visualViewport) return viewport
  return {
    width: Math.max(viewport.width, visualViewport.width),
    height: Math.max(viewport.height, visualViewport.height),
  }
}

function hasCoarsePointer(windowTarget: Window) {
  return windowTarget.matchMedia?.('(pointer: coarse)').matches ?? false
}
