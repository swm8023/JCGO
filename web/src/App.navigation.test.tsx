import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StatePayload } from './api/types'
import App from './App'

const rpc = vi.hoisted(() => ({
  calls: [] as { method: string; params?: unknown }[],
  state: undefined as StatePayload | undefined,
}))

vi.mock('./api/jsonrpc', () => ({
  RPCClient: class {
    connect = vi.fn(() => Promise.resolve())
    on = vi.fn()

    call(method: string, params?: unknown) {
      rpc.calls.push({ method, params })
      return Promise.resolve(rpc.state)
    }
  },
}))

describe('App variation navigation', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    rpc.calls.length = 0
    rpc.state = undefined
  })

  it('uses variation node ids for previous navigation inside a trial branch', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = variationState()

    render(<App />)

    await screen.findByText('3 / 3')
    await userEvent.click(screen.getByRole('button', { name: 'Previous move' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.gotoNode',
      params: { gameId: 'game-1', nodeId: 'var:1' },
    })
  })

  it('uses variation child node ids for next navigation inside a trial branch', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = {
      ...variationState(),
      currentNodeId: 'var:1',
      snapshot: {
        ...variationState().snapshot,
        nodeId: 'var:1',
        moveNumber: 2,
        lastMove: { nodeId: 'var:1', moveNumber: 2, color: 'W', gtp: 'Q4', pass: false },
        children: [{ nodeId: 'var:2', moveNumber: 3, color: 'B', gtp: 'D4', pass: false }],
      },
      variation: {
        ...variationState().variation!,
        currentNodeId: 'var:1',
        timeline: {
          ...variationState().variation!.timeline,
          nodeIds: ['var:1'],
          moves: ['Q4'],
          moveColors: ['W'],
          passes: [false],
          toPlays: ['B'],
          rootWinrates: [null],
          rootScoreLeads: [null],
          rootVisits: [null],
          playedPointLosses: [null],
        },
      },
      current: {
        nodeId: 'var:1',
        candidates: { moves: [], orders: [], visits: [], winrates: [], scoreLeads: [], pvs: [] },
      },
    }

    render(<App />)

    await screen.findByText('2 / 3')
    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.gotoNode',
      params: { gameId: 'game-1', nodeId: 'var:2' },
    })
  })
})

function variationState(): StatePayload {
  return {
    type: 'state',
    schema: 1,
    games: [{ gameId: 'game-1', displayName: 'Demo', result: '', sgfFilename: 'game-1.sgf', createdAt: '2026-06-26T00:00:00Z' }],
    gameId: 'game-1',
    currentNodeId: 'var:2',
    analysisState: 'idle',
    snapshot: {
      gameId: 'game-1',
      nodeId: 'var:2',
      moveNumber: 3,
      totalMoves: 3,
      branchMode: 'variation',
      stones: [],
      children: [],
      toPlay: 'W',
      rules: 'chinese',
      komi: 7.5,
      captures: { B: 0, W: 0 },
      gameEnded: false,
      canPrevious: true,
      canNext: false,
      canBackToMain: true,
    },
    timeline: {
      nodeIds: ['main:0', 'main:1', 'main:2', 'main:3'],
      moves: [null, 'Q16', 'D16', 'R4'],
      moveColors: [null, 'B', 'W', 'B'],
      passes: [false, false, false, false],
      toPlays: ['B', 'W', 'B', 'W'],
      rootWinrates: [null, null, null, null],
      rootScoreLeads: [null, null, null, null],
      rootVisits: [null, null, null, null],
      playedPointLosses: [null, null, null, null],
    },
    badMoves: { nodeIds: [], moveNumbers: [], colors: [], moves: [], pointLosses: [] },
    variation: {
      baseNodeId: 'main:1',
      baseMoveNumber: 1,
      currentNodeId: 'var:2',
      timeline: {
        nodeIds: ['var:1', 'var:2'],
        moves: ['Q4', 'D4'],
        moveColors: ['W', 'B'],
        passes: [false, false],
        toPlays: ['B', 'W'],
        rootWinrates: [null, null],
        rootScoreLeads: [null, null],
        rootVisits: [null, null],
        playedPointLosses: [null, null],
      },
    },
    current: {
      nodeId: 'var:2',
      candidates: { moves: [], orders: [], visits: [], winrates: [], scoreLeads: [], pvs: [] },
    },
  }
}
