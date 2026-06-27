import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StatePayload } from './api/types'
import App from './App'

const rpc = vi.hoisted(() => ({
  calls: [] as { method: string; params?: unknown }[],
  state: undefined as StatePayload | undefined,
  responses: [] as StatePayload[],
  handlers: new Map<string, (params: unknown) => void>(),
}))

vi.mock('./api/jsonrpc', () => ({
  RPCClient: class {
    connect = vi.fn(() => Promise.resolve())
    on(method: string, handler: (params: unknown) => void) {
      rpc.handlers.set(method, handler)
    }
    onClose = vi.fn()
    close = vi.fn()

    call(method: string, params?: unknown) {
      rpc.calls.push({ method, params })
      return Promise.resolve(rpc.responses.shift() ?? rpc.state)
    }
  },
}))

describe('App variation navigation', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
    rpc.calls.length = 0
    rpc.state = undefined
    rpc.responses = []
    rpc.handlers.clear()
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

    await screen.findByLabelText('Move 3, white to play')
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
        toPlay: 'B',
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

    await screen.findByLabelText('Move 2, black to play')
    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.gotoNode',
      params: { gameId: 'game-1', nodeId: 'var:2' },
    })
  })

  it('clamps backward five-move navigation to the first mainline move', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = mainlineState(3, 12)

    render(<App />)

    await screen.findByLabelText('Move 3, white to play')
    await userEvent.click(screen.getByRole('button', { name: 'Back 5 moves' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.goto',
      params: { gameId: 'game-1', moveNumber: 0 },
    })
  })

  it('clamps forward five-move navigation to the last mainline move', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = mainlineState(10, 12)

    render(<App />)

    await screen.findByLabelText('Move 10, black to play')
    await userEvent.click(screen.getByRole('button', { name: 'Forward 5 moves' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.goto',
      params: { gameId: 'game-1', moveNumber: 12 },
    })
  })

  it('clamps backward five-move navigation in a trial branch to the fork point', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = variationState()

    render(<App />)

    await screen.findByLabelText('Move 3, white to play')
    await userEvent.click(screen.getByRole('button', { name: 'Back 5 moves' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.goto',
      params: { gameId: 'game-1', moveNumber: 1 },
    })
  })

  it('clamps forward five-move navigation in a trial branch to the last visible variation node', async () => {
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
        toPlay: 'B',
        children: [],
      },
      variation: {
        ...variationState().variation!,
        currentNodeId: 'var:1',
        timeline: {
          ...variationState().variation!.timeline,
          nodeIds: ['var:1', 'var:2', 'var:3'],
          moves: ['Q4', 'D4', 'R4'],
          moveColors: ['W', 'B', 'W'],
          passes: [false, false, false],
          toPlays: ['B', 'W', 'B'],
          rootWinrates: [null, null, null],
          rootScoreLeads: [null, null, null],
          rootVisits: [null, null, null],
          playedPointLosses: [null, null, null],
        },
      },
      current: {
        nodeId: 'var:1',
        candidates: { moves: [], orders: [], visits: [], winrates: [], scoreLeads: [], pvs: [] },
      },
    }

    render(<App />)

    await screen.findByLabelText('Move 2, black to play')
    await userEvent.click(screen.getByRole('button', { name: 'Forward 5 moves' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.gotoNode',
      params: { gameId: 'game-1', nodeId: 'var:3' },
    })
  })

  it('restores the browser-selected game when a reconnected backend has no selected workspace game', async () => {
    const storage = new Map<string, string>([
      ['jcgo.accessToken', 'secret'],
      ['jcgo.selectedGameId', 'game-1'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.responses = [emptyWorkspaceState(), mainlineState(4, 12)]

    render(<App />)

    await screen.findByLabelText('Move 4, black to play')
    expect(rpc.calls[0]).toEqual({ method: 'workspace.state', params: undefined })
    expect(rpc.calls[1]).toEqual({ method: 'game.select', params: { gameId: 'game-1' } })
  })

  it('restores the browser current mainline move after reconnect instead of using another client cursor', async () => {
    const storage = new Map<string, string>([
      ['jcgo.accessToken', 'secret'],
      ['jcgo.view.gameId', 'game-1'],
      ['jcgo.view.nodeId', 'main:4'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.responses = [mainlineState(1, 12), mainlineState(4, 12)]

    render(<App />)

    await screen.findByLabelText('Move 4, black to play')
    expect(rpc.calls[0]).toEqual({ method: 'workspace.state', params: undefined })
    expect(rpc.calls[1]).toEqual({ method: 'game.goto', params: { gameId: 'game-1', moveNumber: 4 } })
  })

  it('ignores analysis updates for a different current node so another frontend cannot move this view', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = mainlineState(5, 12)

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    rpc.handlers.get('analysis.update')?.(mainlineState(2, 12))

    expect(screen.getByLabelText('Move 5, white to play')).toBeInTheDocument()
  })
})

function emptyWorkspaceState(): StatePayload {
  return {
    type: 'state',
    schema: 1,
    games: [{ gameId: 'game-1', displayName: 'Demo', result: '', sgfFilename: 'game-1.sgf', createdAt: '2026-06-26T00:00:00Z' }],
    analysisState: 'idle',
  }
}

function mainlineState(moveNumber: number, totalMoves: number): StatePayload {
  return {
    type: 'state',
    schema: 1,
    games: [{ gameId: 'game-1', displayName: 'Demo', result: '', sgfFilename: 'game-1.sgf', createdAt: '2026-06-26T00:00:00Z' }],
    gameId: 'game-1',
    currentNodeId: `main:${moveNumber}`,
    analysisState: 'idle',
    snapshot: {
      gameId: 'game-1',
      nodeId: `main:${moveNumber}`,
      moveNumber,
      totalMoves,
      branchMode: 'main',
      stones: [],
      lastMove: moveNumber > 0 ? { nodeId: `main:${moveNumber}`, moveNumber, color: moveNumber % 2 === 1 ? 'B' : 'W', gtp: 'Q16', pass: false } : undefined,
      children: [],
      toPlay: moveNumber % 2 === 0 ? 'B' : 'W',
      rules: 'chinese',
      komi: 7.5,
      captures: { B: 0, W: 0 },
      gameEnded: false,
      canPrevious: moveNumber > 0,
      canNext: moveNumber < totalMoves,
      canBackToMain: false,
    },
    timeline: {
      nodeIds: Array.from({ length: totalMoves + 1 }, (_, index) => `main:${index}`),
      moves: Array.from({ length: totalMoves + 1 }, (_, index) => (index === 0 ? null : 'Q16')),
      moveColors: Array.from({ length: totalMoves + 1 }, (_, index) => (index === 0 ? null : index % 2 === 1 ? 'B' : 'W')),
      passes: Array.from({ length: totalMoves + 1 }, () => false),
      toPlays: Array.from({ length: totalMoves + 1 }, (_, index) => (index % 2 === 0 ? 'B' : 'W')),
      rootWinrates: Array.from({ length: totalMoves + 1 }, () => null),
      rootScoreLeads: Array.from({ length: totalMoves + 1 }, () => null),
      rootVisits: Array.from({ length: totalMoves + 1 }, () => null),
      playedPointLosses: Array.from({ length: totalMoves + 1 }, () => null),
    },
    badMoves: { nodeIds: [], moveNumbers: [], colors: [], moves: [], pointLosses: [] },
    current: {
      nodeId: `main:${moveNumber}`,
      candidates: { moves: [], orders: [], visits: [], winrates: [], scoreLeads: [], pvs: [] },
    },
  }
}

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
      lastMove: { nodeId: 'var:2', moveNumber: 3, color: 'B', gtp: 'D4', pass: false },
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
