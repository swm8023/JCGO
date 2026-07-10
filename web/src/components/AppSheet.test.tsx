import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppSheet } from './AppSheet'

describe('AppSheet', () => {
  it('renders a named modal surface and dismisses it with Escape', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <AppSheet title="命名棋局" actions={<button type="button">确认</button>} onDismiss={onDismiss}>
        <p>内容</p>
      </AppSheet>,
    )

    expect(screen.getByRole('dialog', { name: '命名棋局' })).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
