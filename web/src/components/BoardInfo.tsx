interface BoardInfoProps {
  blackName?: string
  whiteName?: string
  komi?: number
  rules?: string
}

export function BoardInfo({ blackName, whiteName, komi, rules }: BoardInfoProps) {
  return (
    <aside className="board-info" aria-label="棋局信息">
      <span>黑 {blackName || 'Black'}</span>
      <span>白 {whiteName || 'White'}</span>
      <span>贴目 {(komi ?? 7.5).toFixed(1)}</span>
      <span>{rules || 'chinese'}</span>
    </aside>
  )
}
