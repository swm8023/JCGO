import { describe, expect, it } from 'vitest'
import type { StatePayload } from '../api/types'
import { analysisForCurrent, badMovesForState, chartPointsForState, currentCandidates } from './selectors'

const state: StatePayload = {
  type: 'state',
  schema: 1,
  games: [],
  gameId: 'game-1',
  currentNodeId: 'main:0',
  analysisState: 'running',
  snapshot: {
    gameId: 'game-1',
    nodeId: 'main:0',
    moveNumber: 0,
    totalMoves: 1,
    branchMode: 'main',
    stones: [],
    children: [],
    toPlay: 'B',
    rules: 'chinese',
    komi: 7.5,
    captures: { B: 0, W: 0 },
    gameEnded: false,
    canPrevious: false,
    canNext: true,
    canBackToMain: false,
  },
  timeline: {
    nodeIds: ['main:0', 'main:1'],
    moves: [null, 'Q16'],
    moveColors: [null, 'B'],
    passes: [false, false],
    toPlays: ['B', 'W'],
    rootWinrates: [0.52, null],
    rootScoreLeads: [1.4, null],
    rootVisits: [100, null],
    playedPointLosses: [null, null],
  },
  badMoves: {
    nodeIds: ['main:1'],
    moveNumbers: [1],
    colors: ['B'],
    moves: ['Q16'],
    pointLosses: [3.5],
  },
  current: {
    nodeId: 'main:0',
    candidates: {
      moves: ['Q16', 'D4'],
      orders: [0, 1],
      visits: [90, 20],
      winrates: [0.53, 0.48],
      scoreLeads: [1.8, -1],
      pvs: [['Q16'], ['D4']],
    },
  },
}

describe('state selectors', () => {
  it('builds chart points from columnar timeline and skips null roots', () => {
    expect(chartPointsForState(state)).toEqual([{ moveNumber: 0, winrate: 0.52, scoreLead: 1.4 }])
  })

  it('derives candidate display losses from raw root and candidate score', () => {
    const candidates = currentCandidates(state)
    expect(candidates[0]).toMatchObject({ move: 'Q16', pointLoss: -0.4, lowVisits: false })
    expect(candidates[1]).toMatchObject({ move: 'D4', pointLoss: 2.4, lowVisits: true })
  })

  it('builds current summary and bad move view models', () => {
    expect(analysisForCurrent(state)).toMatchObject({ winrate: 0.52, scoreLead: 1.4, visits: 100 })
    expect(badMovesForState(state)).toEqual([{ nodeId: 'main:1', moveNumber: 1, color: 'B', move: 'Q16', pointLoss: 3.5 }])
  })

  it('treats null column arrays from older state payloads as empty arrays', () => {
    const nullColumnState = {
      ...state,
      badMoves: {
        nodeIds: null,
        moveNumbers: null,
        colors: null,
        moves: null,
        pointLosses: null,
      },
      current: {
        ...state.current,
        candidates: {
          moves: null,
          orders: null,
          visits: null,
          winrates: null,
          scoreLeads: null,
          pvs: null,
        },
      },
    } as unknown as StatePayload

    expect(currentCandidates(nullColumnState)).toEqual([])
    expect(badMovesForState(nullColumnState)).toEqual([])
  })
})
