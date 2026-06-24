import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalysisCharts } from './AnalysisCharts'

describe('AnalysisCharts', () => {
  it('renders a visible winrate curve', () => {
    render(
      <AnalysisCharts
        points={[
          { moveNumber: 0, winrate: 0.42, scoreLead: -2.1 },
          { moveNumber: 1, winrate: 0.56, scoreLead: 1.4 },
        ]}
        onJump={() => undefined}
      />,
    )

    expect(screen.getByText('胜率曲线')).toBeInTheDocument()
    expect(screen.getByLabelText('Winrate curve')).toBeInTheDocument()
    expect(screen.getByText('42.0%')).toBeInTheDocument()
    expect(screen.getByText('56.0%')).toBeInTheDocument()
  })
})
