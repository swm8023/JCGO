import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')

describe('right rail layout', () => {
  it('orders analysis sections by current position, curve, bad moves, candidates', () => {
    const current = app.indexOf('<AnalysisPanel')
    const curve = app.indexOf('<AnalysisCharts')
    const badMoves = app.indexOf('<BadMoveList')
    const candidates = app.indexOf('<CandidateList')

    expect(current).toBeGreaterThan(0)
    expect(curve).toBeGreaterThan(current)
    expect(badMoves).toBeGreaterThan(curve)
    expect(candidates).toBeGreaterThan(badMoves)
  })
})
