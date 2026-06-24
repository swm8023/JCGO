import type { CandidateMove, Snapshot } from '../api/types'

interface BoardProps {
  snapshot?: Snapshot
  activePV?: string[]
  onPlay(gtp: string): void
  onPreviewPV(candidate: CandidateMove): void
  onClearPV(): void
}

const size = 19
const pad = 28
const gap = 28
const boardSize = pad * 2 + gap * (size - 1)
const gtpLetters = 'ABCDEFGHJKLMNOPQRST'
const starPoints = [3, 9, 15]

export function Board({ snapshot, activePV, onPlay, onPreviewPV, onClearPV }: BoardProps) {
  const stones = snapshot?.stones ?? []
  const candidates = snapshot?.analysis?.candidates ?? []
  const lastMovePoint = snapshot?.lastMove && !snapshot.lastMove.pass ? gtpToPoint(snapshot.lastMove.gtp) : null
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board" onMouseLeave={onClearPV}>
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="#d8a95f" />
      {Array.from({ length: size }, (_, i) => (
        <g key={`coord-${i}`} className="board-coordinates">
          <text className="board-coordinate file" x={pad + i * gap} y={boardSize - 8} textAnchor="middle" fontSize="11" fill="#55432d">
            {gtpLetters[i]}
          </text>
          <text className="board-coordinate rank" x={12} y={pad + i * gap + 4} textAnchor="middle" fontSize="11" fill="#55432d">
            {size - i}
          </text>
        </g>
      ))}
      {Array.from({ length: size }, (_, i) => (
        <g key={i}>
          <line x1={pad} y1={pad + i * gap} x2={boardSize - pad} y2={pad + i * gap} stroke="#2f2419" strokeWidth="1" />
          <line x1={pad + i * gap} y1={pad} x2={pad + i * gap} y2={boardSize - pad} stroke="#2f2419" strokeWidth="1" />
        </g>
      ))}
      {starPoints.flatMap((x) =>
        starPoints.map((y) => (
          <circle
            key={`star-${x}-${y}`}
            className={x === 9 && y === 9 ? 'star-point tengen' : 'star-point'}
            cx={pad + x * gap}
            cy={pad + y * gap}
            r={gap * 0.09}
            fill="#2f2419"
          />
        )),
      )}
      {stones.map((stone) => (
        <circle
          key={`${stone.x}-${stone.y}`}
          cx={pad + stone.x * gap}
          cy={pad + stone.y * gap}
          r={gap * 0.43}
          fill={stone.color === 'B' ? '#111' : '#f5f2ea'}
          stroke="#111"
        />
      ))}
      {snapshot?.lastMove && lastMovePoint && (
        <circle
          aria-label={`Current move ${snapshot.lastMove.gtp}`}
          className="current-move-marker"
          cx={pad + lastMovePoint.x * gap}
          cy={pad + lastMovePoint.y * gap}
          r={gap * 0.18}
          fill="none"
          stroke={snapshot.lastMove.color === 'B' ? '#f5f2ea' : '#111'}
          strokeWidth="2"
        />
      )}
      {candidates.map((candidate) => {
        const point = gtpToPoint(candidate.move)
        if (!point) return null
        const x = pad + point.x * gap
        const y = pad + point.y * gap
        const label = formatCandidate(candidate)
        return (
          <g
            key={candidate.move}
            aria-label={`Recommended next move ${candidate.move}`}
            onMouseEnter={() => onPreviewPV(candidate)}
            onClick={() => onPlay(candidate.move)}
            opacity={candidate.lowVisits ? 0.45 : 1}
          >
            <circle cx={x} cy={y} r={gap * 0.34} fill={candidate.order === 0 ? '#4f8a5b' : '#e8c85c'} />
            {!candidate.lowVisits && (
              <text x={x} y={y - 2} textAnchor="middle" fontSize="9" fill="#111">
                <tspan x={x}>{label.deltaScore}</tspan>
                <tspan x={x} dy="9" fontSize="8">
                  {label.visits}
                </tspan>
              </text>
            )}
          </g>
        )
      })}
      {(activePV ?? []).map((move, index) => {
        const point = gtpToPoint(move)
        if (!point) return null
        return (
          <g key={`${move}-${index}`}>
            <circle cx={pad + point.x * gap} cy={pad + point.y * gap} r={gap * 0.38} fill={index % 2 === 0 ? '#111' : '#f5f2ea'} stroke="#111" />
            <text x={pad + point.x * gap} y={pad + point.y * gap + 5} textAnchor="middle" fontSize="14" fill={index % 2 === 0 ? '#fff' : '#111'}>
              {index + 1}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function formatCandidate(candidate: CandidateMove) {
  return {
    deltaScore: formatLoss(-candidate.pointLoss),
    visits: formatVisits(candidate.visits),
  }
}

function formatLoss(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function formatVisits(visits: number) {
  if (visits < 1000) return String(visits)
  if (visits < 100000) return `${(visits / 1000).toFixed(1)}k`
  if (visits < 1000000) return `${(visits / 1000).toFixed(0)}k`
  return `${(visits / 1000000).toFixed(0)}M`
}

function gtpToPoint(gtp: string): { x: number; y: number } | null {
  if (gtp.toLowerCase() === 'pass') return null
  const x = gtpLetters.indexOf(gtp[0]?.toUpperCase())
  const row = Number(gtp.slice(1))
  if (x < 0 || !row) return null
  return { x, y: 19 - row }
}
