# Unified UI Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every authenticated JCGO view one persistent title bar, turn long-running surfaces into title-bar-below pages, and make all back paths consume the same application history.

**Architecture:** Keep `App` as the owner of browser history and workspace state. Classify each existing `AppHistoryLayer` as `home`, `page`, or `overlay`; use one reactive current-layer value plus its ref mirror for history callbacks, render page layers in one fixed workspace below the existing sidebar/title-bar component, and leave overlays owned by their current page. Extract the local game library from `GameSidebar` and make import, Yuanluobo, and settings render page bodies without private title bars or dialog backdrops.

**Tech Stack:** React 19, TypeScript, Lucide, existing CSS custom properties and container queries, Vitest with Testing Library.

---

## File Structure

- Create: `web/src/layout/appLayers.ts` — canonical layer type, page/overlay classification, titles, and import picker mapping.
- Create: `web/src/layout/appLayers.test.ts` — pure classification regression tests.
- Create: `web/src/components/GameLibraryPage.tsx` — scrollable local-game page body extracted from `GameSidebar`.
- Create: `web/src/components/GameLibraryPage.test.tsx` — selection, deletion, result marker, and page-body tests.
- Modify: `web/src/App.tsx` — use layer metadata, pass contextual title-bar state, render one page workspace, and preserve browser-history semantics.
- Modify: `web/src/App.navigation.test.tsx` — prove page header state, unavailable-home-controls, nested returns, and `Escape` behavior.
- Modify: `web/src/components/GameSidebar.tsx` — render either the home title bar and analysis controls or the contextual page title bar.
- Modify: `web/src/components/GameSidebar.test.tsx` — test home/context title-bar variants.
- Modify: `web/src/components/ImportDialog.tsx` — render import source and URL content as page bodies rather than dialogs; continue to host the Yuanluobo page body.
- Modify: `web/src/components/ImportDialog.test.tsx` — test page-body roles and remove dialog-only expectations.
- Modify: `web/src/components/YuanluoboImportDialog.tsx` — remove duplicate page title bars; retain the picker as the only modal layer and report login state to the app shell.
- Modify: `web/src/components/YuanluoboImportDialog.test.tsx` — test title-free body and modal picker behavior.
- Modify: `web/src/components/SettingsPage.tsx` — remove its private header and dialog role; leave Worker controls as a scrollable page body.
- Modify: `web/src/components/SettingsPage.test.tsx` — test the page-body contract.
- Modify: `web/src/styles.css` — add contextual title-bar and common page-workspace rules, then convert page CSS away from modal/fullscreen geometry.
- Modify: `web/src/styles.test.ts` — lock title-bar-below page geometry and modal pointer blocking across breakpoints.

### Task 1: Define the Layer Contract

**Files:**
- Create: `web/src/layout/appLayers.ts`
- Create: `web/src/layout/appLayers.test.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write the failing classification test**

Create `web/src/layout/appLayers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appLayer, importModeForLayer, pageLayerFor, yuanluoboPickerForLayer } from './appLayers'

describe('appLayers', () => {
  it('classifies long-lived destinations as pages and pickers as overlays', () => {
    expect(appLayer('home')).toMatchObject({ kind: 'home', title: 'JCGO' })
    expect(appLayer('game-list')).toMatchObject({ kind: 'page', title: '本地棋局' })
    expect(appLayer('settings')).toMatchObject({ kind: 'page', title: '设置' })
    expect(appLayer('import-choose')).toMatchObject({ kind: 'page', title: '导入棋局' })
    expect(appLayer('import-url')).toMatchObject({ kind: 'page', title: '从链接导入' })
    expect(appLayer('import-yuanluobo')).toMatchObject({ kind: 'page', title: '元萝卜' })
    expect(appLayer('yuanluobo-player-picker')).toMatchObject({ kind: 'overlay', parent: 'import-yuanluobo' })
    expect(appLayer('yuanluobo-platform-picker')).toMatchObject({ kind: 'overlay', parent: 'import-yuanluobo' })
    expect(pageLayerFor('yuanluobo-player-picker')).toBe('import-yuanluobo')
  })

  it('keeps import rendering and picker mapping derived from the layer', () => {
    expect(importModeForLayer('import-url')).toBe('url')
    expect(importModeForLayer('import-yuanluobo')).toBe('yuanluobo')
    expect(importModeForLayer('yuanluobo-player-picker')).toBe('yuanluobo')
    expect(yuanluoboPickerForLayer('yuanluobo-player-picker')).toBe('player')
    expect(yuanluoboPickerForLayer('yuanluobo-platform-picker')).toBe('platform')
    expect(yuanluoboPickerForLayer('import-yuanluobo')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run appLayers`

Expected: FAIL because `./appLayers` does not exist.

- [ ] **Step 3: Implement the canonical layer metadata**

Create `web/src/layout/appLayers.ts`:

```ts
import type { ImportDialogMode } from '../components/ImportDialog'
import type { YuanluoboPickerKind } from '../components/YuanluoboImportDialog'

export type AppHistoryLayer =
  | 'home'
  | 'game-list'
  | 'settings'
  | 'import-choose'
  | 'import-url'
  | 'import-yuanluobo'
  | 'yuanluobo-player-picker'
  | 'yuanluobo-platform-picker'

export type AppLayerKind = 'home' | 'page' | 'overlay'

export type AppLayer = {
  kind: AppLayerKind
  title: string
  parent?: AppHistoryLayer
}

const layers: Record<AppHistoryLayer, AppLayer> = {
  home: { kind: 'home', title: 'JCGO' },
  'game-list': { kind: 'page', title: '本地棋局' },
  settings: { kind: 'page', title: '设置' },
  'import-choose': { kind: 'page', title: '导入棋局' },
  'import-url': { kind: 'page', title: '从链接导入' },
  'import-yuanluobo': { kind: 'page', title: '元萝卜' },
  'yuanluobo-player-picker': { kind: 'overlay', title: '选择棋手', parent: 'import-yuanluobo' },
  'yuanluobo-platform-picker': { kind: 'overlay', title: '选择平台', parent: 'import-yuanluobo' },
}

export function appLayer(layer: AppHistoryLayer): AppLayer {
  return layers[layer]
}

export function isPageLayer(layer: AppHistoryLayer): boolean {
  return appLayer(layer).kind === 'page'
}

export function pageLayerFor(layer: AppHistoryLayer): AppHistoryLayer {
  return appLayer(layer).parent ?? layer
}

export function isImportLayer(layer: AppHistoryLayer): boolean {
  return layer === 'import-choose'
    || layer === 'import-url'
    || layer === 'import-yuanluobo'
    || appLayer(layer).kind === 'overlay'
}

export function importModeForLayer(layer: AppHistoryLayer): ImportDialogMode {
  if (layer === 'import-url') return 'url'
  if (layer === 'import-yuanluobo' || appLayer(layer).kind === 'overlay') return 'yuanluobo'
  return 'choose'
}

export function yuanluoboPickerForLayer(layer: AppHistoryLayer): YuanluoboPickerKind | undefined {
  if (layer === 'yuanluobo-player-picker') return 'player'
  if (layer === 'yuanluobo-platform-picker') return 'platform'
  return undefined
}

export const appHistoryLayers = new Set<AppHistoryLayer>(Object.keys(layers) as AppHistoryLayer[])
```

In `web/src/App.tsx`, import `AppHistoryLayer`, `appHistoryLayers`, `importModeForLayer`, `isImportLayer`, `isPageLayer`, `pageLayerFor`, and `yuanluoboPickerForLayer` from `./layout/appLayers`. Remove the local `AppHistoryLayer` union, local `appHistoryLayers` set, and the three mapping helpers at the bottom of the file.

- [ ] **Step 4: Run the layer tests**

Run: `npm test -- --run appLayers`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the navigation contract**

```powershell
git add web/src/layout/appLayers.ts web/src/layout/appLayers.test.ts web/src/App.tsx
git commit -m "refactor: define app navigation layers"
```

### Task 2: Add a Contextual Variant to the Existing Title Bar

**Files:**
- Modify: `web/src/components/GameSidebar.tsx`
- Modify: `web/src/components/GameSidebar.test.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: Write the failing contextual-title-bar test**

Add to `web/src/components/GameSidebar.test.tsx`:

```tsx
it('replaces home controls with one contextual page title and back action', () => {
  const onBack = vi.fn()
  render(
    <GameSidebar
      games={[]}
      selectedGameId="game-1"
      contextualTitle="设置"
      onContextBack={onBack}
      analysisAvailable
      analysisState="idle"
      onOpenGameList={vi.fn()}
      onToggleList={vi.fn()}
      onImport={vi.fn()}
      onSettings={vi.fn()}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onStartAnalysis={vi.fn()}
      onStopAnalysis={vi.fn()}
      onRestartAnalysis={vi.fn()}
    />,
  )

  expect(screen.getByRole('banner', { name: '设置' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '返回设置' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Show game list')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Import SGF')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Open settings')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('打开分析菜单')).not.toBeInTheDocument()

  screen.getByRole('button', { name: '返回设置' }).click()
  expect(onBack).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run GameSidebar`

Expected: FAIL because `contextualTitle` and `onContextBack` are not supported.

- [ ] **Step 3: Extend `GameSidebar` with home and contextual header modes**

In `web/src/components/GameSidebar.tsx`, add these fields without removing the existing `listOpen` and `onToggleList` fields yet:

```ts
  contextualTitle?: string
  onContextBack?(): void
  contextActions?: ReactNode
  onOpenGameList?(): void
```

Import `ArrowLeft` and replace the start of the returned sidebar with:

```tsx
<aside className={contextualTitle ? 'game-sidebar contextual' : 'game-sidebar'}>
  {contextualTitle ? (
    <header className="sidebar-header contextual-titlebar" role="banner" aria-label={contextualTitle}>
      <button className="icon-button contextual-back-button" type="button" onClick={onContextBack} aria-label={`返回${contextualTitle}`}>
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
      <h1>{contextualTitle}</h1>
      <div className="sidebar-context-actions">{contextActions}</div>
    </header>
  ) : (
    <>
      <div className="sidebar-header">
        <h1>JCGO</h1>
        <div className="sidebar-actions sidebar-file-actions">
          <button className="icon-button" onClick={() => onOpenGameList?.() ?? onToggleList()} aria-label="Show game list">
            <Menu size={17} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={onImport} aria-label="Import SGF">
            <Plus size={18} aria-hidden="true" />
          </button>
          <button className="icon-button" onClick={onSettings} aria-label="Open settings">
            <Settings size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar-toggle-actions">{toolbarSlot}</div>
      </div>
      <div className="sidebar-analysis">
        <AnalysisMenu
          selectedGameId={selectedGameId}
          selectedWorkerName={selectedAnalysisWorkerName}
          workerStatus={workerStatus}
          analysisSchedule={analysisSchedule}
          analysisAvailable={analysisAvailable}
          analysisError={analysisError}
          analysisState={analysisState}
          analysisProgress={analysisProgress}
          onSetAnalysisWorker={onSetAnalysisWorker}
          onStartAnalysis={onStartAnalysis}
          onStopAnalysis={onStopAnalysis}
          onRestartAnalysis={onRestartAnalysis}
          onBoostAnalysis={onBoostAnalysis}
        />
      </div>
    </>
  )}
</aside>
```

Keep the embedded `<section className="game-list">` and its helpers for this commit. Task 3 copies the body into its page component, and Task 6 removes the old sidebar surface only after `App` renders the replacement.

- [ ] **Step 4: Add the shared title-bar CSS**

In `web/src/styles.css`, add these rules next to `.game-sidebar` and repeat only layout-track overrides in the existing responsive container queries:

```css
.game-sidebar.contextual {
  z-index: 80;
  grid-template-rows: minmax(0, 1fr);
}

.contextual-titlebar {
  min-width: 0;
  min-height: var(--topbar-height);
  display: grid;
  grid-template-columns: var(--ui-btn-size) minmax(0, 1fr) var(--ui-btn-size);
  align-items: center;
  gap: 8px;
}

.contextual-titlebar h1 {
  display: block;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-context-actions {
  width: var(--ui-btn-size);
  height: var(--ui-btn-size);
  display: grid;
  place-items: center;
}

.contextual-back-button {
  justify-self: start;
}
```

Add a style assertion in `web/src/styles.test.ts`:

```ts
expect(styles).toContain('.contextual-titlebar {\n  min-width: 0;\n  min-height: var(--topbar-height);\n  display: grid;')
expect(styles).toContain('grid-template-columns: var(--ui-btn-size) minmax(0, 1fr) var(--ui-btn-size);')
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run "GameSidebar|styles"`

Expected: PASS. The home-side analysis menu tests remain unchanged and the new contextual test passes.

- [ ] **Step 6: Commit the title-bar variant**

```powershell
git add web/src/components/GameSidebar.tsx web/src/components/GameSidebar.test.tsx web/src/styles.css web/src/styles.test.ts
git commit -m "feat: add contextual page titlebar"
```

### Task 3: Extract the Local Game Library into a Page Body

**Files:**
- Create: `web/src/components/GameLibraryPage.tsx`
- Create: `web/src/components/GameLibraryPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write the failing local-library page test**

Create `web/src/components/GameLibraryPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GameLibraryPage } from './GameLibraryPage'

describe('GameLibraryPage', () => {
  it('renders a scrollable page body and selects a local game', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <GameLibraryPage
        games={[{
          gameId: 'game-1', displayName: 'Lee vs Cho', sgfFilename: 'game-1.sgf', result: 'B+R',
          gameDate: '2026-07-10', blackName: 'Lee', whiteName: 'Cho', analysisStatus: 'running', createdAt: '2026-07-10T10:00:00Z',
        }]}
        selectedGameId="game-1"
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    )

    const page = screen.getByRole('region', { name: '本地棋局内容' })
    expect(page).toHaveClass('app-page-body')
    expect(screen.getByText('共 1 局')).toBeInTheDocument()
    expect(screen.getByText('分析中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Lee.*vs.*Cho/ }))
    expect(onSelect).toHaveBeenCalledWith('game-1')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run GameLibraryPage`

Expected: FAIL because `GameLibraryPage` does not exist.

- [ ] **Step 3: Move the library markup and helpers out of `GameSidebar`**

Create `web/src/components/GameLibraryPage.tsx`. Copy the old game-list JSX and the existing `analysisBadgeClass`, `analysisStatusLabel`, `localGameWinner`, `localGameResultMarker`, `localGameTitle`, and `formatDateLabel` helpers into this file. The old sidebar surface remains temporarily until Task 6. Export this component with this boundary:

```tsx
export function GameLibraryPage({
  games,
  selectedGameId,
  onSelect,
  onDelete,
}: {
  games: GameRecord[]
  selectedGameId?: string
  onSelect(gameId: string): void
  onDelete(gameId: string): void
}) {
  return (
    <section className="app-page-body game-library-page" role="region" aria-label="本地棋局内容">
      <div className="game-list-shell">
        <header className="game-list-header">
          <div>
            <p className="game-list-eyebrow">Local games</p>
            <h2>本地棋局</h2>
          </div>
          <span className="game-list-count">共 {games.length} 局</span>
        </header>
        <div className="game-list-body yuanluobo-record-list">{/* moved rows */}</div>
      </div>
    </section>
  )
}
```

Keep each delete action inside `window.confirm`, as today, and retain the exact row DOM classes so the already-aligned Yuanluobo-style list keeps its visual treatment.

- [ ] **Step 4: Render the page body from `App`**

Do not wire this component into `App` yet; Task 6 does that once the shared workspace exists. Confirm only the component contract here:

```tsx
{currentLayer === 'game-list' && (
  <GameLibraryPage
    games={games}
    selectedGameId={selectedGameId}
    onSelect={selectGame}
    onDelete={deleteGame}
  />
)}
```

Keep the current sidebar list behavior until Task 6. The component's `onSelect` callback is intentionally identical to the existing callback so the later integration can use `selectGame` unchanged.

- [ ] **Step 5: Convert the list geometry from a sibling overlay to page-body geometry**

In `web/src/styles.css`, add the reusable page-body class without removing sidebar-list rules yet:

```css
.app-page-body {
  min-width: 0;
  min-height: 0;
  width: min(1040px, 100%);
  height: 100%;
  display: grid;
  margin: 0 auto;
  overflow: hidden;
}

.game-library-page {
  padding: 12px;
  box-sizing: border-box;
}
```

Leave `.game-list-shell`, `.game-list-header`, `.game-list-body`, `.game-row`, and existing sidebar-list rules in place. Task 6 deletes the obsolete fixed overlay selectors after the replacement is mounted.

- [ ] **Step 6: Run the page and navigation tests**

Run: `npm test -- --run GameLibraryPage`

Expected: PASS. Existing app navigation remains untouched at this point.

- [ ] **Step 7: Commit the extracted library page**

```powershell
git add web/src/components/GameLibraryPage.tsx web/src/components/GameLibraryPage.test.tsx web/src/styles.css
git commit -m "refactor: render local games as a page"
```

### Task 4: Convert Import and Yuanluobo to Page Bodies

**Files:**
- Modify: `web/src/components/ImportDialog.tsx`
- Modify: `web/src/components/ImportDialog.test.tsx`
- Modify: `web/src/components/YuanluoboImportDialog.tsx`
- Modify: `web/src/components/YuanluoboImportDialog.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing import-page tests**

Replace the dialog assertions in `web/src/components/ImportDialog.test.tsx` with:

```tsx
it('renders source selection as a page body instead of a dialog', () => {
  renderImportDialog()
  expect(screen.getByRole('region', { name: '导入棋局内容' })).toHaveClass('app-page-body', 'import-page')
  expect(screen.queryByRole('dialog', { name: '导入棋局' })).not.toBeInTheDocument()
})

it('renders URL entry as a page body instead of a dialog', () => {
  renderImportDialog({ mode: 'url' })
  expect(screen.getByRole('region', { name: '从链接导入内容' })).toHaveClass('app-page-body', 'import-page')
  expect(screen.queryByRole('dialog', { name: '从链接导入' })).not.toBeInTheDocument()
})
```

In the existing `loads categories, records, and marks imported games` test in `web/src/components/YuanluoboImportDialog.test.tsx`, replace the browser assertion and add the modal assertion:

```tsx
expect(await screen.findByRole('region', { name: '元萝卜棋局内容' })).toHaveClass('app-page-body', 'yuanluobo-browser')
// Existing player picker interaction follows.
expect(playerDialog).toHaveAttribute('aria-modal', 'true')
```

- [ ] **Step 2: Run the import and Yuanluobo tests and verify failure**

Run: `npm test -- --run "ImportDialog|YuanluoboImportDialog"`

Expected: FAIL because both components still use dialog/fullscreen wrappers and duplicate page headers.

- [ ] **Step 3: Remove modal wrappers and local back headers from import content**

In `web/src/components/ImportDialog.tsx`:

1. Keep the `mode`, import callbacks, picker API, and file-picker behavior unchanged.
2. Add the optional callback to `ImportDialogProps` and pass it only to the Yuanluobo body:

```ts
onLoginStateChange?(loggedIn: boolean): void
```

3. Remove all `<div className="import-dialog" role="dialog">` wrappers and both `.import-panel-header` blocks.
4. Remove `ArrowLeft` and `X` imports, `onBack` from `ImportDialogProps`, and the `back` function; page-level return now belongs to the app title bar. Remove the `onBack` value from every `renderImportDialog` test fixture.
5. Return these explicit page bodies:

```tsx
if (mode === 'url') {
  return (
    <section className="app-page-body import-page import-url-page" role="region" aria-label="从链接导入内容">
      <label className="import-url-field">{/* existing URL field */}</label>
      {error && <div className="import-error">{error}</div>}
      <div className="import-dialog-actions">
        <button className="import-primary-button" onClick={handleUrlSubmit} disabled={loading || !url.trim()}>
          {loading ? '导入中...' : '导入'}
        </button>
      </div>
    </section>
  )
}

if (mode === 'yuanluobo') {
  return <YuanluoboImportDialog api={yuanluoboApi} pickerKind={yuanluoboPickerKind} onOpenPicker={onOpenYuanluoboPicker} onClosePicker={onCloseYuanluoboPicker} onLoginStateChange={onLoginStateChange} />
}

return (
  <section className="app-page-body import-page" role="region" aria-label="导入棋局内容">
    <div className="import-source-grid">{/* existing three source buttons */}</div>
    <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
  </section>
)
```

For a URL import failure, retain the error in the same page. On success, keep the existing `onImportUrl` behavior, which resets the history layer to the local game library.

- [ ] **Step 4: Remove duplicate Yuanluobo page headers and preserve only the picker dialog**

In `web/src/components/YuanluoboImportDialog.tsx`:

1. Remove the `onBack` prop, `ArrowLeft` import, and all `.yuanluobo-back-button` markup. Add the optional prop `onLoginStateChange?(loggedIn: boolean): void`. Update `renderYuanluoboImportDialog` in its test file to stop accepting and passing `onBack`.
2. Replace login sections with `role="region"` page bodies:

```tsx
<section className="app-page-body yuanluobo-login-layout" role="region" aria-label="元萝卜登录内容">
  {/* existing login copy without the back button, QR card, and error */}
</section>
```

3. Replace the browser root and remove its `.yuanluobo-header`:

```tsx
<section className="app-page-body yuanluobo-browser" role="region" aria-label="元萝卜棋局内容">
  <div className="yuanluobo-filter-bar">{/* existing filters */}</div>
  <div className="yuanluobo-record-toolbar"><strong>棋局记录</strong></div>
  <div className="yuanluobo-browser-body">{/* existing rows */}</div>
  <footer className="yuanluobo-pager">{/* existing pager */}</footer>
  {pickerKind && <YuanluoboPicker /* existing dialog markup */ />}
</section>
```

4. Keep `.yuanluobo-picker-backdrop` and `.yuanluobo-picker-sheet` untouched except for the pointer-blocking rule in Step 5.
5. Report the login state to the app title bar with this effect:

```ts
useEffect(() => {
  onLoginStateChange?.(loginState === 'logged-in')
  return () => onLoginStateChange?.(false)
}, [loginState, onLoginStateChange])
```

The app title bar uses this value to render the existing `LogOut` icon button and calls the API directly.

- [ ] **Step 5: Replace modal/fullscreen positioning with page-body positioning**

In `web/src/styles.css`, remove `.import-dialog`, `.yuanluobo-fullscreen-dialog`, `.yuanluobo-fullscreen-page`, and the page-specific padding that assumes a private title bar. Add:

```css
.app-page-workspace {
  position: fixed;
  inset: calc(var(--app-safe-top) + var(--topbar-height)) var(--app-safe-right) var(--app-safe-bottom) var(--app-safe-left);
  z-index: 70;
  display: grid;
  min-width: 0;
  min-height: 0;
  background: var(--paper);
  overflow: hidden;
}

.import-page {
  align-content: start;
  gap: 18px;
  padding: clamp(16px, 3vw, 32px);
  box-sizing: border-box;
  overflow: auto;
}

.yuanluobo-login-layout,
.yuanluobo-browser {
  width: 100%;
  height: 100%;
  padding: clamp(16px, 3vw, 32px);
  box-sizing: border-box;
}

.yuanluobo-picker-backdrop {
  z-index: 90;
  pointer-events: auto;
}
```

Do not retain `backdrop-filter` for page destinations. The picker backdrop stays `position: fixed` with its current dimmed treatment.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- --run "ImportDialog|YuanluoboImportDialog"`

Expected: PASS. Only the player/platform picker uses `role="dialog"`.

- [ ] **Step 7: Commit the import page conversion**

```powershell
git add web/src/components/ImportDialog.tsx web/src/components/ImportDialog.test.tsx web/src/components/YuanluoboImportDialog.tsx web/src/components/YuanluoboImportDialog.test.tsx web/src/styles.css
git commit -m "refactor: render import flows as pages"
```

### Task 5: Convert Settings to a Shared Page Body

**Files:**
- Modify: `web/src/components/SettingsPage.tsx`
- Modify: `web/src/components/SettingsPage.test.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write the failing settings page-body test**

In `web/src/components/SettingsPage.test.tsx`, add:

```tsx
it('renders worker controls as a page body without a private titlebar', () => {
  render(<SettingsPage workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }} onConfigureWorker={vi.fn()} />)
  expect(screen.getByRole('region', { name: '设置内容' })).toHaveClass('app-page-body', 'settings-page')
  expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run SettingsPage`

Expected: FAIL because the component currently renders a dialog and its own return title bar.

- [ ] **Step 3: Make `SettingsPage` content-only**

In `web/src/components/SettingsPage.tsx`:

1. Remove `ArrowLeft`, `onBack`, and the `.settings-header` markup.
2. Change the outer wrapper to:

```tsx
return (
  <section className="app-page-body settings-page" role="region" aria-label="设置内容">
    <section className="settings-section" role="region" aria-label="Worker 状态">
      {/* existing summary and worker rows */}
    </section>
  </section>
)
```

3. Keep `WorkerRow`, model selection, visits input, save behavior, availability state, CPU, GPU, and backend labels unchanged.

Remove `onBack={vi.fn()}` from every existing `SettingsPage` test fixture because the component props no longer include it.

- [ ] **Step 4: Convert settings CSS to page-body CSS**

Replace the fixed geometry on `.settings-page` with:

```css
.settings-page {
  padding: 12px;
  box-sizing: border-box;
}

.settings-page .settings-section {
  min-height: 0;
  height: 100%;
}
```

Remove `.settings-panel`, `.settings-header`, `.settings-back-button`, `.settings-title-block`, and `.settings-eyebrow` rules after confirming no other selector uses them.

- [ ] **Step 5: Run the settings tests**

Run: `npm test -- --run SettingsPage`

Expected: PASS.

- [ ] **Step 6: Commit the settings page conversion**

```powershell
git add web/src/components/SettingsPage.tsx web/src/components/SettingsPage.test.tsx web/src/styles.css
git commit -m "refactor: render settings as a page"
```

### Task 6: Assemble Page Workspace and Unify History Controls

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.navigation.test.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing end-to-end navigation tests**

Add these tests to `web/src/App.navigation.test.tsx`:

```tsx
it('shows a contextual titlebar and hides home actions while a page is open', async () => {
  stubAuthenticatedStorage()
  rpc.state = mainlineState(5, 12)
  render(<App />)
  await screen.findByLabelText('Move 5, white to play')

  await userEvent.click(screen.getByLabelText('Open settings'))
  expect(screen.getByRole('banner', { name: '设置' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '设置内容' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Show game list')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Import SGF')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Open settings')).not.toBeInTheDocument()
})

it('uses the same one-layer return for titlebar back and Escape', async () => {
  stubAuthenticatedStorage()
  rpc.responses = [mainlineState(5, 12), { loggedIn: false }, { key: 'key-1', scanUrl: 'https://example.test/qr' }, { status: 0, desc: '未扫码' }]
  render(<App />)
  await screen.findByLabelText('Move 5, white to play')

  await userEvent.click(screen.getByLabelText('Import SGF'))
  await userEvent.click(screen.getByRole('button', { name: /复盘链接/ }))
  expect(screen.getByRole('banner', { name: '从链接导入' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '返回从链接导入' }))
  expect(screen.getByRole('banner', { name: '导入棋局' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /元萝卜账号/ }))
  expect(await screen.findByRole('banner', { name: '元萝卜' })).toBeInTheDocument()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await waitFor(() => expect(screen.getByRole('banner', { name: '导入棋局' })).toBeInTheDocument())
})
```

- [ ] **Step 2: Run the navigation tests and verify failure**

Run: `npm test -- --run App.navigation`

Expected: FAIL because pages still mount as dialogs or fixed sibling overlays and `GameSidebar` does not receive contextual props.

- [ ] **Step 3: Derive all visible state from the current layer**

In `web/src/App.tsx`, replace the five independent layer states:

```ts
const [showImport, setShowImport] = useState(false)
const [importMode, setImportMode] = useState<ImportDialogMode>('choose')
const [yuanluoboPickerKind, setYuanluoboPickerKind] = useState<YuanluoboPickerKind>()
const [gameListOpen, setGameListOpen] = useState(false)
const [settingsOpen, setSettingsOpen] = useState(false)
```

with the single reactive source of truth:

```ts
const [currentLayer, setCurrentLayer] = useState<AppHistoryLayer>('home')
```

Keep `appHistoryLayerRef` for non-render callback access. Add these derived values near the existing selected-game values:

```ts
const pageLayer = pageLayerFor(currentLayer)
const layer = appLayer(pageLayer)
const pageOpen = isPageLayer(pageLayer)
const yuanluoboOpen = pageLayer === 'import-yuanluobo'
const importMode = importModeForLayer(currentLayer)
const yuanluoboPickerKind = yuanluoboPickerForLayer(currentLayer)
```

Change `applyAppHistoryLayer` to update the same ref and state:

```ts
const applyAppHistoryLayer = useCallback((layer: AppHistoryLayer) => {
  appHistoryLayerRef.current = layer
  setCurrentLayer(layer)
}, [])
```

Remove imports used only by the deleted state declarations. Do not add a second page-mode state: `pageLayer`, `pageOpen`, import mode, and picker kind must all be derived from `currentLayer`.

- [ ] **Step 4: Switch the sidebar and render one page workspace**

Replace the `GameSidebar` list props and add contextual props:

```tsx
<GameSidebar
  games={games}
  selectedGameId={selectedGameId}
  selectedAnalysisWorkerName={selectedGame?.analysisWorkerName}
  contextualTitle={pageOpen ? layer.title : undefined}
  onContextBack={pageOpen ? closeCurrentAppHistoryLayer : undefined}
  contextActions={yuanluoboOpen && yuanluoboLoggedIn ? (
    <button className="icon-button" type="button" aria-label="退出元萝卜" onClick={() => void logoutYuanluobo()}>
      <LogOut size={17} aria-hidden="true" />
    </button>
  ) : undefined}
  onOpenGameList={() => pushAppHistoryLayer('game-list')}
  onImport={() => pushAppHistoryLayer('import-choose')}
  onSettings={() => { pushAppHistoryLayer('settings'); void refreshWorkspaceState() }}
  {/* existing analysis props and toolbarSlot */}
/>
```

Add `LogOut` to the `lucide-react` import, state and handler:

```ts
const [yuanluoboLoggedIn, setYuanluoboLoggedIn] = useState(false)

const logoutYuanluobo = async () => {
  await yuanluoboApi.logout()
  setYuanluoboLoggedIn(false)
  closeCurrentAppHistoryLayer()
}
```

After `</main>`, replace the old import/settings conditional rendering with:

```tsx
{pageOpen && (
  <section className="app-page-workspace" aria-label={`${layer.title}页面`}>
    {currentLayer === 'game-list' && <GameLibraryPage games={games} selectedGameId={selectedGameId} onSelect={selectGame} onDelete={deleteGame} />}
    {currentLayer === 'settings' && <SettingsPage workerStatus={workspace?.workerStatus} onConfigureWorker={configureWorker} />}
    {isImportLayer(currentLayer) && client && (
      <ImportDialog
        mode={importMode}
        onImport={importGame}
        onImportUrl={importFromUrl}
        onOpenUrl={() => pushAppHistoryLayer('import-url')}
        onOpenYuanluobo={() => pushAppHistoryLayer('import-yuanluobo')}
        yuanluoboApi={yuanluoboApi}
        yuanluoboPickerKind={yuanluoboPickerKind}
        onOpenYuanluoboPicker={(kind) => pushAppHistoryLayer(kind === 'player' ? 'yuanluobo-player-picker' : 'yuanluobo-platform-picker')}
        onCloseYuanluoboPicker={closeCurrentAppHistoryLayer}
        onLoginStateChange={setYuanluoboLoggedIn}
      />
    )}
  </section>
)}
```

Pass `onLoginStateChange` through `ImportDialog` into `YuanluoboImportDialog`. Reset `yuanluoboLoggedIn` to `false` whenever `pageLayer` is not `import-yuanluobo`.

After the new workspace is rendering `GameLibraryPage`, finish the extraction in the same task:

1. Remove `listOpen` and `onToggleList` from `GameSidebarProps`, the old `expanded` class calculation, the embedded game-list section, and its copied helper functions from `web/src/components/GameSidebar.tsx`.
2. Remove `gameListOpen` handling from `App`; the menu button now always calls `pushAppHistoryLayer('game-list')`.
3. Delete `.game-sidebar.expanded .game-list`, `.game-list[aria-hidden='true']`, and `.game-sidebar.expanded ~ .action-rail` from every base and breakpoint CSS block. Keep the row and list-body styling now used by `GameLibraryPage`.
4. Replace every existing test fixture that passes `listOpen` or `onToggleList` with `onOpenGameList`; replace list-region assertions with `GameLibraryPage` region assertions.

- [ ] **Step 5: Block background interaction without hiding the contextual titlebar**

Add `page-open` to the main class in `App.tsx`:

```tsx
<main ref={layoutRef} className={`${sideActionPlacement.enabled ? 'app-layout side-action-layout' : 'app-layout'}${pageOpen ? ' page-open' : ''}`} style={layoutStyle}>
```

and use the deterministic fallback:

```css
.app-layout.page-open .board-stage,
.app-layout.page-open .action-rail,
.app-layout.page-open .analysis-rail {
  pointer-events: none;
}
```

Add the deterministic background blocking rule to `web/src/styles.css`:

```css
.app-layout.page-open .board-stage,
.app-layout.page-open .action-rail,
.app-layout.page-open .analysis-rail {
  pointer-events: none;
}
```

Do not rely on `:has`; the contextual title bar remains outside these three selectors and stays interactive.

- [ ] **Step 6: Update existing history assertions**

In `web/src/App.navigation.test.tsx`, replace list checks such as:

```tsx
const list = container.querySelector<HTMLElement>('[aria-label="本地棋局列表"]')
expect(list).toHaveAttribute('aria-hidden', 'false')
```

with page checks:

```tsx
expect(screen.getByRole('banner', { name: '本地棋局' })).toBeInTheDocument()
expect(screen.getByRole('region', { name: '本地棋局内容' })).toBeInTheDocument()
```

After dispatching the home `PopStateEvent`, assert `queryByRole('region', { name: '本地棋局内容' })` is `null` and the home action `Show game list` is present again. Replace import dialog role assertions with the page-body region names from Task 4.

- [ ] **Step 7: Run navigation tests**

Run: `npm test -- --run App.navigation`

Expected: PASS, including the existing nested import, picker, and settings browser-back cases plus the two new contextual-titlebar tests.

- [ ] **Step 8: Commit unified app navigation**

```powershell
git add web/src/App.tsx web/src/App.navigation.test.tsx web/src/components/GameSidebar.tsx web/src/components/ImportDialog.tsx web/src/components/YuanluoboImportDialog.tsx web/src/styles.css
git commit -m "feat: unify page navigation shell"
```

### Task 7: Responsive Polish and Full Verification

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`
- Modify: `docs/scope/2026-07-10-unified-ui-navigation/spec-unified-ui-navigation.md`
- Create: `docs/scope/2026-07-10-unified-ui-navigation/plan-unified-ui-navigation.md`

- [ ] **Step 1: Add failing responsive layout assertions**

Add to `web/src/styles.test.ts`:

```ts
it('keeps page workspaces below the shared titlebar and leaves only short actions modal', () => {
  expect(styles).toContain('.app-page-workspace {\n  position: fixed;\n  inset: calc(var(--app-safe-top) + var(--topbar-height))')
  expect(styles).not.toContain('.import-dialog {\n  position: fixed;')
  expect(styles).toContain('.yuanluobo-picker-backdrop {')
  expect(styles).toContain('pointer-events: none;')
})
```

- [ ] **Step 2: Run the style test and verify the intended failure**

Run: `npm test -- --run styles`

Expected: FAIL until page workspace CSS and obsolete import-dialog CSS are fully removed.

- [ ] **Step 3: Normalize compact and wide breakpoint rules**

For every existing breakpoint that adjusts `.game-sidebar`, `.sidebar-header`, or `.game-sidebar.expanded .game-list`:

1. Retain the `.game-sidebar` and `.sidebar-header` sizing so the home title bar does not move.
2. Add `.game-sidebar.contextual` and `.contextual-titlebar` sizing only when the home rule changes the header grid or height.
3. Delete every `.game-sidebar.expanded .game-list` block; the page workspace has one `top` inset and does not need per-breakpoint fixed coordinates.
4. Ensure `.app-page-workspace` is `min-height: 0`, and each `.app-page-body` scrolls internally rather than increasing viewport height.

Use these narrow-screen rules if a breakpoint needs explicit override:

```css
@container app-layout (max-width: 699px) {
  .app-page-workspace {
    inset: calc(var(--app-safe-top) + var(--topbar-height)) var(--app-safe-right) var(--app-safe-bottom) var(--app-safe-left);
  }

  .app-page-body {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run all frontend tests**

Run: `npm test -- --run`

Expected: all existing tests plus new layout/navigation tests PASS. The existing Node `--localstorage-file` warning is acceptable when the command exits 0.

- [ ] **Step 5: Build the production frontend**

Run: `npm run build`

Expected: exit code 0. The current Vite chunk-size warning is acceptable.

- [ ] **Step 6: Inspect the final change set**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned frontend files and scope documents are modified.

- [ ] **Step 7: Run end-to-end repository verification and deploy**

Run:

```powershell
go test ./...
cd web
npm test -- --run
npm run build
cd ..
$env:JCGO_DEPLOY_NO_PAUSE = '1'
.\deploy.bat
$env:JCGO_RUNTIME_NO_PAUSE = '1'
& "$HOME\.jcgo\start.bat"
Get-Process jcgo,jcgo-worker,katago -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,Path
```

Expected: backend and frontend commands exit 0; deploy reports `[OK] deploy complete`; `jcgo.exe` and `jcgo-worker.exe` are running, with `katago.exe` present after worker initialization.

- [ ] **Step 8: Commit and push the verified implementation**

```powershell
git add -A
git commit -m "feat: unify UI page navigation"
git push origin master
```

Expected: commit and push both succeed. These are the final repository operations after all verification and deployment checks.
