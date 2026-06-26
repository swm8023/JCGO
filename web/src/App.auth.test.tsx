import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

class RejectingWebSocket {
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    queueMicrotask(() => this.onerror?.())
  }

  send = vi.fn()
}

describe('App token authentication', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('returns to the token gate and forgets a cached token when websocket authentication fails', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'wrong-token']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    vi.stubGlobal('WebSocket', RejectingWebSocket)

    render(<App />)

    expect(await screen.findByLabelText('Access token')).toBeInTheDocument()
    expect(storage.get('jcgo.accessToken')).toBeUndefined()
  })
})
