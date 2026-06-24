import type { GameRecord, Snapshot } from '../api/types'

export interface AppState {
  connected: boolean
  games: GameRecord[]
  selectedGameId?: string
  snapshot?: Snapshot
  error?: string
}

export type AppAction =
  | { type: 'connected' }
  | { type: 'gamesLoaded'; games: GameRecord[] }
  | { type: 'gameSelected'; gameId: string; snapshot: Snapshot }
  | { type: 'snapshotUpdated'; snapshot: Snapshot }
  | { type: 'error'; error: string }

export const initialAppState: AppState = {
  connected: false,
  games: [],
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: true, error: undefined }
    case 'gamesLoaded':
      return { ...state, games: action.games }
    case 'gameSelected':
      return { ...state, selectedGameId: action.gameId, snapshot: action.snapshot }
    case 'snapshotUpdated':
      return { ...state, snapshot: action.snapshot }
    case 'error':
      return { ...state, error: action.error }
  }
}
