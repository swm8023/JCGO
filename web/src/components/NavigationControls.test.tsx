import '@testing-library/jest-dom/vitest'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationControls } from './NavigationControls'

const navigationCallbacks = () => ({
  onFirst: vi.fn(),
  onPrevious: vi.fn(),
  onBackFive: vi.fn(),
  onNext: vi.fn(),
  onForwardFive: vi.fn(),
  onLast: vi.fn(),
})

describe('NavigationControls', () => {
  it('shows direct try as the green default and switches to preview mode', () => {
    const onEnablePreviewMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={12}
        totalMoves={180}
        toPlay="W"
        canBackToMain={false}
        interactionMode="try"
        {...navigationCallbacks()}
        onEnableTryMode={vi.fn()}
        onEnablePreviewMode={onEnablePreviewMode}
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

    const tryButton = controls.getByRole('button', { name: 'Switch to AI preview mode' })
    expect(tryButton).toHaveTextContent('试')
    expect(tryButton).toHaveClass('try-action-button', 'try-action-ready')
    expect(tryButton).not.toBeDisabled()
    tryButton.click()
    expect(onEnablePreviewMode).toHaveBeenCalledTimes(1)
  })

  it('shows preview mode as a clickable gray try control', () => {
    const onEnableTryMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={12}
        totalMoves={180}
        toPlay="W"
        canBackToMain={false}
        interactionMode="preview"
        {...navigationCallbacks()}
        onEnableTryMode={onEnableTryMode}
        onEnablePreviewMode={vi.fn()}
        onExitTryMode={vi.fn()}
      />,
    )
    const previewButton = within(container).getByRole('button', { name: 'Enable direct try mode' })

    expect(previewButton).toHaveTextContent('试')
    expect(previewButton).toHaveClass('try-action-button', 'try-action-preview')
    expect(previewButton).not.toBeDisabled()
    previewButton.click()
    expect(onEnableTryMode).toHaveBeenCalledTimes(1)
  })

  it('uses exit try whenever a trial branch exists', () => {
    const onExitTryMode = vi.fn()
    const { container } = render(
      <NavigationControls
        moveNumber={13}
        totalMoves={180}
        toPlay="B"
        canBackToMain
        interactionMode="preview"
        {...navigationCallbacks()}
        onEnableTryMode={vi.fn()}
        onEnablePreviewMode={vi.fn()}
        onExitTryMode={onExitTryMode}
      />,
    )
    const controls = within(container)

    const exitButton = controls.getByRole('button', { name: 'Exit try mode' })
    expect(exitButton).toHaveTextContent('退')
    expect(exitButton).toHaveClass('try-action-button', 'try-action-exit')
    exitButton.click()
    expect(onExitTryMode).toHaveBeenCalledTimes(1)
    expect(controls.queryByText('Clear branch')).not.toBeInTheDocument()
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
        interactionMode="try"
        {...navigationCallbacks()}
        onBackFive={onBackFive}
        onForwardFive={onForwardFive}
        onEnableTryMode={vi.fn()}
        onEnablePreviewMode={vi.fn()}
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
    const props = {
      totalMoves: 180,
      canBackToMain: false,
      interactionMode: 'try' as const,
      ...navigationCallbacks(),
      onEnableTryMode: vi.fn(),
      onEnablePreviewMode: vi.fn(),
      onExitTryMode: vi.fn(),
    }
    const { rerender, container } = render(<NavigationControls {...props} moveNumber={24} toPlay="B" />)
    const controls = within(container)

    expect(controls.getByLabelText('Move 24, black to play')).toHaveTextContent('24')
    expect(controls.getByLabelText('Move 24, black to play')).toHaveClass('move-number-stone-black')

    rerender(<NavigationControls {...props} moveNumber={0} toPlay={undefined} />)

    expect(controls.getByLabelText('Move 0, next player unavailable')).toHaveTextContent('0')
    expect(controls.getByLabelText('Move 0, next player unavailable')).toHaveClass('move-number-stone-empty')
  })
})
