import type { AnalysisResult, CandidateMove } from '../api/types'

interface EngineStatus {
  available: boolean
  error?: string
}

interface AnalysisPanelProps {
  engineStatus: EngineStatus
  analysis?: AnalysisResult
  analysisState: 'idle' | 'running' | 'stopped' | 'complete' | 'unavailable'
  onStart(): void
  onStop(): void
  onRestart(): void
  onCandidateClick(move: string): void
}

export function AnalysisPanel({ engineStatus, analysis, analysisState, onStart, onStop, onRestart, onCandidateClick }: AnalysisPanelProps) {
  const action =
    analysisState === 'running' ? (
      <button onClick={onStop}>Stop analysis</button>
    ) : analysisState === 'complete' ? (
      <button onClick={onRestart}>Re-analyze</button>
    ) : (
      <button onClick={onStart} disabled={!engineStatus.available}>
        Start analysis
      </button>
    )

  return (
    <aside className="analysis-panel">
      {!engineStatus.available && <div className="engine-error">Engine unavailable: {engineStatus.error}</div>}
      <div className="analysis-summary">
        <strong>{analysis ? `${(analysis.winrate * 100).toFixed(1)}%` : '-'}</strong>
        <strong>{analysis ? formatScore(analysis.scoreLead) : '-'}</strong>
        <span>{analysis?.visits ?? 0} visits</span>
        {action}
      </div>
      <div className="candidate-list">
        {(analysis?.candidates ?? []).map((candidate) => (
          <CandidateRow key={candidate.move} candidate={candidate} onClick={() => onCandidateClick(candidate.move)} />
        ))}
      </div>
    </aside>
  )
}

function CandidateRow({ candidate, onClick }: { candidate: CandidateMove; onClick(): void }) {
  return (
    <button className={candidate.lowVisits ? 'candidate-row low-visits' : 'candidate-row'} onClick={onClick}>
      <span>{candidate.move}</span>
      <span>{candidate.visits}</span>
      <span>{(candidate.winrate * 100).toFixed(1)}%</span>
      <span>{formatScore(candidate.scoreLead)}</span>
      <span>{candidate.pointLoss.toFixed(1)}</span>
    </button>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B +${scoreLead.toFixed(1)}` : `W +${Math.abs(scoreLead).toFixed(1)}`
}
