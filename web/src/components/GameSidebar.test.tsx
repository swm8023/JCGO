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

  it('renders the local game list as a titlebar-below library surface', () => {
    const { container } = render(
      <GameSidebar
        games={[
          { gameId: '2', displayName: 'New', result: 'W+R', sgfFilename: '2.sgf', createdAt: '2026-06-24T02:00:00Z' },
          { gameId: '1', displayName: 'Old', result: 'B+R', sgfFilename: '1.sgf', createdAt: '2026-06-24T01:00:00Z' },
        ]}
        listOpen
        selectedGameId="2"
        analysisAvailable
        analysisState="idle"
        toolbarSlot={<div data-testid="overlay-slot">荐势弱</div>}
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

    const header = container.querySelector('.sidebar-header')
    const list = container.querySelector<HTMLElement>('[aria-label="本地棋局列表"]')
    expect(header).toContainElement(within(container).getByLabelText('Show game list'))
    expect(list).not.toBeNull()
    expect(list).toHaveClass('game-list')
    expect(list).toHaveAttribute('aria-hidden', 'false')
    expect(list?.querySelector('.game-list-shell')).toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('本地棋局')).toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('共 2 局')).toBeInTheDocument()
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

  it('groups file, overlay, and analysis controls for the compact toolbar', () => {
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        analysisAvailable
        analysisState="idle"
        toolbarSlot={<div data-testid="overlay-slot">荐势弱</div>}
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

    const fileActions = container.querySelector('.sidebar-file-actions')
    const toggleActions = container.querySelector('.sidebar-toggle-actions')
    const analysisActions = container.querySelector('.sidebar-analysis')
    const sidebar = within(container)
    expect(fileActions).toContainElement(sidebar.getByLabelText('Show game list'))
    expect(fileActions).toContainElement(sidebar.getByLabelText('Import SGF'))
    expect(toggleActions).toContainElement(sidebar.getByTestId('overlay-slot'))
    expect(analysisActions).toContainElement(sidebar.getByRole('button', { name: 'Start analysis' }))
    expect(Array.from(container.querySelectorAll('.sidebar-file-actions, .sidebar-toggle-actions, .sidebar-analysis'))).toEqual([
      fileActions,
      toggleActions,
      analysisActions,
    ])
  })

  it('shows running analysis progress as the same compact label in both orientations', () => {
    const onStopAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        analysisAvailable
        analysisState="running"
        analysisProgress={{ analyzed: 11, total: 133 }}
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={onStopAnalysis}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const sidebar = within(container)
    const action = sidebar.getByRole('button', { name: 'Analysis progress 11/133' })
    expect(action).toBeDisabled()
    expect(action).toHaveClass('analysis-action-wide')
    expect(action).not.toHaveTextContent('Stop analysis')
    expect(sidebar.getAllByText('11/133')).toHaveLength(2)
    action.click()
    expect(onStopAnalysis).not.toHaveBeenCalled()
  })

  it('disables completed analysis without offering re-analysis', () => {
    const onRestartAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        analysisAvailable
        analysisState="complete"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={onRestartAnalysis}
      />,
    )

    const sidebar = within(container)
    const action = sidebar.getByRole('button', { name: 'Analysis complete' })
    expect(action).toBeDisabled()
    expect(action).not.toHaveTextContent('Re-analyze')
    expect(action).not.toHaveTextContent('Again')
    expect(sidebar.getAllByText('析')).toHaveLength(2)
    action.click()
    expect(onRestartAnalysis).not.toHaveBeenCalled()
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
    expect(rename.querySelector('svg')).toBeInTheDocument()
    expect(remove.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('.game-row')).toBeInTheDocument()
  })

  it('uses the yuanluobo record row structure for local game rows', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'Lee vs Cho',
          result: 'B+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
          gameDate: '2026-06-24',
          blackName: 'Lee',
          whiteName: 'Cho',
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

    const row = container.querySelector('.game-row')
    expect(row).toHaveClass('yuanluobo-record-row')
    expect(row).toHaveAttribute('data-outcome', 'win')
    expect(row?.querySelector('.yuanluobo-record-main')).toBeInTheDocument()
    expect(row?.querySelector('.yuanluobo-record-title')).toHaveTextContent('LeevsCho')
    expect(row?.querySelector('.yuanluobo-vs')).toHaveTextContent('vs')
    expect(row?.querySelectorAll('.yuanluobo-stone')).toHaveLength(2)
    expect(row?.querySelector('.yuanluobo-record-meta')).toHaveTextContent('2026-06-24')
    expect(row?.querySelector('.yuanluobo-record-meta')).toHaveTextContent('黑中盘胜')
    expect(row?.querySelector('.yuanluobo-result-watermark')).not.toBeInTheDocument()
    expect(row?.querySelector('.game-row-actions')).toBeInTheDocument()
  })

  it('normalizes legacy matchup display names to the yuanluobo title structure', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'Lee VS Cho',
          result: 'B+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
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

    const row = container.querySelector('.game-row')
    expect(row?.querySelector('.yuanluobo-record-title')).toHaveTextContent('LeevsCho')
    expect(row?.querySelector('.yuanluobo-vs')).toHaveTextContent('vs')
    expect(row?.querySelectorAll('.yuanluobo-stone')).toHaveLength(2)
    expect(row?.querySelector('.game-title-name')).not.toBeInTheDocument()
  })

  it('uses the left result stripe instead of a result watermark for local game rows', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'White wins',
          result: 'W+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
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

    expect(container.querySelector('.yuanluobo-result-watermark')).not.toBeInTheDocument()
    expect(container.querySelector('.game-row')).toHaveAttribute('data-outcome', 'loss')
  })

  it('shows an empty library state when no games have been imported', () => {
    render(
      <GameSidebar
        games={[]}
        listOpen
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

    const list = document.querySelector<HTMLElement>('[aria-label="本地棋局列表"][aria-hidden="false"]')
    expect(list).not.toBeNull()
    expect(within(list as HTMLElement).getByText('还没有本地棋局')).toBeInTheDocument()
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
    expect(gameRow.getByText('黑中盘胜')).toBeInTheDocument()
    expect(gameRow.getByText('2026-06-24')).toBeInTheDocument()
    expect(gameRow.queryByText('上传 2026-06-25')).not.toBeInTheDocument()
    expect(gameRow.getByText('已分析')).toBeInTheDocument()
  })

  it('formats numeric and legacy child-count results in eyes', () => {
    render(
      <GameSidebar
        games={[
          { gameId: '1', displayName: 'Numeric', result: 'W+12.50', sgfFilename: '1.sgf', createdAt: '2026-06-24T01:00:00Z' },
          { gameId: '2', displayName: 'Legacy', result: '白胜6.25子', sgfFilename: '2.sgf', createdAt: '2026-06-24T02:00:00Z' },
        ]}
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

    expect(screen.getByText('白胜 12.50目')).toBeInTheDocument()
    expect(screen.getByText('白胜 12.5目')).toBeInTheDocument()
  })
})
