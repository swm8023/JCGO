import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Old')).toBeInTheDocument()
  })

  it('exposes separate list, import, and settings actions for the mobile rail', () => {
    const onToggleList = vi.fn()
    const onImport = vi.fn()
    const onSettings = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen
        analysisAvailable
        analysisState="idle"
        onToggleList={onToggleList}
        onImport={onImport}
        onSettings={onSettings}
        onSelect={vi.fn()}
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
    sidebar.getByLabelText('Open settings').click()
    expect(onToggleList).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onSettings).toHaveBeenCalledTimes(1)
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

  it('opens an analysis menu with worker selection and actions', async () => {
    const user = userEvent.setup()
    const onSetAnalysisWorker = vi.fn().mockResolvedValue(undefined)
    const onStartAnalysis = vi.fn()
    const onRestartAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'local-gpu',
            platform: 'windows/amd64',
            model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
            maxVisits: 500,
            available: true,
            busy: false,
          }],
        }}
        analysisAvailable
        analysisState="idle"
        analysisProgress={{ analyzed: 3, total: 10 }}
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={onStartAnalysis}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={onRestartAnalysis}
        onSetAnalysisWorker={onSetAnalysisWorker}
      />,
    )

    const action = within(container).getByRole('button', { name: '打开分析菜单' })
    expect(action).toHaveTextContent('析')
    expect(action).not.toHaveTextContent('Run')
    expect(action.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
    await user.click(action)
    const menu = screen.getByRole('menu', { name: '分析' })
    expect(within(menu).getByText('3 / 10')).toBeInTheDocument()
    expect(within(menu).getByLabelText('分析器')).toHaveValue('local-gpu')
    expect(within(menu).getByText('模型')).toBeInTheDocument()
    expect(within(menu).getByText('kata1-b18c384nbt-s9996604416-d4316597426.bin.gz')).toBeInTheDocument()
    expect(within(menu).getByText('Visits')).toBeInTheDocument()
    expect(within(menu).getByText('500')).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: '继续分析' }))
    expect(onStartAnalysis).toHaveBeenCalledTimes(1)
    await user.click(within(container).getByRole('button', { name: '打开分析菜单' }))
    await user.click(within(screen.getByRole('menu', { name: '分析' })).getByRole('menuitem', { name: '重新分析' }))
    expect(onRestartAnalysis).toHaveBeenCalledTimes(1)
  })

  it('requires a worker before analysis actions are enabled', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
        analysisAvailable
        analysisState="idle"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
        onSetAnalysisWorker={vi.fn()}
      />,
    )

    await user.click(within(container).getByRole('button', { name: '打开分析菜单' }))
    const menu = screen.getByRole('menu', { name: '分析' })
    expect(within(menu).getByRole('menuitem', { name: '继续分析' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: '重新分析' })).toBeDisabled()
    expect(within(menu).getAllByText('请选择分析器').length).toBeGreaterThan(0)
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
    expect(fileActions).toContainElement(sidebar.getByLabelText('Open settings'))
    expect(toggleActions).toContainElement(sidebar.getByTestId('overlay-slot'))
    expect(analysisActions).toContainElement(sidebar.getByRole('button', { name: '打开分析菜单' }))
    expect(Array.from(container.querySelectorAll('.sidebar-file-actions, .sidebar-toggle-actions, .sidebar-analysis'))).toEqual([
      fileActions,
      toggleActions,
      analysisActions,
    ])
  })

  it('shows running analysis progress and exposes stop in the menu', async () => {
    const user = userEvent.setup()
    const onStopAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{ connected: 1, available: 1, busy: 1, workers: [{ id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', available: true, busy: true }] }}
        analysisAvailable
        analysisState="running"
        analysisProgress={{ analyzed: 11, total: 133 }}
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={onStopAnalysis}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const sidebar = within(container)
    const action = sidebar.getByRole('button', { name: '打开分析菜单' })
    expect(action).not.toBeDisabled()
    expect(action).not.toHaveTextContent('Stop analysis')
    expect(sidebar.getAllByText('11/133')).toHaveLength(2)
    await user.click(action)
    const menu = screen.getByRole('menu', { name: '分析' })
    expect(within(menu).getByLabelText('分析器')).toBeDisabled()
    await user.click(within(menu).getByRole('menuitem', { name: '停止分析' }))
    expect(onStopAnalysis).toHaveBeenCalledTimes(1)
  })

  it('offers re-analysis for completed games with a selected worker', async () => {
    const user = userEvent.setup()
    const onRestartAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        games={[]}
        listOpen={false}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{ connected: 1, available: 1, busy: 0, workers: [{ id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', available: true, busy: false }] }}
        analysisAvailable
        analysisState="complete"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={onRestartAnalysis}
      />,
    )

    const sidebar = within(container)
    const action = sidebar.getByRole('button', { name: '打开分析菜单' })
    expect(action).not.toBeDisabled()
    expect(action).not.toHaveTextContent('Again')
    expect(sidebar.getAllByText('析')).toHaveLength(2)
    await user.click(action)
    await user.click(within(screen.getByRole('menu', { name: '分析' })).getByRole('menuitem', { name: '重新分析' }))
    expect(onRestartAnalysis).toHaveBeenCalledTimes(1)
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
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const remove = screen.getByLabelText('Delete Demo')
    expect(remove).toHaveClass('game-row-action', 'danger')
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
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const row = container.querySelector('.game-row')
    expect(row).toHaveClass('yuanluobo-record-row')
    expect(row).not.toHaveAttribute('data-outcome')
    expect(row).toHaveAttribute('data-winner', 'black')
    expect(row?.querySelector('.yuanluobo-record-main')).toBeInTheDocument()
    expect(row?.querySelector('.yuanluobo-record-title')).toHaveTextContent('LeevsCho')
    expect(row?.querySelector('.yuanluobo-vs')).toHaveTextContent('vs')
    expect(row?.querySelectorAll('.yuanluobo-stone')).toHaveLength(2)
    expect(row?.querySelector('.local-game-result-marker')).toHaveAttribute('data-winner', 'black')
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
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    expect(container.querySelector('.yuanluobo-result-watermark')).not.toBeInTheDocument()
    expect(container.querySelector('.game-row')).not.toHaveAttribute('data-outcome')
    expect(container.querySelector('.game-row')).toHaveAttribute('data-winner', 'white')
  })

  it('places the local result marker before the winning player name', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'Lee vs Cho',
          result: 'W+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
          blackName: 'Lee',
          whiteName: 'Cho',
        }]}
        listOpen
        selectedGameId="1"
        analysisAvailable
        analysisState="idle"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const row = container.querySelector('.game-row')
    const players = row?.querySelectorAll('.yuanluobo-player-name')
    expect(row).not.toHaveAttribute('data-outcome')
    expect(row).toHaveAttribute('data-winner', 'white')
    expect(players?.[0].querySelector('.local-game-result-marker')).not.toBeInTheDocument()
    expect(players?.[1].querySelector('.local-game-result-marker')).toHaveAttribute('data-winner', 'white')
  })

  it('keeps analysis status in the metadata row so names keep the full title line', () => {
    const { container } = render(
      <GameSidebar
        games={[{
          gameId: '1',
          displayName: 'AlphaGo Zero vs FineArt Master',
          result: 'B+R',
          sgfFilename: '1.sgf',
          createdAt: '2026-06-25T13:45:00Z',
          gameDate: '2026-06-24',
          blackName: 'AlphaGo Zero',
          whiteName: 'FineArt Master',
          analysisStatus: 'complete',
        }]}
        listOpen
        selectedGameId="1"
        analysisAvailable
        analysisState="idle"
        onToggleList={vi.fn()}
        onImport={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    const row = container.querySelector('.game-row')
    const main = row?.querySelector('.yuanluobo-record-main')
    const meta = row?.querySelector('.yuanluobo-record-meta')
    expect(main).toHaveTextContent('AlphaGo ZerovsFineArt Master')
    expect(main).not.toHaveTextContent('已分析')
    expect(meta).toHaveTextContent('2026-06-24黑中盘胜已分析')
    expect(meta?.querySelector('.game-analysis-badge')).toHaveTextContent('已分析')
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
