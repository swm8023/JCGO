import { describe, expect, it } from 'vitest'
import {
  computeSideActionPlacement,
  sideActionEdgeGap,
  sideActionGap,
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

    expect(placement.enabled).toBe(true)
    expect(placement.width).toBe(36)
    expect(placement.rowHeight).toBe(36)
    expect(placement.left).toBe(316 + sideActionGap)
    expect(placement.top).toBe(52 + 316 / 2)
  })

  it('scales side controls to nine percent of the measured board edge', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 600,
      layoutHeight: 720,
      boardStageLeft: 0,
      boardStageWidth: 600,
      boardStageHeight: 500,
      boardStageRight: 600,
      boardRight: 522,
      boardTop: 69,
      boardHeight: 444,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.rowHeight).toBe(40)
    expect(placement.width).toBe(40)
  })

  it('caps proportional side controls at 44px', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 800,
      layoutHeight: 900,
      boardStageLeft: 0,
      boardStageWidth: 800,
      boardStageHeight: 650,
      boardStageRight: 800,
      boardRight: 650,
      boardTop: 70,
      boardHeight: 600,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.rowHeight).toBe(44)
    expect(placement.width).toBe(44)
  })

  it('limits proportional side controls so the full rail fits the app height', () => {
    const placement = computeSideActionPlacement({
      layoutWidth: 800,
      layoutHeight: 360,
      boardStageLeft: 0,
      boardStageWidth: 800,
      boardStageHeight: 300,
      boardStageRight: 800,
      boardRight: 650,
      boardTop: 0,
      boardHeight: 600,
    }, false)

    expect(placement.enabled).toBe(true)
    expect(placement.rowHeight).toBe(40)
    expect(placement.width).toBe(40)
  })

  it('places the right-side action rail beside the measured board with a comfortable gap', () => {
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

    expect(placement.enabled).toBe(true)
    expect(sideActionGap).toBeGreaterThanOrEqual(16)
    expect(placement.left).toBe(528 + sideActionGap)
    expect(placement.left - 528).toBe(sideActionGap)
    expect(placement.top).toBe(72 + 440 / 2)
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
    expect(placement.left).toBeLessThanOrEqual(840 - sideActionEdgeGap - placement.width)
    const railHeight = placement.rowHeight * 8 + 27
    expect(placement.top).toBeGreaterThanOrEqual(railHeight / 2 + 4)
  })

  it('keeps the vertical controls below the workspace topbar', () => {
    const measurement = {
      layoutWidth: 360,
      layoutHeight: 480,
      boardStageLeft: 0,
      boardStageTop: 44,
      boardStageWidth: 360,
      boardStageHeight: 208,
      boardStageRight: 360,
      boardRight: 288,
      boardTop: 73,
      boardHeight: 216,
    }
    const placement = computeSideActionPlacement(measurement, true)
    const railHeight = placement.rowHeight * 8 + 27

    expect(placement.enabled).toBe(true)
    expect(placement.top).toBeGreaterThanOrEqual(measurement.boardStageTop + railHeight / 2 + 4)
  })
})
