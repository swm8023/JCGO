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
      players: vi.fn(() => Promise.resolve([
        { playerId: 'player-1', name: '棋手一' },
        { playerId: 'player-2', name: '棋手二' },
      ])),
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
            result: 'B+40.50',
            resultLabel: '黑胜 40.5目',
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
            result: 'B+7.00',
            resultLabel: '黑胜 7目',
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
    expect(screen.getByText('棋局记录')).toBeInTheDocument()
    expect(screen.queryByText('按时间倒序')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '列表视图' })).not.toBeInTheDocument()
    const playerTrigger = screen.getByRole('button', { name: /棋手 棋手一/ })
    expect(playerTrigger).toHaveClass('yuanluobo-filter-trigger')
    const platformTrigger = screen.getByRole('button', { name: /平台 元萝卜AI/ })
    expect(platformTrigger).toHaveClass('yuanluobo-filter-trigger')
    expect(screen.queryByLabelText('平台')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '元萝卜分类' })).not.toBeInTheDocument()
    await waitFor(() => expect(testAPI.records).toHaveBeenCalledWith({ playerId: 'player-1', gameMode: 1, page: 1 }))
    expect(screen.getByText('共 3 局')).toBeInTheDocument()
    expect(screen.getByText((content, element) => element?.classList.contains('yuanluobo-record-meta') && content.includes('128手'))).toBeInTheDocument()
    expect(screen.queryByText((content, element) => element?.classList.contains('yuanluobo-record-meta') && content.includes('星阵AI'))).not.toBeInTheDocument()

    const winRow = screen.getByRole('button', { name: /棋手一.*vs.*Opponent.*128手/ })
    expect(winRow).toHaveClass('yuanluobo-record-row')
    expect(winRow).toHaveAttribute('data-outcome', 'win')
    expect(winRow.querySelectorAll('.yuanluobo-player-name')).toHaveLength(2)
    expect(within(winRow).getByText('已导入')).toBeInTheDocument()
    expect(within(winRow).getByText('胜')).toHaveClass('yuanluobo-result-watermark', 'win')

    const lossRow = screen.getByRole('button', { name: /Opponent.*vs.*棋手一.*88手/ })
    expect(within(lossRow).getByText('负')).toHaveClass('yuanluobo-result-watermark', 'loss')

    const drawRow = screen.getByRole('button', { name: /棋手一.*vs.*Draw Opponent.*240手/ })
    expect(within(drawRow).getByText('和')).toHaveClass('yuanluobo-result-watermark', 'draw')
    expect(screen.queryByText('平')).not.toBeInTheDocument()

    await userEvent.click(playerTrigger)
    const playerDialog = await screen.findByRole('dialog', { name: '选择棋手' })
    expect(playerDialog).toHaveClass('yuanluobo-picker-sheet')
    expect(within(playerDialog).queryByPlaceholderText('搜索棋手')).not.toBeInTheDocument()
    expect(within(playerDialog).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(playerDialog.querySelector('.yuanluobo-picker-check')).not.toBeInTheDocument()
    expect(within(playerDialog).getByRole('button', { name: /棋手一/ })).toHaveAttribute('data-selected', 'true')
    expect(within(playerDialog).getByRole('button', { name: /棋手二/ })).toBeInTheDocument()

    await userEvent.click(within(playerDialog).getByRole('button', { name: /棋手二/ }))
    await waitFor(() => expect(testAPI.records).toHaveBeenCalledWith({ playerId: 'player-2', gameMode: 1, page: 1 }))
    expect(screen.queryByRole('dialog', { name: '选择棋手' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /棋手 棋手二/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /平台 元萝卜AI/ }))
    const platformDialog = await screen.findByRole('dialog', { name: '选择平台' })
    expect(platformDialog).toHaveClass('yuanluobo-picker-sheet')
    expect(within(platformDialog).queryByPlaceholderText('搜索平台')).not.toBeInTheDocument()
    expect(within(platformDialog).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(platformDialog.querySelector('.yuanluobo-picker-check')).not.toBeInTheDocument()
    expect(within(platformDialog).getByRole('button', { name: /元萝卜AI/ })).toHaveAttribute('data-selected', 'true')
    expect(within(platformDialog).getByRole('button', { name: /星阵AI/ })).toBeInTheDocument()
    expect(within(platformDialog).queryByText('全部')).not.toBeInTheDocument()

    await userEvent.click(within(platformDialog).getByRole('button', { name: /星阵AI/ }))
    await waitFor(() => expect(testAPI.records).toHaveBeenCalledWith({ playerId: 'player-2', gameMode: 15, page: 1 }))
    expect(screen.queryByRole('dialog', { name: '选择平台' })).not.toBeInTheDocument()
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
            resultLabel: '白胜 2.5目',
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

    await screen.findByRole('button', { name: /Imported.*vs.*Opponent/ })
    await userEvent.click(screen.getByRole('button', { name: /Imported.*vs.*Opponent/ }))
    expect(onOpenGame).toHaveBeenCalledWith('game-imported')

    await userEvent.click(screen.getByRole('button', { name: /New.*vs.*Opponent/ }))
    await waitFor(() => expect(testAPI.importRecord).toHaveBeenCalledWith('session-new'))
    expect(onOpenGame).toHaveBeenCalledWith('game-new')
  })
})
