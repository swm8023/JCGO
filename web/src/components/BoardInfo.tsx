interface BoardInfoProps {
  blackName?: string
  whiteName?: string
  result?: string
}

export function BoardInfo({ blackName, whiteName, result }: BoardInfoProps) {
  const black = blackName || 'Black'
  const white = whiteName || 'White'
  return (
    <aside className="board-info" aria-label="棋局信息">
      <span className="board-matchup">
        <span className="board-player" aria-label={`黑 ${black}`}>
          <span className="board-player-stone board-player-stone-black" aria-hidden="true" />
          <span className="board-player-name">{black}</span>
        </span>
        <span className="board-versus">vs</span>
        <span className="board-player" aria-label={`白 ${white}`}>
          <span className="board-player-stone board-player-stone-white" aria-hidden="true" />
          <span className="board-player-name">{white}</span>
        </span>
      </span>
      <span className="board-result">{formatGameResult(result)}</span>
    </aside>
  )
}

function formatGameResult(result?: string) {
  const value = result?.trim()
  if (!value || value === '?' || value.toLowerCase() === 'unknown') return '结果未知'
  if (value === '0' || value.toLowerCase() === 'draw' || value.toLowerCase() === 'jigo') return '和棋'

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
