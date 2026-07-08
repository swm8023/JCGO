import type { ChartPoint } from '../api/types'

interface AnalysisChartsProps {
  points: ChartPoint[]
  currentMoveNumber?: number
  onJump(moveNumber: number): void
}

interface ChartVertex {
  x: number
  y: number
}

const chart = {
  width: 320,
  height: 112,
  left: 28,
  right: 28,
  top: 4,
  bottom: 18,
}

const plotWidth = chart.width - chart.left - chart.right
const plotHeight = chart.height - chart.top - chart.bottom
const plotBottom = chart.height - chart.bottom
const scoreMidY = chart.top + plotHeight / 2
const tickLabelY = chart.height - 7

export function AnalysisCharts({ points, currentMoveNumber, onJump }: AnalysisChartsProps) {
  const geometry = buildChartGeometry(points, currentMoveNumber)
  return (
    <div className="analysis-charts" aria-label="胜率曲线">
      <div className="rail-section-body chart-body">
        <svg className="winrate-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label="Winrate curve">
          <defs>
            <linearGradient id="winrateAreaGradient" x1="0" x2="0" y1={chart.top} y2={plotBottom} gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="var(--table)" stopOpacity="0.18" />
              <stop offset="72%" stopColor="var(--table)" stopOpacity="0.06" />
              <stop offset="100%" stopColor="var(--table)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect className="chart-plot-bg" x={chart.left} y={chart.top} width={plotWidth} height={plotHeight} />
          {geometry.winrateAreaPath && <path aria-label="Black winrate area" className="winrate-area" d={geometry.winrateAreaPath} />}
          <line className="chart-grid-line" x1={chart.left} y1={chart.top} x2={chart.width - chart.right} y2={chart.top} />
          <line className="chart-grid-line chart-zero-line" x1={chart.left} y1={scoreMidY} x2={chart.width - chart.right} y2={scoreMidY} />
          <line className="chart-grid-line" x1={chart.left} y1={plotBottom} x2={chart.width - chart.right} y2={plotBottom} />
          <line className="chart-axis-line" x1={chart.left} y1={chart.top} x2={chart.left} y2={plotBottom} />
          <line className="chart-axis-line" x1={chart.width - chart.right} y1={chart.top} x2={chart.width - chart.right} y2={plotBottom} />

          {geometry.scorePath && <path aria-label="Score lead line" className="chart-line score-line" d={geometry.scorePath} />}
          {geometry.winratePath && <path aria-label="Black winrate line" className="chart-line winrate-line" d={geometry.winratePath} />}
          {geometry.currentX !== undefined && <line aria-label="Current move marker" className="chart-current-marker" x1={geometry.currentX} y1={chart.top} x2={geometry.currentX} y2={plotBottom} />}
          {geometry.currentPoint && <circle aria-label="Current move point" className="chart-current-point" cx={geometry.currentPoint.x} cy={geometry.currentPoint.y} r="3" />}
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line className="chart-tick-line" x1={tick.x} y1={plotBottom} x2={tick.x} y2={plotBottom + 4} />
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
        <div className="chart-label-layer" aria-hidden="true">
          <span className="chart-axis-label chart-axis-label-left" style={{ left: percentX(chart.left - 6), top: percentY(chart.top + 4) }}>
            100%
          </span>
          <span className="chart-axis-label chart-axis-label-left" style={{ left: percentX(chart.left - 6), top: percentY(scoreMidY + 4) }}>
            50%
          </span>
          <span className="chart-axis-label chart-axis-label-left" style={{ left: percentX(chart.left - 6), top: percentY(plotBottom + 4) }}>
            0%
          </span>
          <span className="chart-axis-label chart-axis-label-right" style={{ left: percentX(chart.width - chart.right + 6), top: percentY(chart.top + 4) }}>
            +{geometry.scoreLimit}
          </span>
          <span className="chart-axis-label chart-axis-label-right" style={{ left: percentX(chart.width - chart.right + 6), top: percentY(scoreMidY + 4) }}>
            0
          </span>
          <span className="chart-axis-label chart-axis-label-right" style={{ left: percentX(chart.width - chart.right + 6), top: percentY(plotBottom + 4) }}>
            -{geometry.scoreLimit}
          </span>
          {geometry.ticks.map((tick) => (
            <span key={tick.value} className="chart-tick-label" style={{ left: percentX(tick.x), top: percentY(tickLabelY) }}>
              {tick.value}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function percentX(x: number) {
  return `${(x / chart.width) * 100}%`
}

function percentY(y: number) {
  return `${(y / chart.height) * 100}%`
}

function buildChartGeometry(points: ChartPoint[], currentMoveNumber?: number) {
  const maxMove = Math.max(1, ...points.map((point) => point.moveNumber))
  const scoreLimit = niceScoreLimit(points)
  const winrateVertices = points.map((point) => ({ x: xForMove(point.moveNumber, maxMove), y: yForWinrate(point.winrate) }))
  const scoreVertices = points.map((point) => ({ x: xForMove(point.moveNumber, maxMove), y: yForScore(point.scoreLead, scoreLimit) }))
  const winratePath = smoothPath(winrateVertices)
  const currentMove = currentMoveNumber === undefined ? undefined : clamp(currentMoveNumber, 0, maxMove)
  const currentX = points.length === 0 || currentMove === undefined ? undefined : xForMove(currentMove, maxMove)
  const currentPointSource = currentMove === undefined ? undefined : points.find((point) => point.moveNumber === currentMove)
  const hitWidth = Math.max(12, plotWidth / Math.max(points.length, 1))
  return {
    scoreLimit,
    winratePath,
    winrateAreaPath: areaPath(winratePath, winrateVertices),
    scorePath: smoothPath(scoreVertices),
    currentX,
    currentPoint: currentPointSource ? { x: xForMove(currentPointSource.moveNumber, maxMove), y: yForWinrate(currentPointSource.winrate) } : undefined,
    ticks: buildMoveTicks(maxMove).map((value) => ({ value, x: xForMove(value, maxMove) })),
    hitTargets: points.map((point) => ({ moveNumber: point.moveNumber, x: xForMove(point.moveNumber, maxMove), width: hitWidth })),
  }
}

function smoothPath(vertices: ChartVertex[]) {
  if (vertices.length < 2) return ''

  const commands = [`M${formatCoord(vertices[0].x)},${formatCoord(vertices[0].y)}`]
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const previous = vertices[index - 1] ?? vertices[index]
    const current = vertices[index]
    const next = vertices[index + 1]
    const following = vertices[index + 2] ?? next
    const controlStart = {
      x: current.x + (next.x - previous.x) / 6,
      y: clamp(current.y + (next.y - previous.y) / 6, chart.top, plotBottom),
    }
    const controlEnd = {
      x: next.x - (following.x - current.x) / 6,
      y: clamp(next.y - (following.y - current.y) / 6, chart.top, plotBottom),
    }

    commands.push(
      `C${formatCoord(controlStart.x)},${formatCoord(controlStart.y)} ${formatCoord(controlEnd.x)},${formatCoord(controlEnd.y)} ${formatCoord(next.x)},${formatCoord(next.y)}`,
    )
  }

  return commands.join(' ')
}

function areaPath(linePath: string, vertices: ChartVertex[]) {
  if (!linePath || vertices.length < 2) return ''
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  return `${linePath} L${formatCoord(last.x)},${formatCoord(plotBottom)} L${formatCoord(first.x)},${formatCoord(plotBottom)} Z`
}

function formatCoord(value: number) {
  return Number(value.toFixed(2)).toString()
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
