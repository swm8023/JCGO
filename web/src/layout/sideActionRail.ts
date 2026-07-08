export const sideActionRailWidth = 42
export const sideActionRailHeight = 267
export const sideActionRowHeight = 0
export const sideActionEdgeGap = 12
export const sideActionGap = 8

const viewportEdgeGap = 4
const fullWidthEnterTolerance = 2
const fullWidthExitTolerance = 2

export interface SideActionMeasurement {
  layoutWidth: number
  layoutHeight: number
  boardStageLeft: number
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

  const railSpace = sideActionGap + sideActionRailWidth
  const boardSize = Math.min(measurement.boardHeight, Math.max(0, measurement.boardStageWidth - railSpace))
  if (boardSize <= 0) return disabled

  const groupWidth = boardSize + railSpace
  const groupLeft = measurement.boardStageLeft + Math.max(0, (measurement.boardStageWidth - groupWidth) / 2)
  const preferredLeft = groupLeft + boardSize + sideActionGap
  const preferredTop = measurement.boardTop + measurement.boardHeight / 2
  const minTop = sideActionRailHeight / 2 + viewportEdgeGap
  const maxTop = measurement.layoutHeight - sideActionRailHeight / 2 - viewportEdgeGap
  return {
    enabled: true,
    left: Math.max(0, Math.min(preferredLeft, measurement.layoutWidth - sideActionEdgeGap - sideActionRailWidth)),
    top: Math.max(minTop, Math.min(preferredTop, maxTop)),
    width: sideActionRailWidth,
    rowHeight: sideActionRowHeight,
  }
}

function disabledPlacement(): SideActionPlacement {
  return { enabled: false, left: 0, top: 0, width: sideActionRailWidth, rowHeight: sideActionRowHeight }
}
