import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OverlayToggles } from './OverlayToggles'

describe('OverlayToggles', () => {
  it('toggles recommended moves while preserving other overlay values', async () => {
    const onChange = vi.fn()
    render(<OverlayToggles value={{ candidates: true, ownership: true, deadStones: true }} onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Toggle recommended moves'))
    expect(onChange).toHaveBeenCalledWith({ candidates: false, ownership: true, deadStones: true })
  })
})
