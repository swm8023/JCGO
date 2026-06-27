import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RotatePrompt } from './RotatePrompt'

describe('RotatePrompt', () => {
  afterEach(() => cleanup())

  it('keeps SGF import available while the phone is held in portrait', async () => {
    const onImport = vi.fn()
    render(<RotatePrompt onImport={onImport} />)

    await userEvent.click(screen.getByRole('button', { name: 'Choose SGF' }))

    expect(onImport).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Review games in landscape')).toBeInTheDocument()
  })
})
