import type { BadMove } from '../api/types'

interface BadMoveListProps {
  badMoves: BadMove[]
  onJump(moveNumber: number): void
}

export function BadMoveList({ badMoves, onJump }: BadMoveListProps) {
  return (
    <section className="bad-move-list-section rail-section">
      <h2>坏棋列表</h2>
      <div className="rail-section-body bad-move-list">
        {badMoves.map((move) => (
          <button key={move.nodeId} className={`bad-move class-${move.class}`} onClick={() => onJump(move.moveNumber)}>
            <span>{move.moveNumber}</span>
            <span>{move.move}</span>
            <span>{move.pointLoss.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
