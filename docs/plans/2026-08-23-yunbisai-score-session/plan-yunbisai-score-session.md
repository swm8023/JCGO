# Yunbisai Session and Score Display Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox syntax for tracking.

**Goal:** 保留云比赛失效会话凭证，并在现有组别对阵表中展示双方当前总分和对手当前总分。

**Scope Source:** docs/scope/2026-08-23-yunbisai-score-session.md

**Architecture:** Go 后端继续持有云比赛授权并把外部对阵字段转换为安全模型。认证失效时授权存储保留原文件并持久化失效标记，状态检查不再使用失效凭证。对阵接口已返回双方 integral，后端映射为 totalScore，React 在同一台对阵中互相读取双方总分，不新增请求。

**Tech Stack:** Go、net/http、React、TypeScript、Vitest、Testing Library、Vite。

**Verification:** 聚焦 Go 授权/对阵测试；聚焦 React 云比赛面板测试；go test ./...；cd web; npm test -- --run；cd web; npm run build；git diff --check。

---

### Task 1: Synchronize approved Yunbisai wiki knowledge

**Files:**
- Modify: docs/wiki/cloud-events.md

**Acceptance:** Wiki documents the approved session-retention behavior, the current-total/opponent-current-total fields, and that no ranking or extra score request is added.

- [x] Step 1: Read the current page and identify the exact sections to extend

Run:

    Get-Content docs/wiki/cloud-events.md -Raw

Expected: the existing request-control and pairing sections are available for a focused update without changing unrelated cloud-event knowledge.

- [x] Step 2: Write the approved stable knowledge

Update docs/wiki/cloud-events.md to state:

1. Order/detail authentication failure marks the backend session invalid but does not delete the persisted authorization file; explicit logout remains the cleanup path.
2. The public pairing response supplies each side's single-game score and current cumulative integral, exposed to the frontend as safe score and totalScore fields.
3. The pairing view displays each player's current total and the current total of the opponent on the same board; it does not calculate full historical opponent tiebreak points.
4. No independent standings/ranking request is made; existing group/round request and cache behavior remains unchanged.

- [x] Step 3: Verify the wiki update

Run:

    rg -n "失效|凭证|totalScore|当前总分|对手当前总分|名次|缓存|groupPairings" docs/wiki/cloud-events.md
    git diff --check

Expected: all approved facts are present, no unrelated section is changed, and whitespace validation passes.

- [x] Step 4: Git checkpoint

Checkpoint only docs/wiki/cloud-events.md after Step 3 passes. Record the commit hash and subject in the execution log.

### Task 2: Preserve invalid Yunbisai authorization without reusing it

**Files:**
- Modify: internal/app/yunbisai_auth.go
- Modify: internal/app/yunbisai.go
- Test: internal/app/yunbisai_auth_test.go
- Test: internal/app/yunbisai_test.go

**Acceptance:** Authentication failure leaves the file present with a persisted invalid marker, Status/order loading treats it as logged out without another remote order request, explicit logout still deletes it, and successful login replaces the invalid state.

- [x] Step 1: Write failing authorization-store tests

Add tests covering:

- A file store can mark a valid saved authorization invalid, keeps the JSON file and token, and loads it as unavailable for use.
- A memory store has the same invalid-state behavior.
- Saving a new authorization after invalidation clears the invalid marker.

Run:

    go test ./internal/app -run "TestYunbisai(FileAuthStore|MemoryAuthStore).*Invalid|TestYunbisaiAuthStores" -count=1

Expected: FAIL because the invalid-state field and store operation do not exist.

- [x] Step 2: Write the failing service regression test

Replace the existing auto-clear expectation with a test that configures Orders to return YunbisaiAuthInvalidError, then asserts:

- MyEvents returns LoggedIn: false.
- The saved authorization remains loadable as a file and still contains its token, but is marked unavailable.
- A later MyEvents call does not append another order-page call to the fake backend.
- Logout still makes the store unavailable and removes the file-backed authorization.

Run:

    go test ./internal/app -run "TestYunbisaiService(DoesNotClear|Preserves|Marks).*Authorization|TestYunbisaiServiceClearsExpiredAuthorization" -count=1

Expected: FAIL because the current service clears the store and the fake has no invalid-state behavior.

- [x] Step 3: Implement the minimal invalid-state storage and service path

Implement a persisted invalid marker on YunbisaiAuth, add a store method that marks the current authorization invalid without deleting it, make Load report marked credentials unavailable, clear the marker on Save, and replace the automatic Clear calls in loadOrders and MyEventDetail with the new invalidation operation. Leave explicit Logout on Clear.

- [x] Step 4: Run the focused authorization tests

Run:

    go test ./internal/app -run "TestYunbisai(Auth|Service).*" -count=1

Expected: PASS with the new preservation behavior and existing login/order/detail regressions green.

- [x] Step 5: Git checkpoint

Checkpoint only internal/app/yunbisai_auth.go, internal/app/yunbisai.go, internal/app/yunbisai_auth_test.go, and internal/app/yunbisai_test.go after focused tests pass. Record the commit hash and subject.

### Task 3: Map Yunbisai current totals through the pairing model

**Files:**
- Modify: internal/app/yunbisai_client.go
- Modify: internal/app/yunbisai.go
- Modify: web/src/api/types.ts
- Test: internal/app/yunbisai_client_test.go
- Test: internal/app/yunbisai_test.go

**Acceptance:** The existing public pairing request maps p1_integral and p2_integral to optional totalScore fields while retaining single-game scores, and no additional RPC or HTTP request is introduced.

- [x] Step 1: Write the failing client and service mapping tests

Extend the pairing fixture with p1_integral: "12.0" and p2_integral: "10.0". Assert the client retains both raw total values and the service exposes them as Player1.TotalScore and Player2.TotalScore alongside the existing Score values. Add a missing-integral row assertion that leaves TotalScore empty rather than producing 0.

Run:

    go test ./internal/app -run "TestYunbisai(Client|Service)(GroupPairings|MapsGroupPairings)" -count=1

Expected: FAIL because the raw and normalized pairing models do not contain total-score fields.

- [x] Step 2: Implement the minimal pairing total-score mapping

Add optional total-score fields to the Go remote/domain pairing player models, parse p1_integral/p2_integral in GroupPairings, and copy them into the service result. Keep the existing p1_score/p2_score mapping and result normalization unchanged.

- [x] Step 3: Add the frontend model contract and run focused Go tests

Add optional totalScore to the TypeScript YunbisaiPairingPlayer interface, then run:

    go test ./internal/app -run "TestYunbisai(Client|Service).*" -count=1

Expected: PASS with no credential fields in the returned pairing model and no changed request count.

- [x] Step 4: Git checkpoint

Checkpoint only internal/app/yunbisai_client.go, internal/app/yunbisai.go, web/src/api/types.ts, internal/app/yunbisai_client_test.go, and internal/app/yunbisai_test.go after focused tests pass. Record the commit hash and subject.

### Task 4: Render current total and opponent current total in the pairing view

**Files:**
- Modify: web/src/components/YunbisaiMyEventsPanel.tsx
- Test: web/src/components/YunbisaiMyEventsPanel.test.tsx

**Acceptance:** Each paired player shows their current total and the other player's current total using the existing single pairing response; bye/missing-total states are explicit and existing request/cache assertions remain unchanged.

- [x] Step 1: Write failing component tests

Extend the pairing fixture with totalScore: "12.0" and totalScore: "10.0". After opening the group, assert the UI contains both 当前总分 12.0/当前总分 10.0 and the corresponding 对手当前总分 labels. Add a bye or missing-total fixture and assert 无对手/待公布 without an extra groupPairings call.

Run:

    cd web
    npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx

Expected: FAIL because the panel currently renders only single-game score and does not render totalScore or opponent totals.

- [x] Step 2: Implement the minimal pairing presentation

Pass each match's opposite player into PairingPlayer, render the player's totalScore as 当前总分, render the opposite player's totalScore as 对手当前总分, and use explicit empty-state text for missing totals or no opponent. Do not alter loadPairings, its cache keys, or its request flow.

- [x] Step 3: Run the focused frontend test

Run:

    cd web
    npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx

Expected: PASS, including existing latest-round, round-navigation, caching, error, and request-count cases.

- [x] Step 4: Git checkpoint

Checkpoint only web/src/components/YunbisaiMyEventsPanel.tsx and web/src/components/YunbisaiMyEventsPanel.test.tsx after the focused component suite passes. Record the commit hash and subject.

### Task 5: Run full verification and prepare final handoff

**Files:**
- Test: all existing Go tests under internal/app
- Test: all existing frontend tests under web/src

**Acceptance:** All required tests and build pass, the diff contains only approved files and the wiki/spec/plan, and no new external request path or sensitive-field exposure appears.

- [ ] Step 1: Run the complete Go suite

Run:

    go test ./...

Expected: PASS.

- [ ] Step 2: Run the complete frontend test suite

Run:

    cd web
    npm test -- --run

Expected: PASS with no unhandled errors or warnings.

- [ ] Step 3: Run the production frontend build

Run:

    cd web
    npm run build

Expected: TypeScript and Vite production build complete successfully.

- [ ] Step 4: Inspect diff and sensitive-field boundaries

Run:

    git diff --check
    git status --short
    git diff -- internal/app/yunbisai_auth.go internal/app/yunbisai.go internal/app/yunbisai_client.go web/src/api/types.ts web/src/components/YunbisaiMyEventsPanel.tsx docs/wiki/cloud-events.md

Expected: only approved session retention, score mapping, UI, tests, wiki, spec, and plan changes are present; no token, Cookie, openId, sCode, sceneId, or key is added to frontend data or logs.

- [ ] Step 5: Git checkpoint/finalize

After all verification passes, run the configured git-workflow checkpoint for any remaining independent documentation/test unit, then run git-workflow finalize with the actual completion result. Push the verified commits to origin/master as required by repository preferences.
