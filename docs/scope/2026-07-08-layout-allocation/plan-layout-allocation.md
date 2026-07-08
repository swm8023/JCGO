# Layout Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework portrait layout allocation so the bottom analysis area claims only its required minimum height and the remaining space chooses the largest stable board/action layout.

**Architecture:** Keep the existing portrait-only app shell and DOM order. Move the board/action mode decision into the existing measured layout helper, then drive CSS with one class: default horizontal controls when a full-width board fits, `side-action-layout` when the board and vertical action rail should be centered as a group. Keep analysis content scroll-contained with fixed minimum heights for single-column and two-column modes.

**Tech Stack:** React, TypeScript, Vite, Vitest, CSS grid/container queries.

---

### Task 1: Board/Action Placement Decision Tests

**Files:**
- Modify: `web/src/layout/sideActionRail.test.ts`
- Modify: `web/src/layout/sideActionRail.ts`

- [ ] **Step 1: Write failing tests for horizontal vs vertical action modes**

Add these imports and tests to `web/src/layout/sideActionRail.test.ts`. Update every existing `computeSideActionPlacement` call in the file to pass `boardStageLeft`, `boardStageWidth`, and `boardStageHeight`. Preserve the existing viewport clamping coverage. Preserve hysteresis coverage by asserting that an already-enabled side rail remains enabled until the board stage height is at least 2px taller than the full-width board cutoff.

```ts
import {
  computeSideActionPlacement,
  sideActionEdgeGap,
  sideActionGap,
  sideActionRailWidth,
} from './sideActionRail'

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
    boardRight: 326,
    boardTop: 52,
    boardHeight: 326,
  }, false)

  expect(placement.enabled).toBe(true)
  expect(placement.width).toBe(sideActionRailWidth)
  expect(placement.left).toBe(326 + sideActionGap)
  expect(placement.top).toBe(52 + 326 / 2)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd web
npm test -- --run src/layout/sideActionRail.test.ts
```

Expected: fail because `SideActionMeasurement` does not yet include `boardStageLeft`, `boardStageWidth`, or `boardStageHeight`, and the helper still disables side controls below 700px.

- [ ] **Step 3: Implement the placement helper fields and decision**

Modify `web/src/layout/sideActionRail.ts`:

```ts
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
```

- [ ] **Step 4: Run helper tests to verify green**

Run:

```powershell
cd web
npm test -- --run src/layout/sideActionRail.test.ts
```

Expected: all `sideActionRail` tests pass after updating older tests to include `boardStageLeft`, `boardStageWidth`, and `boardStageHeight`.

- [ ] **Step 5: Commit helper tests and implementation**

```powershell
git add web/src/layout/sideActionRail.ts web/src/layout/sideActionRail.test.ts
git commit -m "Update portrait action rail placement"
```

---

### Task 2: App Measurement Wiring

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.layout.test.ts`

- [ ] **Step 1: Write failing App layout test for board stage measurement**

Update the last test in `web/src/App.layout.test.ts` so it asserts that the app passes the new stage dimensions into the layout helper:

```ts
it('connects measured board/action allocation to the app layout', () => {
  expect(app).toContain("import { computeSideActionPlacement")
  expect(app).toContain("className={sideActionPlacement.enabled ? 'app-layout side-action-layout' : 'app-layout'}")
  expect(app).toContain('boardStageLeft: stageRect.left - layoutRect.left')
  expect(app).toContain('boardStageWidth: stageRect.width')
  expect(app).toContain('boardStageHeight: stageRect.height')
  expect(app).toContain('ref={layoutRef}')
  expect(app).toContain('ref={boardStageRef}')
  expect(app).toContain('ref={boardFrameRef}')
  expect(app).toContain('ref={actionRailRef}')
})
```

- [ ] **Step 2: Run App layout test to verify it fails**

Run:

```powershell
cd web
npm test -- --run src/App.layout.test.ts
```

Expected: fail because `App.tsx` does not yet pass `boardStageLeft`, `boardStageWidth`, or `boardStageHeight`.

- [ ] **Step 3: Pass board stage dimensions from `App.tsx`**

Modify the measurement object inside `updatePlacement` in `web/src/App.tsx`:

```ts
const next = computeSideActionPlacement({
  layoutWidth: layoutRect.width,
  layoutHeight: layoutRect.height,
  boardStageLeft: stageRect.left - layoutRect.left,
  boardStageWidth: stageRect.width,
  boardStageHeight: stageRect.height,
  boardStageRight: stageRect.right - layoutRect.left,
  boardRight: boardRect.right - layoutRect.left,
  boardTop: boardRect.top - layoutRect.top,
  boardHeight: boardRect.height,
}, sideActionEnabledRef.current)
```

- [ ] **Step 4: Run App layout test to verify green**

Run:

```powershell
cd web
npm test -- --run src/App.layout.test.ts
```

Expected: all `App.layout.test.ts` tests pass.

- [ ] **Step 5: Commit App measurement wiring**

```powershell
git add web/src/App.tsx web/src/App.layout.test.ts
git commit -m "Wire board allocation measurements"
```

---

### Task 3: CSS Allocation Rules

**Files:**
- Modify: `web/src/styles.test.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing CSS tests for bottom minimum heights and board/action modes**

Update `web/src/styles.test.ts` expectations:

```ts
expect(styles).toContain('--analysis-detail-preview-height: 34px;')
expect(styles).toContain('--analysis-bottom-height: calc(var(--analysis-overview-height) + var(--analysis-detail-preview-height));')
expect(styles).toContain('--wide-analysis-bottom-height: var(--analysis-overview-height);')
expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr) auto var(--analysis-bottom-height);')
expect(styles).toContain('.side-action-layout {\n    grid-template-rows: auto minmax(0, 1fr) var(--analysis-bottom-height);')
expect(styles).toContain('.side-action-layout .board-frame {\n    --board-frame-clearance: calc(var(--side-action-width, 42px) + 16px);')
expect(styles).toContain('.side-action-layout .action-rail {\n    grid-row: 2;')
expect(styles).toContain('.analysis-rail {\n    grid-row: 4;')
expect(styles).toContain('.side-action-layout .analysis-rail {\n    grid-row: 3;')
```

Also update the wide portrait test to expect:

```ts
expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr) auto var(--wide-analysis-bottom-height);')
expect(styles).toContain('.analysis-rail {\n    position: relative;\n    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);')
expect(styles).toContain('.analysis-detail-tabs .rail-section-body {\n    overflow: auto;')
```

- [ ] **Step 2: Run CSS tests to verify they fail**

Run:

```powershell
cd web
npm test -- --run src/styles.test.ts
```

Expected: fail because the CSS still uses the previous `clamp(...)` bottom heights and does not apply side-action rows for narrow portrait.

- [ ] **Step 3: Update root layout variables**

Modify the variable block in `web/src/styles.css`:

```css
  --portrait-summary-height: 18px;
  --portrait-chart-height: 88px;
  --portrait-overview-gap: 2px;
  --portrait-overview-padding-top: 2px;
  --portrait-overview-padding-bottom: 4px;
  --analysis-overview-height: calc(var(--portrait-summary-height) + var(--portrait-overview-gap) + var(--portrait-chart-height) + var(--portrait-overview-padding-top) + var(--portrait-overview-padding-bottom));
  --analysis-detail-preview-height: 34px;
  --analysis-bottom-height: calc(var(--analysis-overview-height) + var(--analysis-detail-preview-height));
  --wide-analysis-bottom-height: var(--analysis-overview-height);
```

- [ ] **Step 4: Add generic side-action grid rows for all portrait widths**

Add this base rule near `.app-layout`:

```css
.app-layout.side-action-layout {
  grid-template-columns: 1fr;
  grid-template-rows: auto minmax(0, 1fr) var(--analysis-bottom-height);
}
```

Keep the existing default `.app-layout` row order:

```css
grid-template-rows: auto minmax(0, 1fr) auto var(--analysis-bottom-height);
```

- [ ] **Step 5: Update board frame and action rail CSS for centered side-action groups**

Modify the side-action CSS in `web/src/styles.css`:

```css
.side-action-layout .board-frame {
  --board-frame-clearance: calc(var(--side-action-width, 42px) + 16px);
}

.side-action-layout .action-rail {
  grid-row: 2;
  grid-column: 1 / -1;
  position: absolute;
  left: var(--side-action-left, 0px);
  top: var(--side-action-top, 0px);
  width: var(--side-action-width, 42px);
  transform: translateY(-50%);
  align-content: center;
  justify-content: center;
  z-index: 5;
  padding: 0;
  background: transparent;
  border: 0;
  overflow: visible;
}
```

- [ ] **Step 6: Update narrow portrait analysis sizing**

Inside `@container app-layout (max-width: 699px)`, keep the bottom analysis row as:

```css
.analysis-rail {
  grid-row: 4;
  min-height: 0;
  max-height: none;
  grid-template-rows: var(--analysis-overview-height) minmax(var(--analysis-detail-preview-height), 1fr);
  gap: 4px;
  padding: 4px 6px 6px;
  background: var(--board-zone);
  overflow: hidden;
}

.side-action-layout .analysis-rail {
  grid-row: 3;
}
```

- [ ] **Step 7: Update wide portrait analysis sizing**

Inside `@container app-layout (min-width: 700px)`, keep two columns and use the wide minimum height:

```css
.app-layout {
  --analysis-bottom-height: var(--wide-analysis-bottom-height);
  grid-template-rows: auto minmax(0, 1fr) auto var(--wide-analysis-bottom-height);
}

.app-layout.side-action-layout {
  grid-template-rows: auto minmax(0, 1fr) var(--wide-analysis-bottom-height);
}

.analysis-rail {
  position: relative;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  grid-row: 4;
  min-height: 0;
  max-height: none;
  gap: 6px;
  padding: 3px 10px 8px;
  background: var(--board-zone);
  overflow: hidden;
}
```

- [ ] **Step 8: Run CSS tests to verify green**

Run:

```powershell
cd web
npm test -- --run src/styles.test.ts
```

Expected: all `styles.test.ts` tests pass.

- [ ] **Step 9: Commit CSS allocation rules**

```powershell
git add web/src/styles.css web/src/styles.test.ts
git commit -m "Refine portrait layout allocation"
```

---

### Task 4: Focused Regression Pass

**Files:**
- Verify only: `web/src/layout/sideActionRail.test.ts`
- Verify only: `web/src/App.layout.test.ts`
- Verify only: `web/src/styles.test.ts`

- [ ] **Step 1: Run focused layout tests**

Run:

```powershell
cd web
npm test -- --run src/layout/sideActionRail.test.ts src/App.layout.test.ts src/styles.test.ts
```

Expected: all focused layout tests pass.

- [ ] **Step 2: Inspect CSS for forbidden orientation layout branches**

Run:

```powershell
rg -n "@media \(orientation|orientation: portrait|landscape|rotate-prompt" web/src/styles.css web/src/App.tsx web/src/pwa/viewportInteraction.ts
```

Expected: no layout branch in `styles.css`; `viewportInteraction.ts` may still contain orientation only in debug output.

- [ ] **Step 3: Confirm focused regression files are already committed**

Run:

```powershell
git status --short web/src/layout/sideActionRail.test.ts web/src/App.layout.test.ts web/src/styles.test.ts
```

Expected: no output. Any output means the matching earlier task is incomplete and must be finished before Task 5.

---

### Task 5: Full Verification and Repository Gate

**Files:**
- Verify all frontend code.
- Follow `CLAUDE.md` completion gate.

- [ ] **Step 1: Run full frontend tests**

Run:

```powershell
cd web
npm test -- --run
```

Expected: all frontend tests pass with no unhandled errors.

- [ ] **Step 2: Run production build**

Run:

```powershell
cd web
npm run build
```

Expected: TypeScript build and Vite production build exit 0.

- [ ] **Step 3: Check git status**

Run:

```powershell
git status --short --branch
```

Expected: only intended source and doc changes are present.

- [ ] **Step 4: Execute repository completion gate**

Run the exact required tail sequence from `CLAUDE.md`:

```powershell
git add -A
git commit -m "Implement portrait layout allocation"
git push origin master
```

Expected: commit succeeds and `master` pushes to `origin/master`.
