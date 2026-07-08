import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'
import type { YuanluoboImportAPI } from './YuanluoboImportDialog'

function yuanluoboApi(): YuanluoboImportAPI {
  return {
    status: vi.fn(() => Promise.resolve({ loggedIn: false })),
    loginStart: vi.fn(() => Promise.resolve({
      key: 'key-1',
      image: 'jpeg-base64',
      scanUrl: 'https://jupiter.yuanluobo.com/robot-public/all-in-app/scanned-page?key=key-1&from=qrcode-login',
    })),
    loginPoll: vi.fn(() => Promise.resolve({ status: 0, desc: '未扫码' })),
    logout: vi.fn(() => Promise.resolve()),
    players: vi.fn(() => Promise.resolve([])),
    records: vi.fn(() => Promise.resolve({ total: 0, page: 1, size: 10, pageTotal: 0, categories: [], records: [] })),
    importRecord: vi.fn(),
  }
}

describe('ImportDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('presents import sources as a compact tool panel', () => {
    render(<ImportDialog onImport={vi.fn()} onImportUrl={vi.fn()} onCancel={vi.fn()} yuanluoboApi={yuanluoboApi()} onOpenGame={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '导入棋局' })).toBeInTheDocument()
    expect(screen.getByText('选择一个来源，导入后会进入当前棋盘。')).toBeInTheDocument()

    const file = screen.getByRole('button', { name: /SGF 文件/ })
    const link = screen.getByRole('button', { name: /复盘链接/ })
    const yuanluobo = screen.getByRole('button', { name: /元萝卜账号/ })

    expect(file).toHaveClass('import-source-card')
    expect(link).toHaveClass('import-source-card')
    expect(yuanluobo).toHaveClass('import-source-card', 'primary')
  })

  it('uses the File System Access picker with a stable SGF directory id when available', async () => {
    const file = new File(['(;GM[1]FF[4]SZ[19])'], 'demo.sgf', { type: 'application/x-go-sgf' })
    const showOpenFilePicker = vi.fn(() => Promise.resolve([{ getFile: () => Promise.resolve(file) }]))
    Object.defineProperty(window, 'showOpenFilePicker', { value: showOpenFilePicker, configurable: true })
    vi.spyOn(window, 'prompt').mockReturnValue('Demo')
    const onImport = vi.fn()

    render(<ImportDialog onImport={onImport} onImportUrl={vi.fn()} onCancel={vi.fn()} yuanluoboApi={yuanluoboApi()} onOpenGame={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /SGF 文件/ }))

    expect(showOpenFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'jcgo-sgf-import',
        startIn: 'documents',
        multiple: false,
      }),
    )
    await waitFor(() => expect(onImport).toHaveBeenCalledWith('Demo', 'demo.sgf', '(;GM[1]FF[4]SZ[19])'))
  })

  it('opens the yuanluobo import entry from the choose screen', async () => {
    render(
      <ImportDialog
        onImport={vi.fn()}
        onImportUrl={vi.fn()}
        onCancel={vi.fn()}
        yuanluoboApi={yuanluoboApi()}
        onOpenGame={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))

    expect(await screen.findByRole('region', { name: '元萝卜登录' })).toBeInTheDocument()
  })
})
