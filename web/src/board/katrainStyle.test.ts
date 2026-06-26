import { describe, expect, it } from 'vitest'
import { evalClassForPointLoss, formatCandidateDelta, katrainEvalColor } from './katrainStyle'

describe('KaTrain style helpers', () => {
  it('maps point loss to KaTrain classes', () => {
    expect(evalClassForPointLoss(13)).toBe(0)
    expect(evalClassForPointLoss(7)).toBe(1)
    expect(evalClassForPointLoss(4)).toBe(2)
    expect(evalClassForPointLoss(2)).toBe(3)
    expect(evalClassForPointLoss(0.7)).toBe(4)
    expect(evalClassForPointLoss(0)).toBe(5)
  })

  it('formats KaTrain candidate delta as negative pointsLost', () => {
    expect(formatCandidateDelta(1.25)).toBe('-1.3')
    expect(formatCandidateDelta(-0.4)).toBe('+0.4')
  })

  it('returns green for class five', () => {
    expect(katrainEvalColor(0)).toBe('#1e9600')
  })
})
