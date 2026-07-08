import type { CandidateMove } from '../api/types'

interface CandidateListProps {
  candidates: CandidateMove[]
  onCandidateClick(candidate: CandidateMove): void
  emptyLabel?: string
}

export function CandidateList({ candidates, onCandidateClick, emptyLabel }: CandidateListProps) {
  return (
    <section className="candidate-list-section rail-section" aria-label="候选点">
      <div className="rail-section-body">
        <CandidateListContent candidates={candidates} onCandidateClick={onCandidateClick} emptyLabel={emptyLabel} />
      </div>
    </section>
  )
}

export function CandidateListContent({ candidates, onCandidateClick, emptyLabel = '暂无推荐点' }: CandidateListProps) {
  if (candidates.length === 0) return <p className="empty-list">{emptyLabel}</p>

  return (
    <div className="candidate-list">
      {candidates.map((candidate) => (
        <CandidateRow key={candidate.move} candidate={candidate} onClick={() => onCandidateClick(candidate)} />
      ))}
    </div>
  )
}

function CandidateRow({ candidate, onClick }: { candidate: CandidateMove; onClick(): void }) {
  return (
    <button className={candidate.lowVisits ? 'candidate-row low-visits' : 'candidate-row'} onClick={onClick}>
      <span className="candidate-move">{candidate.move}</span>
      <span>{candidate.visits}v</span>
      <span>{(candidate.winrate * 100).toFixed(1)}%</span>
      <span>{formatScore(candidate.scoreLead)}</span>
      <span>损失 {candidate.pointLoss.toFixed(1)}目</span>
    </button>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B +${scoreLead.toFixed(1)}` : `W +${Math.abs(scoreLead).toFixed(1)}`
}
