export const BOARD_SIZE = 19
export const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRST'

export interface BoardPoint {
  x: number
  y: number
}

export function pointToGTP(x: number, y: number) {
  return `${GTP_LETTERS[x]}${BOARD_SIZE - y}`
}

export function gtpToPoint(gtp: string): BoardPoint | null {
  if (gtp.toLowerCase() === 'pass') return null
  const x = GTP_LETTERS.indexOf(gtp[0]?.toUpperCase())
  const row = Number(gtp.slice(1))
  if (x < 0 || !row) return null
  return { x, y: BOARD_SIZE - row }
}

export function boardPoints() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({ x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) }))
}

export function pointKey(x: number, y: number) {
  return `${x}:${y}`
}
