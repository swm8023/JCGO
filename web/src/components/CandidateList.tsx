import type { CandidateMove } from '../api/types'

interface CandidateListProps {
  candidates: CandidateMove[]
  onCandidateClick(move: string): void
}

export function CandidateList({ candidates, onCandidateClick }: CandidateListProps) {
  return (
    <section className="candidate-list-section rail-section" aria-label="候选点">
      <div className="rail-section-body candidate-list">
        {candidates.map((candidate) => (
          <CandidateRow key={candidate.move} candidate={candidate} onClick={() => onCandidateClick(candidate.move)} />
        ))}
      </div>
    </section>
  )
}

function CandidateRow({ candidate, onClick }: { candidate: CandidateMove; onClick(): void }) {
  return (
    <button className={candidate.lowVisits ? 'candidate-row low-visits' : 'candidate-row'} onClick={onClick}>
      <span className="candidate-move">{candidate.move}</span>
      <span>{candidate.visits}v</span>
      <span>{(candidate.winrate * 100).toFixed(1)}%</span>
      <span>{formatScore(candidate.scoreLead)}</span>
      <span>loss {candidate.pointLoss.toFixed(1)}</span>
    </button>
  )
}

function formatScore(scoreLead: number) {
  return scoreLead >= 0 ? `B +${scoreLead.toFixed(1)}` : `W +${Math.abs(scoreLead).toFixed(1)}`
}
