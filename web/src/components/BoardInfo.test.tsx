import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoardInfo } from './BoardInfo'

describe('BoardInfo', () => {
  it('shows a compact matchup with colored stones and the game result', () => {
    render(<BoardInfo blackName="Lee" whiteName="Cho" result="B+R" />)
    expect(screen.getByLabelText('黑 Lee')).toBeInTheDocument()
    expect(screen.getByLabelText('白 Cho')).toBeInTheDocument()
    expect(screen.getByText('vs')).toBeInTheDocument()
    expect(screen.getByText('黑中盘胜')).toBeInTheDocument()
    expect(document.querySelector('.board-player-stone-black')).toBeInTheDocument()
    expect(document.querySelector('.board-player-stone-white')).toBeInTheDocument()
    expect(screen.queryByText('japanese')).not.toBeInTheDocument()
    expect(screen.queryByText(/贴目/)).not.toBeInTheDocument()
  })

  it('formats point wins and unknown results without exposing raw SGF codes', () => {
    const { rerender } = render(<BoardInfo blackName="Lee" whiteName="Cho" result="W+2.5" />)
    expect(screen.getByText('白胜 2.5目')).toBeInTheDocument()

    rerender(<BoardInfo blackName="Lee" whiteName="Cho" result="白胜6.25子" />)
    expect(screen.getByText('白胜 12.5目')).toBeInTheDocument()

    rerender(<BoardInfo blackName="Lee" whiteName="Cho" result="" />)
    expect(screen.getByText('结果未知')).toBeInTheDocument()
  })
})
