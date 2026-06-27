import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProtocols, makeRequest, RPCClient } from './jsonrpc'

class ControlledWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: ControlledWebSocket[] = []

  readyState = ControlledWebSocket.CONNECTING
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []

  constructor() {
    ControlledWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = ControlledWebSocket.CLOSED
    this.onclose?.()
  }

  open() {
    this.readyState = ControlledWebSocket.OPEN
    this.onopen?.()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  ControlledWebSocket.instances = []
})

describe('jsonrpc helpers', () => {
  it('builds websocket subprotocols with token', () => {
    expect(buildProtocols('secret')).toEqual(['jcgo-jsonrpc', 'token.secret'])
  })

  it('creates JSON-RPC 2.0 requests', () => {
    expect(makeRequest('1', 'game.list', {})).toEqual({
      jsonrpc: '2.0',
      id: '1',
      method: 'game.list',
      params: {},
    })
  })

  it('rejects calls before the websocket is open', async () => {
    const client = new RPCClient()

    await expect(withTimeout(client.call('workspace.state'))).rejects.toThrow('websocket is not connected')
  })

  it('rejects pending calls when the websocket closes before a response', async () => {
    vi.stubGlobal('WebSocket', ControlledWebSocket)
    const client = new RPCClient()
    const connected = client.connect('ws://localhost/ws', 'secret')
    const socket = ControlledWebSocket.instances[0]
    socket.open()
    await connected

    const pending = client.call('game.goto', { gameId: 'g', moveNumber: 1 })
    expect(socket.sent).toHaveLength(1)
    socket.close()

    await expect(withTimeout(pending)).rejects.toThrow('websocket closed')
  })
})

function withTimeout<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timed out waiting for promise')), 25)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (reason) => {
        window.clearTimeout(timer)
        reject(reason)
      },
    )
  })
}
