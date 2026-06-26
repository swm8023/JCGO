import type { CandidateMove, EncodedOwnership, Snapshot } from '../api/types'
import { BOARD_SIZE, GTP_LETTERS, boardPoints, gtpToPoint, pointKey, pointToGTP } from '../board/coordinates'
import { TOP_MOVE_BORDER_COLOR, formatCandidateDelta, formatVisits, katrainEvalColor } from '../board/katrainStyle'
import { decodeOwnershipQ8, ownershipAlpha, ownershipAt, ownershipOwner } from '../board/ownership'
import type { OverlayState } from './OverlayToggles'

interface BoardProps {
  snapshot?: Snapshot
  candidates?: CandidateMove[]
  ownership?: EncodedOwnership
  playedPointLoss?: number | null
  overlays?: OverlayState
  activePV?: string[]
  tryMode: boolean
  onPlay(gtp: string): void
  onPreviewPV(candidate: CandidateMove): void
}

const pad = 28
const gap = 28
const boardSize = pad * 2 + gap * (BOARD_SIZE - 1)
const starPoints = [3, 9, 15]
const defaultOverlays: OverlayState = { candidates: true, ownership: true, deadStones: true }

export function Board({ snapshot, candidates: candidateProps, ownership, playedPointLoss, overlays = defaultOverlays, activePV, tryMode, onPlay, onPreviewPV }: BoardProps) {
  const stones = snapshot?.stones ?? []
  const candidates = candidateProps ?? snapshot?.analysis?.candidates ?? []
  const children = snapshot?.children ?? []
  const occupied = new Set(stones.map((stone) => pointKey(stone.x, stone.y)))
  const lastMovePoint = snapshot?.lastMove && !snapshot.lastMove.pass ? gtpToPoint(snapshot.lastMove.gtp) : null
  const topCandidatePoint = gtpToPoint(candidates.find((candidate) => candidate.order === 0)?.move ?? '')
  const ownershipValues = decodeOwnershipQ8(ownership)
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board">
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="var(--board-wood)" />
      {overlays.ownership && ownershipValues.length > 0 && (
        <g className="ownership-layer" aria-label="Ownership overlay" pointerEvents="none">
          {boardPoints().map((point) => {
            const value = ownershipAt(ownershipValues, point.x, point.y)
            const alpha = ownershipAlpha(value)
            if (alpha === 0) return null
            return (
              <rect
                key={`ownership-${point.x}-${point.y}`}
                x={pad + point.x * gap - gap / 2}
                y={pad + point.y * gap - gap / 2}
                width={gap}
                height={gap}
                fill={value >= 0 ? 'rgb(0 0 26)' : 'rgb(235 235 255)'}
                opacity={alpha * 0.55}
              />
            )
          })}
        </g>
      )}
      {Array.from({ length: BOARD_SIZE }, (_, i) => (
        <g key={`coord-${i}`} className="board-coordinates">
          <text className="board-coordinate file" x={pad + i * gap} y={boardSize - 8} textAnchor="middle" fontSize="11" fill="var(--board-line)">
            {GTP_LETTERS[i]}
          </text>
          <text className="board-coordinate rank" x={12} y={pad + i * gap + 4} textAnchor="middle" fontSize="11" fill="var(--board-line)">
            {BOARD_SIZE - i}
          </text>
        </g>
      ))}
      {Array.from({ length: BOARD_SIZE }, (_, i) => (
        <g key={i}>
          <line x1={pad} y1={pad + i * gap} x2={boardSize - pad} y2={pad + i * gap} stroke="var(--board-line)" strokeWidth="1" />
          <line x1={pad + i * gap} y1={pad} x2={pad + i * gap} y2={boardSize - pad} stroke="var(--board-line)" strokeWidth="1" />
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
            fill="var(--board-line)"
          />
        )),
      )}
      {tryMode &&
        snapshot &&
        boardPoints()
          .filter((point) => !occupied.has(pointKey(point.x, point.y)))
          .map((point) => {
            const move = pointToGTP(point.x, point.y)
            return (
              <rect
                key={`try-${move}`}
                aria-label={`Try move ${move}`}
                className="board-click-target"
                x={pad + point.x * gap - gap / 2}
                y={pad + point.y * gap - gap / 2}
                width={gap}
                height={gap}
                fill="transparent"
                onClick={() => onPlay(move)}
              />
            )
          })}
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
      {overlays.deadStones &&
        ownershipValues.length > 0 &&
        stones.map((stone) => {
          const value = ownershipAt(ownershipValues, stone.x, stone.y)
          if (value === 0 || stone.color === ownershipOwner(value)) return null
          const markerSize = Math.max(2, gap * 0.43 * 2 * 0.42 * Math.abs(value))
          return (
            <rect
              key={`weak-${stone.x}-${stone.y}`}
              aria-label={`Weak stone marker ${pointToGTP(stone.x, stone.y)}`}
              className="weak-stone-marker"
              x={pad + stone.x * gap - markerSize / 2}
              y={pad + stone.y * gap - markerSize / 2}
              width={markerSize}
              height={markerSize}
              fill={ownershipOwner(value) === 'B' ? '#111' : '#f5f2ea'}
              opacity="0.9"
              pointerEvents="none"
            />
          )
        })}
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
      {snapshot?.lastMove && lastMovePoint && playedPointLoss !== undefined && playedPointLoss !== null && (
        <circle
          aria-label={`Current move quality ${snapshot.lastMove.gtp}`}
          className="current-move-quality"
          cx={pad + lastMovePoint.x * gap}
          cy={pad + lastMovePoint.y * gap}
          r={gap * 0.13}
          fill={katrainEvalColor(playedPointLoss)}
          pointerEvents="none"
        />
      )}
      {overlays.candidates && candidates.map((candidate) => {
        const point = gtpToPoint(candidate.move)
        if (!point) return null
        const x = pad + point.x * gap
        const y = pad + point.y * gap
        const label = formatCandidate(candidate)
        return (
          <g
            key={candidate.move}
            aria-label={tryMode ? `Try recommended move ${candidate.move}` : `Recommended next move ${candidate.move}`}
            onClick={() => {
              if (tryMode) onPlay(candidate.move)
              else onPreviewPV(candidate)
            }}
            opacity={candidate.lowVisits ? 0.45 : 1}
          >
            <circle cx={x} cy={y} r={gap * 0.34} fill={katrainEvalColor(candidate.pointLoss)} stroke={candidate.order === 0 ? TOP_MOVE_BORDER_COLOR : 'transparent'} strokeWidth={candidate.order === 0 ? 2 : 0} />
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
      {children.map((child) => {
        const point = !child.pass ? gtpToPoint(child.gtp) : null
        if (!point) return null
        const x = pad + point.x * gap
        const y = pad + point.y * gap
        const isTopMove = topCandidatePoint?.x === point.x && topCandidatePoint.y === point.y
        return (
          <g key={child.nodeId} aria-label={`Actual next move ${child.gtp}`} className="actual-next-move" pointerEvents="none">
            {!isTopMove && (
              <circle
                className="actual-next-contrast"
                cx={x}
                cy={y}
                r={gap * 0.43}
                fill="none"
                stroke={child.color === 'B' ? '#d8d8d8' : '#5f5f5f'}
                strokeWidth="1.2"
              />
            )}
            <circle
              className="actual-next-dash"
              cx={x}
              cy={y}
              r={gap * 0.43}
              fill="none"
              stroke={child.color === 'B' ? '#111' : '#f5f2ea'}
              strokeWidth="1.6"
              strokeDasharray={isTopMove ? '5 5' : '9 5'}
              strokeLinecap="round"
            />
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
    deltaScore: formatCandidateDelta(candidate.pointLoss),
    visits: formatVisits(candidate.visits),
  }
}
