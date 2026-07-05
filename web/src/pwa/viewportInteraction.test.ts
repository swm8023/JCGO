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
  readonly visualViewport = new FakeVisualViewport()

  matchMedia() {
    return { matches: this.coarsePointer }
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

    windowTarget.visualViewport.width = 430
    windowTarget.visualViewport.height = 932
    windowTarget.visualViewport.dispatch('resize', new Event('resize'))
    expect(documentTarget.documentElement.style.values.get('--app-width')).toBe('430px')
    expect(documentTarget.documentElement.style.values.get('--app-height')).toBe('932px')

    cleanup()
    expect(windowTarget.visualViewport.listeners.get('resize')).toEqual([])
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
