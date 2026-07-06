import { describe, expect, it } from 'vitest'
import type { StatePayload } from '../api/types'
import { analysisForCurrent, analysisProgressForState, badMovesForState, chartPointsForState, currentCandidates, trialMovesForState } from './selectors'

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

  it('counts analyzed mainline moves without counting the root position', () => {
    const progressState = {
      ...state,
      snapshot: { ...state.snapshot, totalMoves: 133 },
      timeline: {
        ...state.timeline,
        nodeIds: Array.from({ length: 134 }, (_, index) => `main:${index}`),
        rootVisits: Array.from({ length: 134 }, (_, index) => (index <= 11 ? 100 : null)),
      },
    } satisfies StatePayload

    expect(analysisProgressForState(progressState)).toEqual({ analyzed: 11, total: 133 })
  })

  it('keeps mainline chart points before a trial branch and appends trial analysis after the fork', () => {
    const variationState = {
      ...state,
      timeline: {
        ...state.timeline,
        nodeIds: ['main:0', 'main:1', 'main:2', 'main:3'],
        moves: [null, 'Q16', 'D4', 'C3'],
        moveColors: [null, 'B', 'W', 'B'],
        passes: [false, false, false, false],
        toPlays: ['B', 'W', 'B', 'W'],
        rootWinrates: [0.52, 0.49, 0.46, 0.42],
        rootScoreLeads: [1.4, 0.8, -0.2, -1.1],
        rootVisits: [100, 120, 140, 160],
        playedPointLosses: [null, 0.3, 0.5, 0.9],
      },
      variation: {
        baseNodeId: 'main:2',
        baseMoveNumber: 2,
        currentNodeId: 'var:3',
        timeline: {
          nodeIds: ['var:1', 'var:2', 'var:3'],
          moves: ['Q4', 'pass', 'D16'],
          moveColors: ['B', 'W', 'B'],
          passes: [false, true, false],
          toPlays: ['W', 'B', 'W'],
          rootWinrates: [0.55, null, 0.58],
          rootScoreLeads: [0.6, null, 1.2],
          rootVisits: [80, null, 90],
          playedPointLosses: [null, null, 0.4],
        },
      },
    } satisfies StatePayload

    expect(chartPointsForState(variationState)).toEqual([
      { moveNumber: 0, winrate: 0.52, scoreLead: 1.4 },
      { moveNumber: 1, winrate: 0.49, scoreLead: 0.8 },
      { moveNumber: 2, winrate: 0.46, scoreLead: -0.2 },
      { moveNumber: 3, winrate: 0.55, scoreLead: 0.6 },
      { moveNumber: 5, winrate: 0.58, scoreLead: 1.2 },
    ])
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

  it('extracts visible trial branch moves from variation timeline', () => {
    const variationState = {
      ...state,
      variation: {
        baseNodeId: 'main:1',
        baseMoveNumber: 1,
        currentNodeId: 'var:3',
        timeline: {
          nodeIds: ['var:1', 'var:2', 'var:3'],
          moves: ['Q4', 'pass', 'D4'],
          moveColors: ['W', 'B', 'B'],
          passes: [false, true, false],
          toPlays: ['B', 'B', 'W'],
          rootWinrates: [null, null, null],
          rootScoreLeads: [null, null, null],
          rootVisits: [null, null, null],
          playedPointLosses: [null, null, null],
        },
      },
    } satisfies StatePayload

    expect(trialMovesForState(variationState)).toEqual(['Q4', 'D4'])
    expect(trialMovesForState(state)).toEqual([])
  })
})
