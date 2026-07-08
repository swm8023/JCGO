import { formatGameResult } from './gameResult'

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
