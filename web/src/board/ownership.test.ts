import { describe, expect, it } from 'vitest'
import { decodeOwnershipQ8, ownershipAt, ownershipDisplay } from './ownership'

describe('ownership helpers', () => {
  it('decodes q8 base64 into signed ownership values', () => {
    const data = btoa(String.fromCharCode(129, 0, 127))
    const decoded = decodeOwnershipQ8({ encoding: 'q8-base64', data })
    expect(decoded[0]).toBeCloseTo(-1)
    expect(decoded[1]).toBe(0)
    expect(decoded[2]).toBeCloseTo(1)
  })

  it('indexes ownership by x y', () => {
    const values = Array.from({ length: 361 }, (_, i) => i / 127)
    expect(ownershipAt(values, 3, 4)).toBe(values[4 * 19 + 3])
  })

  it('maps ownership into softened display samples', () => {
    expect(ownershipDisplay(0.01)).toBeNull()
    expect(ownershipDisplay(1)).toMatchObject({ owner: 'B', fill: 'rgb(28 24 20)', alpha: 0.22 })
    expect(ownershipDisplay(-1)).toMatchObject({ owner: 'W', fill: 'rgb(244 244 255)', alpha: 0.26 })
    expect(ownershipDisplay(0.25)?.alpha).toBeLessThan(ownershipDisplay(1)?.alpha ?? 0)
  })
})
