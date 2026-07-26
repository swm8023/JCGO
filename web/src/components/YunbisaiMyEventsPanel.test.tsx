import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YunbisaiMyEvent, YunbisaiMyEventsAPI } from '../api/types'
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
      players: [{ name: '棋手甲', groupName: '甲组', teamName: '杭州队' }],
    })),
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
