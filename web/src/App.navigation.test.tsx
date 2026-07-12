import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatePayload } from './api/types'
import App from './App'

const rpc = vi.hoisted(() => ({
  calls: [] as { method: string; params?: unknown }[],
  state: undefined as StatePayload | undefined,
  responses: [] as unknown[],
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
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rpc.calls.length = 0
    rpc.state = undefined
    rpc.responses = []
    rpc.handlers.clear()
    window.history.replaceState(null, '', '/')
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

  it('starts in direct try mode and changes to exit after playing a recommendation', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [mainlineStateWithCandidate(5, 12), variationState()]

    render(<App />)

    await screen.findByRole('button', { name: 'Switch to AI preview mode' })
    await userEvent.click(screen.getByLabelText('Try recommended move D16'))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.play',
      params: { gameId: 'game-1', move: 'D16' },
    })
    expect(await screen.findByRole('button', { name: 'Exit try mode' })).toHaveTextContent('退')
  })

  it('keeps preview mode across navigation and clears only the current preview', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [mainlineStateWithCandidate(5, 12), mainlineStateWithCandidate(6, 12)]

    const { container } = render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Switch to AI preview mode' }))
    expect(screen.getByRole('button', { name: 'Enable direct try mode' })).toHaveClass('try-action-preview')
    expect(screen.queryByLabelText('Try move D4')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Recommended next move D16'))
    expect(container.querySelectorAll('.pv-stone')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))
    await screen.findByLabelText('Move 6, black to play')

    expect(screen.getByRole('button', { name: 'Enable direct try mode' })).toHaveClass('try-action-preview')
    expect(container.querySelectorAll('.pv-stone')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Enable direct try mode' }))
    expect(screen.getByRole('button', { name: 'Switch to AI preview mode' })).toHaveClass('try-action-ready')
  })

  it('lets a server trial branch override the local preview-only mode', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [mainlineStateWithCandidate(5, 12), variationState()]

    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Switch to AI preview mode' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))

    expect(await screen.findByRole('button', { name: 'Exit try mode' })).toHaveTextContent('退')
    expect(screen.getByLabelText('Try move D4')).toBeInTheDocument()
  })

  it('returns to the green direct try default after exiting a trial branch', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [variationState(), mainlineStateWithCandidate(1, 12)]

    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Exit try mode' }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.clearVariation',
      params: { gameId: 'game-1' },
    })
    expect(await screen.findByRole('button', { name: 'Switch to AI preview mode' })).toHaveClass('try-action-ready')
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

  it('returns from the local game page with Escape', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = gameLibraryState('game-1')

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByLabelText('Show game list'))
    expect(screen.getByRole('region', { name: '本地棋局内容' })).toBeInTheDocument()
    expect(screen.getByRole('banner', { name: '本地棋局' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Import SGF')).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('region', { name: '本地棋局内容' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Import SGF')).toBeInTheDocument()
  })

  it('closes the local game list after selecting a game', async () => {
    const storage = new Map<string, string>([['jcgo.accessToken', 'secret']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    rpc.state = gameLibraryState('game-1')

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByLabelText('Show game list'))
    const list = screen.getByRole('region', { name: '本地棋局内容' })

    rpc.responses = [gameLibraryState('game-2')]
    await userEvent.click(within(list).getByRole('button', { name: /^Second study/ }))

    expect(rpc.calls.at(-1)).toEqual({
      method: 'game.select',
      params: { gameId: 'game-2' },
    })
    expect(screen.queryByRole('region', { name: '本地棋局内容' })).not.toBeInTheDocument()
  })

  it('closes the local game list when the browser history returns to the board', async () => {
    stubAuthenticatedStorage()
    rpc.state = gameLibraryState('game-1')

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    const homeState = window.history.state
    await userEvent.click(screen.getByLabelText('Show game list'))
    expect(screen.getByRole('region', { name: '本地棋局内容' })).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: homeState }))

    await waitFor(() => expect(screen.queryByRole('region', { name: '本地棋局内容' })).not.toBeInTheDocument())
  })

  it('shows a yuanluobo import in the local game list without reconnecting', async () => {
    stubAuthenticatedStorage()
    const importedState = yuanluoboImportedGameState()
    const records = {
      total: 1,
      page: 1,
      size: 10,
      pageTotal: 1,
      categories: [{ title: '元萝卜AI', gameMode: 1 }],
      records: [{
        sessionId: 'session-new',
        gameMode: 1,
        category: '元萝卜AI',
        startDate: '2026-07-08',
        startTime: 1783500000,
        blackPlayerName: 'New player',
        whitePlayerName: 'Opponent',
        title: '元萝卜AI',
        result: 'B+R',
        resultLabel: '黑中盘胜',
        resultWinner: 'B' as const,
        totalRound: 90,
        imported: false,
      }],
    }
    rpc.responses = [
      mainlineState(5, 12),
      { loggedIn: true },
      [{ playerId: 'player-1', name: '棋手一' }],
      records,
      {
        game: importedState.games[1],
        snapshot: importedState.snapshot,
      },
      importedState,
      records,
    ]

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    const homeState = window.history.state
    await userEvent.click(screen.getByLabelText('Import SGF'))
    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))
    await userEvent.click(await screen.findByRole('button', { name: /New player.*vs.*Opponent/ }))

    await waitFor(() => {
      expect(rpc.calls.filter(({ method }) => method === 'workspace.state')).toHaveLength(2)
    })

    window.dispatchEvent(new PopStateEvent('popstate', { state: homeState }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '元萝卜棋局内容' })).not.toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Show game list'))
    expect(screen.getByRole('button', { name: /^Imported immediately/ })).toBeInTheDocument()
  })

  it('asks the server for a worker recommendation when opening analysis', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [
      {
        ...mainlineState(5, 12),
        workerStatus: {
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{ id: 'worker-1', name: 'gpu-worker', platform: 'windows/amd64', available: true, busy: false }],
        },
      },
      { workerName: 'gpu-worker' },
    ]

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByRole('button', { name: '打开分析菜单' }))
    await waitFor(() => {
      expect(rpc.calls).toContainEqual({ method: 'analysis.recommendWorker', params: undefined })
    })
  })

  it('walks browser history from nested import screens back to the board', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [
      mainlineState(5, 12),
      { loggedIn: false },
      {
        key: 'key-1',
        image: 'jpeg-base64',
        scanUrl: 'https://jupiter.yuanluobo.com/robot-public/all-in-app/scanned-page?key=key-1&from=qrcode-login',
      },
      { status: 0, desc: '未扫码' },
    ]

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    const homeState = window.history.state

    await userEvent.click(screen.getByLabelText('Import SGF'))
    const chooseState = window.history.state
    expect(screen.getByRole('region', { name: '导入棋局内容' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /复盘链接/ }))
    expect(screen.getByRole('region', { name: '从链接导入内容' })).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: chooseState }))
    await waitFor(() => expect(screen.getByRole('region', { name: '导入棋局内容' })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: '从链接导入内容' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))
    expect(await screen.findByRole('region', { name: '元萝卜登录内容' })).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: chooseState }))
    await waitFor(() => expect(screen.getByRole('region', { name: '导入棋局内容' })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: '元萝卜登录内容' })).not.toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: homeState }))
    await waitFor(() => expect(screen.queryByRole('region', { name: '导入棋局内容' })).not.toBeInTheDocument())
  })

  it('closes a yuanluobo picker on browser back before leaving the yuanluobo screen', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [
      mainlineState(5, 12),
      { loggedIn: true },
      [{ playerId: 'player-1', name: '棋手一' }],
      {
        total: 0,
        page: 1,
        size: 10,
        pageTotal: 0,
        categories: [{ title: '元萝卜AI', gameMode: 1 }],
        records: [],
      },
    ]

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByLabelText('Import SGF'))
    const chooseState = window.history.state
    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))
    const yuanluoboState = window.history.state
    expect(await screen.findByRole('region', { name: '元萝卜棋局内容' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /棋手 棋手一/ }))
    expect(await screen.findByRole('dialog', { name: '选择棋手' })).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: yuanluoboState }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择棋手' })).not.toBeInTheDocument())
    expect(screen.getByRole('region', { name: '元萝卜棋局内容' })).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: chooseState }))
    await waitFor(() => expect(screen.getByRole('region', { name: '导入棋局内容' })).toBeInTheDocument())
  })

  it('opens settings from the titlebar and closes it on browser back', async () => {
    stubAuthenticatedStorage()
    rpc.state = {
      ...mainlineState(5, 12),
      workerStatus: {
        connected: 1,
        available: 1,
        busy: 0,
        workers: [{
          id: 'worker-1',
          name: 'gpu-worker',
          platform: 'windows/amd64',
          available: true,
          busy: false,
        }],
      },
    }

    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    const homeState = window.history.state

    await userEvent.click(screen.getByLabelText('Open settings'))

    expect(screen.getByRole('region', { name: '设置内容' })).toBeInTheDocument()
    expect(screen.getByText('gpu-worker')).toBeInTheDocument()

    window.dispatchEvent(new PopStateEvent('popstate', { state: homeState }))

    await waitFor(() => expect(screen.queryByRole('region', { name: '设置内容' })).not.toBeInTheDocument())
  })

  it('shows a contextual titlebar and hides home actions while a page is open', async () => {
    stubAuthenticatedStorage()
    rpc.state = mainlineState(5, 12)
    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByLabelText('Open settings'))

    expect(screen.getByRole('banner', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '设置内容' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Show game list')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Import SGF')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open settings')).not.toBeInTheDocument()
  })

  it('uses the same one-layer return for titlebar back and Escape', async () => {
    stubAuthenticatedStorage()
    rpc.responses = [
      mainlineState(5, 12),
      { loggedIn: false },
      { key: 'key-1', image: 'jpeg-base64', scanUrl: 'https://example.test/qr' },
      { status: 0, desc: '未扫码' },
    ]
    render(<App />)

    await screen.findByLabelText('Move 5, white to play')
    await userEvent.click(screen.getByLabelText('Import SGF'))
    await userEvent.click(screen.getByRole('button', { name: /复盘链接/ }))
    expect(screen.getByRole('banner', { name: '从链接导入' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '返回从链接导入' }))
    expect(screen.getByRole('banner', { name: '导入棋局' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))
    expect(await screen.findByRole('banner', { name: '元萝卜' })).toBeInTheDocument()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => expect(screen.getByRole('banner', { name: '导入棋局' })).toBeInTheDocument())
  })
})

function stubAuthenticatedStorage(entries: [string, string][] = []) {
  const storage = new Map<string, string>([['jcgo.accessToken', 'secret'], ...entries])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  })
}

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

function mainlineStateWithCandidate(moveNumber: number, totalMoves: number): StatePayload {
  const state = mainlineState(moveNumber, totalMoves)
  const rootWinrates = [...state.timeline!.rootWinrates]
  const rootScoreLeads = [...state.timeline!.rootScoreLeads]
  const rootVisits = [...state.timeline!.rootVisits]
  rootWinrates[moveNumber] = 0.5
  rootScoreLeads[moveNumber] = 0
  rootVisits[moveNumber] = 500

  return {
    ...state,
    timeline: {
      ...state.timeline!,
      rootWinrates,
      rootScoreLeads,
      rootVisits,
    },
    current: {
      nodeId: `main:${moveNumber}`,
      candidates: {
        moves: ['D16'],
        orders: [0],
        visits: [500],
        winrates: [0.5],
        scoreLeads: [0],
        pvs: [['D16', 'Q4']],
      },
    },
  }
}

function gameLibraryState(gameId: string): StatePayload {
  const state = mainlineState(5, 12)
  return {
    ...state,
    gameId,
    games: [
      {
        gameId: 'game-1',
        displayName: 'First study',
        result: 'B+R',
        sgfFilename: 'first.sgf',
        createdAt: '2026-06-26T00:00:00Z',
        gameDate: '2026-06-25',
        analysisStatus: 'complete',
      },
      {
        gameId: 'game-2',
        displayName: 'Second study',
        result: 'W+3.50',
        sgfFilename: 'second.sgf',
        createdAt: '2026-06-27T00:00:00Z',
        gameDate: '2026-06-26',
        analysisStatus: 'idle',
      },
    ],
    snapshot: state.snapshot ? { ...state.snapshot, gameId } : undefined,
  }
}

function yuanluoboImportedGameState(): StatePayload {
  const state = mainlineState(5, 12)
  const gameId = 'game-new'
  return {
    ...state,
    gameId,
    games: [
      ...state.games,
      {
        gameId,
        displayName: 'Imported immediately',
        result: 'B+R',
        sgfFilename: 'game-new.sgf',
        createdAt: '2026-07-08T00:00:00Z',
        gameDate: '2026-07-08',
        analysisStatus: 'idle',
      },
    ],
    snapshot: state.snapshot ? { ...state.snapshot, gameId } : undefined,
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
