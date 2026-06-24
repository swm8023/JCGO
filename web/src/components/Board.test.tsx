import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Board } from './Board'

describe('Board', () => {
  it('renders board coordinates, star points, stones, current move, and next-move candidates', () => {
    render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [{ x: 15, y: 3, color: 'B' }],
          lastMove: { nodeId: 'main:1', moveNumber: 1, color: 'B', gtp: 'Q16', pass: false },
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
                pointLoss: 0.3,
                relativePointLoss: 0,
                winrateLoss: 0,
                pv: ['D16'],
                lowVisits: false,
              },
              {
                move: 'Q4',
                order: 1,
                visits: 1500,
                winrate: 0.49,
                scoreLead: -0.4,
                pointLoss: -0.4,
                relativePointLoss: 0,
                winrateLoss: 0,
                pv: ['Q4'],
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
    const board = screen.getByLabelText('Go board')
    expect(board).toBeInTheDocument()
    expect(board.querySelectorAll('.board-coordinate.file')).toHaveLength(19)
    expect(board.querySelectorAll('.board-coordinate.rank')).toHaveLength(19)
    expect(board).toHaveTextContent('A')
    expect(board).toHaveTextContent('T')
    expect(board).not.toHaveTextContent('I')
    expect(board).toHaveTextContent('19')
    expect(board).toHaveTextContent('1')
    expect(board.querySelectorAll('.star-point')).toHaveLength(9)
    expect(board.querySelector('.star-point.tengen')).toBeInTheDocument()
    expect(screen.getByLabelText('Current move Q16')).toBeInTheDocument()
    const candidateD16 = screen.getByLabelText('Recommended next move D16')
    const candidateQ4 = screen.getByLabelText('Recommended next move Q4')
    expect(candidateD16).toBeInTheDocument()
    expect(candidateD16).toHaveTextContent('-0.3')
    expect(candidateD16).toHaveTextContent('500')
    expect(candidateQ4).toBeInTheDocument()
    expect(candidateQ4).toHaveTextContent('+0.4')
    expect(candidateQ4).toHaveTextContent('1.5k')
  })
})
