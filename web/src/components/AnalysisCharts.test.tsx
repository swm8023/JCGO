import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisCharts } from './AnalysisCharts'

describe('AnalysisCharts', () => {
  it('renders the ECharts-backed curve while preserving move jump targets', () => {
    const onJump = vi.fn()

    render(
      <AnalysisCharts
        points={[
          { moveNumber: 0, winrate: 0.42, scoreLead: -2.1 },
          { moveNumber: 50, winrate: 0.56, scoreLead: 1.4 },
          { moveNumber: 100, winrate: 0.48, scoreLead: -0.8 },
          { moveNumber: 200, winrate: 0.66, scoreLead: 5.2 },
        ]}
        currentMoveNumber={100}
        onJump={onJump}
      />,
    )

    expect(screen.queryByText('胜率曲线')).not.toBeInTheDocument()
    const chart = screen.getByLabelText('Winrate curve')
    expect(chart.tagName.toLowerCase()).toBe('div')
    expect(chart).toHaveClass('echarts-chart')
    expect(document.querySelector('svg.winrate-chart')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jump to move 100'))
    expect(onJump).toHaveBeenCalledWith(100)
    expect(screen.queryByText('42.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('5.2')).not.toBeInTheDocument()
  })
})
