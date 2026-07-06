const gestureEvents = ['gesturestart', 'gesturechange', 'gestureend'] as const
const nonPassiveListener: AddEventListenerOptions = { passive: false }
const appWidthVariable = '--app-width'
const appHeightVariable = '--app-height'
const orientationSettleFrameCount = 8
const viewportDebugElementId = '__viewport-debug'
const viewportDebugSampleLimit = 5

export function installViewportInteractionGuards(windowTarget: Window = window, documentTarget: Document = document) {
  let stableWidth: number | undefined
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
  const applyViewport = () => {
    if (stableWidth === undefined) documentTarget.documentElement.style.removeProperty(appWidthVariable)
    else documentTarget.documentElement.style.setProperty(appWidthVariable, `${stableWidth}px`)
    documentTarget.documentElement.style.setProperty(appHeightVariable, `${stableHeight}px`)
  }
  const clearViewportLock = () => {
    documentTarget.documentElement.style.removeProperty(appWidthVariable)
    documentTarget.documentElement.style.removeProperty(appHeightVariable)
  }
  const writeDebug = (source: string) => {
    if (!debugOverlay) return
    debugSamples.push(viewportDebugSnapshot(source, windowTarget, documentTarget, stableHeight, orientationChangePending, orientationSettleFramesRemaining))
    while (debugSamples.length > viewportDebugSampleLimit) debugSamples.shift()
    debugOverlay.textContent = debugSamples.join('\n\n')
  }
  const consoleLog: string[] = []
  const logToOverlay = (msg: string) => {
    console.log(msg)
    consoleLog.push(msg)
    if (consoleLog.length > 20) consoleLog.shift()
    if (debugOverlay) {
      let logEl = documentTarget.getElementById('__viewport-log')
      if (!logEl) {
        logEl = documentTarget.createElement('div')
        logEl.id = '__viewport-log'
        logEl.style.cssText = 'margin-top:4px;max-height:40vh;overflow:hidden'
        debugOverlay.appendChild(logEl)
      }
      logEl.textContent = consoleLog.join('\n')
    }
  }
  const applyCurrentViewport = (source: string) => {
    const viewport = currentViewportSize(windowTarget, true)
    const vv = windowTarget.visualViewport
    logToOverlay(`[${source}] win=${windowTarget.innerWidth}x${windowTarget.innerHeight} vv=${vv?.width}x${vv?.height} sc=${round(vv?.scale ?? 1)} -> ${viewport.width === undefined ? 'css' : round(viewport.width)}x${round(viewport.height)} sh=${round(stableHeight)}`)
    stableWidth = viewport.usesVisualViewport ? viewport.width : undefined
    stableHeight = viewport.height
    applyViewport()
    writeDebug(source)
  }
  const scheduleOrientationSettle = () => {
    if (rafId !== undefined) return
    rafId = windowTarget.requestAnimationFrame(runOrientationSettle)
  }
  const restartOrientationSettle = () => {
    orientationChangePending = true
    orientationSettleFramesRemaining = orientationSettleFrameCount
    clearViewportLock()
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
    const vv = windowTarget.visualViewport
    logToOverlay(`[resize] win=${windowTarget.innerWidth}x${windowTarget.innerHeight} vv=${vv?.width}x${vv?.height} sc=${round(vv?.scale ?? 1)} -> ${viewport.width === undefined ? 'css' : round(viewport.width)}x${round(viewport.height)} sh=${round(stableHeight)}`)
    stableWidth = viewport.usesVisualViewport ? viewport.width : undefined
    if (!hasCoarsePointer(windowTarget) || viewport.usesVisualViewport) {
      stableHeight = viewport.height
    } else {
      stableHeight = Math.max(stableHeight, viewport.height)
    }
    applyViewport()
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
    const windowSize = currentViewportSize(windowTarget, true)
    logToOverlay(`[vv] win=${windowTarget.innerWidth}x${windowTarget.innerHeight} vv=${viewport.width}x${viewport.height} sc=${round(viewport.scale)} -> ${windowSize.width === undefined ? 'css' : round(windowSize.width)}x${round(windowSize.height)} sh=${round(stableHeight)}`)
    stableWidth = windowSize.usesVisualViewport ? windowSize.width : undefined
    if (!hasCoarsePointer(windowTarget) || windowSize.usesVisualViewport) {
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
  width?: number
  height: number
  usesVisualViewport?: boolean
}

interface LayoutViewportSize extends ViewportSize {
  width: number
}

function windowViewportSize(windowTarget: Window): LayoutViewportSize {
  return { width: windowTarget.innerWidth, height: windowTarget.innerHeight }
}

function currentViewportSize(windowTarget: Window, allowVisibleViewportOverride = false): ViewportSize {
  const viewport = windowViewportSize(windowTarget)
  if (!hasCoarsePointer(windowTarget)) return viewport
  const visualViewport = windowTarget.visualViewport
  if (!visualViewport) return viewport
  if (allowVisibleViewportOverride && isUnscaledVisibleViewportSmaller(viewport, visualViewport)) {
    return {
      width: visualViewport.width,
      height: visualViewport.height,
      usesVisualViewport: true,
    }
  }
  if (Math.abs((visualViewport.scale ?? 1) - 1) > 0.01) return { height: viewport.height }
  return {
    height: Math.max(viewport.height, visualViewport.height),
  }
}

function isUnscaledVisibleViewportSmaller(layoutViewport: LayoutViewportSize, visualViewport: VisualViewport) {
  if (Math.abs((visualViewport.scale ?? 1) - 1) > 0.01) return false
  return visualViewport.width < layoutViewport.width - 0.5 || visualViewport.height < layoutViewport.height - 0.5
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
  })
  const btn = documentTarget.createElement('button')
  btn.textContent = 'COPY LOG'
  Object.assign(btn.style, {
    display: 'block',
    width: '100%',
    padding: '12px',
    marginBottom: '4px',
    fontSize: '16px',
    fontWeight: 'bold',
    background: '#2fff4f',
    color: '#000',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'center',
  })
  btn.addEventListener('click', () => {
    const logEl = documentTarget.getElementById('__viewport-log')
    const text = logEl?.textContent ?? ''
    navigator.clipboard?.writeText(text)?.then(() => {
      btn.textContent = 'COPIED!'
      setTimeout(() => { btn.textContent = 'COPY LOG' }, 1500)
    })?.catch(() => {})
  })
  el.appendChild(btn)
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
