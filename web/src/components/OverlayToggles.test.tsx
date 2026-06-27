import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OverlayToggles } from './OverlayToggles'

describe('OverlayToggles', () => {
  it('toggles recommended moves while preserving other overlay values', async () => {
    const onChange = vi.fn()
    render(<OverlayToggles value={{ candidates: true, ownership: true, deadStones: true }} onChange={onChange} />)
    expect(screen.getByLabelText('Toggle recommended moves')).toHaveTextContent('荐')
    expect(screen.getByLabelText('Toggle ownership')).toHaveTextContent('势')
    expect(screen.getByLabelText('Toggle weak stones')).toHaveTextContent('围')
    await userEvent.click(screen.getByLabelText('Toggle recommended moves'))
    expect(onChange).toHaveBeenCalledWith({ candidates: false, ownership: true, deadStones: true })
  })
})
