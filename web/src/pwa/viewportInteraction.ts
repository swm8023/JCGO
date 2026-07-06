const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'
const orientationSettleFrameCount = 8
const viewportDebugElementId = '__viewport-debug'
const viewportDebugSampleLimit = 5

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  let orientationChangePending = false
  let orientationSettleFramesRemaining = 0
  let rafId: number | undefined
  const debugOverlay = createViewportDebugOverlay(documentTarget)
  const debugSamples: string[] = []

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
  const writeDebug = (source: string) => {
    if (!debugOverlay) return
    debugSamples.push(viewportDebugSnapshot(source, windowTarget, documentTarget, stableHeight, orientationChangePending, orientationSettleFramesRemaining))
    while (debugSamples.length > viewportDebugSampleLimit) debugSamples.shift()
    debugOverlay.textContent = debugSamples.join('\n\n')
  }
  const applyCurrentViewport = (source: string) => {
    const viewport = currentViewportSize(windowTarget)
    stableHeight = viewport.height
    applyViewport(viewport.width)
    writeDebug(source)
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
    applyCurrentViewport('settle')
    orientationSettleFramesRemaining -= 1
    if (orientationSettleFramesRemaining <= 0) {
      orientationChangePending = false
      writeDebug('settle(done)')
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
    writeDebug('resize')
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
    writeDebug('vv')
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
    debugOverlay?.remove()
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

function createViewportDebugOverlay(documentTarget: Document): HTMLElement {
  documentTarget.getElementById(viewportDebugElementId)?.remove()
  const el = documentTarget.createElement('div')
  el.id = viewportDebugElementId
  Object.assign(el.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '99999',
    maxHeight: '50vh',
    overflow: 'hidden',
    padding: '6px 8px',
    background: 'rgba(0, 0, 0, 0.84)',
    color: '#2fff4f',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '10px',
    lineHeight: '1.35',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
  })
  documentTarget.body.appendChild(el)
  return el
}

function viewportDebugSnapshot(
  source: string,
  windowTarget: Window,
  documentTarget: Document,
  stableHeight: number,
  orientationChangePending: boolean,
  orientationSettleFramesRemaining: number,
) {
  const rootStyle = documentTarget.documentElement.style
  const viewport = windowViewportSize(windowTarget)
  const visualViewport = windowTarget.visualViewport
  const screenTarget = windowTarget.screen
  const orientation = screenTarget?.orientation
  const layout = documentTarget.querySelector('.app-layout')
  const analysis = documentTarget.querySelector('.analysis-rail')
  const board = documentTarget.querySelector('.go-board')
  const layoutStyle = computedStyle(windowTarget, layout)
  const analysisStyle = computedStyle(windowTarget, analysis)

  return [
    `[DEBUG-viewport-rot] src=${source} pending=${orientationChangePending} settle=${orientationSettleFramesRemaining}`,
    `win=${round(viewport.width)}x${round(viewport.height)} vv=${visualViewport ? `${round(visualViewport.width)}x${round(visualViewport.height)} scale=${round(visualViewport.scale ?? 1)}` : 'none'} sh=${round(stableHeight)} dpr=${round(windowTarget.devicePixelRatio || 1)}`,
    `screen=${screenTarget ? `${screenTarget.width}x${screenTarget.height}` : 'none'} orient=${orientation ? `${orientation.type}/${orientation.angle}` : 'none'} display=${displayModeSummary(windowTarget)} mq=${mediaQuerySummary(windowTarget)}`,
    `vars=${rootStyle.getPropertyValue(appWidthVariable)}x${rootStyle.getPropertyValue(appHeightVariable)} root=${rectSummary(documentTarget.getElementById('root'))}`,
    `layout=${rectSummary(layout)} pad=${layoutStyle ? `${layoutStyle.paddingLeft}/${layoutStyle.paddingRight}/${layoutStyle.paddingTop}/${layoutStyle.paddingBottom}` : 'N/A'} cols=${layoutStyle?.gridTemplateColumns ?? 'N/A'} rows=${layoutStyle?.gridTemplateRows ?? 'N/A'}`,
    `railL=${rectSummary(documentTarget.querySelector('.game-sidebar'))} boardStage=${rectSummary(documentTarget.querySelector('.board-stage'))} action=${rectSummary(documentTarget.querySelector('.action-rail'))}`,
    `analysis=${analysisStyle?.display ?? 'N/A'} ${rectSummary(analysis)} board=${rectSummary(board)}`,
  ].join('\n')
}

function computedStyle(windowTarget: Window, element: Element | null) {
  if (!element) return undefined
  return windowTarget.getComputedStyle?.(element)
}

function rectSummary(element: Element | null) {
  if (!element) return 'none'
  const rect = element.getBoundingClientRect()
  return `${round(rect.width)}x${round(rect.height)}@${round(rect.left)},${round(rect.top)}`
}

function mediaQuerySummary(windowTarget: Window) {
  return [
    `p=${windowTarget.matchMedia?.('(orientation: portrait)').matches ?? 'N/A'}`,
    `l=${windowTarget.matchMedia?.('(orientation: landscape)').matches ?? 'N/A'}`,
    `coarse=${hasCoarsePointer(windowTarget)}`,
  ].join('/')
}

function displayModeSummary(windowTarget: Window) {
  const modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser']
  return modes.filter((mode) => windowTarget.matchMedia?.(`(display-mode: ${mode})`).matches).join('|') || 'N/A'
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
