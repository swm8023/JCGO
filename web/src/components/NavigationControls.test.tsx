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
        toPlay="W"
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
    expect(controls.getByRole('button', { name: 'Back 5 moves' })).toHaveTextContent('<<')
    expect(controls.getByRole('button', { name: 'Previous move' })).toBeInTheDocument()
    expect(controls.getByLabelText('Move 12, white to play')).toHaveTextContent('12')
    expect(controls.queryByText('12 / 180')).not.toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Next move' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Forward 5 moves' })).toHaveTextContent('>>')
    expect(controls.getByRole('button', { name: 'Last move' })).toBeInTheDocument()
    expect(controls.getByRole('button', { name: 'Try selected recommendation' })).toHaveTextContent('试')
    expect(controls.getByRole('button', { name: 'Try selected recommendation' })).toHaveClass('try-action-button', 'try-action-enter')
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
        toPlay="B"
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

    expect(controls.getByRole('button', { name: 'Exit try mode' })).toHaveTextContent('退')
    expect(controls.getByRole('button', { name: 'Exit try mode' })).toHaveClass('try-action-button', 'try-action-exit')
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
        toPlay="B"
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
        toPlay="W"
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

  it('renders next-player and unavailable move number stones', () => {
    const { rerender, container } = render(
      <NavigationControls
        moveNumber={24}
        totalMoves={180}
        toPlay="B"
        canBackToMain={false}
        tryMode={false}
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={vi.fn()}
        onNext={vi.fn()}
        onForwardFive={vi.fn()}
        onLast={vi.fn()}
        onEnterTryMode={vi.fn()}
        onExitTryMode={vi.fn()}
      />,
    )
    const controls = within(container)

    expect(controls.getByLabelText('Move 24, black to play')).toHaveTextContent('24')
    expect(controls.getByLabelText('Move 24, black to play')).toHaveClass('move-number-stone-black')

    rerender(
      <NavigationControls
        moveNumber={0}
        totalMoves={180}
        toPlay={undefined}
        canBackToMain={false}
        tryMode={false}
        onFirst={vi.fn()}
        onPrevious={vi.fn()}
        onBackFive={vi.fn()}
        onNext={vi.fn()}
        onForwardFive={vi.fn()}
        onLast={vi.fn()}
        onEnterTryMode={vi.fn()}
        onExitTryMode={vi.fn()}
      />,
    )

    expect(controls.getByLabelText('Move 0, next player unavailable')).toHaveTextContent('0')
    expect(controls.getByLabelText('Move 0, next player unavailable')).toHaveClass('move-number-stone-empty')
  })
})
