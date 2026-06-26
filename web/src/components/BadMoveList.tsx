import { useState } from 'react'
import type { BadMove } from '../api/types'

interface BadMoveListProps {
  badMoves: BadMove[]
  onJump(moveNumber: number): void
  onRequestBadMovePrompt?(move: BadMove): Promise<string>
  emptyLabel?: string
}

export function BadMoveList({ badMoves, onJump, onRequestBadMovePrompt, emptyLabel }: BadMoveListProps) {
  return (
    <section className="bad-move-list-section rail-section" aria-label="坏棋列表">
      <div className="rail-section-body">
        <BadMoveListContent badMoves={badMoves} onJump={onJump} onRequestBadMovePrompt={onRequestBadMovePrompt} emptyLabel={emptyLabel} />
      </div>
    </section>
  )
}

export function BadMoveListContent({ badMoves, onJump, onRequestBadMovePrompt, emptyLabel = '暂无恶手' }: BadMoveListProps) {
  const [copiedNodeId, setCopiedNodeId] = useState<string>()
  const [copyingNodeId, setCopyingNodeId] = useState<string>()
  if (badMoves.length === 0) return <p className="empty-list">{emptyLabel}</p>

  const copyPrompt = async (move: BadMove) => {
    if (!onRequestBadMovePrompt) return
    setCopyingNodeId(move.nodeId)
    try {
      const prompt = await onRequestBadMovePrompt(move)
      await navigator.clipboard.writeText(prompt)
      setCopiedNodeId(move.nodeId)
      window.setTimeout(() => {
        setCopiedNodeId((current) => (current === move.nodeId ? undefined : current))
      }, 1400)
    } catch {
      // Copy failures leave the row unchanged.
    } finally {
      setCopyingNodeId((current) => (current === move.nodeId ? undefined : current))
    }
  }

  return (
    <div className="bad-move-list">
      {badMoves.map((move) => (
        <div key={move.nodeId} className={`bad-move class-${move.class}`}>
          <button type="button" className="bad-move-jump" onClick={() => onJump(move.moveNumber)}>
            <span>{move.moveNumber}</span>
            <span>{move.move}</span>
            <span>{move.pointLoss.toFixed(1)}</span>
          </button>
          {onRequestBadMovePrompt && (
            <button
              type="button"
              className="bad-move-copy"
              aria-label={`${copiedNodeId === move.nodeId ? '已复制' : '复制'} ${move.move}`}
              disabled={copyingNodeId === move.nodeId}
              onClick={() => void copyPrompt(move)}
            >
              {copiedNodeId === move.nodeId ? '已复制' : '复制'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
