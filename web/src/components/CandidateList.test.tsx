import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CandidateList } from './CandidateList'

describe('CandidateList', () => {
  it('renders candidate moves as the final right rail section', () => {
    const onCandidateClick = vi.fn()
    render(
      <CandidateList
        candidates={[
          { move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['Q16'], lowVisits: false },
        ]}
        onCandidateClick={onCandidateClick}
      />,
    )

    expect(screen.getByLabelText('候选点')).toBeInTheDocument()
    expect(screen.queryByText('候选点')).not.toBeInTheDocument()
    screen.getByText('Q16').click()
    expect(screen.getByText('400v')).toBeInTheDocument()
    expect(screen.getByText('63.0%')).toBeInTheDocument()
    expect(onCandidateClick).toHaveBeenCalledWith('Q16')
  })
})
