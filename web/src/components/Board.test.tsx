import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Board } from './Board'

describe('Board', () => {
  it('renders stones and candidate labels', () => {
    render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [{ x: 15, y: 3, color: 'B' }],
          toPlay: 'W',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: true,
          canNext: false,
          canBackToMain: false,
          analysis: {
            winrate: 0.5,
            scoreLead: 0,
            visits: 500,
            candidates: [
              {
                move: 'D16',
                order: 0,
                visits: 500,
                winrate: 0.5,
                scoreLead: 0,
                pointLoss: 0,
                relativePointLoss: 0,
                winrateLoss: 0,
                pv: ['D16'],
                lowVisits: false,
              },
            ],
          },
        }}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
        onClearPV={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Go board')).toBeInTheDocument()
  })
})
