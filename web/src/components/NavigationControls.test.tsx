import '@testing-library/jest-dom/vitest'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationControls } from './NavigationControls'

describe('NavigationControls', () => {
  it('keeps review controls focused on move navigation and try actions', () => {
    const onEnterTryMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={12}
        totalMoves={180}
        canBackToMain={false}
        tryMode={false}
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={vi.fn()}
        onNext={vi.fn()}
        onForwardFive={vi.fn()}
        onLast={vi.fn()}
        onEnterTryMode={onEnterTryMode}
        onExitTryMode={vi.fn()}
      />,
    )
    const controls = within(container)

    expect(controls.getByRole('button', { name: 'First move' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Back 5 moves' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Previous move' })).toBeInTheDocument()
    expect(controls.getByText('12 / 180')).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Next move' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Forward 5 moves' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Last move' })).toBeInTheDocument()
    controls.getByRole('button', { name: 'Try selected recommendation' }).click()
    expect(onEnterTryMode).toHaveBeenCalledTimes(1)
    expect(controls.queryByText('Pass')).not.toBeInTheDocument()
    expect(controls.queryByText('Delete node')).not.toBeInTheDocument()
    expect(controls.queryByText('Clear branch')).not.toBeInTheDocument()
  })

  it('uses exit try to leave a trial branch instead of exposing delete controls', () => {
    const onExitTryMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={13}
        totalMoves={180}
        canBackToMain
        tryMode
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={vi.fn()}
        onNext={vi.fn()}
        onForwardFive={vi.fn()}
        onLast={vi.fn()}
        onEnterTryMode={vi.fn()}
        onExitTryMode={onExitTryMode}
      />,
    )
    const controls = within(container)

    controls.getByRole('button', { name: 'Exit try mode' }).click()
    expect(onExitTryMode).toHaveBeenCalledTimes(1)
    expect(controls.queryByText('Clear branch')).not.toBeInTheDocument()
  })

  it('allows entering try mode before selecting a candidate preview', () => {
    const onEnterTryMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={0}
        totalMoves={180}
        canBackToMain={false}
        tryMode={false}
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={vi.fn()}
        onNext={vi.fn()}
        onForwardFive={vi.fn()}
        onLast={vi.fn()}
        onEnterTryMode={onEnterTryMode}
        onExitTryMode={vi.fn()}
      />,
    )
    const controls = within(container)

    controls.getByRole('button', { name: 'Try selected recommendation' }).click()
    expect(onEnterTryMode).toHaveBeenCalledTimes(1)
  })

  it('calls five-move jump callbacks', () => {
    const onBackFive = vi.fn()
    const onForwardFive = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={12}
        totalMoves={180}
        canBackToMain={false}
        tryMode={false}
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={onBackFive}
        onNext={vi.fn()}
        onForwardFive={onForwardFive}
        onLast={vi.fn()}
        onEnterTryMode={vi.fn()}
        onExitTryMode={vi.fn()}
      />,
    )
    const controls = within(container)

    controls.getByRole('button', { name: 'Back 5 moves' }).click()
    controls.getByRole('button', { name: 'Forward 5 moves' }).click()

    expect(onBackFive).toHaveBeenCalledTimes(1)
    expect(onForwardFive).toHaveBeenCalledTimes(1)
  })
})
