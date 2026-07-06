import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalysisCharts } from './AnalysisCharts'

describe('AnalysisCharts', () => {
  it('renders winrate and score curves with move ticks and current move marker', () => {
    render(
      <AnalysisCharts
        points={[
          { moveNumber: 0, winrate: 0.42, scoreLead: -2.1 },
          { moveNumber: 50, winrate: 0.56, scoreLead: 1.4 },
          { moveNumber: 100, winrate: 0.48, scoreLead: -0.8 },
          { moveNumber: 200, winrate: 0.66, scoreLead: 5.2 },
        ]}
        currentMoveNumber={100}
        onJump={() => undefined}
      />,
    )

    expect(screen.queryByText('胜率曲线')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Winrate curve')).toHaveAttribute('preserveAspectRatio', 'none')
    expect(screen.getByLabelText('Winrate curve')).toHaveAttribute('viewBox', '0 0 320 112')
    expect(screen.getByLabelText('Black winrate line')).toBeInTheDocument()
    expect(screen.getByLabelText('Score lead line')).toBeInTheDocument()
    expect(screen.getByLabelText('Current move marker')).toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    for (const tickLabel of screen.getByLabelText('Winrate curve').querySelectorAll('.chart-tick-label')) {
      expect(Number(tickLabel.getAttribute('y'))).toBeGreaterThanOrEqual(104)
      expect(Number(tickLabel.getAttribute('y'))).toBeLessThanOrEqual(106)
    }
    expect(screen.queryByText('42.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('5.2')).not.toBeInTheDocument()
  })
})
