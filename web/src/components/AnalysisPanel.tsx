import type { AnalysisResult } from '../api/types'

interface AnalysisPanelProps {
  analysis?: AnalysisResult
}

export function AnalysisPanel({ analysis }: AnalysisPanelProps) {
  return (
    <div className="analysis-summary" aria-label="当前局面">
      <span className="summary-metric">
        黑胜率{' '}
        <strong>{analysis ? `${(analysis.winrate * 100).toFixed(1)}%` : '-'}</strong>
      </span>
      <span className="summary-metric">
        目差{' '}
        <strong>{analysis ? formatScore(analysis.scoreLead) : '-'}</strong>
      </span>
      <span className="summary-metric">
        访问{' '}
        <strong>{analysis ? `${analysis.visits}v` : '0v'}</strong>
      </span>
    </div>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B+${scoreLead.toFixed(1)}` : `W+${Math.abs(scoreLead).toFixed(1)}`
}
