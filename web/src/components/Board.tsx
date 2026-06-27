import type { CandidateMove, EncodedOwnership, Snapshot } from '../api/types'
import { BOARD_SIZE, GTP_LETTERS, boardPoints, gtpToPoint, pointKey, pointToGTP } from '../board/coordinates'
import { KATRAIN_EVAL_COLORS, evalClassForPointLoss, formatCandidateDelta, formatVisits } from '../board/katrainStyle'
import { decodeOwnershipQ8, ownershipAt, ownershipDisplay, ownershipOwner } from '../board/ownership'
import type { OverlayState } from './OverlayToggles'

interface BoardProps {
  snapshot?: Snapshot
  candidates?: CandidateMove[]
  ownership?: EncodedOwnership
  playedPointLoss?: number | null
  overlays?: OverlayState
  activePV?: string[]
  trialMoves?: string[]
  tryMode: boolean
  onPlay(gtp: string): void
  onPreviewPV(candidate: CandidateMove): void
}

const pad = 28
const gap = 28
const boardSize = pad * 2 + gap * (BOARD_SIZE - 1)
const ownershipFilterId = 'ownership-soften'
const ownershipMaskId = 'ownership-edge-fade'
const ownershipMaskFilterId = 'ownership-mask-soften'
const ownershipMaskRadius = gap * 0.55
const ownershipMaskBlur = 9
const candidateGradientPrefix = 'candidate-fill'
const blackStoneGradientId = 'black-stone-gradient'
const whiteStoneGradientId = 'white-stone-gradient'
const stoneShadowId = 'stone-shadow'
const starPoints = [3, 9, 15]
const defaultOverlays: OverlayState = { candidates: true, ownership: true, deadStones: true }

export function Board({ snapshot, candidates: candidateProps, ownership, playedPointLoss, overlays = defaultOverlays, activePV, trialMoves, tryMode, onPlay, onPreviewPV }: BoardProps) {
  const stones = snapshot?.stones ?? []
  const candidates = candidateProps ?? snapshot?.analysis?.candidates ?? []
  const children = snapshot?.children ?? []
  const occupied = new Set(stones.map((stone) => pointKey(stone.x, stone.y)))
  const trialMoveByPoint = trialMovesByPoint(trialMoves)
  const lastMovePoint = snapshot?.lastMove && !snapshot.lastMove.pass ? gtpToPoint(snapshot.lastMove.gtp) : null
  const topCandidatePoint = gtpToPoint(candidates.find((candidate) => candidate.order === 0)?.move ?? '')
  const ownershipValues = decodeOwnershipQ8(ownership)
  const currentMoveMarker = currentMoveMarkerVisual()
  return (
    <svg className="go-board" viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="Go board">
      <defs>
        <filter id={ownershipMaskFilterId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={ownershipMaskBlur} />
        </filter>
        <mask id={ownershipMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width={boardSize} height={boardSize}>
          <rect x="0" y="0" width={boardSize} height={boardSize} fill="black" />
          <rect className="ownership-edge-fade-field" x="0" y="0" width={boardSize} height={boardSize} rx={ownershipMaskRadius} fill="white" filter={`url(#${ownershipMaskFilterId})`} />
        </mask>
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
        <radialGradient id={blackStoneGradientId} cx="34%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#5b5b58" />
          <stop offset="36%" stopColor="#20201f" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
        <radialGradient id={whiteStoneGradientId} cx="34%" cy="27%" r="74%">
          <stop offset="0%" stopColor="#fffdf8" />
          <stop offset="56%" stopColor="#ece7dc" />
          <stop offset="100%" stopColor="#b7aea0" />
        </radialGradient>
        <filter id={stoneShadowId} x="-18%" y="-18%" width="136%" height="136%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0.7" dy="1.1" stdDeviation="0.8" floodColor="#000000" floodOpacity="0.28" />
        </filter>
      </defs>
      <rect x="0" y="0" width={boardSize} height={boardSize} rx="6" fill="var(--board-wood)" />
      {overlays.ownership && ownershipValues.length > 0 && (
        <g className="ownership-layer smooth" aria-label="Ownership overlay" pointerEvents="none" mask={`url(#${ownershipMaskId})`}>
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
      {stones.map((stone) => {
        const trialMove = trialMoveByPoint.get(pointKey(stone.x, stone.y))
        if (trialMove) {
          return (
            <g
              key={`${stone.x}-${stone.y}`}
              aria-label={`Trial move ${trialMove.number} ${trialMove.move}`}
              className="trial-stone"
              opacity={sequenceStoneOpacity(trialMove.number - 1)}
              pointerEvents="none"
            >
              <circle
                cx={pad + stone.x * gap}
                cy={pad + stone.y * gap}
                r={gap * 0.38}
                fill={`url(#${stone.color === 'B' ? blackStoneGradientId : whiteStoneGradientId})`}
                stroke={stone.color === 'B' ? '#030303' : '#9f9788'}
                strokeWidth="0.8"
                filter={`url(#${stoneShadowId})`}
              />
              <text
                x={pad + stone.x * gap}
                y={pad + stone.y * gap + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill={stone.color === 'B' ? '#fff' : '#111'}
                paintOrder="stroke"
                stroke={stone.color === 'B' ? 'rgba(0, 0, 0, 0.52)' : 'rgba(245, 242, 234, 0.74)'}
                strokeWidth="1.6"
                strokeLinejoin="round"
              >
                {trialMove.number}
              </text>
            </g>
          )
        }
        return (
          <circle
            key={`${stone.x}-${stone.y}`}
            className={`stone ${stone.color === 'B' ? 'black-stone' : 'white-stone'}`}
            cx={pad + stone.x * gap}
            cy={pad + stone.y * gap}
            r={gap * 0.43}
            fill={`url(#${stone.color === 'B' ? blackStoneGradientId : whiteStoneGradientId})`}
            stroke={stone.color === 'B' ? '#030303' : '#9f9788'}
            strokeWidth="0.8"
            filter={`url(#${stoneShadowId})`}
          />
        )
      })}
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
              opacity={weakStoneMarkerOpacity(value)}
              pointerEvents="none"
            />
          )
        })}
      {snapshot?.lastMove && lastMovePoint && playedPointLoss !== undefined && playedPointLoss !== null && (
        <g
          aria-label={`Current move quality ${snapshot.lastMove.gtp}`}
          className="current-move-quality"
          opacity={qualityMarkerVisual().opacity}
          pointerEvents="none"
        >
          <circle
            className="move-quality-dot current-move-quality-dot"
            cx={pad + lastMovePoint.x * gap}
            cy={pad + lastMovePoint.y * gap}
            r={qualityMarkerVisual().radius}
            fill={`url(#${candidateGradientId(playedPointLoss)})`}
            stroke="rgba(17, 17, 17, 0.14)"
            strokeWidth="0.5"
          />
          <text
            className="move-quality-label"
            x={pad + lastMovePoint.x * gap}
            y={pad + lastMovePoint.y * gap + 3}
            textAnchor="middle"
            fontSize="8"
            fontWeight="700"
            fill="#16120b"
            paintOrder="stroke"
            stroke="rgba(236, 198, 125, 0.7)"
            strokeWidth="2.2"
            strokeLinejoin="round"
          >
            {formatCandidateDelta(playedPointLoss)}
          </text>
        </g>
      )}
      {snapshot?.lastMove && lastMovePoint && (
        <g
          aria-label={`Current move ${snapshot.lastMove.gtp}`}
          className="current-move-marker"
          pointerEvents="none"
          opacity={currentMoveMarker.opacity}
        >
          <path
            className="current-move-tick-shadow"
            d={currentMoveMarkerPath(pad + lastMovePoint.x * gap, pad + lastMovePoint.y * gap, currentMoveMarker)}
            fill="none"
            stroke="rgba(36, 24, 10, 0.42)"
            strokeWidth={currentMoveMarker.shadowStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="current-move-tick"
            d={currentMoveMarkerPath(pad + lastMovePoint.x * gap, pad + lastMovePoint.y * gap, currentMoveMarker)}
            fill="none"
            stroke={currentMoveMarker.stroke}
            strokeWidth={currentMoveMarker.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
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
            <circle
              className="candidate-dot move-quality-dot"
              cx={x}
              cy={y}
              r={visual.radius}
              fill={`url(#${candidateGradientId(candidate.pointLoss)})`}
              stroke={visual.primary ? 'rgba(10, 200, 250, 0.55)' : 'rgba(17, 17, 17, 0.14)'}
              strokeWidth={visual.primary ? 1.2 : 0.5}
            />
            {visual.showText && (
              <text
                className="candidate-label move-quality-label"
                x={x}
                y={visual.showVisits ? y - 2 : y + 3}
                textAnchor="middle"
                fontSize={visual.primary ? 8.6 : 8}
                fontWeight="700"
                fill="#16120b"
                paintOrder="stroke"
                stroke="rgba(236, 198, 125, 0.7)"
                strokeWidth="2.2"
                strokeLinejoin="round"
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
        const opacity = sequenceStoneOpacity(index)
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

function trialMovesByPoint(trialMoves?: string[]) {
  const moves = new Map<string, { move: string; number: number }>()
  ;(trialMoves ?? []).forEach((move, index) => {
    const point = gtpToPoint(move)
    if (!point) return
    moves.set(pointKey(point.x, point.y), { move, number: index + 1 })
  })
  return moves
}

function sequenceStoneOpacity(index: number) {
  return Math.max(0.45, 0.82 - index * 0.08)
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
    opacity: candidate.lowVisits ? 0.5 : primary ? 0.92 : 0.78,
  }
}

function qualityMarkerVisual() {
  return {
    radius: gap * 0.27,
    opacity: 0.78,
  }
}

function candidateGradientId(pointLoss: number) {
  return `${candidateGradientPrefix}-${evalClassForPointLoss(pointLoss)}`
}

function currentMoveMarkerVisual() {
  return {
    halfSize: gap * 0.48,
    tickLength: gap * 0.15,
    stroke: '#f2c15d',
    strokeWidth: 1.35,
    shadowStrokeWidth: 2.7,
    opacity: 0.95,
  }
}

function currentMoveMarkerPath(x: number, y: number, marker: ReturnType<typeof currentMoveMarkerVisual>) {
  const h = marker.halfSize
  const l = marker.tickLength
  return [
    `M ${x - h} ${y - h + l} L ${x - h} ${y - h} L ${x - h + l} ${y - h}`,
    `M ${x + h - l} ${y - h} L ${x + h} ${y - h} L ${x + h} ${y - h + l}`,
    `M ${x + h} ${y + h - l} L ${x + h} ${y + h} L ${x + h - l} ${y + h}`,
    `M ${x - h + l} ${y + h} L ${x - h} ${y + h} L ${x - h} ${y + h - l}`,
  ].join(' ')
}

function weakStoneMarkerOpacity(value: number) {
  return String(Math.round((0.12 + 0.28 * Math.min(1, Math.abs(value))) * 100) / 100)
}
