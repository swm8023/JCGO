import type { AnalysisProgress, AnalysisState, GameRecord } from '../api/types'
import type { ReactNode } from 'react'

interface GameSidebarProps {
  games: GameRecord[]
  listOpen: boolean
  selectedGameId?: string
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
  analysisProgress?: AnalysisProgress
  onToggleList(): void
  onImport(): void
  onSelect(gameId: string): void
  onRename(gameId: string, displayName: string): void
  onDelete(gameId: string): void
  onStartAnalysis(): void
  onStopAnalysis(): void
  onRestartAnalysis(): void
  toolbarSlot?: ReactNode
}

export function GameSidebar({
  games,
  listOpen,
  selectedGameId,
  analysisAvailable,
  analysisError,
  analysisState,
  analysisProgress,
  onToggleList,
  onImport,
  onSelect,
  onRename,
  onDelete,
  onStartAnalysis,
  toolbarSlot,
}: GameSidebarProps) {
  const analysisAction = analysisButton(analysisState, analysisProgress, onStartAnalysis)
  const disabled = !selectedGameId || analysisAction.disabled || (!analysisAvailable && analysisState !== 'running')

  return (
    <aside className={listOpen ? 'game-sidebar expanded' : 'game-sidebar'}>
      <div className="sidebar-header">
        <h1>JCGO</h1>
        <div className="sidebar-actions">
          <button className="icon-button" onClick={onToggleList} aria-label="Show game list">
            ☰
          </button>
          <button className="icon-button" onClick={onImport} aria-label="Import SGF">
            +
          </button>
        </div>
        {toolbarSlot}
      </div>
      <div className="sidebar-analysis">
        <button className="analysis-action-button" aria-label={analysisAction.label} onClick={analysisAction.onClick} disabled={disabled}>
          <span className="wide-label">{analysisAction.text}</span>
          <span className="narrow-label">{analysisAction.shortText}</span>
        </button>
        {!analysisAvailable && analysisError && <small className="engine-error">{analysisError}</small>}
      </div>
      <div className="game-list">
        {games.map((game) => (
          <div className={game.gameId === selectedGameId ? 'game-row selected' : 'game-row'} key={game.gameId}>
            <button className="game-title" onClick={() => onSelect(game.gameId)}>
              <span className="game-title-name">{game.displayName}</span>
              <span className="game-title-meta">
                <small>{game.result || 'Unknown result'}</small>
                {game.gameDate && <small>{`棋局 ${formatDateLabel(game.gameDate)}`}</small>}
                <small>{`上传 ${formatDateLabel(game.createdAt)}`}</small>
                <small className={game.analysisStatus === 'complete' ? 'game-analysis-badge complete' : 'game-analysis-badge'}>
                  {analysisStatusLabel(game.analysisStatus)}
                </small>
              </span>
            </button>
            <button
              className="game-row-action"
              aria-label={`Rename ${game.displayName}`}
              onClick={() => {
                const name = window.prompt('Rename game', game.displayName)
                if (name && name.trim()) onRename(game.gameId, name.trim())
              }}
            >
              <span aria-hidden="true">✎</span>
            </button>
            <button
              className="game-row-action danger"
              aria-label={`Delete ${game.displayName}`}
              onClick={() => {
                if (window.confirm(`Delete ${game.displayName}?`)) onDelete(game.gameId)
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

function analysisButton(analysisState: AnalysisState, progress: AnalysisProgress | undefined, onStart: () => void) {
  if (analysisState === 'running') {
    const text = formatAnalysisProgress(progress)
    return { label: `Analysis progress ${text}`, text, shortText: text, onClick: noop, disabled: true }
  }
  if (analysisState === 'complete') {
    return { label: 'Analysis complete', text: '析', shortText: '析', onClick: noop, disabled: true }
  }
  return { label: 'Start analysis', text: '析', shortText: '析', onClick: onStart, disabled: false }
}

function formatAnalysisProgress(progress?: AnalysisProgress) {
  if (!progress) return '0/0'
  return `${progress.analyzed}/${progress.total}`
}

function noop() {
  return undefined
}

function formatDateLabel(value: string) {
  if (!value) return '-'
  const timeIndex = value.indexOf('T')
  return timeIndex > 0 ? value.slice(0, timeIndex) : value
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
