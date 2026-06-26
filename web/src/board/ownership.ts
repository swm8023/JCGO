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

export function ownershipAlpha(value: number) {
  return Math.pow(Math.abs(value), 1 / 1.33)
}
