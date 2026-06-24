import type { BadMove } from '../api/types'

interface BadMoveListProps {
  badMoves: BadMove[]
  onJump(moveNumber: number): void
  emptyLabel?: string
}

export function BadMoveList({ badMoves, onJump, emptyLabel }: BadMoveListProps) {
  return (
    <section className="bad-move-list-section rail-section" aria-label="坏棋列表">
      <div className="rail-section-body">
        <BadMoveListContent badMoves={badMoves} onJump={onJump} emptyLabel={emptyLabel} />
      </div>
    </section>
  )
}

export function BadMoveListContent({ badMoves, onJump, emptyLabel = '暂无恶手' }: BadMoveListProps) {
  if (badMoves.length === 0) return <p className="empty-list">{emptyLabel}</p>

  return (
    <div className="bad-move-list">
      {badMoves.map((move) => (
        <button key={move.nodeId} className={`bad-move class-${move.class}`} onClick={() => onJump(move.moveNumber)}>
          <span>{move.moveNumber}</span>
          <span>{move.move}</span>
          <span>{move.pointLoss.toFixed(1)}</span>
        </button>
      ))}
    </div>
  )
}
