import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnalysisProgress, AnalysisSchedule, AnalysisScheduleTask, AnalysisState, AnalysisWorkerLane, GameRecord, WorkerStatus } from '../api/types'
import { Menu, Plus, Settings, Trash2 } from 'lucide-react'
import { formatGameResult } from './gameResult'

interface GameSidebarProps {
  games: GameRecord[]
  listOpen: boolean
  selectedGameId?: string
  selectedAnalysisWorkerName?: string
  workerStatus?: WorkerStatus
  analysisSchedule?: AnalysisSchedule
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
  analysisProgress?: AnalysisProgress
  onToggleList(): void
  onImport(): void
  onSettings?(): void
  onSelect(gameId: string): void
  onDelete(gameId: string): void
  onStartAnalysis(): void
  onStopAnalysis(): void
  onRestartAnalysis(): void
  onBoostAnalysis?(gameId: string): Promise<void>
  onSetAnalysisWorker?(workerName: string): Promise<void>
  toolbarSlot?: ReactNode
}

export function GameSidebar({
  games,
  listOpen,
  selectedGameId,
  selectedAnalysisWorkerName,
  workerStatus,
  analysisSchedule,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onToggleList,
  onImport,
  onSettings = noop,
  onSelect,
  onDelete,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
  onBoostAnalysis,
  onSetAnalysisWorker,
  toolbarSlot,
}: GameSidebarProps) {
  return (
    <aside className={listOpen ? 'game-sidebar expanded' : 'game-sidebar'}>
      <div className="sidebar-header">
        <h1>JCGO</h1>
        <div className="sidebar-actions sidebar-file-actions">
          <button className="icon-button" onClick={onToggleList} aria-label="Show game list" aria-pressed={listOpen}>
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
          onStartAnalysis={onStartAnalysis}
          onStopAnalysis={onStopAnalysis}
          onRestartAnalysis={onRestartAnalysis}
          onBoostAnalysis={onBoostAnalysis}
        />
      </div>
      <section className="game-list" role="region" aria-label="本地棋局列表" aria-hidden={!listOpen}>
        <div className="game-list-shell">
          <header className="game-list-header">
            <div>
              <p className="game-list-eyebrow">Local games</p>
              <h2>本地棋局</h2>
            </div>
            <span className="game-list-count">共 {games.length} 局</span>
          </header>
          <div className="game-list-body yuanluobo-record-list">
            {games.length === 0 ? (
              <p className="game-list-empty">还没有本地棋局</p>
            ) : games.map((game) => {
              const selected = game.gameId === selectedGameId
              const winner = localGameWinner(game.result)
              const dateLabel = formatDateLabel(game.gameDate || game.createdAt)
              const title = localGameTitle(game)
              return (
                <div
                  className={selected ? 'game-row yuanluobo-record-row selected' : 'game-row yuanluobo-record-row'}
                  data-winner={winner}
                  key={game.gameId}
                >
                  <button className="game-row-open" onClick={() => onSelect(game.gameId)}>
                    <span className="yuanluobo-record-main">
                      <span className="yuanluobo-record-title">
                        {title.kind === 'matchup' ? (
                          <>
                            <span className="yuanluobo-player-name" title={title.blackName}>
                              {localGameResultMarker(winner, 'black')}
                              <span className="yuanluobo-stone black" aria-hidden="true" />
                              <span className="yuanluobo-player-label">{title.blackName}</span>
                            </span>
                            <span className="yuanluobo-vs">vs</span>
                            <span className="yuanluobo-player-name" title={title.whiteName}>
                              {localGameResultMarker(winner, 'white')}
                              <span className="yuanluobo-stone white" aria-hidden="true" />
                              <span className="yuanluobo-player-label">{title.whiteName}</span>
                            </span>
                          </>
                        ) : (
                          <span className="game-title-name" title={title.displayName}>
                            {localGameResultMarker(winner)}
                            <span className="local-game-title-label">{title.displayName}</span>
                          </span>
                        )}
                      </span>
                      {selected && <span className="yuanluobo-imported-badge">当前</span>}
                    </span>
                    <span className="yuanluobo-record-meta">
                      <span>{dateLabel}</span>
                      <span className="yuanluobo-meta-sep" aria-hidden="true" />
                      <span>{formatGameResult(game.result)}</span>
                      <span className="yuanluobo-meta-sep" aria-hidden="true" />
                      <span className={analysisBadgeClass(game.analysisStatus)}>
                        {analysisStatusLabel(game.analysisStatus)}
                      </span>
                    </span>
                  </button>
                  <span className="game-row-actions">
                    <button
                      className="game-row-action danger"
                      aria-label={`Delete ${game.displayName}`}
                      onClick={() => {
                        if (window.confirm(`Delete ${game.displayName}?`)) onDelete(game.gameId)
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </section>
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
  onStartAnalysis(): void
  onStopAnalysis(): void
  onRestartAnalysis(): void
  onBoostAnalysis?(gameId: string): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const running = analysisState === 'running'
  const workers = workerStatus?.workers ?? []
  const selectedWorker = workers.find((worker) => worker.name === selectedWorkerName)
  const workerReady = Boolean(selectedWorkerName && selectedWorker?.available && !selectedWorker.error)
  const baseActionDisabled = !selectedGameId || !workerReady || (!analysisAvailable && !running)
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

  const setWorker = async (workerName: string) => {
    if (!workerName || !onSetAnalysisWorker || running || workerName === selectedWorkerName) return
    await onSetAnalysisWorker(workerName)
  }

  const triggerText = running ? progressCompact : '析'

  return (
    <div className="analysis-menu-root" ref={menuRef}>
      <button
        className={running ? 'analysis-action-button analysis-action-wide' : 'analysis-action-button'}
        aria-label="打开分析菜单"
        aria-expanded={open}
        title={progressTitle}
        onClick={() => setOpen((value) => !value)}
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
              value={selectedWorkerName || ''}
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
          {selectedWorkerName && (
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
          {!selectedWorkerName && <small className="engine-error">请选择分析器</small>}
          {selectedWorkerName && !workerReady && <small className="engine-error">{selectedWorker?.error || '分析器不可用'}</small>}
          {analysisError && <small className="engine-error">{analysisError}</small>}
          <AnalysisLaneList
            schedule={analysisSchedule}
            workerStatus={workerStatus}
            onBoostAnalysis={onBoostAnalysis}
          />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onStartAnalysis()
            }}
            disabled={baseActionDisabled || running || analysisState === 'complete'}
          >
            继续分析
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onRestartAnalysis()
            }}
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

function localGameResultMarker(winner: LocalGameWinner, player?: 'black' | 'white') {
  if (player && winner !== player) return null
  if (winner !== 'black' && winner !== 'white' && winner !== 'draw') return null
  return <span className="local-game-result-marker" data-winner={winner} aria-hidden="true" />
}

type LocalGameTitle =
  | { kind: 'matchup'; blackName: string; whiteName: string }
  | { kind: 'plain'; displayName: string }

function localGameTitle(game: GameRecord): LocalGameTitle {
  const blackName = game.blackName?.trim()
  const whiteName = game.whiteName?.trim()
  if (blackName && whiteName) return { kind: 'matchup', blackName, whiteName }

  const matchup = /^\s*(.*?)\s+vs\s+(.*?)\s*$/i.exec(game.displayName)
  const fallbackBlackName = matchup?.[1]?.trim()
  const fallbackWhiteName = matchup?.[2]?.trim()
  if (fallbackBlackName && fallbackWhiteName) {
    return { kind: 'matchup', blackName: fallbackBlackName, whiteName: fallbackWhiteName }
  }

  return { kind: 'plain', displayName: game.displayName }
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

function formatDateLabel(value: string) {
  if (!value) return '-'
  const timeIndex = value.indexOf('T')
  return timeIndex > 0 ? value.slice(0, timeIndex) : value
}

function analysisBadgeClass(status?: AnalysisState) {
  return status === 'complete' ? 'game-analysis-badge complete' : 'game-analysis-badge'
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

type LocalGameWinner = 'black' | 'white' | 'draw' | 'unknown'

function localGameWinner(result: string): LocalGameWinner {
  const normalized = result.trim().toUpperCase()
  const formatted = formatGameResult(result)
  if (normalized.startsWith('B+') || formatted.startsWith('黑')) return 'black'
  if (normalized.startsWith('W+') || formatted.startsWith('白')) return 'white'
  if (normalized === 'DRAW' || normalized === 'JIGO' || formatted.includes('和')) return 'draw'
  return 'unknown'
}
