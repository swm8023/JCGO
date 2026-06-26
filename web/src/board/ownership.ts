import type { EncodedOwnership } from '../api/types'

export function decodeOwnershipQ8(ownership?: EncodedOwnership): number[] {
  if (!ownership || ownership.encoding !== 'q8-base64') return []
  const raw = atob(ownership.data)
  return Array.from(raw, (char) => {
    const byte = char.charCodeAt(0)
    const signed = byte > 127 ? byte - 256 : byte
    return signed / 127
  })
}

export function ownershipAt(values: number[], x: number, y: number) {
  return values[y * 19 + x] ?? 0
}

export function ownershipOwner(value: number): 'B' | 'W' {
  return value >= 0 ? 'B' : 'W'
}

export const OWNERSHIP_DISPLAY_THRESHOLD = 0.035
export const OWNERSHIP_COLORS = {
  B: 'rgb(0 0 26)',
  W: 'rgb(235 235 255)',
} as const

export function ownershipAlpha(value: number) {
  return Math.pow(Math.min(1, Math.abs(value)), 1 / 1.33)
}

export function ownershipDisplay(value: number) {
  if (Math.abs(value) < OWNERSHIP_DISPLAY_THRESHOLD) return null
  const owner = ownershipOwner(value)
  return {
    owner,
    fill: OWNERSHIP_COLORS[owner],
    alpha: ownershipAlpha(value) * (owner === 'B' ? 0.38 : 0.42),
  }
}
