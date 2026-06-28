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

  it('uses compact aligned icon actions in each game row', () => {
    const { container } = render(
      <GameSidebar
        games={[{ gameId: '1', displayName: 'Demo', result: '', sgfFilename: '1.sgf', createdAt: '2026-06-24T01:00:00Z' }]}
        listOpen
        selectedGameId="1"
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

    const rename = screen.getByLabelText('Rename Demo')
    const remove = screen.getByLabelText('Delete Demo')
    expect(rename).toHaveClass('game-row-action')
    expect(remove).toHaveClass('game-row-action', 'danger')
    expect(rename).toHaveTextContent('✎')
    expect(remove).toHaveTextContent('×')
    expect(container.querySelector('.game-row')).toBeInTheDocument()
  })

  it('shows game metadata without hiding dates or analysis status', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'Honinbo final',
          result: 'B+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
          gameDate: '2026-06-24',
          analysisStatus: 'complete',
        }]}
        listOpen
        selectedGameId="1"
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

    const row = within(container).getByText('Honinbo final').closest('.game-row')
    expect(row).not.toBeNull()
    const gameRow = within(row as HTMLElement)
    expect(gameRow.getByText('B+R')).toBeInTheDocument()
    expect(gameRow.getByText('棋局 2026-06-24')).toBeInTheDocument()
    expect(gameRow.getByText('上传 2026-06-25')).toBeInTheDocument()
    expect(gameRow.getByText('已分析')).toBeInTheDocument()
  })
})
