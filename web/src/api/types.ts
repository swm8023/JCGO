export type Color = 'B' | 'W'

export interface GameRecord {
  gameId: string
  displayName: string
  result: string
  sgfFilename: string
  createdAt: string
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
  toPlay: Color
  rules: string
  komi: number
  captures: Record<Color, number>
  gameEnded: boolean
  canPrevious: boolean
  canNext: boolean
  canBackToMain: boolean
  analysis?: AnalysisResult
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
  class: number
}

export interface WorkspaceState {
  games: GameRecord[]
  selectedGameId?: string
  snapshot?: Snapshot
  chartPoints: ChartPoint[]
  badMoves: BadMove[]
  analysisState: AnalysisState
}
