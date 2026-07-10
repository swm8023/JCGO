export const sideActionEdgeGap = 12
export const sideActionGap = 18

const viewportEdgeGap = 4
const fullWidthEnterTolerance = 2
const fullWidthExitTolerance = 2
const sideActionControlMin = 36
const sideActionControlMax = 44
const sideActionBoardRatio = 0.09
const sideActionControlCount = 8
const sideActionControlGap = 3
const sideActionVerticalPadding = 6

export interface SideActionMeasurement {
  layoutWidth: number
  layoutHeight: number
  boardStageLeft: number
  boardStageTop?: number
  boardStageWidth: number
  boardStageHeight: number
  boardStageRight: number
  boardRight: number
  boardTop: number
  boardHeight: number
}

export interface SideActionPlacement {
  enabled: boolean
  left: number
  top: number
  width: number
  rowHeight: number
}

export function computeSideActionPlacement(measurement: SideActionMeasurement, currentlyEnabled: boolean): SideActionPlacement {
  const disabled = disabledPlacement()
  if (measurement.layoutWidth <= 0 || measurement.layoutHeight <= 0) return disabled
  if (measurement.boardStageWidth <= 0 || measurement.boardStageHeight <= 0) return disabled
  if (measurement.boardHeight <= 0 || measurement.boardRight <= 0) return disabled

  const requiredFullWidthHeight = measurement.boardStageWidth + (currentlyEnabled ? fullWidthExitTolerance : -fullWidthEnterTolerance)
  if (measurement.boardStageHeight >= requiredFullWidthHeight) return disabled

  const controlSize = sideActionControlSize(measurement)
  const railWidth = controlSize
  const railHeight = sideActionRailHeight(controlSize)
  const railSpace = sideActionGap + railWidth
  const boardSize = Math.min(measurement.boardHeight, Math.max(0, measurement.boardStageWidth - railSpace))
  if (boardSize <= 0) return disabled

  const preferredLeft = measurement.boardRight + sideActionGap
  const preferredTop = measurement.boardTop + measurement.boardHeight / 2
  const minTop = (measurement.boardStageTop ?? 0) + railHeight / 2 + viewportEdgeGap
  const maxTop = measurement.layoutHeight - railHeight / 2 - viewportEdgeGap
  return {
    enabled: true,
    left: Math.max(0, Math.min(preferredLeft, measurement.layoutWidth - sideActionEdgeGap - railWidth)),
    top: Math.max(minTop, Math.min(preferredTop, maxTop)),
    width: railWidth,
    rowHeight: controlSize,
  }
}

function sideActionControlSize(measurement: SideActionMeasurement) {
  const proportionalSize = Math.round(measurement.boardHeight * sideActionBoardRatio)
  const fixedRailSpace = viewportEdgeGap * 2
    + sideActionVerticalPadding
    + sideActionControlGap * (sideActionControlCount - 1)
  const heightLimitedSize = Math.floor((measurement.layoutHeight - fixedRailSpace) / sideActionControlCount)
  return Math.max(sideActionControlMin, Math.min(sideActionControlMax, proportionalSize, heightLimitedSize))
}

function sideActionRailHeight(controlSize: number) {
  return controlSize * sideActionControlCount
    + sideActionControlGap * (sideActionControlCount - 1)
    + sideActionVerticalPadding
}

function disabledPlacement(): SideActionPlacement {
  return { enabled: false, left: 0, top: 0, width: sideActionControlMin, rowHeight: sideActionControlMin }
}
