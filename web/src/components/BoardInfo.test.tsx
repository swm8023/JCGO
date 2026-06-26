import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoardInfo } from './BoardInfo'

describe('BoardInfo', () => {
  it('shows players komi and rules', () => {
    render(<BoardInfo blackName="Lee" whiteName="Cho" komi={6.5} rules="japanese" />)
    expect(screen.getByText('黑 Lee')).toBeInTheDocument()
    expect(screen.getByText('白 Cho')).toBeInTheDocument()
    expect(screen.getByText('贴目 6.5')).toBeInTheDocument()
    expect(screen.getByText('japanese')).toBeInTheDocument()
  })
})
