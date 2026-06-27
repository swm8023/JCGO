import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'

describe('ImportDialog', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses the File System Access picker with a stable SGF directory id when available', async () => {
    const file = new File(['(;GM[1]FF[4]SZ[19])'], 'demo.sgf', { type: 'application/x-go-sgf' })
    const showOpenFilePicker = vi.fn(() => Promise.resolve([{ getFile: () => Promise.resolve(file) }]))
    const lock = vi.fn(() => Promise.resolve())
    const unlock = vi.fn()
    Object.defineProperty(window, 'showOpenFilePicker', { value: showOpenFilePicker, configurable: true })
    Object.defineProperty(window.screen, 'orientation', { value: { lock, unlock }, configurable: true })
    vi.spyOn(window, 'prompt').mockReturnValue('Demo')
    const onImport = vi.fn()

    render(<ImportDialog onImport={onImport} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Choose SGF' }))

    expect(lock).toHaveBeenCalledWith('portrait')
    expect(showOpenFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'jcgo-sgf-import',
        startIn: 'documents',
        multiple: false,
      }),
    )
    await waitFor(() => expect(onImport).toHaveBeenCalledWith('Demo', 'demo.sgf', '(;GM[1]FF[4]SZ[19])'))
    expect(unlock).toHaveBeenCalled()
  })
})
