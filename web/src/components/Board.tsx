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

export function Board({ snapshot, activePV, onPlay, onPreviewPV, onClearPV }: BoardProps) {
  const stones = snapshot?.stones ?? []
  const candidates = snapshot?.analysis?.candidates ?? []
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board" onMouseLeave={onClearPV}>
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="#d8a95f" />
      {Array.from({ length: size }, (_, i) => (
        <g key={i}>
          <line x1={pad} y1={pad + i * gap} x2={boardSize - pad} y2={pad + i * gap} stroke="#2f2419" strokeWidth="1" />
          <line x1={pad + i * gap} y1={pad} x2={pad + i * gap} y2={boardSize - pad} stroke="#2f2419" strokeWidth="1" />
        </g>
      ))}
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
      {candidates.map((candidate) => {
        const point = gtpToPoint(candidate.move)
        if (!point) return null
        return (
          <g
            key={candidate.move}
            onMouseEnter={() => onPreviewPV(candidate)}
            onClick={() => onPlay(candidate.move)}
            opacity={candidate.lowVisits ? 0.45 : 1}
          >
            <circle cx={pad + point.x * gap} cy={pad + point.y * gap} r={gap * 0.34} fill={candidate.order === 0 ? '#4f8a5b' : '#e8c85c'} />
            {!candidate.lowVisits && (
              <text x={pad + point.x * gap} y={pad + point.y * gap + 4} textAnchor="middle" fontSize="9">
                {formatCandidate(candidate)}
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
  return `${candidate.pointLoss.toFixed(1)} ${candidate.visits}`
}

function gtpToPoint(gtp: string): { x: number; y: number } | null {
  if (gtp.toLowerCase() === 'pass') return null
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const x = letters.indexOf(gtp[0]?.toUpperCase())
  const row = Number(gtp.slice(1))
  if (x < 0 || !row) return null
  return { x, y: 19 - row }
}
