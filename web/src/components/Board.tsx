import type { CandidateMove, EncodedOwnership, Snapshot } from '../api/types'
import { BOARD_SIZE, GTP_LETTERS, boardPoints, gtpToPoint, pointKey, pointToGTP } from '../board/coordinates'
import { KATRAIN_EVAL_COLORS, evalClassForPointLoss, formatCandidateDelta, formatVisits, katrainEvalColor } from '../board/katrainStyle'
import { decodeOwnershipQ8, ownershipAt, ownershipDisplay, ownershipOwner } from '../board/ownership'
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
const boardClipX = pad - gap / 2
const boardClipSize = gap * BOARD_SIZE
const ownershipFilterId = 'ownership-soften'
const ownershipClipId = 'ownership-clip'
const candidateGradientPrefix = 'candidate-fill'
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
  const currentMoveMarker = snapshot?.lastMove ? currentMoveMarkerVisual(snapshot.lastMove.color, playedPointLoss) : null
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board">
      <defs>
        <clipPath id={ownershipClipId}>
          <rect x={boardClipX} y={boardClipX} width={boardClipSize} height={boardClipSize} rx={gap * 0.32} />
        </clipPath>
        <filter id={ownershipFilterId} x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="11" />
        </filter>
        {KATRAIN_EVAL_COLORS.map((color, index) => (
          <radialGradient key={color} id={`${candidateGradientPrefix}-${index}`} cx="50%" cy="45%" r="62%">
            <stop offset="0%" stopColor={color} stopOpacity="0.94" />
            <stop offset="68%" stopColor={color} stopOpacity="0.78" />
            <stop offset="100%" stopColor={color} stopOpacity="0.18" />
          </radialGradient>
        ))}
      </defs>
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="var(--board-wood)" />
      {overlays.ownership && ownershipValues.length > 0 && (
        <g className="ownership-layer smooth" aria-label="Ownership overlay" pointerEvents="none" clipPath={`url(#${ownershipClipId})`}>
          {(['B', 'W'] as const).map((owner) => (
            <g key={owner} className={`ownership-soft-layer ${owner === 'B' ? 'black' : 'white'}`} filter={`url(#${ownershipFilterId})`}>
              {boardPoints().map((point) => {
                const display = ownershipDisplay(ownershipAt(ownershipValues, point.x, point.y))
                if (!display || display.owner !== owner) return null
                return (
                  <circle
                    key={`ownership-${point.x}-${point.y}`}
                    className={`ownership-sample ${owner === 'B' ? 'ownership-black' : 'ownership-white'}`}
                    cx={pad + point.x * gap}
                    cy={pad + point.y * gap}
                    r={gap * 1.12}
                    fill={display.fill}
                    opacity={display.alpha}
                  />
                )
              })}
            </g>
          ))}
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
          const markerSize = Math.max(5, gap * 0.43 * 2 * 0.36 * Math.abs(value))
          const x = pad + stone.x * gap
          const y = pad + stone.y * gap
          return (
            <path
              key={`weak-${stone.x}-${stone.y}`}
              aria-label={`Weak stone marker ${pointToGTP(stone.x, stone.y)}`}
              className="weak-stone-marker"
              d={`M ${x - markerSize / 2} ${y - markerSize / 2} L ${x + markerSize / 2} ${y + markerSize / 2} M ${x + markerSize / 2} ${y - markerSize / 2} L ${x - markerSize / 2} ${y + markerSize / 2}`}
              fill="none"
              stroke={stone.color === 'B' ? '#f5f2ea' : '#111'}
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.42"
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
          r={currentMoveMarker?.radius}
          fill="none"
          stroke={currentMoveMarker?.stroke}
          strokeWidth={currentMoveMarker?.strokeWidth}
          opacity={currentMoveMarker?.opacity}
          pointerEvents="none"
        />
      )}
      {overlays.candidates && candidates.map((candidate) => {
        const point = gtpToPoint(candidate.move)
        if (!point) return null
        const x = pad + point.x * gap
        const y = pad + point.y * gap
        const label = formatCandidate(candidate)
        const visual = candidateVisual(candidate)
        return (
          <g
            key={candidate.move}
            aria-label={tryMode ? `Try recommended move ${candidate.move}` : `Recommended next move ${candidate.move}`}
            className={`candidate-hint ${visual.primary ? 'primary' : 'secondary'}${candidate.lowVisits ? ' low-visits' : ''}`}
            onClick={() => {
              if (tryMode) onPlay(candidate.move)
              else onPreviewPV(candidate)
            }}
            opacity={visual.opacity}
          >
            {visual.showText && (
              <circle
                className="candidate-backplate"
                cx={x}
                cy={y}
                r={visual.backplateRadius}
                fill="var(--board-wood)"
                opacity="0.68"
              />
            )}
            <circle
              className="candidate-dot"
              cx={x}
              cy={y}
              r={visual.radius}
              fill={`url(#${candidateGradientId(candidate.pointLoss)})`}
              stroke={visual.primary ? 'rgba(10, 200, 250, 0.55)' : 'rgba(17, 17, 17, 0.14)'}
              strokeWidth={visual.primary ? 1.2 : 0.5}
            />
            {visual.showText && (
              <text
                className="candidate-label"
                x={x}
                y={visual.showVisits ? y - 2 : y + 3}
                textAnchor="middle"
                fontSize={visual.primary ? 8.6 : 8}
                fontWeight="700"
                fill="#16120b"
                pointerEvents="none"
              >
                <tspan x={x}>{label.deltaScore}</tspan>
                {visual.showVisits && (
                  <tspan x={x} dy="9" fontSize="7.3" fontWeight="600" opacity="0.78">
                    {label.visits}
                  </tspan>
                )}
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
                strokeWidth="1"
                opacity="0.55"
              />
            )}
            <circle
              className="actual-next-dash"
              cx={x}
              cy={y}
              r={gap * 0.43}
              fill="none"
              stroke={child.color === 'B' ? '#111' : '#f5f2ea'}
              strokeWidth="1.25"
              strokeDasharray={isTopMove ? '5 5' : '9 5'}
              strokeLinecap="round"
              opacity="0.78"
            />
          </g>
        )
      })}
      {(activePV ?? []).map((move, index) => {
        const point = gtpToPoint(move)
        if (!point) return null
        const opacity = Math.max(0.45, 0.82 - index * 0.08)
        return (
          <g key={`${move}-${index}`} className="pv-stone" opacity={opacity}>
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

function candidateVisual(candidate: CandidateMove) {
  const primary = candidate.order === 0
  const showText = !candidate.lowVisits && candidate.order <= 4
  return {
    primary,
    showText,
    showVisits: primary,
    radius: primary ? gap * 0.32 : showText ? gap * 0.27 : gap * 0.16,
    backplateRadius: primary ? gap * 0.4 : gap * 0.34,
    opacity: candidate.lowVisits ? 0.5 : primary ? 0.92 : 0.78,
  }
}

function candidateGradientId(pointLoss: number) {
  return `${candidateGradientPrefix}-${evalClassForPointLoss(pointLoss)}`
}

function currentMoveMarkerVisual(color: 'B' | 'W', pointLoss?: number | null) {
  if (pointLoss === undefined || pointLoss === null) {
    return {
      radius: gap * 0.18,
      stroke: color === 'B' ? '#f5f2ea' : '#111',
      strokeWidth: 2,
      opacity: 1,
    }
  }
  return {
    radius: gap * 0.25,
    stroke: katrainEvalColor(pointLoss),
    strokeWidth: 2.4,
    opacity: 0.86,
  }
}
