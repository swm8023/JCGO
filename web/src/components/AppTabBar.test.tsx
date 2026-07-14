import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppTabBar } from './AppTabBar'

describe('AppTabBar', () => {
  it('shows four Chinese root destinations and selects cloud events', async () => {
    const onSelect = vi.fn()
    render(<AppTabBar active="game-list" onSelect={onSelect} />)

    expect(screen.getByRole('navigation', { name: '应用功能' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本地棋局' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '云比赛' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '云比赛' }))
    expect(onSelect).toHaveBeenCalledWith('cloud-events')
  })
})
