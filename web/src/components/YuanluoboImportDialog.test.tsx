import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YuanluoboImportDialog, type YuanluoboImportAPI } from './YuanluoboImportDialog'

const scanUrl = 'https://jupiter.yuanluobo.com/robot-public/all-in-app/scanned-page?key=key-1&from=qrcode-login'

function api(overrides: Partial<YuanluoboImportAPI> = {}): YuanluoboImportAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: false })),
    loginStart: vi.fn(() => Promise.resolve({ key: 'key-1', image: 'jpeg-base64', scanUrl })),
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

    const panel = await screen.findByRole('region', { name: '元萝卜登录' })
    expect(panel).toHaveClass('yuanluobo-login-layout', 'yuanluobo-fullscreen-page')
    expect(screen.getByRole('heading', { name: '元萝卜账号' })).toBeInTheDocument()
    expect(screen.getByText('扫码后读取账号棋局，选择后导入到本地棋盘。')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: '元萝卜登录二维码' })).toHaveAttribute('data-qr-value', scanUrl)
    expect(screen.queryByAltText('元萝卜登录二维码')).not.toBeInTheDocument()
    expect(screen.getByLabelText('扫码状态')).toHaveTextContent('未扫码')
  })

  it('loads categories, records, and marks imported games', async () => {
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: true })),
      players: vi.fn(() => Promise.resolve([{ playerId: 'player-1', name: '棋手一' }])),
      records: vi.fn(() => Promise.resolve({
        total: 3,
        page: 1,
        size: 10,
        pageTotal: 1,
        categories: [{ title: '元萝卜AI', gameMode: 1 }, { title: '星阵AI', gameMode: 15 }],
        records: [
          {
            sessionId: 'session-1',
            gameMode: 15,
            category: '星阵AI',
            startDate: '2026-07-08',
            startTime: 1783500000,
            blackPlayerName: '棋手一',
            whitePlayerName: 'Opponent',
            title: '星阵AI',
            result: 'B+20.25',
            resultLabel: '黑胜 20.25子',
            resultWinner: 'B',
            totalRound: 128,
            imported: true,
            gameId: 'game-1',
          },
          {
            sessionId: 'session-2',
            gameMode: 15,
            category: '星阵AI',
            startDate: '2026-07-07',
            startTime: 1783400000,
            blackPlayerName: 'Opponent',
            whitePlayerName: '棋手一',
            title: '星阵AI',
            result: 'B+3.50',
            resultLabel: '黑胜 3.5子',
            resultWinner: 'B',
            totalRound: 88,
            imported: false,
          },
          {
            sessionId: 'session-3',
            gameMode: 15,
            category: '星阵AI',
            startDate: '2026-07-06',
            startTime: 1783300000,
            blackPlayerName: '棋手一',
            whitePlayerName: 'Draw Opponent',
            title: '星阵AI',
            result: 'Draw',
            resultLabel: '和棋',
            resultWinner: 'draw',
            totalRound: 240,
            imported: false,
          },
        ],
      })),
    })

    render(<YuanluoboImportDialog api={testAPI} onOpenGame={vi.fn()} onBack={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '元萝卜棋局浏览' })).toHaveClass('yuanluobo-fullscreen-page')
    expect(await screen.findByText('棋手一')).toBeInTheDocument()
    const platformSelect = screen.getByLabelText('平台')
    expect(platformSelect).toHaveDisplayValue('元萝卜AI')
    expect(screen.getByRole('option', { name: '星阵AI' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '全部' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '元萝卜分类' })).not.toBeInTheDocument()
    await waitFor(() => expect(testAPI.records).toHaveBeenCalledWith({ playerId: 'player-1', gameMode: 1, page: 1 }))
    expect(screen.getByText('共 3 局')).toBeInTheDocument()
    expect(screen.getByText('2026-07-08 · 128手 · 黑胜 20.25子')).toBeInTheDocument()
    expect(screen.queryByText('2026-07-08 · 星阵AI · B+20.25')).not.toBeInTheDocument()

    const winRow = screen.getByRole('button', { name: /棋手一 vs Opponent/ })
    expect(winRow).toHaveClass('yuanluobo-record-row')
    expect(within(winRow).getByText('已导入')).toBeInTheDocument()
    expect(within(winRow).getByText('胜')).toHaveClass('yuanluobo-result-watermark', 'win')

    const lossRow = screen.getByRole('button', { name: /Opponent vs 棋手一/ })
    expect(within(lossRow).getByText('负')).toHaveClass('yuanluobo-result-watermark', 'loss')

    const drawRow = screen.getByRole('button', { name: /棋手一 vs Draw Opponent/ })
    expect(within(drawRow).getByText('和')).toHaveClass('yuanluobo-result-watermark', 'draw')
    expect(screen.queryByText('平')).not.toBeInTheDocument()

    await userEvent.selectOptions(platformSelect, '15')
    await waitFor(() => expect(testAPI.records).toHaveBeenCalledWith({ playerId: 'player-1', gameMode: 15, page: 1 }))
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
        categories: [{ title: '元萝卜AI', gameMode: 1 }],
        records: [
          {
            sessionId: 'session-imported',
            gameMode: 1,
            category: '元萝卜AI',
            startDate: '2026-07-08',
            startTime: 1783500000,
            blackPlayerName: 'Imported',
            whitePlayerName: 'Opponent',
            title: '元萝卜AI',
            result: 'B+R',
            resultLabel: '黑中盘胜',
            resultWinner: 'B',
            totalRound: 90,
            imported: true,
            gameId: 'game-imported',
          },
          {
            sessionId: 'session-new',
            gameMode: 1,
            category: '元萝卜AI',
            startDate: '2026-07-07',
            startTime: 1783400000,
            blackPlayerName: 'New',
            whitePlayerName: 'Opponent',
            title: '元萝卜AI',
            result: 'W+2.50',
            resultLabel: '白胜 2.5子',
            resultWinner: 'W',
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
