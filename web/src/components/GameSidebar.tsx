import type { AnalysisProgress, AnalysisState, GameRecord } from '../api/types'
import type { ReactNode } from 'react'
import { Menu, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatGameResult } from './gameResult'

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
  const analysisClassName = analysisAction.wide ? 'analysis-action-button analysis-action-wide' : 'analysis-action-button'

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
        </div>
        <div className="sidebar-toggle-actions">{toolbarSlot}</div>
      </div>
      <div className="sidebar-analysis">
        <button className={analysisClassName} aria-label={analysisAction.label} onClick={analysisAction.onClick} disabled={disabled}>
          <span className="wide-label">{analysisAction.text}</span>
          <span className="narrow-label">{analysisAction.shortText}</span>
        </button>
        {!analysisAvailable && analysisError && <small className="engine-error">{analysisError}</small>}
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
                      className="game-row-action"
                      aria-label={`Rename ${game.displayName}`}
                      onClick={() => {
                        const name = window.prompt('Rename game', game.displayName)
                        if (name && name.trim()) onRename(game.gameId, name.trim())
                      }}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
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

function analysisButton(analysisState: AnalysisState, progress: AnalysisProgress | undefined, onStart: () => void) {
  if (analysisState === 'running') {
    const text = formatAnalysisProgress(progress)
    return { label: `Analysis progress ${text}`, text, shortText: text, onClick: noop, disabled: true, wide: true }
  }
  if (analysisState === 'complete') {
    return { label: 'Analysis complete', text: '析', shortText: '析', onClick: noop, disabled: true, wide: false }
  }
  return { label: 'Start analysis', text: '析', shortText: '析', onClick: onStart, disabled: false, wide: false }
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
