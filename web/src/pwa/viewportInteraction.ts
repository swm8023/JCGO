const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'
const portraitFallbackRootProperties = ['position', 'left', 'top', 'transform', 'transform-origin'] as const
const safeAreaVariables = ['--app-safe-top', '--app-safe-right', '--app-safe-bottom', '--app-safe-left'] as const
const viewportDebugElementId = '__viewport-debug'
const viewportDebugSampleLimit = 5

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  let appWidth: number | undefined
  let effectiveAppWidth: number | undefined
  const debugOverlay = viewportDebugEnabled(windowTarget) ? createViewportDebugOverlay(documentTarget) : undefined
  const debugSamples: string[] = []

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const applyViewport = () => {
    if (appWidth === undefined) {
      documentTarget.documentElement.style.removeProperty(appWidthVariable)
    } else {
      documentTarget.documentElement.style.setProperty(appWidthVariable, `${appWidth}px`)
    }
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const writeDebug = (source: string) => {
    if (!debugOverlay) return
    debugSamples.push(viewportDebugSnapshot(source, windowTarget, documentTarget, stableHeight))
    while (debugSamples.length > viewportDebugSampleLimit) debugSamples.shift()
    debugOverlay.textContent = debugSamples.join('\n\n')
  }
  const updateViewport = (source: string) => {
    const viewport = currentViewportSize(windowTarget)
    const coarsePointer = hasCoarsePointer(windowTarget)
    const portraitViewport = portraitViewportSize(viewport, coarsePointer)
    const nextAppWidth = portraitViewport.width
    const nextEffectiveAppWidth = nextAppWidth ?? viewport.width
    const widthChanged = effectiveAppWidth !== undefined && Math.abs(nextEffectiveAppWidth - effectiveAppWidth) > 0.5
    const canvasOrientationChanged = (appWidth === undefined) !== (nextAppWidth === undefined)
    if (!coarsePointer || effectiveAppWidth === undefined || widthChanged || canvasOrientationChanged) {
      stableHeight = portraitViewport.height
    } else {
      stableHeight = Math.max(stableHeight, portraitViewport.height)
    }
    appWidth = nextAppWidth
    effectiveAppWidth = nextEffectiveAppWidth
    applyViewport()
    applyPortraitFallback(windowTarget, documentTarget, appWidth !== undefined)
    writeDebug(source)
  }
  const handleResize = () => {
    updateViewport('resize')
  }
  const handleVisualViewportResize = () => {
    if (!windowTarget.visualViewport) return
    updateViewport('vv')
  }
  const handleScreenOrientationChange = () => {
    updateViewport('orientation')
  }

  requestPrimaryPortraitOrientation(windowTarget)
  handleResize()
  for (const eventName of gestureEvents) {
    windowTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
    documentTarget.addEventListener(eventName, preventGestureZoom, nonPassiveListener)
  }
  documentTarget.addEventListener('touchmove', preventMultiTouchMove, nonPassiveListener)
  windowTarget.addEventListener('resize', handleResize)
  windowTarget.visualViewport?.addEventListener('resize', handleVisualViewportResize)
  windowTarget.screen.orientation?.addEventListener?.('change', handleScreenOrientationChange)

  return () => {
    for (const eventName of gestureEvents) {
      windowTarget.removeEventListener(eventName, preventGestureZoom)
      documentTarget.removeEventListener(eventName, preventGestureZoom)
    }
    documentTarget.removeEventListener('touchmove', preventMultiTouchMove)
    windowTarget.removeEventListener('resize', handleResize)
    windowTarget.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
    windowTarget.screen.orientation?.removeEventListener?.('change', handleScreenOrientationChange)
    clearPortraitFallback(documentTarget)
    debugOverlay?.remove()
  }
}

interface ViewportSize {
  width: number
  height: number
}

interface AppViewportSize {
  width?: number
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
  if (Math.abs((visualViewport.scale ?? 1) - 1) > 0.01) return viewport
  return {
    width: viewport.width,
    height: Math.max(viewport.height, visualViewport.height),
  }
}

function portraitViewportSize(viewport: ViewportSize, coarsePointer: boolean): AppViewportSize {
  if (!coarsePointer) return { height: viewport.height }
  if (viewport.width <= viewport.height) return { height: viewport.height }
  return { width: viewport.height, height: viewport.width }
}

function requestPrimaryPortraitOrientation(windowTarget: Window) {
  try {
    windowTarget.screen.orientation?.lock?.('portrait-primary')?.catch?.(() => undefined)
  } catch {
    // The manifest remains authoritative when a runtime rejects programmatic orientation locking.
  }
}

function applyPortraitFallback(windowTarget: Window, documentTarget: Document, enabled: boolean) {
  const root = documentTarget.getElementById('root')
  if (!root) return
  if (!enabled) {
    clearPortraitFallback(documentTarget)
    return
  }

  const rotation = portraitFallbackRotation(windowTarget)
  root.style.setProperty('position', 'fixed')
  root.style.setProperty('left', '50%')
  root.style.setProperty('top', '50%')
  root.style.setProperty('transform-origin', 'center')
  root.style.setProperty('transform', `translate(-50%, -50%) rotate(${rotation}deg)`)
  applyRotatedSafeAreas(documentTarget, rotation)
}

function clearPortraitFallback(documentTarget: Document) {
  const root = documentTarget.getElementById('root')
  for (const property of portraitFallbackRootProperties) root?.style.removeProperty(property)
  for (const property of safeAreaVariables) documentTarget.documentElement.style.removeProperty(property)
}

function portraitFallbackRotation(windowTarget: Window) {
  const orientation = windowTarget.screen.orientation
  const legacyAngle = (windowTarget as Window & { orientation?: number }).orientation
  const angle = normalizeAngle(orientation?.angle ?? legacyAngle ?? 0)
  if (angle === 270 || orientation?.type === 'landscape-secondary') return 90
  return -90
}

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360
}

function applyRotatedSafeAreas(documentTarget: Document, rotation: number) {
  const style = documentTarget.documentElement.style
  if (rotation < 0) {
    style.setProperty('--app-safe-top', 'env(safe-area-inset-left, 0px)')
    style.setProperty('--app-safe-right', 'env(safe-area-inset-top, 0px)')
    style.setProperty('--app-safe-bottom', 'env(safe-area-inset-right, 0px)')
    style.setProperty('--app-safe-left', 'env(safe-area-inset-bottom, 0px)')
    return
  }
  style.setProperty('--app-safe-top', 'env(safe-area-inset-right, 0px)')
  style.setProperty('--app-safe-right', 'env(safe-area-inset-bottom, 0px)')
  style.setProperty('--app-safe-bottom', 'env(safe-area-inset-left, 0px)')
  style.setProperty('--app-safe-left', 'env(safe-area-inset-top, 0px)')
}

function hasCoarsePointer(windowTarget: Window) {
  return windowTarget.matchMedia?.('(pointer: coarse)').matches ?? false
}

function viewportDebugEnabled(windowTarget: Window) {
  try {
    const value = new URLSearchParams(windowTarget.location.search).get('viewport-debug')
    return value === '1' || value === 'true'
  } catch {
    return false
  }
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
    `[DEBUG-viewport-rot] src=${source}`,
    `win=${round(viewport.width)}x${round(viewport.height)} vv=${visualViewport ? `${round(visualViewport.width)}x${round(visualViewport.height)} scale=${round(visualViewport.scale ?? 1)}` : 'none'} sh=${round(stableHeight)} dpr=${round(windowTarget.devicePixelRatio || 1)}`,
    `screen=${screenTarget ? `${screenTarget.width}x${screenTarget.height}` : 'none'} orient=${orientation ? `${orientation.type}/${orientation.angle}` : 'none'} display=${displayModeSummary(windowTarget)} mq=${mediaQuerySummary(windowTarget)}`,
    `vars=${rootStyle.getPropertyValue(appWidthVariable) || 'css'}x${rootStyle.getPropertyValue(appHeightVariable) || 'css'} doc=${documentMetrics(documentTarget.documentElement)} vp=${viewportMetaSummary(documentTarget)} root=${rectSummary(documentTarget.getElementById('root'))}`,
    `wide=${widestElementsSummary(documentTarget)}`,
    `layout=${rectSummary(layout)} pad=${layoutStyle ? `${layoutStyle.paddingLeft}/${layoutStyle.paddingRight}/${layoutStyle.paddingTop}/${layoutStyle.paddingBottom}` : 'N/A'} cols=${layoutStyle?.gridTemplateColumns ?? 'N/A'} rows=${layoutStyle?.gridTemplateRows ?? 'N/A'}`,
    `railL=${rectSummary(documentTarget.querySelector('.game-sidebar'))} boardStage=${rectSummary(documentTarget.querySelector('.board-stage'))} action=${rectSummary(documentTarget.querySelector('.action-rail'))}`,
    `analysis=${analysisStyle?.display ?? 'N/A'} ${rectSummary(analysis)} board=${rectSummary(board)}`,
  ].join('\n')
}

function viewportMetaSummary(documentTarget: Document) {
  const meta = documentTarget.querySelector('meta[name="viewport"]')
  return meta?.getAttribute('content')?.replace(/\s+/g, ' ').trim() || 'none'
}

function documentMetrics(element: Element) {
  return `${round(element.clientWidth)}x${round(element.clientHeight)} scroll=${round(element.scrollWidth)}x${round(element.scrollHeight)}`
}

function widestElementsSummary(documentTarget: Document) {
  const body = documentTarget.body
  if (!body || typeof body.querySelectorAll !== 'function') return 'N/A'

  const elements = [documentTarget.documentElement, body, ...Array.from(body.querySelectorAll('*'))]
  return elements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const scrollWidth = element.scrollWidth || 0
      const clientWidth = element.clientWidth || 0
      return {
        element,
        width: Math.max(rect.width, scrollWidth, clientWidth),
        rect,
        scrollWidth,
        clientWidth,
      }
    })
    .filter(({ width }) => width > 0)
    .sort((a, b) => b.width - a.width)
    .slice(0, 4)
    .map(({ element, width, rect, scrollWidth, clientWidth }) => `${elementDebugLabel(element)}:${round(width)} r${round(rect.width)} s${round(scrollWidth)} c${round(clientWidth)}@${round(rect.left)}`)
    .join(' | ') || 'none'
}

function elementDebugLabel(element: Element) {
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const className = typeof element.className === 'string' ? element.className : ''
  const classes = className
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join('')
  return `${tag}${id}${classes}`
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
