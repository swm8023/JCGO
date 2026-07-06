export type Color = 'B' | 'W'

export interface GameRecord {
  gameId: string
  displayName: string
  result: string
  gameDate?: string
  sgfFilename: string
  createdAt: string
  analysisStatus?: AnalysisState
}

export interface Stone {
  x: number
  y: number
  color: Color
}

export interface MoveView {
  nodeId: string
  moveNumber: number
  color: Color
  gtp: string
  pass: boolean
}

export interface Snapshot {
  gameId: string
  nodeId: string
  moveNumber: number
  totalMoves: number
  branchMode: 'main' | 'variation'
  stones: Stone[]
  lastMove?: MoveView
  children: MoveView[]
  toPlay: Color
  rules: string
  komi: number
  blackName?: string
  whiteName?: string
  result?: string
  captures: Record<Color, number>
  gameEnded: boolean
  canPrevious: boolean
  canNext: boolean
  canBackToMain: boolean
  analysis?: AnalysisResult
}

export interface RootAnalysis {
  winrate: number
  scoreLead: number
  visits: number
}

export interface CandidateRaw {
  move: string
  order: number
  visits: number
  winrate: number
  scoreLead: number
  pv: string[]
}

export interface CandidateMove {
  move: string
  order: number
  visits: number
  winrate: number
  scoreLead: number
  pointLoss: number
  relativePointLoss: number
  winrateLoss: number
  pv: string[]
  lowVisits: boolean
}

export interface AnalysisResult {
  winrate: number
  scoreLead: number
  visits: number
  candidates: CandidateMove[]
}

export type AnalysisState = 'idle' | 'running' | 'stopped' | 'complete' | 'unavailable'

export interface AnalysisProgress {
  analyzed: number
  total: number
}

export interface ImportResult {
  game: GameRecord
  snapshot: Snapshot
}

export interface ListResult {
  games: GameRecord[]
}

export interface SnapshotResult {
  snapshot: Snapshot
}

export interface ChartPoint {
  moveNumber: number
  winrate: number
  scoreLead: number
}

export interface BadMove {
  nodeId: string
  moveNumber: number
  color: Color
  move: string
  pointLoss: number
  class?: number
}

export interface BadMovePromptResult {
  prompt: string
}

export interface StatePayload {
  type: 'state'
  schema: number
  games: GameRecord[]
  gameId?: string
  currentNodeId?: string
  analysisState: AnalysisState
  snapshot?: Snapshot
  timeline?: TimelineColumns
  badMoves?: BadMoveColumns
  variation?: VariationState
  current?: CurrentNodeState
}

export interface TimelineColumns {
  nodeIds: string[]
  moves: (string | null)[]
  moveColors: (Color | null)[]
  passes: boolean[]
  toPlays: Color[]
  rootWinrates: (number | null)[]
  rootScoreLeads: (number | null)[]
  rootVisits: (number | null)[]
  playedPointLosses: (number | null)[]
}

export interface BadMoveColumns {
  nodeIds: string[]
  moveNumbers: number[]
  colors: Color[]
  moves: string[]
  pointLosses: number[]
}

export interface VariationState {
  baseNodeId: string
  baseMoveNumber: number
  currentNodeId: string
  timeline: TimelineColumns
}

export interface CurrentNodeState {
  nodeId: string
  candidates: CandidateColumns
  ownership?: EncodedOwnership
}

export interface CandidateColumns {
  moves: string[]
  orders: number[]
  visits: number[]
  winrates: number[]
  scoreLeads: number[]
  pvs: string[][]
}

export interface EncodedOwnership {
  encoding: 'q8-base64'
  data: string
}
