import type { ChartPoint } from '../api/types'

interface AnalysisChartsProps {
  points: ChartPoint[]
  currentMoveNumber?: number
  onJump(moveNumber: number): void
}

const chart = {
  width: 320,
  height: 150,
  left: 34,
  right: 34,
  top: 12,
  bottom: 28,
}

const plotWidth = chart.width - chart.left - chart.right
const plotHeight = chart.height - chart.top - chart.bottom
const plotBottom = chart.height - chart.bottom
const scoreMidY = chart.top + plotHeight / 2

export function AnalysisCharts({ points, currentMoveNumber, onJump }: AnalysisChartsProps) {
  const geometry = buildChartGeometry(points, currentMoveNumber)
  return (
    <div className="analysis-charts" aria-label="胜率曲线">
      <div className="rail-section-body chart-body">
        <svg className="winrate-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Winrate curve">
          <rect className="chart-plot-bg" x={chart.left} y={chart.top} width={plotWidth} height={plotHeight} />
          <line className="chart-grid-line" x1={chart.left} y1={chart.top} x2={chart.width - chart.right} y2={chart.top} />
          <line className="chart-grid-line chart-zero-line" x1={chart.left} y1={scoreMidY} x2={chart.width - chart.right} y2={scoreMidY} />
          <line className="chart-grid-line" x1={chart.left} y1={plotBottom} x2={chart.width - chart.right} y2={plotBottom} />
          <line className="chart-axis-line" x1={chart.left} y1={chart.top} x2={chart.left} y2={plotBottom} />
          <line className="chart-axis-line" x1={chart.width - chart.right} y1={chart.top} x2={chart.width - chart.right} y2={plotBottom} />

          <text className="chart-axis-label left" x={chart.left - 6} y={chart.top + 4}>
            100%
          </text>
          <text className="chart-axis-label left" x={chart.left - 6} y={scoreMidY + 4}>
            50%
          </text>
          <text className="chart-axis-label left" x={chart.left - 6} y={plotBottom + 4}>
            0%
          </text>
          <text className="chart-axis-label right" x={chart.width - chart.right + 6} y={chart.top + 4}>
            +{geometry.scoreLimit}
          </text>
          <text className="chart-axis-label right" x={chart.width - chart.right + 6} y={scoreMidY + 4}>
            0
          </text>
          <text className="chart-axis-label right" x={chart.width - chart.right + 6} y={plotBottom + 4}>
            -{geometry.scoreLimit}
          </text>

          {geometry.winratePath && <polyline aria-label="Black winrate line" className="chart-line winrate-line" points={geometry.winratePath} />}
          {geometry.scorePath && <polyline aria-label="Score lead line" className="chart-line score-line" points={geometry.scorePath} />}
          {geometry.currentX !== undefined && <line aria-label="Current move marker" className="chart-current-marker" x1={geometry.currentX} y1={chart.top} x2={geometry.currentX} y2={plotBottom} />}
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line className="chart-tick-line" x1={tick.x} y1={plotBottom} x2={tick.x} y2={plotBottom + 4} />
              <text className="chart-tick-label" x={tick.x} y={chart.height - 8}>
                {tick.value}
              </text>
            </g>
          ))}
          {geometry.hitTargets.map((target) => (
            <rect
              key={target.moveNumber}
              aria-label={`Jump to move ${target.moveNumber}`}
              className="chart-hit-target"
              x={target.x - target.width / 2}
              y={chart.top}
              width={target.width}
              height={plotHeight}
              onClick={() => onJump(target.moveNumber)}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

function buildChartGeometry(points: ChartPoint[], currentMoveNumber?: number) {
  const maxMove = Math.max(1, ...points.map((point) => point.moveNumber))
  const scoreLimit = niceScoreLimit(points)
  const winratePoints = points.map((point) => `${xForMove(point.moveNumber, maxMove)},${yForWinrate(point.winrate)}`).join(' ')
  const scorePoints = points.map((point) => `${xForMove(point.moveNumber, maxMove)},${yForScore(point.scoreLead, scoreLimit)}`).join(' ')
  const currentX = points.length === 0 || currentMoveNumber === undefined ? undefined : xForMove(clamp(currentMoveNumber, 0, maxMove), maxMove)
  const hitWidth = Math.max(12, plotWidth / Math.max(points.length, 1))
  return {
    scoreLimit,
    winratePath: points.length > 1 ? winratePoints : '',
    scorePath: points.length > 1 ? scorePoints : '',
    currentX,
    ticks: buildMoveTicks(maxMove).map((value) => ({ value, x: xForMove(value, maxMove) })),
    hitTargets: points.map((point) => ({ moveNumber: point.moveNumber, x: xForMove(point.moveNumber, maxMove), width: hitWidth })),
  }
}

function xForMove(moveNumber: number, maxMove: number) {
  return chart.left + (moveNumber / maxMove) * plotWidth
}

function yForWinrate(winrate: number) {
  return plotBottom - clamp(winrate, 0, 1) * plotHeight
}

function yForScore(scoreLead: number, scoreLimit: number) {
  return scoreMidY - (clamp(scoreLead, -scoreLimit, scoreLimit) / scoreLimit) * (plotHeight / 2)
}

function niceScoreLimit(points: ChartPoint[]) {
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.scoreLead)))
  return Math.ceil(maxAbs)
}

function buildMoveTicks(maxMove: number) {
  const roughStep = maxMove / 4
  const step = niceMoveStep(roughStep)
  const ticks = new Set<number>([0, maxMove])
  for (let value = step; value < maxMove; value += step) {
    ticks.add(value)
  }
  return [...ticks].sort((a, b) => a - b)
}

function niceMoveStep(value: number) {
  if (value <= 10) return 10
  if (value <= 25) return 25
  if (value <= 50) return 50
  if (value <= 100) return 100
  return Math.ceil(value / 100) * 100
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
