export function formatGameResult(result?: string) {
  const value = result?.trim()
  if (!value || value === '?' || value.toLowerCase() === 'unknown') return '结果未知'
  if (value === '0' || value.toLowerCase() === 'draw' || value.toLowerCase() === 'jigo') return '和棋'

  const chinesePointWin = /^([黑白])胜\s*(\d+(?:\.\d+)?)子$/.exec(value)
  if (chinesePointWin) return `${chinesePointWin[1]}胜 ${formatPointScore(Number(chinesePointWin[2]) * 2)}目`

  const match = /^([BW])\+(.+)$/i.exec(value)
  if (!match) return value

  const winner = match[1].toUpperCase() === 'B' ? '黑' : '白'
  const detail = match[2].toUpperCase()
  if (detail === 'R' || detail === 'RESIGN') return `${winner}中盘胜`
  if (detail === 'T' || detail === 'TIME') return `${winner}超时胜`
  if (detail === 'F' || detail === 'FORFEIT') return `${winner}弃权胜`
  if (/^\d+(?:\.\d+)?$/.test(match[2])) return `${winner}胜 ${match[2]}目`
  return `${winner}胜`
}

function formatPointScore(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
}
