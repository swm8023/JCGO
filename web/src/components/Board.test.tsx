import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Board } from './Board'

afterEach(() => cleanup())

describe('Board', () => {
  it('renders ownership, dead stone marks, candidate colors, and current move quality when enabled', () => {
    const ownershipBytes = new Uint8Array(361)
    ownershipBytes[3 * 19 + 15] = 129
    const ownership = btoa(String.fromCharCode(...ownershipBytes))
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
          children: [],
          toPlay: 'W',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: true,
          canNext: false,
          canBackToMain: false,
        }}
        candidates={[
          {
            move: 'D16',
            order: 0,
            visits: 500,
            winrate: 0.5,
            scoreLead: 0,
            pointLoss: 0.7,
            relativePointLoss: 0,
            winrateLoss: 0,
            pv: ['D16'],
            lowVisits: false,
          },
        ]}
        ownership={{ encoding: 'q8-base64', data: ownership }}
        playedPointLoss={2}
        overlays={{ candidates: true, ownership: true, deadStones: true }}
        tryMode={false}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
      />,
    )
    const board = screen.getByLabelText('Go board')
    expect(board.querySelector('.ownership-layer.smooth')).toHaveAttribute('mask', 'url(#ownership-edge-fade)')
    expect(board.querySelector('.ownership-layer.smooth')).not.toHaveAttribute('clip-path')
    expect(board.querySelector('#ownership-edge-fade')).toBeInTheDocument()
    expect(board.querySelector('.ownership-edge-fade.right')).toHaveAttribute('fill', 'url(#ownership-fade-right)')
    expect(board.querySelector('.ownership-edge-fade.right')).toHaveAttribute('width', '21')
    expect(board.querySelector('.ownership-soft-layer.black')).toHaveAttribute('filter', 'url(#ownership-soften)')
    expect(board.querySelector('feGaussianBlur')).toHaveAttribute('stdDeviation', '11')
    expect(board.querySelector('.ownership-sample')).toHaveAttribute('fill', 'rgb(244 244 255)')
    expect(board.querySelector('.ownership-sample')).toHaveAttribute('r', '31.360000000000003')
    expect(board.querySelector('.ownership-layer rect')).not.toBeInTheDocument()
    expect(board.querySelector('.stone.black-stone')).toHaveAttribute('fill', 'url(#black-stone-gradient)')
    expect(board.querySelector('.stone.black-stone')).toHaveAttribute('filter', 'url(#stone-shadow)')
    expect(screen.getByLabelText('Weak stone marker Q16').tagName).toBe('path')
    expect(screen.getByLabelText('Weak stone marker Q16')).toHaveAttribute('opacity', '0.4')
    const currentQuality = screen.getByLabelText('Current move quality Q16')
    expect(currentQuality).toHaveTextContent('-2.0')
    expect(currentQuality.querySelector('.move-quality-dot')).toHaveAttribute('fill', 'url(#candidate-fill-3)')
    expect(currentQuality.querySelector('.candidate-backplate')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current move Q16')).toHaveAttribute('stroke', '#f5f2ea')
    expect(screen.getByLabelText('Current move Q16')).toHaveAttribute('r', '12.88')
    expect(screen.getByLabelText('Recommended next move D16').querySelector('.candidate-dot')).toHaveAttribute('fill', 'url(#candidate-fill-4)')
    expect(screen.getByLabelText('Recommended next move D16').querySelector('.candidate-dot')).toHaveAttribute('stroke', 'rgba(10, 200, 250, 0.55)')
  })

  it('scales weak stone marker opacity by ownership certainty', () => {
    const ownershipBytes = new Uint8Array(361)
    ownershipBytes[3 * 19 + 15] = 129
    ownershipBytes[15 * 19 + 3] = 224
    const ownership = btoa(String.fromCharCode(...ownershipBytes))
    render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [
            { x: 15, y: 3, color: 'B' },
            { x: 3, y: 15, color: 'B' },
          ],
          children: [],
          toPlay: 'W',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: false,
          canNext: false,
          canBackToMain: false,
        }}
        ownership={{ encoding: 'q8-base64', data: ownership }}
        overlays={{ candidates: false, ownership: true, deadStones: true }}
        tryMode={false}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Weak stone marker Q16')).toHaveAttribute('opacity', '0.4')
    expect(screen.getByLabelText('Weak stone marker D4')).toHaveAttribute('opacity', '0.19')
  })

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
          children: [{ nodeId: 'main:2', moveNumber: 2, color: 'W', gtp: 'D4', pass: false }],
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
        tryMode={false}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
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
    expect(screen.getByLabelText('Actual next move D4')).toBeInTheDocument()
    const candidateD16 = screen.getByLabelText('Recommended next move D16')
    const candidateQ4 = screen.getByLabelText('Recommended next move Q4')
    expect(candidateD16).toBeInTheDocument()
    expect(candidateD16).toHaveTextContent('-0.3')
    expect(candidateD16).toHaveTextContent('500')
    expect(candidateD16.querySelector('.candidate-backplate')).not.toBeInTheDocument()
    expect(candidateD16.querySelector('.candidate-label')).toHaveAttribute('paint-order', 'stroke')
    expect(candidateQ4).toBeInTheDocument()
    expect(candidateQ4).toHaveTextContent('+0.4')
    expect(candidateQ4).not.toHaveTextContent('1.5k')
  })

  it('keeps low-visit candidates as quiet dots without labels', () => {
    render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [],
          children: [],
          toPlay: 'B',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: false,
          canNext: false,
          canBackToMain: false,
        }}
        candidates={[
          {
            move: 'Q4',
            order: 5,
            visits: 4,
            winrate: 0.47,
            scoreLead: -2,
            pointLoss: 2.5,
            relativePointLoss: 0,
            winrateLoss: 0,
            pv: ['Q4'],
            lowVisits: true,
          },
        ]}
        tryMode={false}
        onPlay={vi.fn()}
        onPreviewPV={vi.fn()}
      />,
    )

    const candidate = screen.getByLabelText('Recommended next move Q4')
    expect(candidate).not.toHaveTextContent('-2.5')
    expect(candidate.querySelector('.candidate-backplate')).not.toBeInTheDocument()
    expect(candidate.querySelector('.candidate-dot')).toHaveAttribute('r', '4.48')
    expect(candidate).toHaveAttribute('opacity', '0.5')
  })

  it('uses click to preview candidate PV before try mode can play it', () => {
    const onPlay = vi.fn()
    const onPreviewPV = vi.fn()
    const snapshot = {
      gameId: 'g',
      nodeId: 'main:1',
      moveNumber: 1,
      totalMoves: 1,
      branchMode: 'main' as const,
      stones: [],
      children: [],
      toPlay: 'W' as const,
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
            pv: ['D16', 'Q4'],
            lowVisits: false,
          },
        ],
      },
    }

    const { container, rerender } = render(
      <Board snapshot={snapshot} tryMode={false} onPlay={onPlay} onPreviewPV={onPreviewPV} />,
    )
    const board = within(container)

    fireEvent.click(board.getByLabelText('Recommended next move D16'))
    expect(onPreviewPV).toHaveBeenCalledWith(snapshot.analysis.candidates[0])
    expect(onPlay).not.toHaveBeenCalled()

    rerender(<Board snapshot={snapshot} tryMode onPlay={onPlay} onPreviewPV={onPreviewPV} />)
    fireEvent.click(board.getByLabelText('Try recommended move D16'))
    expect(onPlay).toHaveBeenCalledWith('D16')
  })

  it('allows trying any empty board point in try mode', () => {
    const onPlay = vi.fn()
    const { container } = render(
      <Board
        snapshot={{
          gameId: 'g',
          nodeId: 'main:1',
          moveNumber: 1,
          totalMoves: 1,
          branchMode: 'main',
          stones: [{ x: 15, y: 3, color: 'B' }],
          children: [],
          toPlay: 'W',
          rules: 'chinese',
          komi: 7.5,
          captures: { B: 0, W: 0 },
          gameEnded: false,
          canPrevious: true,
          canNext: false,
          canBackToMain: false,
        }}
        tryMode
        onPlay={onPlay}
        onPreviewPV={vi.fn()}
      />,
    )
    const board = within(container)

    fireEvent.click(board.getByLabelText('Try move D4'))
    expect(onPlay).toHaveBeenCalledWith('D4')
    expect(board.queryByLabelText('Try move Q16')).not.toBeInTheDocument()
  })
})
