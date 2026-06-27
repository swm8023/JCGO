import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GameSidebar } from './GameSidebar'

describe('GameSidebar', () => {
  it('renders imported games newest first', () => {
    render(
      <GameSidebar
        games={[
          { gameId: '2', displayName: 'New', result: 'W+R', sgfFilename: '2.sgf', createdAt: '2026-06-24T02:00:00Z' },
          { gameId: '1', displayName: 'Old', result: 'B+R', sgfFilename: '1.sgf', createdAt: '2026-06-24T01:00:00Z' },
        ]}
        listOpen={false}
        selectedGameId="2"
        analysisAvailable
        analysisState="idle"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Old')).toBeInTheDocument()
  })

  it('exposes separate list and import actions for the mobile rail', () => {
    const onToggleList = vi.fn()
    const onImport = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen
        analysisAvailable
        analysisState="idle"
        onToggleList={onToggleList}
        onImport={onImport}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    expect(container.querySelector('.game-sidebar')).toHaveClass('expanded')
    const sidebar = within(container)
    sidebar.getByLabelText('Show game list').click()
    sidebar.getByLabelText('Import SGF').click()
    expect(onToggleList).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it('places the analysis action in the left sidebar', () => {
    const onStartAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        analysisAvailable
        analysisState="idle"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={onStartAnalysis}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const action = within(container).getByRole('button', { name: 'Start analysis' })
    expect(action).toHaveTextContent('析')
    expect(action).not.toHaveTextContent('Run')
    action.click()
    expect(onStartAnalysis).toHaveBeenCalledTimes(1)
  })
})
