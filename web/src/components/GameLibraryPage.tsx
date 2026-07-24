import { useState } from 'react'
import type { AnalysisState, GameRecord, WorkerStatus } from '../api/types'
import { ChartNoAxesCombined, Trash2 } from 'lucide-react'
import { AppSheet } from './AppSheet'
import { formatGameResult } from './gameResult'

type StartGameAnalysisInput = {
  gameId: string
  workerName: string
}

interface GameLibraryPageProps {
  games: GameRecord[]
  selectedGameId?: string
  workerStatus?: WorkerStatus
  onSelect(gameId: string): void
  onDelete(gameId: string): void
  onStartAnalysis?(input: StartGameAnalysisInput): Promise<void>
}

export function GameLibraryPage({ games, selectedGameId, workerStatus, onSelect, onDelete, onStartAnalysis }: GameLibraryPageProps) {
  const [pendingDelete, setPendingDelete] = useState<GameRecord>()
  const [pendingAnalysis, setPendingAnalysis] = useState<GameRecord>()
  const [analysisWorkerName, setAnalysisWorkerName] = useState('')
  const [startingAnalysis, setStartingAnalysis] = useState(false)
  const [analysisError, setAnalysisError] = useState<string>()
  const workers = workerStatus?.workers ?? []
  const selectedWorker = workers.find((worker) => worker.name === analysisWorkerName)
  const workerReady = Boolean(selectedWorker?.available && !selectedWorker.error)

  const openQuickAnalysis = (game: GameRecord) => {
    setPendingAnalysis(game)
    setAnalysisWorkerName('')
    setAnalysisError(undefined)
  }

  const startQuickAnalysis = async () => {
    if (!pendingAnalysis || !workerReady || !onStartAnalysis) return
    setStartingAnalysis(true)
    setAnalysisError(undefined)
    try {
      await onStartAnalysis({ gameId: pendingAnalysis.gameId, workerName: analysisWorkerName })
      setPendingAnalysis(undefined)
      setAnalysisWorkerName('')
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : '启动分析失败')
    } finally {
      setStartingAnalysis(false)
    }
  }

  return (
    <>
      <section className="app-page-body game-library-page" role="region" aria-label="本地棋局内容">
        <div className="game-list-shell">
          <header className="game-list-header">
            <div>
              <p className="game-list-eyebrow">本地棋谱</p>
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
                    <span className={analysisBadgeClass(game.analysisStatus)}>{analysisStatusLabel(game.analysisStatus)}</span>
                  </span>
                </button>
                <span className="game-row-actions">
                  <button
                    className="game-row-action"
                    aria-label={`快速分析 ${game.displayName}`}
                    onClick={() => openQuickAnalysis(game)}
                    disabled={!onStartAnalysis}
                  >
                    <ChartNoAxesCombined size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="game-row-action danger"
                    aria-label={`删除 ${game.displayName}`}
                    onClick={() => setPendingDelete(game)}
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
      {pendingDelete && (
        <AppSheet
          title="删除棋局"
          onDismiss={() => setPendingDelete(undefined)}
          actions={(
            <>
              <button className="app-sheet-button" type="button" onClick={() => setPendingDelete(undefined)}>取消</button>
              <button
                className="app-sheet-button danger"
                type="button"
                onClick={() => {
                  onDelete(pendingDelete.gameId)
                  setPendingDelete(undefined)
                }}
              >
                删除
              </button>
            </>
          )}
        >
          <p className="app-sheet-message">删除“{pendingDelete.displayName}”？此操作无法撤销。</p>
        </AppSheet>
      )}
      {pendingAnalysis && (
        <AppSheet
          title="快速分析"
          onDismiss={() => {
            if (startingAnalysis) return
            setPendingAnalysis(undefined)
            setAnalysisWorkerName('')
            setAnalysisError(undefined)
          }}
          actions={(
            <>
              <button className="app-sheet-button" type="button" onClick={() => setPendingAnalysis(undefined)} disabled={startingAnalysis}>取消</button>
              <button className="app-sheet-button primary" type="button" onClick={() => void startQuickAnalysis()} disabled={startingAnalysis || !workerReady}>
                {startingAnalysis ? '启动中...' : '开始分析'}
              </button>
            </>
          )}
        >
          <p className="app-sheet-message">为“{pendingAnalysis.displayName}”选择分析 Worker。</p>
          <label className="app-sheet-field">
            <span>分析器</span>
            <select value={analysisWorkerName} onChange={(event) => setAnalysisWorkerName(event.target.value)} disabled={startingAnalysis}>
              <option value="">请选择分析器</option>
              {workers.map((worker) => {
                const available = worker.available && !worker.error
                const workerName = worker.name || worker.id
                return <option key={worker.id} value={worker.name} disabled={!available}>{workerName}{available ? '' : '（不可用）'}</option>
              })}
            </select>
          </label>
          {analysisError && <p className="import-error">{analysisError}</p>}
        </AppSheet>
      )}
    </>
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
  if (fallbackBlackName && fallbackWhiteName) return { kind: 'matchup', blackName: fallbackBlackName, whiteName: fallbackWhiteName }

  return { kind: 'plain', displayName: game.displayName }
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
