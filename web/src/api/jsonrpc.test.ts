import { describe, expect, it } from 'vitest'
import { buildProtocols, makeRequest } from './jsonrpc'

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
})
