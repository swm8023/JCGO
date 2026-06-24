import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'

describe('AnalysisPanel', () => {
  it('shows black winrate score lead and candidates', () => {
    render(
      <AnalysisPanel
        engineStatus={{ available: true }}
        analysis={{
          winrate: 0.625,
          scoreLead: 4.2,
          visits: 500,
          candidates: [
            { move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['Q16'], lowVisits: false },
          ],
        }}
        analysisState="idle"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        onCandidateClick={vi.fn()}
      />,
    )
    expect(screen.getByText('62.5%')).toBeInTheDocument()
    expect(screen.getByText('B +4.2')).toBeInTheDocument()
    expect(screen.getByText('Q16')).toBeInTheDocument()
  })
})
