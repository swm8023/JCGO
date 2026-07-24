# Quick Game Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user launch analysis for any local game from its list row by choosing a ready Worker and explicitly pressing Start.

**Architecture:** `GameLibraryPage` owns the short-lived analysis-sheet state and only presents workers supplied by `App`. `App` performs the existing `game.setAnalysisWorker` and `analysis.start` RPC calls for the target game, so selection and analysis remain authoritative on the server without changing the protocol.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing `AppSheet` and lucide-react icons.

---

### Task 1: Add the list-row quick-analysis UI and component test

**Files:**
- Modify: `web/src/components/GameLibraryPage.tsx`
- Modify: `web/src/components/GameLibraryPage.test.tsx`

- [x] **Step 1: Write the failing component test**

Add a test that passes one ready `gpu-worker` and one unavailable `cpu-worker`, clicks the new `快速分析 Lee VS Cho` row action, selects `gpu-worker`, and presses `开始分析`. Assert the sheet is named `快速分析`, the unavailable Worker cannot be selected, and `onStartAnalysis` receives `{ gameId: 'game-1', workerName: 'gpu-worker' }`.

```tsx
it('starts a chosen ready worker from a game-row quick-analysis sheet', async () => {
  const user = userEvent.setup()
  const onStartAnalysis = vi.fn().mockResolvedValue(undefined)
  render(<GameLibraryPage games={[game]} selectedGameId="game-1" onSelect={vi.fn()} onDelete={vi.fn()} onStartAnalysis={onStartAnalysis} workerStatus={workerStatus} />)

  await user.click(screen.getByRole('button', { name: '快速分析 Lee VS Cho' }))
  const sheet = screen.getByRole('dialog', { name: '快速分析' })
  expect(within(sheet).getByRole('option', { name: 'cpu-worker（不可用）' })).toBeDisabled()
  await user.selectOptions(within(sheet).getByLabelText('分析器'), 'gpu-worker')
  await user.click(within(sheet).getByRole('button', { name: '开始分析' }))
  expect(onStartAnalysis).toHaveBeenCalledWith({ gameId: 'game-1', workerName: 'gpu-worker' })
})
```

- [x] **Step 2: Run the component test and verify it fails because the quick-analysis action does not exist**

Run: `cd web; npm test -- --run src/components/GameLibraryPage.test.tsx`

Expected: FAIL because no button with accessible name `快速分析 Lee VS Cho` is rendered.

- [x] **Step 3: Implement the minimal quick-analysis sheet**

Extend the page props with `workerStatus?: WorkerStatus` and `onStartAnalysis?(input: { gameId: string; workerName: string }): Promise<void>`. Add `pendingAnalysis`, `analysisWorkerName`, and `startingAnalysis` state. Render a non-destructive action before the existing delete action, using `ChartNoAxesCombined` and the accessible name `快速分析 ${game.displayName}`. In an `AppSheet` titled `快速分析`, render a labelled Worker `<select>`, disable unavailable/error workers, and keep `开始分析` disabled until a ready Worker is selected. While awaiting the callback, disable controls and show `启动中...`; dismiss only after the callback resolves.

```tsx
await onStartAnalysis({ gameId: pendingAnalysis.gameId, workerName: analysisWorkerName })
setPendingAnalysis(undefined)
setAnalysisWorkerName('')
```

- [x] **Step 4: Run the component test and verify it passes**

Run: `cd web; npm test -- --run src/components/GameLibraryPage.test.tsx`

Expected: PASS with the existing list and delete tests plus the new quick-analysis test.

### Task 2: Wire the target-game RPC sequence through the app and cover it end-to-end

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.navigation.test.tsx`

- [x] **Step 1: Write the failing app-flow test**

Add an app navigation test with `gameLibraryState('game-1')` containing a ready Worker. Open the local-game page, open the quick-analysis sheet for `Second study`, select `gpu-worker`, and press `开始分析`. Queue response states for `game.setAnalysisWorker` and `analysis.start`, then assert the final two RPC calls exactly equal:

```tsx
expect(rpc.calls.slice(-2)).toEqual([
  { method: 'game.setAnalysisWorker', params: { gameId: 'game-2', workerName: 'gpu-worker' } },
  { method: 'analysis.start', params: { gameId: 'game-2' } },
])
```

- [x] **Step 2: Run the app-flow test and verify it fails because the component receives no quick-analysis callback**

Run: `cd web; npm test -- --run src/App.navigation.test.tsx`

Expected: FAIL because the quick-analysis trigger or RPC flow is absent.

- [x] **Step 3: Implement the app callback and pass it into the library page**

Add `startGameAnalysis({ gameId, workerName })` next to the existing analysis handlers. It must await `game.setAnalysisWorker` before `analysis.start`, apply each returned `StatePayload`, clear any active PV, and preserve the game-library layer rather than calling `resetAppHistoryLayer`. On a failure, set the app analysis state to `unavailable`, surface the existing error message, and rethrow so the sheet remains open. Pass `workspace?.workerStatus` and this callback to `GameLibraryPage`.

```tsx
const workerState = await client.call<StatePayload>('game.setAnalysisWorker', { gameId, workerName })
applyWorkspaceState(workerState)
const state = await client.call<StatePayload>('analysis.start', { gameId })
applyWorkspaceState(state)
```

- [x] **Step 4: Run the app-flow test and verify it passes**

Run: `cd web; npm test -- --run src/App.navigation.test.tsx`

Expected: PASS and the test observes Worker assignment followed by analysis start for the row's game ID.

### Task 3: Verify the frontend and repository state

**Files:**
- Verify: `web/src/components/GameLibraryPage.test.tsx`
- Verify: `web/src/App.navigation.test.tsx`

- [x] **Step 1: Run the full frontend test suite**

Run: `cd web; npm test -- --run`

Expected: PASS with zero failing tests.

- [x] **Step 2: Build the frontend**

Run: `cd web; npm run build`

Expected: TypeScript and Vite exit with code 0.

- [x] **Step 3: Inspect the final change set**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the quick-analysis implementation, tests, and this plan are changed (plus any pre-existing user changes reported separately).

- [ ] **Step 4: Commit and push the implementation**

Run: `git add -A; git commit -m "feat: add quick game analysis"; git push origin master`

Expected: a new commit is created and pushed to `origin/master`.
