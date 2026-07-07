const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'
const viewportDebugElementId = '__viewport-debug'
const viewportDebugSampleLimit = 5

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableHeight = windowTarget.innerHeight
  const debugOverlay = viewportDebugEnabled(windowTarget) ? createViewportDebugOverlay(documentTarget) : undefined
  const debugSamples: string[] = []

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }
  const preventMultiTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const applyViewport = () => {
    documentTarget.documentElement.style.removeProperty(appWidthVariable)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const writeDebug = (source: string) => {
    if (!debugOverlay) return
    debugSamples.push(viewportDebugSnapshot(source, windowTarget, documentTarget, stableHeight))
    while (debugSamples.length > viewportDebugSampleLimit) debugSamples.shift()
    debugOverlay.textContent = debugSamples.join('\n\n')
  }
  const handleResize = () => {
    const viewport = currentViewportSize(windowTarget)
    if (!hasCoarsePointer(windowTarget)) {
      stableHeight = viewport.height
    } else {
      stableHeight = Math.max(stableHeight, viewport.height)
    }
    applyViewport()
    writeDebug('resize')
  }
  const handleVisualViewportResize = () => {
    const viewport = windowTarget.visualViewport
    if (!viewport) return
    const windowSize = currentViewportSize(windowTarget)
    if (!hasCoarsePointer(windowTarget)) {
      stableHeight = windowSize.height
    } else {
      stableHeight = Math.max(stableHeight, windowSize.height)
    }
    applyViewport()
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

  return () => {
    for (const eventName of gestureEvents) {
      windowTarget.removeEventListener(eventName, preventGestureZoom)
      documentTarget.removeEventListener(eventName, preventGestureZoom)
    }
    documentTarget.removeEventListener('touchmove', preventMultiTouchMove)
    windowTarget.removeEventListener('resize', handleResize)
    windowTarget.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
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
  if (Math.abs((visualViewport.scale ?? 1) - 1) > 0.01) return viewport
  return {
    width: viewport.width,
    height: Math.max(viewport.height, visualViewport.height),
  }
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
