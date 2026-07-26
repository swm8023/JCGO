import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YunbisaiMyEventsAPI } from './api/types'
import App from './App'

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params?: unknown }>,
}))

vi.mock('./api/jsonrpc', () => ({
  RPCClient: class {
    connect = vi.fn(() => Promise.resolve())
    on = vi.fn()
    onClose = vi.fn()
    close = vi.fn()

    call(method: string, params?: unknown) {
      rpc.calls.push({ method, params })
      if (method === 'workspace.state') {
        return Promise.resolve({
          type: 'state',
          schema: 1,
          games: [],
          analysisState: 'idle',
        })
      }
      if (method === 'yunbisai.status') return Promise.resolve({ loggedIn: true })
      if (method === 'yunbisai.myEvents') {
        return Promise.resolve({ loggedIn: true, total: 0, page: 1, events: [] })
      }
      return Promise.resolve(undefined)
    }
  },
}))

vi.mock('./components/CloudEventsPage', () => ({
  CloudEventsPage: ({ myEventsApi }: { myEventsApi: YunbisaiMyEventsAPI }) => (
    <button
      type="button"
      onClick={() => {
        void myEventsApi.status()
        void myEventsApi.myEvents(1)
      }}
    >
      调用云比赛 API
    </button>
  ),
}))

describe('App Yunbisai API wiring', () => {
  beforeEach(() => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
  })

  afterEach(() => {
    cleanup()
    rpc.calls.length = 0
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('passes status and my-events RPC methods to the cloud page', async () => {
    render(<App />)

    await screen.findByLabelText('打开功能菜单')
    await userEvent.click(screen.getByLabelText('打开功能菜单'))
    await userEvent.click(screen.getByRole('button', { name: '云比赛' }))
    await userEvent.click(await screen.findByRole('button', { name: '调用云比赛 API' }))

    await waitFor(() => {
      expect(rpc.calls).toContainEqual({ method: 'yunbisai.status', params: undefined })
      expect(rpc.calls).toContainEqual({ method: 'yunbisai.myEvents', params: { page: 1 } })
    })
  })
})
