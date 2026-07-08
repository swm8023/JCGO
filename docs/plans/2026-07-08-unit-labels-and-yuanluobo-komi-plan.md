# Unit Labels And Yuanluobo Komi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use "目" consistently in the UI and analysis prompts, convert Yuanluobo `tsugi` into KataGo/SGF komi correctly, surface analysis engine errors, and repair already imported affected SGF files.

**Architecture:** Keep KataGo analysis values authoritative in point/score-lead units. Convert Yuanluobo source fields at the import boundary, then keep stored SGF and UI display aligned to "目".

**Tech Stack:** Go backend, React/Vite frontend, SQLite/file-backed SGF data, KataGo JSON analysis engine.

---

### Task 1: Yuanluobo SGF Conversion

**Files:**
- Modify: `internal/app/sgf_import_test.go`
- Modify: `internal/app/sgf_import.go`

- [ ] **Step 1: Write the failing test**

Update `TestConvertYuanluoboToSGF` to expect `KM[7.5]` for `Tsugi: 3.75`, and update Yuanluobo result tests to expect `W+40.50` / `B+101.00` if result scores are stored in SGF point units.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app -run "TestConvertYuanluoboToSGF|TestFormatYuanluoboResult" -v`

- [ ] **Step 3: Write minimal implementation**

Add a helper that converts Yuanluobo child-count values to point values by multiplying by 2. Use it for SGF `KM` and numeric `RE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app -run "TestConvertYuanluoboToSGF|TestFormatYuanluoboResult" -v`

### Task 2: UI And Prompt Labels

**Files:**
- Modify: `web/src/components/BoardInfo.test.tsx`
- Modify: `web/src/components/BoardInfo.tsx`
- Modify: `internal/app/handlers_test.go`
- Modify: `internal/app/workspace.go`
- Modify: `web/src/components/CandidateList.tsx`

- [ ] **Step 1: Write failing tests**

Expect `BoardInfo` numeric results to render as `目`. Expect bad-move prompt text to say `损失3.5目`.

- [ ] **Step 2: Run tests to verify failure**

Run: `go test ./internal/app -run TestBadMovePromptDescribesPositionBeforeBadMove -v`
Run: `cd web; npm test -- --run src/components/BoardInfo.test.tsx`

- [ ] **Step 3: Write minimal implementation**

Change bad-move prompt unit from `子` to `目`, and ensure candidate list labels use Chinese `损失`.

- [ ] **Step 4: Run tests to verify pass**

Run the same backend and frontend tests.

### Task 3: Analysis Error State

**Files:**
- Modify: `internal/app/state.go`
- Modify: `internal/app/workspace.go`
- Modify: `internal/app/scheduler.go`
- Modify: `internal/app/scheduler_test.go`

- [ ] **Step 1: Write failing test**

Add a scheduler test with an analyzer returning an error and assert that subscribers receive an event that marks analysis as unavailable/error instead of remaining silently running.

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./internal/app -run TestSchedulerPublishesAnalysisError -v`

- [ ] **Step 3: Write minimal implementation**

Add optional error text to scheduler events and workspace state. Mark the game as `unavailable` when analysis fails.

- [ ] **Step 4: Run test to verify pass**

Run: `go test ./internal/app -run TestSchedulerPublishesAnalysisError -v`

### Task 4: Data Repair

**Files:**
- Modify: `.data/games/13bcf1dd2161c3320db4b8b006824363.sgf`
- Modify: `.data/games/f33edfd46ed376f5c2b9e1ab3244d23b.sgf`

- [ ] **Step 1: Repair SGF komi**

Change `KM[3.8]` to `KM[7.5]` in both affected imported files.

- [ ] **Step 2: Verify no invalid imported komi remains**

Run a SGF scan over `.data/games/*.sgf` and confirm no `KM[3.8]` remains.

### Task 5: Verification And Completion

- [ ] **Step 1: Run backend tests**

Run: `go test ./...`

- [ ] **Step 2: Run frontend tests/build**

Run: `cd web; npm test -- --run`
Run: `cd web; npm run build`

- [ ] **Step 3: Commit and push**

Run repository completion gate: `git add -A`, `git commit -m "fix: normalize score units"`, `git push origin master`.
