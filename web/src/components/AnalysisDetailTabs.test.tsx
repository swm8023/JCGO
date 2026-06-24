import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisDetailTabs } from './AnalysisDetailTabs'

describe('AnalysisDetailTabs', () => {
  it('switches between black bad moves, white bad moves, and candidate moves', async () => {
    const onCandidateClick = vi.fn()
    const onJump = vi.fn()
    render(
      <AnalysisDetailTabs
        badMoves={[
          { nodeId: 'black-1', moveNumber: 1, move: 'Q16', pointLoss: 3.2, class: 1 },
          { nodeId: 'white-2', moveNumber: 2, move: 'D4', pointLoss: 4.8, class: 2 },
        ]}
        candidates={[
          { move: 'R17', order: 0, visits: 360, winrate: 0.62, scoreLead: 3.7, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['R17'], lowVisits: false },
        ]}
        onCandidateClick={onCandidateClick}
        onJump={onJump}
      />,
    )

    expect(screen.getByRole('tab', { name: '推荐点 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '推荐点 1' })).toHaveTextContent('R17')
    expect(screen.queryByText('Q16')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '黑恶手 1' }))
    expect(screen.getByRole('tab', { name: '黑恶手 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '黑恶手 1' })).toHaveTextContent('Q16')
    expect(screen.queryByText('D4')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Q16'))
    expect(onJump).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('tab', { name: '白恶手 1' }))
    expect(screen.getByRole('tabpanel', { name: '白恶手 1' })).toHaveTextContent('D4')
    expect(screen.queryByText('Q16')).not.toBeInTheDocument()
  })
})
