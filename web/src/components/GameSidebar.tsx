import type { AnalysisState, GameRecord } from '../api/types'
import type { ReactNode } from 'react'

interface GameSidebarProps {
  games: GameRecord[]
  listOpen: boolean
  selectedGameId?: string
  analysisAvailable: boolean
  analysisError?: string
  analysisState: AnalysisState
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
  onToggleList,
  onImport,
  onSelect,
  onRename,
  onDelete,
  onStartAnalysis,
  onStopAnalysis,
  onRestartAnalysis,
  toolbarSlot,
}: GameSidebarProps) {
  const analysisAction = analysisButton(analysisState, onStartAnalysis, onStopAnalysis, onRestartAnalysis)
  const disabled = !selectedGameId || (!analysisAvailable && analysisState !== 'running')

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
              <span>{game.displayName}</span>
              <small>{game.result || 'Unknown result'}</small>
            </button>
            <button
              className="icon-button"
              aria-label={`Rename ${game.displayName}`}
              onClick={() => {
                const name = window.prompt('Rename game', game.displayName)
                if (name && name.trim()) onRename(game.gameId, name.trim())
              }}
            >
              A
            </button>
            <button
              className="icon-button"
              aria-label={`Delete ${game.displayName}`}
              onClick={() => {
                if (window.confirm(`Delete ${game.displayName}?`)) onDelete(game.gameId)
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

function analysisButton(analysisState: AnalysisState, onStart: () => void, onStop: () => void, onRestart: () => void) {
  if (analysisState === 'running') {
    return { label: 'Stop analysis', text: 'Stop analysis', shortText: 'Stop', onClick: onStop }
  }
  if (analysisState === 'complete') {
    return { label: 'Re-analyze', text: 'Re-analyze', shortText: 'Again', onClick: onRestart }
  }
  return { label: 'Start analysis', text: 'Start analysis', shortText: 'Run', onClick: onStart }
}
