import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YuanluoboImportDialog, type YuanluoboImportAPI } from './YuanluoboImportDialog'

function api(overrides: Partial<YuanluoboImportAPI> = {}): YuanluoboImportAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: false })),
    loginStart: vi.fn(() => Promise.resolve({ key: 'key-1', image: 'jpeg-base64' })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 0, desc: '未扫码' })),
    logout: vi.fn(() => Promise.resolve()),
    players: vi.fn(() => Promise.resolve([])),
    records: vi.fn(() => Promise.resolve({ total: 0, page: 1, size: 10, pageTotal: 0, categories: [], records: [] })),
    importRecord: vi.fn(),
    ...overrides,
  }
}

describe('YuanluoboImportDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows scan login when yuanluobo is not logged in', async () => {
    render(<YuanluoboImportDialog api={api()} onOpenGame={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByText('元萝卜扫码登录')).toBeInTheDocument()
    expect(await screen.findByAltText('元萝卜登录二维码')).toHaveAttribute('src', 'data:image/jpeg;base64,jpeg-base64')
    expect(screen.getByText('请使用元萝卜 App 扫码确认')).toBeInTheDocument()
  })

  it('loads categories, records, and marks imported games', async () => {
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: true })),
      players: vi.fn(() => Promise.resolve([{ playerId: 'player-1', name: '棋手一' }])),
      records: vi.fn(() => Promise.resolve({
        total: 2,
        page: 1,
        size: 10,
        pageTotal: 1,
        categories: [{ title: '全部', gameMode: 0 }, { title: '星阵AI', gameMode: 15 }],
        records: [
          {
            sessionId: 'session-1',
            gameMode: 15,
            category: '星阵AI',
            startDate: '2026-07-08',
            startTime: 1783500000,
            blackPlayerName: 'Black',
            whitePlayerName: 'White',
            title: '星阵AI',
            result: 'B+3.50',
            totalRound: 120,
            imported: true,
            gameId: 'game-1',
          },
        ],
      })),
    })

    render(<YuanluoboImportDialog api={testAPI} onOpenGame={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByText('棋手一')).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: '星阵AI' })).toBeInTheDocument()
    expect(screen.getByText('Black vs White')).toBeInTheDocument()
    expect(screen.getByText('已导入')).toBeInTheDocument()
  })

  it('opens imported games and imports new games', async () => {
    const onOpenGame = vi.fn()
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: true })),
      players: vi.fn(() => Promise.resolve([{ playerId: 'player-1', name: '棋手一' }])),
      records: vi.fn(() => Promise.resolve({
        total: 2,
        page: 1,
        size: 10,
        pageTotal: 1,
        categories: [{ title: '全部', gameMode: 0 }],
        records: [
          {
            sessionId: 'session-imported',
            gameMode: 0,
            category: '全部',
            startDate: '2026-07-08',
            startTime: 1783500000,
            blackPlayerName: 'Imported',
            whitePlayerName: 'Opponent',
            title: '全部',
            result: 'B+R',
            totalRound: 90,
            imported: true,
            gameId: 'game-imported',
          },
          {
            sessionId: 'session-new',
            gameMode: 0,
            category: '全部',
            startDate: '2026-07-07',
            startTime: 1783400000,
            blackPlayerName: 'New',
            whitePlayerName: 'Opponent',
            title: '全部',
            result: 'W+2.50',
            totalRound: 100,
            imported: false,
          },
        ],
      })),
      importRecord: vi.fn(() => Promise.resolve({
        game: {
          gameId: 'game-new',
          displayName: 'New vs Opponent',
          result: 'W+2.50',
          sgfFilename: 'game-new.sgf',
          createdAt: '2026-07-08T00:00:00Z',
        },
        snapshot: {} as never,
      })),
    })

    render(<YuanluoboImportDialog api={testAPI} onOpenGame={onOpenGame} onBack={vi.fn()} />)

    await screen.findByText('Imported vs Opponent')
    await userEvent.click(screen.getByText('Imported vs Opponent'))
    expect(onOpenGame).toHaveBeenCalledWith('game-imported')

    await userEvent.click(screen.getByText('New vs Opponent'))
    await waitFor(() => expect(testAPI.importRecord).toHaveBeenCalledWith('session-new'))
    expect(onOpenGame).toHaveBeenCalledWith('game-new')
  })
})
