import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

  it('renders source selection as a page body instead of a dialog', () => {
    renderImportDialog()

    expect(screen.getByRole('region', { name: '导入棋局内容' })).toHaveClass('app-page-body', 'import-page')
    expect(screen.queryByRole('dialog', { name: '导入棋局' })).not.toBeInTheDocument()

    const file = screen.getByRole('button', { name: /SGF 文件/ })
    const link = screen.getByRole('button', { name: /复盘链接/ })
    const yuanluobo = screen.getByRole('button', { name: /元萝卜账号/ })

    expect(file).toHaveClass('import-source-card')
    expect(link).toHaveClass('import-source-card')
    expect(yuanluobo).toHaveClass('import-source-card', 'primary')
  })

  it('renders URL entry as a page body instead of a dialog', () => {
    renderImportDialog({ mode: 'url' })

    expect(screen.getByRole('region', { name: '从链接导入内容' })).toHaveClass('app-page-body', 'import-page')
    expect(screen.queryByRole('dialog', { name: '从链接导入' })).not.toBeInTheDocument()
  })

  it('uses the File System Access picker with a stable SGF directory id when available', async () => {
    const user = userEvent.setup()
    const file = new File(['(;GM[1]FF[4]SZ[19])'], 'demo.sgf', { type: 'application/x-go-sgf' })
    const showOpenFilePicker = vi.fn(() => Promise.resolve([{ getFile: () => Promise.resolve(file) }]))
    Object.defineProperty(window, 'showOpenFilePicker', { value: showOpenFilePicker, configurable: true })
    const prompt = vi.spyOn(window, 'prompt')
    const onImport = vi.fn()

    renderImportDialog({ onImport })

    await user.click(screen.getByRole('button', { name: /SGF 文件/ }))

    expect(showOpenFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'jcgo-sgf-import',
        startIn: 'documents',
        multiple: false,
      }),
    )
    const sheet = await screen.findByRole('dialog', { name: '命名棋局' })
    const name = within(sheet).getByLabelText('棋局名称')
    expect(name).toHaveValue('demo')
    await user.clear(name)
    await user.type(name, '练习棋局')
    await user.click(within(sheet).getByRole('button', { name: '导入' }))
    await waitFor(() => expect(onImport).toHaveBeenCalledWith('练习棋局', 'demo.sgf', '(;GM[1]FF[4]SZ[19])'))
    expect(prompt).not.toHaveBeenCalled()
  })

  it('requests the yuanluobo import entry from the choose screen', async () => {
    const onOpenYuanluobo = vi.fn()
    renderImportDialog({ onOpenYuanluobo })

    await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))

    expect(onOpenYuanluobo).toHaveBeenCalledOnce()
  })

  it('renders the yuanluobo import entry as a page body', async () => {
    renderImportDialog({ mode: 'yuanluobo' })

    expect(screen.queryByRole('dialog', { name: '元萝卜导入' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '元萝卜登录内容' })).toBeInTheDocument()
  })
})

function renderImportDialog(overrides: Partial<Parameters<typeof ImportDialog>[0]> = {}) {
  const props: Parameters<typeof ImportDialog>[0] = {
    mode: 'choose',
    onImport: vi.fn(),
    onImportUrl: vi.fn(),
    onOpenUrl: vi.fn(),
    onOpenYuanluobo: vi.fn(),
    yuanluoboApi: yuanluoboApi(),
    onOpenYuanluoboPicker: vi.fn(),
    onCloseYuanluoboPicker: vi.fn(),
    ...overrides,
  }
  return render(<ImportDialog {...props} />)
}
