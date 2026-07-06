export const sideActionRailWidth = 42
export const sideActionRailHeight = 267
export const sideActionRowHeight = 0

const sideActionGap = 8
const viewportEdgeGap = 4
const widePortraitMinWidth = 700
const widePortraitMaxWidth = 1220
const enterExtraSpace = 12
const exitTolerance = 4

export interface SideActionMeasurement {
  layoutWidth: number
  layoutHeight: number
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
  if (!isWidePortrait(measurement)) return disabled
  if (measurement.boardHeight <= 0 || measurement.boardRight <= 0 || measurement.boardStageRight <= 0) return disabled

  const rightGap = currentlyEnabled
    ? measurement.layoutWidth - measurement.boardRight
    : measurement.boardStageRight - measurement.boardRight
  const requiredGap = currentlyEnabled
    ? sideActionRailWidth - exitTolerance
    : sideActionRailWidth + enterExtraSpace
  if (rightGap < requiredGap) return disabled

  const preferredLeft = measurement.boardRight + sideActionGap
  const maxLeft = measurement.boardStageRight - sideActionRailWidth
  const preferredTop = measurement.boardTop + measurement.boardHeight / 2
  const minTop = sideActionRailHeight / 2 + viewportEdgeGap
  const maxTop = measurement.layoutHeight - sideActionRailHeight / 2 - viewportEdgeGap
  return {
    enabled: true,
    left: Math.max(0, Math.min(preferredLeft, maxLeft)),
    top: Math.max(minTop, Math.min(preferredTop, maxTop)),
    width: sideActionRailWidth,
    rowHeight: sideActionRowHeight,
  }
}

function isWidePortrait(measurement: SideActionMeasurement) {
  return measurement.layoutWidth >= widePortraitMinWidth
    && measurement.layoutWidth <= widePortraitMaxWidth
    && measurement.layoutHeight >= measurement.layoutWidth
}

function disabledPlacement(): SideActionPlacement {
  return { enabled: false, left: 0, top: 0, width: sideActionRailWidth, rowHeight: sideActionRowHeight }
}
