import { describe, expect, it } from 'vitest'
import { computeSideActionPlacement, sideActionEdgeGap, sideActionRailHeight, sideActionRailWidth } from './sideActionRail'

describe('side action rail placement', () => {
  it('enables side controls when wide portrait has enough board-right space', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 840,
      layoutHeight: 1100,
      boardStageRight: 840,
      boardRight: 760,
      boardTop: 92,
      boardHeight: 640,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.left).toBe(840 - sideActionEdgeGap - sideActionRailWidth)
    expect(placement.top).toBe(412)
    expect(placement.width).toBe(sideActionRailWidth)
    expect(placement.rowHeight).toBe(0)
  })

  it('keeps horizontal controls when portrait side space is too small', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 820,
      layoutHeight: 1080,
      boardStageRight: 820,
      boardRight: 790,
      boardTop: 100,
      boardHeight: 620,
    }, false)

    expect(placement.enabled).toBe(false)
  })

  it('uses hysteresis so small viewport changes do not toggle the rail repeatedly', () => {
    const marginal = {
      layoutWidth: 820,
      layoutHeight: 1080,
      boardStageRight: 820,
      boardRight: 756,
      boardTop: 100,
      boardHeight: 620,
    }

    expect(computeSideActionPlacement(marginal, false).enabled).toBe(false)
    expect(computeSideActionPlacement(marginal, true).enabled).toBe(true)
  })

  it('turns off side controls when the floating rail would overlap the centered board', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 820,
      layoutHeight: 1080,
      boardStageRight: 820,
      boardRight: 770,
      boardTop: 92,
      boardHeight: 640,
    }, true)

    expect(placement.enabled).toBe(false)
  })

  it('does not enable side controls outside wide portrait layouts', () => {
    expect(computeSideActionPlacement({
      layoutWidth: 640,
      layoutHeight: 940,
      boardStageRight: 640,
      boardRight: 540,
      boardTop: 80,
      boardHeight: 520,
    }, false).enabled).toBe(false)

    expect(computeSideActionPlacement({
      layoutWidth: 940,
      layoutHeight: 640,
      boardStageRight: 940,
      boardRight: 820,
      boardTop: 40,
      boardHeight: 520,
    }, false).enabled).toBe(false)
  })

  it('keeps the vertical controls inside the app viewport', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 840,
      layoutHeight: 880,
      boardStageRight: 840,
      boardRight: 760,
      boardTop: 10,
      boardHeight: 240,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.top).toBeGreaterThanOrEqual(sideActionRailHeight / 2 + 4)
  })
})
