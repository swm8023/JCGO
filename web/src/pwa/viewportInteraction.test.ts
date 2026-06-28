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

describe('viewport interaction guards', () => {
  it('installs non-passive iOS pinch zoom guards without blocking one finger touch moves', async () => {
    const moduleName = './viewportInteraction'
    const { installViewportInteractionGuards } = (await import(moduleName)) as typeof import('./viewportInteraction')
    const windowTarget = new FakeEventTarget()
    const documentTarget = new FakeEventTarget()

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
})
