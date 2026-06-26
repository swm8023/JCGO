import type { AnalysisResult, BadMove, CandidateMove, ChartPoint, StatePayload, TimelineColumns } from '../api/types'

export function activeTimeline(state?: StatePayload): TimelineColumns | undefined {
  return state?.variation?.timeline ?? state?.timeline
}

export function chartPointsForState(state?: StatePayload): ChartPoint[] {
  const timeline = activeTimeline(state)
  if (!timeline) return []
  const baseMoveNumber = state?.variation?.baseMoveNumber ?? 0
  const nodeIds = timeline.nodeIds ?? []
  const rootWinrates = timeline.rootWinrates ?? []
  const rootScoreLeads = timeline.rootScoreLeads ?? []
  return nodeIds.flatMap((_, index) => {
    const winrate = rootWinrates[index]
    const scoreLead = rootScoreLeads[index]
    if (winrate === null || winrate === undefined || scoreLead === null || scoreLead === undefined) return []
    return [{ moveNumber: baseMoveNumber + index, winrate, scoreLead }]
  })
}

export function currentCandidates(state?: StatePayload): CandidateMove[] {
  const current = state?.current
  if (!state || !current) return []
  const root = rootForCurrent(state)
  const rootScoreLead = root?.scoreLead ?? 0
  const rootWinrate = root?.winrate ?? 0
  const moves = current.candidates.moves ?? []
  const orders = current.candidates.orders ?? []
  const visits = current.candidates.visits ?? []
  const winrates = current.candidates.winrates ?? []
  const scoreLeads = current.candidates.scoreLeads ?? []
  const pvs = current.candidates.pvs ?? []
  const bestIndex = orders.indexOf(0)
  const bestScoreLead = bestIndex >= 0 ? scoreLeads[bestIndex] ?? rootScoreLead : rootScoreLead
  const sideSign = toPlayForCurrent(state) === 'W' ? -1 : 1

  return moves.map((move, index) => {
    const scoreLead = scoreLeads[index] ?? 0
    const winrate = winrates[index] ?? 0
    const order = orders[index] ?? index
    return {
      move,
      order,
      visits: visits[index] ?? 0,
      winrate,
      scoreLead,
      pointLoss: round1(sideSign * (rootScoreLead - scoreLead)),
      relativePointLoss: round1(sideSign * (bestScoreLead - scoreLead)),
      winrateLoss: sideSign * (rootWinrate - winrate),
      pv: pvs[index] ?? [],
      lowVisits: (visits[index] ?? 0) < 25 && order !== 0,
    }
  })
}

export function analysisForCurrent(state?: StatePayload): AnalysisResult | undefined {
  if (!state) return undefined
  const root = rootForCurrent(state)
  if (!root) return undefined
  return { ...root, candidates: currentCandidates(state) }
}

export function playedPointLossForCurrent(state?: StatePayload): number | null {
  const timeline = activeTimeline(state)
  const nodeId = state?.current?.nodeId
  if (!timeline || !nodeId) return null
  const index = (timeline.nodeIds ?? []).indexOf(nodeId)
  if (index < 0) return null
  return (timeline.playedPointLosses ?? [])[index] ?? null
}

export function badMovesForState(state?: StatePayload): BadMove[] {
  const badMoves = state?.badMoves
  if (!badMoves) return []
  const nodeIds = badMoves.nodeIds ?? []
  const moveNumbers = badMoves.moveNumbers ?? []
  const colors = badMoves.colors ?? []
  const moves = badMoves.moves ?? []
  const pointLosses = badMoves.pointLosses ?? []
  return nodeIds.map((nodeId, index) => ({
    nodeId,
    moveNumber: moveNumbers[index],
    color: colors[index],
    move: moves[index],
    pointLoss: pointLosses[index],
  }))
}

function rootForCurrent(state: StatePayload): { winrate: number; scoreLead: number; visits: number } | undefined {
  const timeline = activeTimeline(state)
  const nodeId = state.current?.nodeId
  if (!timeline || !nodeId) return undefined
  const index = (timeline.nodeIds ?? []).indexOf(nodeId)
  if (index < 0) return undefined
  const winrate = (timeline.rootWinrates ?? [])[index]
  const scoreLead = (timeline.rootScoreLeads ?? [])[index]
  const visits = (timeline.rootVisits ?? [])[index]
  if (winrate === null || winrate === undefined || scoreLead === null || scoreLead === undefined || visits === null || visits === undefined) return undefined
  return { winrate, scoreLead, visits }
}

function toPlayForCurrent(state: StatePayload) {
  const timeline = activeTimeline(state)
  const nodeId = state.current?.nodeId
  if (!timeline || !nodeId) return state.snapshot?.toPlay
  const index = (timeline.nodeIds ?? []).indexOf(nodeId)
  return index >= 0 ? (timeline.toPlays ?? [])[index] : state.snapshot?.toPlay
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}
