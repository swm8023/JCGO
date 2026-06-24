import type { ChartPoint } from '../api/types'

interface AnalysisChartsProps {
  points: ChartPoint[]
  onJump(moveNumber: number): void
}

export function AnalysisCharts({ points, onJump }: AnalysisChartsProps) {
  const curvePoints = buildCurvePoints(points)
  return (
    <section className="analysis-charts rail-section">
      <h2>胜率曲线</h2>
      <div className="rail-section-body chart-body">
        <svg className="winrate-chart" viewBox="0 0 240 96" role="img" aria-label="Winrate curve">
          <line x1="0" y1="48" x2="240" y2="48" stroke="#d0d7cf" strokeWidth="1" />
          {curvePoints.length > 1 && <polyline points={curvePoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2f5d50" strokeWidth="3" />}
          {curvePoints.map((point) => (
            <circle key={point.moveNumber} cx={point.x} cy={point.y} r="3" fill="#2f5d50" />
          ))}
        </svg>
        <div className="chart-point-list">
          {points.map((point) => (
            <button key={point.moveNumber} onClick={() => onJump(point.moveNumber)}>
              <span>{point.moveNumber}</span>
              <span>{(point.winrate * 100).toFixed(1)}%</span>
              <span>{point.scoreLead.toFixed(1)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function buildCurvePoints(points: ChartPoint[]) {
  if (points.length === 0) return []
  const maxIndex = Math.max(points.length - 1, 1)
  return points.map((point, index) => ({
    moveNumber: point.moveNumber,
    x: (index / maxIndex) * 232 + 4,
    y: 92 - clamp(point.winrate, 0, 1) * 88,
  }))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
