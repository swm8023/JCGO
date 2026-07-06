import { useMemo, useState } from 'react'
import type { BadMove, CandidateMove } from '../api/types'
import { BadMoveListContent } from './BadMoveList'
import { CandidateListContent } from './CandidateList'

interface AnalysisDetailTabsProps {
  badMoves: BadMove[]
  candidates: CandidateMove[]
  onJump(moveNumber: number): void
  onCandidateClick(candidate: CandidateMove): void
  onRequestBadMovePrompt?(move: BadMove): Promise<string>
}

type DetailTab = 'black-bad' | 'white-bad' | 'candidates'

export function AnalysisDetailTabs({ badMoves, candidates, onJump, onCandidateClick, onRequestBadMovePrompt }: AnalysisDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('candidates')
  const blackBadMoves = useMemo(() => badMoves.filter((move) => move.color === 'B'), [badMoves])
  const whiteBadMoves = useMemo(() => badMoves.filter((move) => move.color === 'W'), [badMoves])
  const tabs = [
    { id: 'black-bad' as const, label: '黑恶手', shortLabel: '黑', count: blackBadMoves.length },
    { id: 'white-bad' as const, label: '白恶手', shortLabel: '白', count: whiteBadMoves.length },
    { id: 'candidates' as const, label: '推荐点', shortLabel: '推荐', count: candidates.length },
  ]
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[2]

  return (
    <section className="analysis-detail-tabs rail-section" aria-label="分析明细">
      <div className="analysis-tab-list" role="tablist" aria-label="分析明细">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`analysis-tab-${tab.id}`}
            className="analysis-tab"
            type="button"
            role="tab"
            aria-label={`${tab.label} ${tab.count}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`analysis-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="analysis-tab-label">{tab.shortLabel}</span>
            <span className="analysis-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>
      <div id={`analysis-panel-${active.id}`} className="analysis-tab-panel rail-section-body" role="tabpanel" aria-labelledby={`analysis-tab-${active.id}`}>
        {activeTab === 'black-bad' && <BadMoveListContent badMoves={blackBadMoves} onJump={onJump} onRequestBadMovePrompt={onRequestBadMovePrompt} emptyLabel="暂无黑棋恶手" />}
        {activeTab === 'white-bad' && <BadMoveListContent badMoves={whiteBadMoves} onJump={onJump} onRequestBadMovePrompt={onRequestBadMovePrompt} emptyLabel="暂无白棋恶手" />}
        {activeTab === 'candidates' && <CandidateListContent candidates={candidates} onCandidateClick={onCandidateClick} />}
      </div>
    </section>
  )
}
