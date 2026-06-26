export const KATRAIN_THRESHOLDS = [12, 6, 3, 1.5, 0.5, 0]
export const KATRAIN_EVAL_COLORS = ['#72216b', '#cc0000', '#e6661a', '#f2f200', '#abdf2e', '#1e9600']
export const TOP_MOVE_BORDER_COLOR = '#0ac8fa'

export function evalClassForPointLoss(pointLoss: number) {
  let index = 0
  while (index < KATRAIN_THRESHOLDS.length - 1 && pointLoss < KATRAIN_THRESHOLDS[index]) index += 1
  return index
}

export function katrainEvalColor(pointLoss: number) {
  return KATRAIN_EVAL_COLORS[evalClassForPointLoss(pointLoss)]
}

export function formatCandidateDelta(pointsLost: number) {
  const value = -pointsLost
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

export function formatVisits(visits: number) {
  if (visits < 1000) return String(visits)
  if (visits < 100000) return `${(visits / 1000).toFixed(1)}k`
  if (visits < 1000000) return `${(visits / 1000).toFixed(0)}k`
  return `${(visits / 1000000).toFixed(0)}M`
}
