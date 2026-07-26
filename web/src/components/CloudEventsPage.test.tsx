import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudEvent } from '../api/cloudEvents'
import type { YunbisaiMyEventsAPI } from '../api/types'
import { CloudEventsPage } from './CloudEventsPage'

const event: CloudEvent = {
  id: '67043',
  title: '棋通杯围棋业余段级位赛',
  sport: '围棋',
  startDate: '2026-07-19',
  endDate: '2026-07-20',
  fee: 0,
  registeredCount: 290,
  organizer: '杭州棋通少儿棋院',
}

function myEventsApi(): YunbisaiMyEventsAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: true, account: { loginId: '7', name: '棋手甲', account: '' } })),
    loginStart: vi.fn(() => Promise.resolve({ flowId: 'flow-1', imageUrl: 'https://example.test/qr.png' })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 'waiting' })),
    loginSelect: vi.fn(() => Promise.resolve({ loggedIn: true })),
    logout: vi.fn(() => Promise.resolve()),
    myEvents: vi.fn(() => Promise.resolve({ loggedIn: true, total: 0, page: 1, events: [] })),
    myEventDetail: vi.fn(() => Promise.resolve({ loggedIn: true })),
  }
}

describe('CloudEventsPage', () => {
  afterEach(cleanup)

  it('loads the current month and renders an original detail link', async () => {
    const loadEvents = vi.fn(async () => [event])
    render(<CloudEventsPage myEventsApi={myEventsApi()} today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    expect(screen.getByLabelText('比赛月份')).toHaveValue('2026-07')
    expect(await screen.findByText(event.title)).toBeInTheDocument()
    expect(loadEvents).toHaveBeenCalledWith('2026-07', expect.any(AbortSignal))
    expect(screen.getByText('2026-07-19 — 07-20')).toBeInTheDocument()
    expect(screen.getByText('免费')).toBeInTheDocument()
    expect(screen.getByText('已报 290 人')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(event.title) })).toHaveAttribute(
      'href',
      'https://m.yunbisai.com/signUp?eventid=67043',
    )
    expect(screen.getByRole('link', { name: new RegExp(event.title) })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('switches top-level tabs and keeps the month filter only on Hangzhou events', async () => {
    const api = myEventsApi()
    render(<CloudEventsPage myEventsApi={api} today={new Date(2026, 6, 14)} loadEvents={vi.fn(async () => [])} />)

    expect(screen.getByRole('tab', { name: '杭州比赛' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '我的比赛' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('比赛月份')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '我的比赛' }))
    expect(screen.getByRole('tab', { name: '我的比赛' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('比赛月份')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '我的比赛内容' })).toBeInTheDocument()
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1))
    expect(api.myEvents).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('tab', { name: '杭州比赛' }))
    expect(screen.getByLabelText('比赛月份')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '我的比赛内容' })).not.toBeInTheDocument()
  })

  it('keeps a stale month response from replacing the selected month', async () => {
    const resolvers = new Map<string, (events: CloudEvent[]) => void>()
    const loadEvents = vi.fn((month: string) => new Promise<CloudEvent[]>((resolve) => resolvers.set(month, resolve)))
    render(<CloudEventsPage myEventsApi={myEventsApi()} today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    fireEvent.change(screen.getByLabelText('比赛月份'), { target: { value: '2026-08' } })
    await act(async () => resolvers.get('2026-08')?.([{ ...event, id: 'aug', title: '8 月比赛' }]))
    expect(await screen.findByText('8 月比赛')).toBeInTheDocument()

    await act(async () => resolvers.get('2026-07')?.([{ ...event, id: 'jul', title: '7 月旧数据' }]))
    expect(screen.queryByText('7 月旧数据')).not.toBeInTheDocument()
  })

  it('shows empty and retryable error states', async () => {
    const loadEvents = vi.fn()
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce([])
    render(<CloudEventsPage myEventsApi={myEventsApi()} today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2026 年 7 月暂无杭州比赛')).toBeInTheDocument()
  })
})
