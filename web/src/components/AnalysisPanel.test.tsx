import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'

describe('AnalysisPanel', () => {
  it('shows a compact current position summary without title or actions', () => {
    render(
      <AnalysisPanel
        analysis={{
          winrate: 0.625,
          scoreLead: 4.2,
          visits: 500,
          candidates: [
            { move: 'Q16', order: 0, visits: 400, winrate: 0.63, scoreLead: 4.4, pointLoss: 0, relativePointLoss: 0, winrateLoss: 0, pv: ['Q16'], lowVisits: false },
          ],
        }}
      />,
    )
    expect(screen.queryByText('当前局面')).not.toBeInTheDocument()
    const summary = screen.getByLabelText('当前局面')
    expect(summary).toHaveTextContent('黑胜率 62.5%')
    expect(summary).toHaveTextContent('目差 黑 +4.2')
    expect(summary).toHaveTextContent('访问 500v')
    expect(summary.querySelector('small')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /analysis/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Q16')).not.toBeInTheDocument()
  })

  it('shows white for negative scoreLead', () => {
    render(
      <AnalysisPanel
        analysis={{
          winrate: 0.375,
          scoreLead: -5.8,
          visits: 300,
          candidates: [],
        }}
      />,
    )
    const summaries = screen.getAllByLabelText('当前局面')
    const summary = summaries[summaries.length - 1]
    expect(summary).toHaveTextContent('黑胜率 37.5%')
    expect(summary).toHaveTextContent('目差 白 +5.8')
    expect(summary).toHaveTextContent('访问 300v')
  })
})
