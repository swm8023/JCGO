export type Color = 'B' | 'W'

export interface GameRecord {
  gameId: string
  displayName: string
  result: string
  gameDate?: string
  blackName?: string
  whiteName?: string
  analysisWorkerName?: string
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
  analysisError?: string
  workerStatus?: WorkerStatus
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

export interface WorkerRuntimeStatus {
  id: string
  name: string
  platform: string
  backend?: string
  cpu?: string
  gpus?: string[]
  model?: string
  maxVisits?: number
  available: boolean
  busy: boolean
  error?: string
}

export interface WorkerStatus {
  connected: number
  available: number
  busy: number
  workers: WorkerRuntimeStatus[]
}

export interface WorkerConfigureInput {
  workerName: string
  model: string
  maxVisits: number
}

export interface YuanluoboQRCode {
  key: string
  image: string
  scanUrl: string
}

export type YuanluoboQRStatusCode = 0 | 1 | 2 | 3 | 4

export interface YuanluoboLoginPoll {
  status: YuanluoboQRStatusCode
  desc: string
}

export interface YuanluoboUser {
  id: number
  playerId: string
  name: string
  groupId: string
  userId: string
  avatarUrl?: string
}

export interface YuanluoboStatusResult {
  loggedIn: boolean
  user?: YuanluoboUser
}

export interface YuanluoboPlayer {
  playerId: string
  name: string
  avatarUrl?: string
  groupId?: string
}

export interface YuanluoboCategory {
  title: string
  gameMode: number
}

export interface YuanluoboRecord {
  sessionId: string
  gameMode: number
  category: string
  startDate: string
  startTime: number
  blackPlayerName: string
  whitePlayerName: string
  title: string
  result: string
  resultLabel: string
  resultWinner: 'B' | 'W' | 'draw'
  totalRound: number
  imported: boolean
  gameId?: string
}

export interface YuanluoboRecordsResult {
  total: number
  page: number
  size: number
  pageTotal: number
  categories: YuanluoboCategory[]
  records: YuanluoboRecord[]
}
