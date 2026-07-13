import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CandidateList } from './CandidateList'

describe('CandidateList', () => {
  it('renders candidate moves as the final right rail section', () => {
    const onCandidateClick = vi.fn()
    const candidate = { move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['Q16'], lowVisits: false }
    render(
      <CandidateList
        candidates={[candidate]}
        onCandidateClick={onCandidateClick}
      />,
    )

    expect(screen.getByLabelText('候选点')).toBeInTheDocument()
    expect(screen.queryByText('候选点')).not.toBeInTheDocument()
    screen.getByText('Q16').click()
    expect(screen.getByText('400v')).toBeInTheDocument()
    expect(screen.getByText('63.0%')).toBeInTheDocument()
    expect(screen.getByText('黑 +4.4')).toBeInTheDocument()
    expect(screen.getByText('损失 0.0目')).toBeInTheDocument()
    expect(onCandidateClick).toHaveBeenCalledWith(candidate)
  })

  it('shows white for a negative candidate score lead', () => {
    render(
      <CandidateList
        candidates={[{ move: 'D4', order: 0, visits: 200, winrate: 0.37, scoreLead: -2.6, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['D4'], lowVisits: false }]}
        onCandidateClick={vi.fn()}
      />,
    )

    expect(screen.getByText('白 +2.6')).toBeInTheDocument()
  })
})
