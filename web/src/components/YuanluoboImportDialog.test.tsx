import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
