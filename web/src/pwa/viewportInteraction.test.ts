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
  width = 932
  height = 430
}

class FakeMediaQueryList extends FakeEventTarget {
  constructor(public matches: boolean) {
    super()
  }
}

class FakeStyle {
  readonly values = new Map<string, string>()

  setProperty(name: string, value: string) {
    this.values.set(name, value)
  }
}

class FakeDocumentTarget extends FakeEventTarget {
  readonly documentElement = { style: new FakeStyle() }
}

class FakeWindowTarget extends FakeEventTarget {
  innerWidth = 932
  innerHeight = 430
  coarsePointer = true
  portrait = false
  private nextFrameId = 0
  private readonly animationFrames = new Map<number, FrameRequestCallback>()
  private readonly mediaQueries = new Map<string, FakeMediaQueryList>()
  readonly visualViewport = new FakeVisualViewport()

  matchMedia(query: string) {
    const existing = this.mediaQueries.get(query)
    if (existing) return existing

    const list = new FakeMediaQueryList(query.includes('orientation') ? this.portrait : this.coarsePointer)
    this.mediaQueries.set(query, list)
    return list
  }

  setPortrait(value: boolean) {
    this.portrait = value
    const query = this.mediaQueries.get('(orientation: portrait)')
    if (!query) return
    query.matches = value
    query.dispatch('change', new Event('change'))
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = ++this.nextFrameId
    this.animationFrames.set(id, callback)
    return id
  }

  cancelAnimationFrame(id: number) {
    this.animationFrames.delete(id)
  }

  runAnimationFrames() {
    const callbacks = [...this.animationFrames.entries()]
    this.animationFrames.clear()
    for (const [, callback] of callbacks) callback(performance.now())
  }
}

describe('viewport interaction guards', () => {
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

  it('locks app height to the largest landscape viewport so transient Android system bars do not compress the board', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('430px')

    windowTarget.innerHeight = 390
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('430px')

    windowTarget.innerHeight = 452
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('452px')

    cleanup()
    expect(windowTarget.listeners.get('resize')).toEqual([])
  })

  it('updates app dimensions when mobile rotation is reported through visual viewport resize', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()

    const cleanup = installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('430px')

    windowTarget.innerWidth = 430
    windowTarget.innerHeight = 932
    windowTarget.visualViewport.width = 430
    windowTarget.visualViewport.height = 932
    windowTarget.visualViewport.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('430px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')

    cleanup()
    expect(windowTarget.visualViewport.listeners.get('resize')).toEqual([])
  })

  it('does not lock mobile landscape rotation to a transient browser chrome height', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 368
    windowTarget.innerHeight = 663
    windowTarget.visualViewport.width = 368
    windowTarget.visualViewport.height = 663
    windowTarget.portrait = true

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    windowTarget.innerWidth = 795
    windowTarget.innerHeight = 278
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430
    windowTarget.setPortrait(false)
    windowTarget.dispatch('resize', new Event('resize'))
    windowTarget.runAnimationFrames()
    windowTarget.runAnimationFrames()

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('430px')
  })

  it('keeps sampling after rotation until delayed mobile viewport dimensions settle', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeWindowTarget()
    const documentTarget = new FakeDocumentTarget()
    windowTarget.innerWidth = 368
    windowTarget.innerHeight = 663
    windowTarget.visualViewport.width = 368
    windowTarget.visualViewport.height = 663
    windowTarget.portrait = true

    installViewportInteractionGuards(
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    windowTarget.innerWidth = 795
    windowTarget.innerHeight = 278
    windowTarget.visualViewport.width = 795
    windowTarget.visualViewport.height = 278
    windowTarget.setPortrait(false)
    windowTarget.dispatch('resize', new Event('resize'))
    windowTarget.runAnimationFrames()

    windowTarget.innerWidth = 932
    windowTarget.innerHeight = 430
    windowTarget.visualViewport.width = 932
    windowTarget.visualViewport.height = 430
    for (let i = 0; i < 10; i++) windowTarget.runAnimationFrames()

    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('932px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('430px')
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

    windowTarget.innerHeight = 390
    windowTarget.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('390px')
  })
})
