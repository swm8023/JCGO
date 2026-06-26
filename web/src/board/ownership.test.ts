import { describe, expect, it } from 'vitest'
import { decodeOwnershipQ8, ownershipAt } from './ownership'

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
})
