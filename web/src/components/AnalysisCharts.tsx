import type { ChartPoint } from '../api/types'

interface AnalysisChartsProps {
  points: ChartPoint[]
  onJump(moveNumber: number): void
}

export function AnalysisCharts({ points, onJump }: AnalysisChartsProps) {
  return (
    <section className="analysis-charts">
      {points.map((point) => (
        <button key={point.moveNumber} onClick={() => onJump(point.moveNumber)}>
          <span>{point.moveNumber}</span>
          <span>{(point.winrate * 100).toFixed(1)}%</span>
          <span>{point.scoreLead.toFixed(1)}</span>
        </button>
      ))}
    </section>
  )
}
