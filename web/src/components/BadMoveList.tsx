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
  const [failedNodeId, setFailedNodeId] = useState<string>()
  const [copyingNodeId, setCopyingNodeId] = useState<string>()
  if (badMoves.length === 0) return <p className="empty-list">{emptyLabel}</p>

  const copyPrompt = async (move: BadMove) => {
    if (!onRequestBadMovePrompt) return
    setCopyingNodeId(move.nodeId)
    setCopiedNodeId((current) => (current === move.nodeId ? undefined : current))
    setFailedNodeId((current) => (current === move.nodeId ? undefined : current))
    try {
      const prompt = await onRequestBadMovePrompt(move)
      if (await copyText(prompt)) {
        setCopiedNodeId(move.nodeId)
        window.setTimeout(() => {
          setCopiedNodeId((current) => (current === move.nodeId ? undefined : current))
        }, 1400)
        return
      }
      setFailedNodeId(move.nodeId)
      window.setTimeout(() => {
        setFailedNodeId((current) => (current === move.nodeId ? undefined : current))
      }, 1400)
    } catch {
      setFailedNodeId(move.nodeId)
      window.setTimeout(() => {
        setFailedNodeId((current) => (current === move.nodeId ? undefined : current))
      }, 1400)
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
              aria-label={`${copyLabel(move.nodeId, copiedNodeId, failedNodeId)} ${move.move}`}
              disabled={copyingNodeId === move.nodeId}
              onClick={() => void copyPrompt(move)}
            >
              {copyLabel(move.nodeId, copiedNodeId, failedNodeId)}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the document copy path.
    }
  }
  return copyTextWithSelection(text)
}

function copyTextWithSelection(text: string) {
  if (typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function copyLabel(nodeId: string, copiedNodeId?: string, failedNodeId?: string) {
  if (copiedNodeId === nodeId) return '已复制'
  if (failedNodeId === nodeId) return '复制失败'
  return '复制'
}
