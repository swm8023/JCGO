import { describe, expect, it } from 'vitest'
import {
  computeSideActionPlacement,
  sideActionEdgeGap,
  sideActionGap,
  sideActionRailHeight,
  sideActionRailWidth,
} from './sideActionRail'

describe('side action rail placement', () => {
  it('keeps horizontal controls when the remaining board/action area fits a full-width board', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 390,
      layoutHeight: 844,
      boardStageLeft: 0,
      boardStageWidth: 390,
      boardStageHeight: 430,
      boardStageRight: 390,
      boardRight: 386,
      boardTop: 48,
      boardHeight: 386,
    }, false)

    expect(placement.enabled).toBe(false)
  })

  it('uses a right-side action rail when full-width board plus horizontal controls do not fit', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 390,
      layoutHeight: 844,
      boardStageLeft: 0,
      boardStageWidth: 390,
      boardStageHeight: 330,
      boardStageRight: 390,
      boardRight: 316,
      boardTop: 52,
      boardHeight: 316,
    }, false)

    const expectedGroupWidth = 316 + sideActionGap + sideActionRailWidth
    const expectedGroupLeft = (390 - expectedGroupWidth) / 2
    expect(placement.enabled).toBe(true)
    expect(placement.width).toBe(sideActionRailWidth)
    expect(placement.left).toBe(expectedGroupLeft + 316 + sideActionGap)
    expect(placement.top).toBe(52 + 316 / 2)
  })

  it('centers the board and right-side action rail group inside the board stage', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 700,
      layoutHeight: 1024,
      boardStageLeft: 0,
      boardStageWidth: 700,
      boardStageHeight: 440,
      boardStageRight: 700,
      boardRight: 528,
      boardTop: 72,
      boardHeight: 440,
    }, false)

    const expectedGroupWidth = 440 + sideActionGap + sideActionRailWidth
    const expectedGroupLeft = (700 - expectedGroupWidth) / 2
    expect(placement.enabled).toBe(true)
    expect(placement.left).toBe(expectedGroupLeft + 440 + sideActionGap)
  })

  it('uses hysteresis so small viewport changes do not toggle the rail repeatedly', () => {
    const marginal = {
      layoutWidth: 390,
      layoutHeight: 844,
      boardStageLeft: 0,
      boardStageWidth: 390,
      boardStageHeight: 389,
      boardStageRight: 390,
      boardRight: 340,
      boardTop: 56,
      boardHeight: 340,
    }

    expect(computeSideActionPlacement(marginal, false).enabled).toBe(false)
    expect(computeSideActionPlacement(marginal, true).enabled).toBe(true)
  })

  it('turns off side controls once an enabled layout clears the full-width exit tolerance', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 390,
      layoutHeight: 844,
      boardStageLeft: 0,
      boardStageWidth: 390,
      boardStageHeight: 392,
      boardStageRight: 390,
      boardRight: 340,
      boardTop: 56,
      boardHeight: 340,
    }, true)

    expect(placement.enabled).toBe(false)
  })

  it('does not enable side controls without a measured board stage', () => {
    expect(computeSideActionPlacement({
      layoutWidth: 390,
      layoutHeight: 844,
      boardStageLeft: 0,
      boardStageWidth: 0,
      boardStageHeight: 0,
      boardStageRight: 0,
      boardRight: 340,
      boardTop: 56,
      boardHeight: 340,
    }, false).enabled).toBe(false)
  })

  it('keeps the vertical controls inside the app viewport', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 840,
      layoutHeight: 880,
      boardStageLeft: 0,
      boardStageWidth: 840,
      boardStageHeight: 600,
      boardStageRight: 840,
      boardRight: 520,
      boardTop: 0,
      boardHeight: 240,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.left).toBeLessThanOrEqual(840 - sideActionEdgeGap - sideActionRailWidth)
    expect(placement.top).toBeGreaterThanOrEqual(sideActionRailHeight / 2 + 4)
  })
})
