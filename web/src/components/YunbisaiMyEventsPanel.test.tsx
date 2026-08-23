import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  YunbisaiEventGroup,
  YunbisaiGroupPairings,
  YunbisaiMyEvent,
  YunbisaiMyEventsAPI,
} from '../api/types'
import { YunbisaiMyEventsPanel } from './YunbisaiMyEventsPanel'

const event: YunbisaiMyEvent = {
  orderId: 'order-1',
  eventId: '67043',
  title: '杭州围棋公开赛',
  status: 'paid',
  createdAt: '2026-07-01 10:00:00',
  amount: '128.00',
  officialUrl: '',
}

const groups: YunbisaiEventGroup[] = [
  {
    groupId: '331092',
    name: '8级组',
    playerCount: 27,
    startTime: '2026-08-01 09:00:00',
    endTime: '2026-08-01 17:00:00',
  },
  {
    groupId: '331093',
    name: '9级组',
    playerCount: 31,
    startTime: '2026-08-02 09:00:00',
    endTime: '2026-08-02 17:00:00',
  },
]

const finalPairings: YunbisaiGroupPairings = {
  groupId: '331092',
  groupName: '8级组',
  round: 7,
  totalRounds: 7,
  matches: [
    {
      seatNumber: '1',
      againstPlanId: 'plan-1',
      player1: { name: '张三', teamName: '杭州队', result: 'win', score: '2', totalScore: '12' },
      player2: { name: '李四', teamName: '宁波队', result: 'loss', score: '0', totalScore: '10' },
    },
  ],
}

function api(overrides: Partial<YunbisaiMyEventsAPI> = {}): YunbisaiMyEventsAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: true, account: { loginId: '7', name: '棋手甲', account: '138****0000' } })),
    loginStart: vi.fn(() => Promise.resolve({ flowId: 'flow-1', imageUrl: 'https://example.test/qr.png' })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 'waiting' })),
    loginSelect: vi.fn(() => Promise.resolve({ loggedIn: true, account: { loginId: '7', name: '棋手甲', account: '138****0000' } })),
    logout: vi.fn(() => Promise.resolve()),
    myEvents: vi.fn(() => Promise.resolve({ loggedIn: true, total: 1, page: 1, events: [event] })),
    myEventDetail: vi.fn(() => Promise.resolve({
      loggedIn: true,
      orderId: 'order-1',
      eventId: '67043',
      title: '杭州围棋公开赛',
      status: 'paid',
      startTime: '2026-08-01 09:00:00',
      endTime: '2026-08-01 17:00:00',
      address: '杭州市上城区',
      organizer: '杭州棋院',
      amount: '128.00',
      createdAt: '2026-07-01 10:00:00',
      officialUrl: 'https://m.yunbisai.com/event/67043',
      players: [{ name: '棋手甲', groupName: '8级组', teamName: '杭州队' }],
    })),
    eventGroups: vi.fn(() => Promise.resolve(groups)),
    groupPairings: vi.fn(() => Promise.resolve(finalPairings)),
    ...overrides,
  }
}

describe('YunbisaiMyEventsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows and refreshes the WeChat QR code while logged out', async () => {
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: false })),
      loginStart: vi.fn()
        .mockResolvedValueOnce({ flowId: 'flow-1', imageUrl: 'https://example.test/qr-1.png' })
        .mockResolvedValueOnce({ flowId: 'flow-2', imageUrl: 'https://example.test/qr-2.png' }),
    })

    render(<YunbisaiMyEventsPanel api={testAPI} />)

    expect(await screen.findByRole('img', { name: '云比赛登录二维码' })).toHaveAttribute('src', 'https://example.test/qr-1.png')
    expect(screen.getByText('请使用微信扫码登录云比赛')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
    expect(await screen.findByRole('img', { name: '云比赛登录二维码' })).toHaveAttribute('src', 'https://example.test/qr-2.png')
    expect(testAPI.loginStart).toHaveBeenCalledTimes(2)
  })

  it('polls every three seconds and loads events after automatic authorization', async () => {
    vi.useFakeTimers()
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: false })),
      loginPoll: vi.fn(() => Promise.resolve({ status: 'authorized' })),
    })

    render(<YunbisaiMyEventsPanel api={testAPI} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testAPI.loginStart).toHaveBeenCalledTimes(1)
    expect(testAPI.loginPoll).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(testAPI.loginPoll).toHaveBeenCalledWith('flow-1')
    expect(testAPI.myEvents).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: /杭州围棋公开赛/ })).toBeInTheDocument()
  })

  it('asks the user to choose when several accounts are returned', async () => {
    vi.useFakeTimers()
    const testAPI = api({
      status: vi.fn(() => Promise.resolve({ loggedIn: false })),
      loginPoll: vi.fn(() => Promise.resolve({
        status: 'accounts',
        accounts: [
          { loginId: '7', name: '棋手甲', account: '138****0000' },
          { loginId: '8', name: '棋手乙', account: '139****0000' },
        ],
      })),
      loginSelect: vi.fn((_flowId, loginId) => Promise.resolve({
        loggedIn: true,
        account: { loginId, name: loginId === '8' ? '棋手乙' : '棋手甲', account: '' },
      })),
    })

    render(<YunbisaiMyEventsPanel api={testAPI} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testAPI.loginStart).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    const accountList = screen.getByRole('list', { name: '云比赛账号' })
    fireEvent.click(within(accountList).getByRole('button', { name: /棋手乙/ }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(testAPI.loginSelect).toHaveBeenCalledWith('flow-1', '8')
    expect(testAPI.myEvents).toHaveBeenCalledWith(1)
  })

  it('loads active events continuously without filters', async () => {
    const pageTwo = { ...event, orderId: 'order-2', title: '杭州棋王赛' }
    const testAPI = api({
      myEvents: vi.fn()
        .mockResolvedValueOnce({ loggedIn: true, total: 2, page: 1, events: [event] })
        .mockResolvedValueOnce({ loggedIn: true, total: 2, page: 2, events: [event, pageTwo] }),
    })

    render(<YunbisaiMyEventsPanel api={testAPI} />)

    expect(await screen.findByRole('button', { name: /杭州围棋公开赛/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('比赛月份')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByRole('button', { name: /杭州棋王赛/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /杭州围棋公开赛/ })).toHaveLength(1)
    expect(testAPI.myEvents).toHaveBeenLastCalledWith(2)
  })

  it('returns to login when the backend reports loggedIn false', async () => {
    const testAPI = api({
      myEvents: vi.fn(() => Promise.resolve({ loggedIn: false, total: 0, page: 1, events: [] })),
    })

    render(<YunbisaiMyEventsPanel api={testAPI} />)

    expect(await screen.findByRole('img', { name: '云比赛登录二维码' })).toBeInTheDocument()
    expect(testAPI.loginStart).toHaveBeenCalledTimes(1)
  })

  it('opens an in-tab detail and returns to the list', async () => {
    const testAPI = api()
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    expect(await screen.findByRole('heading', { name: '杭州围棋公开赛' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '参赛棋手' })).getByText('棋手甲')).toBeInTheDocument()
    expect(screen.getByText('杭州市上城区')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开云比赛原始详情' })).toHaveAttribute(
      'href',
      'https://m.yunbisai.com/event/67043',
    )
    await userEvent.click(screen.getByRole('button', { name: '返回我的比赛' }))
    expect(await screen.findByRole('button', { name: /杭州围棋公开赛/ })).toBeInTheDocument()
  })

  it('loads all groups once, shows their metadata, and highlights the registered group', async () => {
    const testAPI = api()
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    const groupSection = await screen.findByRole('region', { name: '赛事组别' })

    expect(within(groupSection).getByText('8级组')).toBeInTheDocument()
    expect(within(groupSection).getByText('27 人')).toBeInTheDocument()
    expect(within(groupSection).getByText('2026-08-01 09:00:00 — 2026-08-01 17:00:00')).toBeInTheDocument()
    expect(within(groupSection).getByText('我的组别')).toBeInTheDocument()
    expect(testAPI.eventGroups).toHaveBeenCalledTimes(1)
    expect(testAPI.eventGroups).toHaveBeenCalledWith('67043')
  })

  it('loads the selected group final round and renders players, teams, results, and scores', async () => {
    const testAPI = api()
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))

    const pairingSection = await screen.findByRole('region', { name: '8级组对阵表' })
    expect(within(pairingSection).getByText('第 7 / 7 轮')).toBeInTheDocument()
    expect(within(pairingSection).getByText('1 台')).toBeInTheDocument()
    expect(within(pairingSection).getByText('张三')).toBeInTheDocument()
    expect(within(pairingSection).getByText('杭州队')).toBeInTheDocument()
    expect(within(pairingSection).getByText('李四')).toBeInTheDocument()
    expect(within(pairingSection).getByText('宁波队')).toBeInTheDocument()
    expect(within(pairingSection).getByText('胜')).toBeInTheDocument()
    expect(within(pairingSection).getByText('负')).toBeInTheDocument()
    expect(within(pairingSection).getByText('得分 2')).toBeInTheDocument()
    expect(within(pairingSection).getByText('得分 0')).toBeInTheDocument()
    expect(within(pairingSection).getByText('当前总分 12')).toBeInTheDocument()
    expect(within(pairingSection).getByText('当前总分 10')).toBeInTheDocument()
    expect(within(pairingSection).getByText('对手当前总分 10')).toBeInTheDocument()
    expect(within(pairingSection).getByText('对手当前总分 12')).toBeInTheDocument()
    expect(testAPI.groupPairings).toHaveBeenCalledTimes(1)
    expect(testAPI.groupPairings).toHaveBeenCalledWith('331092')
  })

  it('shows explicit empty states for missing totals and a bye without another request', async () => {
    const testAPI = api({
      groupPairings: vi.fn(() => Promise.resolve({
        ...finalPairings,
        matches: [{
          seatNumber: '2',
          player1: { name: '待确认甲', result: 'pending' },
          player2: { name: '', result: 'bye' },
        }],
      })),
    })
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    const pairingSection = await screen.findByRole('region', { name: '8级组对阵表' })
    expect(within(pairingSection).getAllByText('当前总分 待公布')).toHaveLength(2)
    expect(within(pairingSection).getByText('无对手')).toBeInTheDocument()
    expect(testAPI.groupPairings).toHaveBeenCalledTimes(1)
  })

  it('requests the previous round once and reuses a cached round when moving forward', async () => {
    const testAPI = api({
      groupPairings: vi.fn((_groupID: string, bout?: number) => Promise.resolve(
        bout === 6 ? { ...finalPairings, round: 6 } : finalPairings,
      )),
    })
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    await screen.findByText('第 7 / 7 轮')

    await userEvent.click(screen.getByRole('button', { name: '上一轮' }))
    expect(await screen.findByText('第 6 / 7 轮')).toBeInTheDocument()
    expect(testAPI.groupPairings).toHaveBeenNthCalledWith(2, '331092', 6)

    await userEvent.click(screen.getByRole('button', { name: '下一轮' }))
    expect(await screen.findByText('第 7 / 7 轮')).toBeInTheDocument()
    expect(testAPI.groupPairings).toHaveBeenCalledTimes(2)
  })

  it('loads another group only when selected and keeps the group list cached', async () => {
    const testAPI = api({
      groupPairings: vi.fn((groupID: string) => Promise.resolve(
        groupID === '331093'
          ? { ...finalPairings, groupId: '331093', groupName: '9级组' }
          : finalPairings,
      )),
    })
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    await screen.findByText('第 7 / 7 轮')
    await userEvent.click(screen.getByRole('button', { name: '返回赛事详情' }))
    await userEvent.click(screen.getByRole('button', { name: /9级组/ }))

    expect(await screen.findByRole('region', { name: '9级组对阵表' })).toBeInTheDocument()
    expect(testAPI.eventGroups).toHaveBeenCalledTimes(1)
    expect(testAPI.groupPairings).toHaveBeenNthCalledWith(1, '331092')
    expect(testAPI.groupPairings).toHaveBeenNthCalledWith(2, '331093')
  })

  it('keeps basic event detail visible and retries an isolated group-list failure', async () => {
    const testAPI = api({
      eventGroups: vi.fn()
        .mockRejectedValueOnce(new Error('组别网络不可用'))
        .mockResolvedValueOnce(groups),
    })
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    expect(await screen.findByRole('heading', { name: '杭州围棋公开赛' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('组别网络不可用')
    await userEvent.click(screen.getByRole('button', { name: '重试加载组别' }))

    expect(await screen.findByText('8级组')).toBeInTheDocument()
    expect(testAPI.eventGroups).toHaveBeenCalledTimes(2)
  })

  it('keeps the group title visible and retries an isolated pairing failure', async () => {
    const testAPI = api({
      groupPairings: vi.fn()
        .mockRejectedValueOnce(new Error('对阵网络不可用'))
        .mockResolvedValueOnce(finalPairings),
    })
    render(<YunbisaiMyEventsPanel api={testAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    expect(await screen.findByRole('heading', { name: '8级组对阵表' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('对阵网络不可用')
    await userEvent.click(screen.getByRole('button', { name: '重试对阵表' }))

    expect(await screen.findByText('第 7 / 7 轮')).toBeInTheDocument()
    expect(testAPI.groupPairings).toHaveBeenCalledTimes(2)
  })

  it('renders empty pairings and unknown results without inventing a winner', async () => {
    const emptyAPI = api({
      groupPairings: vi.fn(() => Promise.resolve({ ...finalPairings, matches: [] })),
    })
    const { unmount } = render(<YunbisaiMyEventsPanel api={emptyAPI} />)

    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    expect(await screen.findByText('暂无对阵')).toBeInTheDocument()
    unmount()

    const unknownAPI = api({
      groupPairings: vi.fn(() => Promise.resolve({
        ...finalPairings,
        matches: [{
          seatNumber: '2',
          player1: { name: '待确认甲', result: 'unknown' },
          player2: { name: '', result: 'pending' },
        }],
      })),
    })
    render(<YunbisaiMyEventsPanel api={unknownAPI} />)
    await userEvent.click(await screen.findByRole('button', { name: /杭州围棋公开赛/ }))
    await userEvent.click(await screen.findByRole('button', { name: /8级组/ }))
    const pairingSection = await screen.findByRole('region', { name: '8级组对阵表' })
    expect(within(pairingSection).getByText('结果待确认')).toBeInTheDocument()
    expect(within(pairingSection).queryByText('胜')).not.toBeInTheDocument()
  })

  it('logs out and switches accounts without exposing credentials', async () => {
    const testAPI = api()
    const { container } = render(<YunbisaiMyEventsPanel api={testAPI} />)

    await screen.findByRole('button', { name: /杭州围棋公开赛/ })
    expect(container.textContent).not.toContain('token')
    expect(container.textContent).not.toContain('cookie')
    await userEvent.click(screen.getByRole('button', { name: '切换账号' }))

    await waitFor(() => expect(testAPI.logout).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('img', { name: '云比赛登录二维码' })).toBeInTheDocument()
  })
})
