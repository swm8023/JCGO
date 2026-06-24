import type { AnalysisResult } from '../api/types'

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
}

export function AnalysisPanel({ engineStatus, analysis, analysisState, onStart, onStop, onRestart }: AnalysisPanelProps) {
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
    <section className="analysis-panel rail-section">
      <h2>当前局面</h2>
      {!engineStatus.available && <div className="engine-error">Engine unavailable: {engineStatus.error}</div>}
      <div className="analysis-summary">
        <strong>{analysis ? `${(analysis.winrate * 100).toFixed(1)}%` : '-'}</strong>
        <strong>{analysis ? formatScore(analysis.scoreLead) : '-'}</strong>
        <span>{analysis?.visits ?? 0} visits</span>
        {action}
      </div>
    </section>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B +${scoreLead.toFixed(1)}` : `W +${Math.abs(scoreLead).toFixed(1)}`
}
