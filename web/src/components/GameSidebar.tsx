import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnalysisProgress, AnalysisSchedule, AnalysisScheduleTask, AnalysisState, AnalysisWorkerLane, WorkerStatus } from '../api/types'
import { ArrowLeft, Menu, Plus, Settings } from 'lucide-react'

interface GameSidebarProps {
  contextualTitle?: string
  onContextBack?(): void
  contextActions?: ReactNode
  onOpenGameList(): void
  selectedGameId?: string
  selectedAnalysisWorkerName?: string
  workerStatus?: WorkerStatus
  analysisSchedule?: AnalysisSchedule
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
  analysisProgress?: AnalysisProgress
  onImport(): void
  onSettings?(): void
  onStartAnalysis(): void | Promise<void>
  onStopAnalysis(): void
  onRestartAnalysis(): void | Promise<void>
  onBoostAnalysis?(gameId: string): Promise<void>
  onSetAnalysisWorker?(workerName: string): Promise<void>
  onRecommendAnalysisWorker?(): Promise<string | undefined>
  toolbarSlot?: ReactNode
}

export function GameSidebar({
  contextualTitle,
  onContextBack = noop,
  contextActions,
  onOpenGameList,
  selectedGameId,
  selectedAnalysisWorkerName,
  workerStatus,
  analysisSchedule,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onImport,
  onSettings = noop,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
  onBoostAnalysis,
  onSetAnalysisWorker,
  onRecommendAnalysisWorker,
  toolbarSlot,
}: GameSidebarProps) {
  return (
    <aside className={contextualTitle ? 'game-sidebar contextual' : 'game-sidebar'}>
      {contextualTitle ? (
        <header className="sidebar-header contextual-titlebar" role="banner" aria-label={contextualTitle}>
          <button className="icon-button contextual-back-button" type="button" onClick={onContextBack} aria-label={`返回${contextualTitle}`}>
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <h1>{contextualTitle}</h1>
          <div className="sidebar-context-actions">{contextActions}</div>
        </header>
      ) : (
        <>
          <div className="sidebar-header">
        <h1>JCGO</h1>
        <div className="sidebar-actions sidebar-file-actions">
          <button className="icon-button" onClick={onOpenGameList} aria-label="Show game list">
            <Menu size={17} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={onImport} aria-label="Import SGF">
            <Plus size={18} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={onSettings} aria-label="Open settings">
            <Settings size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar-toggle-actions">{toolbarSlot}</div>
      </div>
      <div className="sidebar-analysis">
        <AnalysisMenu
          selectedGameId={selectedGameId}
          selectedWorkerName={selectedAnalysisWorkerName}
          workerStatus={workerStatus}
          analysisSchedule={analysisSchedule}
          analysisAvailable={analysisAvailable}
          analysisError={analysisError}
          analysisState={analysisState}
          analysisProgress={analysisProgress}
          onSetAnalysisWorker={onSetAnalysisWorker}
          onRecommendAnalysisWorker={onRecommendAnalysisWorker}
          onStartAnalysis={onStartAnalysis}
          onStopAnalysis={onStopAnalysis}
          onRestartAnalysis={onRestartAnalysis}
          onBoostAnalysis={onBoostAnalysis}
        />
      </div>
      </>
      )}
    </aside>
  )
}
function AnalysisMenu({
  selectedGameId,
  selectedWorkerName,
  workerStatus,
  analysisSchedule,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onSetAnalysisWorker,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
  onBoostAnalysis,
  onRecommendAnalysisWorker,
}: {
  selectedGameId?: string
  selectedWorkerName?: string
  workerStatus?: WorkerStatus
  analysisSchedule?: AnalysisSchedule
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
  analysisProgress?: AnalysisProgress
  onSetAnalysisWorker?(workerName: string): Promise<void>
  onStartAnalysis(): void | Promise<void>
  onStopAnalysis(): void
  onRestartAnalysis(): void | Promise<void>
  onBoostAnalysis?(gameId: string): Promise<void>
  onRecommendAnalysisWorker?(): Promise<string | undefined>
}) {
  const [open, setOpen] = useState(false)
  const [recommendedWorkerName, setRecommendedWorkerName] = useState<string>()
  const [recommending, setRecommending] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const running = analysisState === 'running'
  const workers = workerStatus?.workers ?? []
  const activeWorkerName = selectedWorkerName || recommendedWorkerName
  const selectedWorker = workers.find((worker) => worker.name === activeWorkerName)
  const workerReady = Boolean(activeWorkerName && selectedWorker?.available && !selectedWorker.error)
  const baseActionDisabled = !selectedGameId || !workerReady || recommending || (!selectedWorkerName && !onSetAnalysisWorker) || (!analysisAvailable && !running)
  const progressCompact = formatAnalysisProgress(analysisProgress)
  const progressSpaced = formatAnalysisProgressSpaced(analysisProgress)
  const progressTitle = progressSpaced === '0 / 0' ? '当前棋局未分析' : `当前棋局 ${progressSpaced}`
  const modelLabel = selectedWorker?.model || '-'
  const visitsLabel = selectedWorker?.maxVisits ? String(selectedWorker.maxVisits) : '-'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    setRecommendedWorkerName(undefined)
  }, [selectedGameId, selectedWorkerName])

  const setWorker = async (workerName: string) => {
    if (!workerName || !onSetAnalysisWorker || running || workerName === selectedWorkerName) return
    await onSetAnalysisWorker(workerName)
  }

  const openMenu = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (running || selectedWorkerName || !onRecommendAnalysisWorker) return
    setRecommending(true)
    void onRecommendAnalysisWorker()
      .then((workerName) => setRecommendedWorkerName(workerName))
      .finally(() => setRecommending(false))
  }

  const startWithActiveWorker = async (action: () => void | Promise<void>) => {
    if (!activeWorkerName) return
    if (!selectedWorkerName) {
      if (!onSetAnalysisWorker) return
      await onSetAnalysisWorker(activeWorkerName)
    }
    setOpen(false)
    await action()
  }

  const triggerText = running ? progressCompact : '析'

  return (
    <div className="analysis-menu-root" ref={menuRef}>
      <button
        className={running ? 'analysis-action-button analysis-action-wide' : 'analysis-action-button'}
        aria-label="打开分析菜单"
        aria-expanded={open}
        title={progressTitle}
        onClick={openMenu}
        disabled={!selectedGameId}
      >
        <span className="wide-label">{triggerText}</span>
        <span className="narrow-label">{triggerText}</span>
      </button>
      {open && (
        <div className="analysis-menu" role="menu" aria-label="分析">
          <label className="analysis-worker-select">
            <span>分析器</span>
            <select
              value={activeWorkerName || ''}
              disabled={running || !onSetAnalysisWorker}
              onChange={(event) => void setWorker(event.target.value)}
            >
              <option value="">请选择分析器</option>
              {workers.map((worker) => (
                <option key={worker.name || worker.id} value={worker.name}>
                  {worker.name || worker.id}
                </option>
              ))}
            </select>
          </label>
          <div className="analysis-menu-status">
            <strong>{analysisStatusLabel(analysisState)}</strong>
            <span>{progressSpaced}</span>
          </div>
          {activeWorkerName && (
            <dl className="analysis-menu-params" aria-label="分析参数">
              <div>
                <dt>模型</dt>
                <dd title={modelLabel}>{modelLabel}</dd>
              </div>
              <div>
                <dt>Visits</dt>
                <dd>{visitsLabel}</dd>
              </div>
            </dl>
          )}
          {!activeWorkerName && <small className="engine-error">请选择分析器</small>}
          {activeWorkerName && !workerReady && <small className="engine-error">{selectedWorker?.error || '分析器不可用'}</small>}
          {analysisError && <small className="engine-error">{analysisError}</small>}
          <AnalysisLaneList
            schedule={analysisSchedule}
            workerStatus={workerStatus}
            onBoostAnalysis={onBoostAnalysis}
          />
          <button
            type="button"
            role="menuitem"
            onClick={() => void startWithActiveWorker(onStartAnalysis)}
            disabled={baseActionDisabled || running || analysisState === 'complete'}
          >
            继续分析
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void startWithActiveWorker(onRestartAnalysis)}
            disabled={baseActionDisabled || running}
          >
            重新分析
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onStopAnalysis()
            }}
            disabled={!running}
          >
            停止分析
          </button>
        </div>
      )}
    </div>
  )
}

function AnalysisLaneList({
  schedule,
  workerStatus,
  onBoostAnalysis,
}: {
  schedule?: AnalysisSchedule
  workerStatus?: WorkerStatus
  onBoostAnalysis?(gameId: string): Promise<void>
}) {
  const lanes = schedule?.lanes ?? []
  const workers = workerStatus?.workers ?? []
  const knownNames = new Set(lanes.map((lane) => lane.workerName))
  const merged: AnalysisWorkerLane[] = [
    ...lanes,
    ...workers.flatMap((worker) => knownNames.has(worker.name) ? [] : [{ workerName: worker.name, current: undefined, highPriority: [], queue: [] }]),
  ]
  if (merged.length === 0) return <p className="analysis-lane-empty">暂无 Worker 队列</p>
  return (
    <section className="analysis-lanes" aria-label="Worker 分析队列">
      {merged.map((lane) => {
        const worker = workers.find((item) => item.name === lane.workerName)
        return (
          <article className="analysis-lane" key={lane.workerName}>
            <header className="analysis-lane-header">
              <strong>{lane.workerName}</strong>
              <span title={worker?.model || undefined}>{compactWorkerModel(worker?.model)}</span>
              <span>{worker?.maxVisits ? `${worker.maxVisits} visits` : '-'}</span>
            </header>
            {lane.current ? (
              <AnalysisTaskRow label="正在分析" task={lane.current} />
            ) : (
              <small className="analysis-lane-idle">空闲</small>
            )}
            {lane.highPriority.map((task) => (
              <AnalysisTaskRow key={task.id} label="试下" task={task} />
            ))}
            {lane.queue.map((task) => (
              <AnalysisTaskRow key={task.id} label="排队" task={task} onBoostAnalysis={task.canBoost ? onBoostAnalysis : undefined} />
            ))}
          </article>
        )
      })}
    </section>
  )
}

function AnalysisTaskRow({
  label,
  task,
  onBoostAnalysis,
}: {
  label: string
  task: AnalysisScheduleTask
  onBoostAnalysis?(gameId: string): Promise<void>
}) {
  return (
    <div className="analysis-task-row">
      <span className="analysis-task-kind">{label}</span>
      <span className="analysis-task-main">
        <strong title={task.displayName}>{task.displayName}</strong>
        <small>{taskProgress(task)}</small>
      </span>
      {onBoostAnalysis && (
        <button type="button" onClick={() => void onBoostAnalysis(task.gameId)} aria-label={`插队 ${task.displayName}`}>
          插队
        </button>
      )}
    </div>
  )
}

function taskProgress(task: AnalysisScheduleTask) {
  if (task.kind === 'trial') return task.nodeId || '试下'
  return `${task.analyzed} / ${task.total}`
}

function compactWorkerModel(model?: string) {
  if (!model) return '-'
  const match = /kata1-(b\d+c\d+)/i.exec(model)
  return match?.[1] ?? model
}

function formatAnalysisProgress(progress?: AnalysisProgress) {
  if (!progress) return '0/0'
  return `${progress.analyzed}/${progress.total}`
}

function formatAnalysisProgressSpaced(progress?: AnalysisProgress) {
  if (!progress) return '0 / 0'
  return `${progress.analyzed} / ${progress.total}`
}

function noop() {
  return undefined
}

function analysisStatusLabel(status?: AnalysisState) {
  switch (status) {
    case 'running':
      return '分析中'
    case 'stopped':
      return '已停止'
    case 'complete':
      return '已分析'
    case 'unavailable':
      return '不可用'
    default:
      return '未分析'
  }
}
