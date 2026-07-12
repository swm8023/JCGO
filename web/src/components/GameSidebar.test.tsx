import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GameSidebar } from './GameSidebar'

describe('GameSidebar', () => {
  it('replaces home controls with one contextual page title and back action', () => {
    const onBack = vi.fn()
    render(
      <GameSidebar
        selectedGameId="game-1"
        contextualTitle="设置"
        onContextBack={onBack}
        analysisAvailable
        analysisState="idle"
        onOpenGameList={vi.fn()}
        onImport={vi.fn()}
        onSettings={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    expect(screen.getByRole('banner', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回设置' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Show game list')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Import SGF')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open settings')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('打开分析菜单')).not.toBeInTheDocument()

    screen.getByRole('button', { name: '返回设置' }).click()
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('exposes separate list, import, and settings actions for the mobile rail', () => {
    const onOpenGameList = vi.fn()
    const onImport = vi.fn()
    const onSettings = vi.fn()
    const { container } = render(
      <GameSidebar
        onOpenGameList={onOpenGameList}
        analysisAvailable
        analysisState="idle"
        onImport={onImport}
        onSettings={onSettings}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
      />,
    )

    expect(container.querySelector('.game-sidebar')).not.toHaveClass('expanded')
    const sidebar = within(container)
    sidebar.getByLabelText('Show game list').click()
    sidebar.getByLabelText('Import SGF').click()
    sidebar.getByLabelText('Open settings').click()
    expect(onOpenGameList).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  it('opens an analysis menu with worker selection and actions', async () => {
    const user = userEvent.setup()
    const onSetAnalysisWorker = vi.fn().mockResolvedValue(undefined)
    const onStartAnalysis = vi.fn()
    const onRestartAnalysis = vi.fn()
    const { container } = render(
      <GameSidebar
        onOpenGameList={vi.fn()}
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
        onImport={vi.fn()}
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

  it('recommends a worker on open and binds it only when analysis starts', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const onRecommendAnalysisWorker = vi.fn().mockResolvedValue('preferred-gpu')
    const onSetAnalysisWorker = vi.fn(async (workerName: string) => {
      calls.push(`bind:${workerName}`)
    })
    const onStartAnalysis = vi.fn(async () => {
      calls.push('start')
    })
    const props = {
      onOpenGameList: vi.fn(),
      selectedGameId: 'game-1',
      workerStatus: {
        connected: 2,
        available: 2,
        busy: 0,
        workers: [
          { id: 'worker-1', name: 'preferred-gpu', platform: 'windows/amd64', available: true, busy: false },
          { id: 'worker-2', name: 'fallback-gpu', platform: 'windows/amd64', available: true, busy: false },
        ],
      },
      analysisAvailable: true,
      analysisState: 'idle' as const,
      onImport: vi.fn(),
      onStartAnalysis,
      onStopAnalysis: vi.fn(),
      onRestartAnalysis: vi.fn(),
      onSetAnalysisWorker,
      onRecommendAnalysisWorker,
    }
    const { container } = render(<GameSidebar {...props} />)

    await user.click(within(container).getByRole('button', { name: '打开分析菜单' }))
    await waitFor(() => expect(onRecommendAnalysisWorker).toHaveBeenCalledTimes(1))
    const menu = screen.getByRole('menu', { name: '分析' })
    expect(within(menu).getByLabelText('分析器')).toHaveValue('preferred-gpu')
    expect(onSetAnalysisWorker).not.toHaveBeenCalled()

    await user.click(within(menu).getByRole('menuitem', { name: '继续分析' }))
    await waitFor(() => expect(calls).toEqual(['bind:preferred-gpu', 'start']))
  })

  it('shows all worker lanes in the analysis menu and boosts queued games', async () => {
    const user = userEvent.setup()
    const onBoostAnalysis = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <GameSidebar
        onOpenGameList={vi.fn()}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{
          connected: 2,
          available: 2,
          busy: 1,
          workers: [
            { id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', maxVisits: 500, available: true, busy: true },
            { id: 'worker-2', name: 'remote-gpu', platform: 'linux/amd64', model: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz', maxVisits: 300, available: true, busy: false },
          ],
        }}
        analysisSchedule={{ lanes: [
          {
            workerName: 'local-gpu',
            current: { id: 'run-1:main:3', kind: 'background', gameId: 'game-1', displayName: 'Lee vs Cho', nodeId: 'main:3', moveNumber: 3, workerName: 'local-gpu', analyzed: 3, total: 180, status: 'running', canBoost: false },
            highPriority: [{ id: 'trial-1', kind: 'trial', gameId: 'game-1', displayName: 'Lee vs Cho', nodeId: 'var:1', moveNumber: 4, workerName: 'local-gpu', analyzed: 0, total: 1, status: 'queued', canBoost: false }],
            queue: [{ id: 'run-2', kind: 'background', gameId: 'game-2', displayName: 'Alpha vs Beta', nodeId: 'main:0', workerName: 'local-gpu', analyzed: 0, total: 120, status: 'queued', canBoost: true }],
          },
          { workerName: 'remote-gpu', highPriority: [], queue: [] },
        ] }}
        analysisAvailable
        analysisState="running"
        analysisProgress={{ analyzed: 3, total: 180 }}
        onImport={vi.fn()}
        onStartAnalysis={vi.fn()}
        onStopAnalysis={vi.fn()}
        onRestartAnalysis={vi.fn()}
        onBoostAnalysis={onBoostAnalysis}
      />,
    )

    const action = within(container).getByRole('button', { name: '打开分析菜单' })
    expect(action).toHaveAttribute('title', '当前棋局 3 / 180')
    await user.click(action)
    const menu = screen.getByRole('menu', { name: '分析' })
    expect(within(menu).getAllByText('local-gpu').length).toBeGreaterThan(0)
    expect(within(menu).getAllByText('remote-gpu').length).toBeGreaterThan(0)
    expect(within(menu).getByText('正在分析')).toBeInTheDocument()
    expect(within(menu).getAllByText('Lee vs Cho').length).toBeGreaterThan(0)
    expect(within(menu).getByText('试下')).toBeInTheDocument()
    expect(within(menu).getByText('Alpha vs Beta')).toBeInTheDocument()
    await user.click(within(menu).getByRole('button', { name: '插队 Alpha vs Beta' }))
    expect(onBoostAnalysis).toHaveBeenCalledWith('game-2')
  })

  it('requires a worker before analysis actions are enabled', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <GameSidebar
        onOpenGameList={vi.fn()}
        selectedGameId="game-1"
        workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
        analysisAvailable
        analysisState="idle"
        onImport={vi.fn()}
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
        onOpenGameList={vi.fn()}
        selectedGameId="game-1"
        analysisAvailable
        analysisState="idle"
        toolbarSlot={<div data-testid="overlay-slot">荐势弱</div>}
        onImport={vi.fn()}
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
        onOpenGameList={vi.fn()}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{ connected: 1, available: 1, busy: 1, workers: [{ id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', available: true, busy: true }] }}
        analysisAvailable
        analysisState="running"
        analysisProgress={{ analyzed: 11, total: 133 }}
        onImport={vi.fn()}
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
        onOpenGameList={vi.fn()}
        selectedGameId="game-1"
        selectedAnalysisWorkerName="local-gpu"
        workerStatus={{ connected: 1, available: 1, busy: 0, workers: [{ id: 'worker-1', name: 'local-gpu', platform: 'windows/amd64', available: true, busy: false }] }}
        analysisAvailable
        analysisState="complete"
        onImport={vi.fn()}
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

})
