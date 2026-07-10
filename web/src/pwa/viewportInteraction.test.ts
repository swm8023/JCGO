import { describe, expect, it, vi } from 'vitest'

type ListenerRecord = { listener: EventListenerOrEventListenerObject; options?: AddEventListenerOptions | boolean }

class FakeEventTarget {
  readonly listeners = new Map<string, ListenerRecord[]>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { listener, options }])
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((record) => record.listener !== listener),
    )
  }

  dispatch(type: string, event: Event) {
    for (const { listener } of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

class FakeVisualViewport extends FakeEventTarget {
  width = 430
  height = 932
  scale = 1
}

class FakeMediaQueryList extends FakeEventTarget {
  constructor(public matches: boolean) {
    super()
  }
}

class FakeScreenOrientation extends FakeEventTarget {
  type = 'portrait-primary'
  angle = 0
  readonly lock = vi.fn(() => Promise.resolve())
}

class FakeStyle {
  readonly values = new Map<string, string>()
  readonly assigned = new Map<string, string>()

  setProperty(name: string, value: string) {
    this.values.set(name, value)
  }

  removeProperty(name: string) {
    const value = this.values.get(name) ?? ''
    this.values.delete(name)
    return value
  }

  getPropertyValue(name: string) {
    return this.values.get(name) ?? ''
  }
}

class FakeDocumentTarget extends FakeEventTarget {
  readonly elements = new Map<string, FakeElement>()
  readonly body = new FakeElement('body', this)
  readonly root = new FakeElement('div', this)
  readonly viewportMeta = new FakeElement('meta', this)
  readonly documentElement = { style: new FakeStyle(), clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0 }

  constructor() {
    super()
    this.root.id = 'root'
  }

  createElement(tagName: string) {
    return new FakeElement(tagName, this)
  }

  getElementById(id: string) {
    return this.elements.get(id) ?? null
  }

  querySelector(selector: string) {
    if (selector.startsWith('#')) return this.getElementById(selector.slice(1))
    if (selector === 'meta[name="viewport"]') return this.viewportMeta
    return null
  }
}

class FakeElement {
  private elementId = ''
  private readonly attributes = new Map<string, string>()
  readonly style = new FakeStyle()
  textContent = ''

  constructor(readonly tagName: string, private readonly ownerDocument: FakeDocumentTarget) {}

  set id(value: string) {
    this.elementId = value
    if (value) this.ownerDocument.elements.set(value, this)
  }

  get id() {
    return this.elementId
  }

  appendChild(child: FakeElement) {
    if (child.id) this.ownerDocument.elements.set(child.id, child)
    return child
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  remove() {
    if (this.id) this.ownerDocument.elements.delete(this.id)
  }

  getBoundingClientRect() {
    return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }
  }
}

class FakeWindowTarget extends FakeEventTarget {
  innerWidth = 430
  innerHeight = 932
  location = { search: '', reload: vi.fn() }
  readonly screenOrientation = new FakeScreenOrientation()
  readonly orientationLock = this.screenOrientation.lock
  screen = { width: 430, height: 932, orientation: this.screenOrientation }
  coarsePointer = true
  private readonly animationFrames = new Map<number, FrameRequestCallback>()
  private readonly mediaQueries = new Map<string, FakeMediaQueryList>()
  readonly visualViewport = new FakeVisualViewport()

  matchMedia(query: string) {
    const existing = this.mediaQueries.get(query)
    if (existing) return existing

    const list = new FakeMediaQueryList(query.includes('orientation') ? query.includes('portrait') : this.coarsePointer)
    this.mediaQueries.set(query, list)
    return list
  }

  requestAnimationFrame(_callback: FrameRequestCallback) {
    return 0
  }

  cancelAnimationFrame() {
    // no-op: portrait-only viewport handling no longer schedules animation frames
  }
}

describe('viewport interaction guards', () => {
  it('requests the primary portrait orientation from supported installed-app runtimes', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(windowTarget.orientationLock).toHaveBeenCalledWith('portrait-primary')
  })

  it('shows viewport diagnostics when viewport-debug URL parameter is set', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    windowTarget.location.search = '?viewport-debug=1'
    const documentTarget = new FakeDocumentTarget()

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.getElementById('__viewport-debug')?.textContent).toContain('[DEBUG-viewport-rot]')
  })

  it('shows viewport diagnostics for portrait mobile debugging', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    windowTarget.location.search = '?viewport-debug=1'
    windowTarget.innerWidth = 390
    windowTarget.innerHeight = 844
    windowTarget.visualViewport.width = 390
    windowTarget.visualViewport.height = 844
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    windowTarget.dispatch('resize', new Event('resize'))

    const debug = documentTarget.getElementById('__viewport-debug')
    expect(debug?.textContent).toContain('[DEBUG-viewport-rot]')
    expect(debug?.textContent).toContain('src=')
    expect(debug?.textContent).toContain('win=390x844')
    expect(debug?.textContent).toContain('vv=390x844')
    expect(debug?.textContent).toContain('vars=cssx844px')
    expect(debug?.textContent).toContain('display=')
    expect(debug?.textContent).toContain('vp=')
    expect(debug?.textContent).toContain('wide=')

    // a taller viewport raises the locked height (coarse pointer keeps the largest seen height)
    windowTarget.innerWidth = 390
    windowTarget.innerHeight = 1200
    windowTarget.visualViewport.width = 390
    windowTarget.visualViewport.height = 1200
    windowTarget.dispatch('resize', new Event('resize'))

    const debugTaller = documentTarget.getElementById('__viewport-debug')
    expect(debugTaller?.textContent).toContain('win=390x1200')
    expect(debugTaller?.textContent).toContain('vars=cssx1200px')

    cleanup()
    expect(documentTarget.getElementById('__viewport-debug')).toBeNull()
  })

  it('installs non-passive iOS pinch zoom guards without blocking one finger touch moves', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(windowTarget.listeners.get('gesturestart')?.[0].options).toEqual({ passive: false })
    expect(windowTarget.listeners.get('gesturechange')?.[0].options).toEqual({ passive: false })
    expect(windowTarget.listeners.get('gestureend')?.[0].options).toEqual({ passive: false })
    expect(documentTarget.listeners.get('touchmove')?.[0].options).toEqual({ passive: false })

    const gestureEvent = { preventDefault: vi.fn() } as unknown as Event
    windowTarget.dispatch('gesturestart', gestureEvent)
    expect(gestureEvent.preventDefault).toHaveBeenCalledTimes(1)

    const twoFingerMove = { touches: [{}, {}], preventDefault: vi.fn() } as unknown as TouchEvent
    documentTarget.dispatch('touchmove', twoFingerMove)
    expect(twoFingerMove.preventDefault).toHaveBeenCalledTimes(1)

    const oneFingerMove = { touches: [{}], preventDefault: vi.fn() } as unknown as TouchEvent
    documentTarget.dispatch('touchmove', oneFingerMove)
    expect(oneFingerMove.preventDefault).not.toHaveBeenCalled()

    cleanup()
    expect(windowTarget.listeners.get('gesturestart')).toEqual([])
    expect(documentTarget.listeners.get('touchmove')).toEqual([])
  })

  it('locks app height to the largest portrait viewport so transient Android system bars do not compress the board', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-width')).toBeUndefined()

    // transient system-bar show shrinks the viewport; coarse-pointer keeps the largest seen height
    windowTarget.innerHeight = 844
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')

    // expanding again tracks the new maximum
    windowTarget.innerHeight = 960
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('960px')

    cleanup()
    expect(windowTarget.listeners.get('resize')).toEqual([])
  })

  it('updates the centered portrait canvas when landscape viewport geometry changes', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 932
    windowTarget.innerHeight = 430
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('430px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')

    windowTarget.innerWidth = 844
    windowTarget.innerHeight = 390
    windowTarget.visualViewport.width = 844
    windowTarget.visualViewport.height = 390
    windowTarget.dispatch('resize', new Event('resize'))

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('390px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('844px')
  })

  it('counter-rotates the portrait canvas when the platform still exposes a landscape viewport', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 932
    windowTarget.innerHeight = 430
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430
    windowTarget.screen.width = 932
    windowTarget.screen.height = 430

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.root.style.values.get('position')).toBe('fixed')
    expect(documentTarget.root.style.values.get('left')).toBe('50%')
    expect(documentTarget.root.style.values.get('top')).toBe('50%')
    expect(documentTarget.root.style.values.get('transform')).toBe('translate(-50%, -50%) rotate(-90deg)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-top')).toBe('env(safe-area-inset-left, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-right')).toBe('env(safe-area-inset-top, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-bottom')).toBe('env(safe-area-inset-right, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-left')).toBe('env(safe-area-inset-bottom, 0px)')
  })

  it('counter-rotates in the opposite direction for a secondary landscape viewport', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 932
    windowTarget.innerHeight = 430
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430
    windowTarget.screen.width = 932
    windowTarget.screen.height = 430
    windowTarget.screen.orientation.type = 'landscape-secondary'
    windowTarget.screen.orientation.angle = 270

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.root.style.values.get('transform')).toBe('translate(-50%, -50%) rotate(90deg)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-top')).toBe('env(safe-area-inset-right, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-right')).toBe('env(safe-area-inset-bottom, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-bottom')).toBe('env(safe-area-inset-left, 0px)')
    expect(documentTarget.documentElement.style.values.get('--app-safe-left')).toBe('env(safe-area-inset-top, 0px)')
  })

  it('updates the counter-rotation when screen orientation settles after the viewport resize', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 932
    windowTarget.innerHeight = 430
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )
    expect(documentTarget.root.style.values.get('transform')).toBe('translate(-50%, -50%) rotate(-90deg)')

    windowTarget.screen.orientation.type = 'landscape-secondary'
    windowTarget.screen.orientation.angle = 270
    windowTarget.screen.orientation.dispatch('change', new Event('change'))

    expect(documentTarget.root.style.values.get('transform')).toBe('translate(-50%, -50%) rotate(90deg)')

    cleanup()
    expect(windowTarget.screen.orientation.listeners.get('change')).toEqual([])
  })

  it('updates app dimensions when portrait visual viewport resize settles', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-width')).toBeUndefined()

    windowTarget.innerWidth = 430
    windowTarget.innerHeight = 1200
    windowTarget.visualViewport.width = 430
    windowTarget.visualViewport.height = 1200
    windowTarget.visualViewport.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('1200px')
    expect(documentTarget.documentElement.style.values.get('--app-width')).toBeUndefined()

    cleanup()
    expect(windowTarget.visualViewport.listeners.get('resize')).toEqual([])
  })

  it('matches a fresh layout after a foldable changes to a shorter wider viewport', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const resizedWindow = new FakeWindowTarget()
    const resizedDocument = new FakeDocumentTarget()

    installViewportInteractionGuards(
      resizedWindow as unknown as Window,
      resizedDocument as unknown as Document,
    )

    resizedWindow.innerWidth = 800
    resizedWindow.innerHeight = 820
    resizedWindow.visualViewport.width = 800
    resizedWindow.visualViewport.height = 820
    resizedWindow.dispatch('resize', new Event('resize'))

    const freshWindow = new FakeWindowTarget()
    freshWindow.innerWidth = 800
    freshWindow.innerHeight = 820
    freshWindow.visualViewport.width = 800
    freshWindow.visualViewport.height = 820
    const freshDocument = new FakeDocumentTarget()
    installViewportInteractionGuards(
      freshWindow as unknown as Window,
      freshDocument as unknown as Document,
    )

    expect(resizedDocument.documentElement.style.values).toEqual(freshDocument.documentElement.style.values)
  })

  it('matches a fresh layout after rotating from landscape into portrait', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const rotatedWindow = new FakeWindowTarget()
    rotatedWindow.innerWidth = 932
    rotatedWindow.innerHeight = 430
    rotatedWindow.visualViewport.width = 932
    rotatedWindow.visualViewport.height = 430
    const rotatedDocument = new FakeDocumentTarget()

    installViewportInteractionGuards(
      rotatedWindow as unknown as Window,
      rotatedDocument as unknown as Document,
    )

    rotatedWindow.innerWidth = 390
    rotatedWindow.innerHeight = 844
    rotatedWindow.visualViewport.width = 390
    rotatedWindow.visualViewport.height = 844
    rotatedWindow.dispatch('resize', new Event('resize'))

    const freshWindow = new FakeWindowTarget()
    freshWindow.innerWidth = 390
    freshWindow.innerHeight = 844
    freshWindow.visualViewport.width = 390
    freshWindow.visualViewport.height = 844
    const freshDocument = new FakeDocumentTarget()
    installViewportInteractionGuards(
      freshWindow as unknown as Window,
      freshDocument as unknown as Document,
    )

    expect(rotatedDocument.documentElement.style.values).toEqual(freshDocument.documentElement.style.values)
  })

  it('does not persist scaled visual viewport width as the root layout width', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 390
    windowTarget.innerHeight = 844
    windowTarget.visualViewport.width = 979
    windowTarget.visualViewport.height = 928
    windowTarget.visualViewport.scale = 0.4

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBeUndefined()
  })

  it('lets desktop window resizes follow the current viewport height', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.coarsePointer = false

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    windowTarget.innerHeight = 800
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('800px')
  })
})
