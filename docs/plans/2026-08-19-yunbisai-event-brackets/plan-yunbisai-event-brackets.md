# Yunbisai Event Brackets Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在“我的比赛”赛事详情中展示全部组别，并按需加载任意组别的最后一轮及各轮对阵结果。

**Scope Source:** `docs/scope/2026-08-19-yunbisai-event-brackets/spec-yunbisai-event-brackets.md`

**Architecture:** Go 后端继续作为云比赛外部数据的唯一适配边界，新增公开组别和 JSONP 对阵接口，并向 React 返回规范化领域模型。赛事详情单独加载一次组别列表；组别对阵由新的 RPC 按组别和轮次懒加载，React 在当前面板内缓存已访问的组别/轮次。

**Tech Stack:** Go、`net/http`、JSON-RPC、React、TypeScript、Vitest、Testing Library、Vite。

**Verification:** 聚焦 Go client/service/handler 测试；聚焦 React 组件/API 测试；`go test ./...`；`cd web; npm test -- --run`；`cd web; npm run build`；本地已完成云比赛手工流程。

---

### Task 1: Sync the approved cloud-events wiki knowledge

**Files:**
- Create: `docs/wiki/cloud-events.md`
- Modify: `docs/wiki/wiki.md`

**Acceptance:** Wiki contains only stable, approved facts about the existing Yunbisai integration, the new group/pairing data flow, and the request-count rule; the root index links to the new page.

- [x] **Step 1: Read the existing wiki index and confirm the root-page scope**

Run:

```powershell
Get-Content docs/wiki/wiki.md -Raw
```

Expected: the existing top-level index is understood before adding the cloud-events page.

- [x] **Step 2: Write the approved stable knowledge**

Create `docs/wiki/cloud-events.md` with a first-line `> 摘要：` summary and sections covering:

1. The `云比赛` page's public-event and `我的比赛` responsibilities.
2. Backend ownership of Yunbisai credentials and frontend-safe RPC models.
3. `yunbisai.eventGroups` loading all event groups once and the UI-only matching of the registered group.
4. `yunbisai.groupPairings` loading one latest/selected round from the public pairing endpoint, with frontend caching and no ranking-table request.
5. The source endpoints and the rule that other groups/rounds are not prefetched.

Update `docs/wiki/wiki.md` with a link to `cloud-events.md` without changing unrelated entries.

- [x] **Step 3: Verify wiki structure and stability**

Run:

```powershell
rg -n "^> 摘要：|^# |cloud-events|eventGroups|groupPairings|名次表" docs/wiki/wiki.md docs/wiki/cloud-events.md
git diff --check
```

Expected: both pages have required summaries/headings, the index link exists, and there is no whitespace error or unapproved implementation checklist.

- [x] **Step 4: Git checkpoint**

Invoke `git-workflow` checkpoint for `docs/wiki/wiki.md` and `docs/wiki/cloud-events.md` only after Step 3 passes. Recorded commit: `4778e5f docs: document Yunbisai cloud events`.

### Task 2: Add the public Yunbisai group and pairing client

**Files:**
- Modify: `internal/app/yunbisai_client.go`
- Test: `internal/app/yunbisai_client_test.go`

**Acceptance:** The client fetches all groups and one selected/latest round, rejects malformed public responses, never sends saved authentication to these public endpoints, and normalizes JSONP before the service consumes it.

- [x] **Step 1: Write failing group-client tests**

Add `TestYunbisaiClientEventGroups` to the existing `httptest.Server` client tests. The fixture must:

- Serve `GET /api/lswl-groups/event/67043` with `{"error":0,"data":[{"groupname":"8级组","groupid":331092,"pnumber":27,"begintime":"2026-06-07 00:00:00","endtime":"2026-06-07 19:30:00"}]}`.
- Fail the test if the request contains `token` or `Cookie`.
- Assert the returned group ID, name, player count, and time fields.
- Return a malformed envelope in a second case and assert an error instead of an empty group list.

Run:

```powershell
go test ./internal/app -run TestYunbisaiClientEventGroups -count=1
```

Expected: FAIL because the public group client method and model do not exist.

- [x] **Step 2: Write failing JSONP pairing tests**

Add `TestYunbisaiClientGroupPairings` with a handler for `/request/group/againstplan` that asserts `groupid=331092`, accepts an empty `bout` for latest-round loading and `bout=6` for an explicit round, then returns a JSONP envelope containing `lastbout`, `total_bout`, and rows with `seatnum`, both player/team names, `p1_result`/`p2_result`, and scores. Assert:

- Latest response preserves round `7` and total `7`.
- Explicit response preserves round `6`.
- Result values `1` and `2` are retained for backend normalization.
- A malformed JSONP body and a JSON envelope with a non-zero error both fail.
- The request has no saved authentication headers or cookies.

Run:

```powershell
go test ./internal/app -run TestYunbisaiClientGroupPairings -count=1
```

Expected: FAIL because the method and JSONP decoder do not exist.

- [x] **Step 3: Implement the minimal client models and public requests**

Add client-facing raw models and methods with these contracts:

```go
func (c *YunbisaiClient) EventGroups(ctx context.Context, eventID string) ([]YunbisaiRemoteGroup, error)
func (c *YunbisaiClient) GroupPairings(ctx context.Context, groupID string, bout int) (YunbisaiRemotePairingRound, error)
```

Use the existing `request` helper with an empty `YunbisaiAuth`. Add strict event/group ID validation at the service boundary; the client must reject malformed envelopes, invalid JSONP wrappers, missing group IDs, missing round metadata, or rows without required pairing identity. Parse JSONP by extracting the JSON value from the callback wrapper and never expose raw response text in errors.

- [x] **Step 4: Verify the client tests are green**

Run:

```powershell
go test ./internal/app -run "TestYunbisaiClient(EventGroups|GroupPairings)" -count=1
```

Expected: PASS, including the no-credentials assertions and malformed-response cases.

- [x] **Step 5: Run the existing client regression tests**

Run:

```powershell
go test ./internal/app -run TestYunbisaiClient -count=1
```

Expected: PASS with the login, order, detail, waiting, expiry, and malformed-payload coverage unchanged.

- [x] **Step 6: Git checkpoint**

Invoke `git-workflow` checkpoint for `internal/app/yunbisai_client.go` and `internal/app/yunbisai_client_test.go` only after all Task 2 tests pass. Recorded commit: `7ade1fa feat: add Yunbisai group pairing client`.

### Task 3: Expose normalized groups and pairings through the backend service and RPC

**Files:**
- Modify: `internal/app/yunbisai.go`
- Modify: `internal/app/yunbisai_handlers.go`
- Modify: `internal/app/handlers.go`
- Test: `internal/app/yunbisai_test.go`
- Test: `internal/app/yunbisai_handlers_test.go`

**Acceptance:** The service returns frontend-safe groups and round data, maps known results without guessing unknown values, validates RPC parameters before external calls, and dispatches the new methods without credentials in the result.

- [x] **Step 1: Extend the fake backend and write failing service tests**

Extend `fakeYunbisaiClient` with `EventGroups`, `GroupPairings`, call records, and configured errors. Add:

- `TestYunbisaiServiceLoadsEventGroupsOnce`: call `service.EventGroups(ctx, "67043")`, assert all groups and fields are returned, and assert the fake receives exactly one event ID with no auth argument.
- `TestYunbisaiServiceMapsGroupPairings`: return two rows including a win/loss pair, a bye row, and an unknown result value; assert round metadata, player/team fields, normalized known labels, and an explicit pending/unknown label rather than a false win/loss.
- `TestYunbisaiServiceRejectsInvalidGroupRequests`: blank event/group IDs and non-positive explicit rounds fail before the fake backend call.

Run:

```powershell
go test ./internal/app -run "TestYunbisaiService(EventGroups|GroupPairings|RejectsInvalidGroupRequests)" -count=1
```

Expected: FAIL because the service methods and normalized models do not exist.

- [x] **Step 2: Write failing handler dispatch and validation tests**

Extend the handler fake and dispatch table tests with:

```text
yunbisai.eventGroups       { eventId }
yunbisai.groupPairings     { groupId, bout? }
```

Assert valid calls reach the fake and return only group/pairing fields. Add invalid cases for blank `eventId`, blank `groupId`, and `bout: 0`/negative explicit values; assert the fake call count remains zero. Extend the sensitive-field scan to reject `token`, `cookie`, `openId`, `sCode`, `sceneId`, and `key` in both new results.

Run:

```powershell
go test ./internal/app -run "TestYunbisaiHandler|TestHandlerCallYunbisai" -count=1
```

Expected: FAIL because the RPC parameters, methods, and dispatch cases are absent.

- [x] **Step 3: Implement service models, mapping, and handler dispatch**

Add normalized models for `YunbisaiEventGroup`, `YunbisaiGroupPairings`, and `YunbisaiPairing` in the existing Yunbisai app boundary. Extend `YunbisaiBackend` and `YunbisaiServiceBackend`, implement:

```go
func (s *YunbisaiService) EventGroups(context.Context, string) ([]YunbisaiEventGroup, error)
func (s *YunbisaiService) GroupPairings(context.Context, string, int) (YunbisaiGroupPairings, error)
```

Map `p1_result`/`p2_result` values `1` to win and `2` to loss; represent bye and unknown/missing values explicitly. Add parameter structs and two handler methods, then register both switch cases in `Handler.Call`. Keep these public-data calls independent of saved Yunbisai auth and do not add ranking-table calls.

- [x] **Step 4: Verify backend focused and regression tests**

Run:

```powershell
go test ./internal/app -run "TestYunbisai(Service|Handler|HandlerCallYunbisai|Client)" -count=1
```

Expected: PASS for new and existing Yunbisai behavior.

- [x] **Step 5: Git checkpoint**

Invoke `git-workflow` checkpoint for the backend service, handler, dispatch, and their tests after the focused suite passes. Recorded commit: `00c8d46 feat: expose Yunbisai groups and pairings`.

### Task 4: Add frontend types and JSON-RPC wiring

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/App.tsx`
- Test: `web/src/App.yunbisai.test.tsx`

**Acceptance:** The frontend API exposes the two new server-safe methods with optional latest-round semantics, and `App` sends exactly the intended RPC method/parameters.

- [ ] **Step 1: Write failing API wiring assertions**

Extend the existing RPC fake in `App.yunbisai.test.tsx` to return group and pairing fixtures. Add assertions that rendering the cloud page and opening a detail can invoke:

```text
yunbisai.eventGroups   { eventId: "67043" }
yunbisai.groupPairings { groupId: "331092" }
yunbisai.groupPairings { groupId: "331092", bout: 6 }
```

Run:

```powershell
cd web
npm test -- --run src/App.yunbisai.test.tsx
```

Expected: FAIL because the API interface and App wiring do not expose the new methods.

- [ ] **Step 2: Implement frontend-safe types and wiring**

Add `YunbisaiEventGroup`, `YunbisaiPairingPlayer`, `YunbisaiPairing`, and `YunbisaiGroupPairings` types. Extend `YunbisaiMyEventsAPI` with `eventGroups(eventId)` and `groupPairings(groupId, bout?)`. Add App RPC functions that omit `bout` for latest-round requests and include it for explicit rounds.

- [ ] **Step 3: Verify API wiring**

Run:

```powershell
cd web
npm test -- --run src/App.yunbisai.test.tsx
```

Expected: PASS with existing cloud-event wiring assertions unchanged.

- [ ] **Step 4: Git checkpoint**

Invoke `git-workflow` checkpoint for `web/src/api/types.ts`, `web/src/App.tsx`, and `web/src/App.yunbisai.test.tsx` after the focused test passes. Record the commit hash and subject.

### Task 5: Build the group list, cached round view, and responsive styling

**Files:**
- Modify: `web/src/components/YunbisaiMyEventsPanel.tsx`
- Modify: `web/src/components/YunbisaiMyEventsPanel.test.tsx`
- Modify: `web/src/styles.css`

**Acceptance:** The current in-tab detail shows all groups with the registered group highlighted, lazy-loads the latest round, navigates rounds with bounded requests, caches visited data, and isolates group/pairing errors.

- [ ] **Step 1: Extend component fixtures and write failing interaction tests**

Update the `YunbisaiMyEventsAPI` test fixture with `eventGroups` and `groupPairings`. Add tests for these single behaviors:

1. Detail loads all groups once, displays player counts/times, and marks `8级组` as the registered group using the existing detail player group.
2. Clicking `8级组` calls `groupPairings("331092")` once and displays `第 7 / 7 轮`, board number, both players/teams, and `胜`/`负` plus scores.
3. Clicking `上一轮` requests only bout `6`; clicking `下一轮` returns to a cached bout without a second request.
4. A second group click requests only that group's latest round and does not preload other groups; the group-list API remains at one call.
5. Group-list failure leaves the event title and basic fields visible and provides a retry; pairing failure leaves the group title visible and provides a retry.
6. Empty/unknown pairing fields render `暂无对阵` or `结果待确认` and never fabricate a winner.

Run:

```powershell
cd web
npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx
```

Expected: FAIL because the component has no group or pairing view.

- [ ] **Step 2: Implement detail group loading and per-page caches**

Add group state and a one-call-per-event loader after detail opens. Compare group names with the already loaded detail player group only for the visual “我的组别” marker. Store group results and pairing results in refs keyed by event/group and `groupId + bout`; ignore stale async responses after unmount or view changes.

- [ ] **Step 3: Implement the in-tab pairing view**

Add a group selection view with a back-to-detail action, latest-round loading, round metadata, previous/next buttons, match cards, result labels, empty states, retry states, and no ranking-table request. Keep session actions and existing official-detail link behavior available from the detail view.

- [ ] **Step 4: Add focused styles and mobile behavior**

Extend `web/src/styles.css` for group cards, the highlighted registered group, pairing header/round controls, match rows, result states, loading/errors, and the existing mobile breakpoint. Preserve the current panel's typography, focus outlines, scroll containment, and two-column detail grid behavior.

- [ ] **Step 5: Verify component tests and frontend regression**

Run:

```powershell
cd web
npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx src/components/CloudEventsPage.test.tsx src/App.yunbisai.test.tsx
```

Expected: PASS, including request-count/cache assertions and existing login/list/detail behavior.

- [ ] **Step 6: Git checkpoint**

Invoke `git-workflow` checkpoint for the component, component tests, and styles after the focused frontend suite passes. Record the commit hash and subject.

### Task 6: Run full verification and the real completed-event flow

**Files:**
- Modify: `docs/plans/2026-08-19-yunbisai-event-brackets/plan-yunbisai-event-brackets.md` to mark completed steps and record evidence.

**Acceptance:** All automated checks pass, the real local authorized flow shows the completed “博趣杯” event's groups and 8级组 final-round results, and the Git lifecycle can finalize without staging the pre-existing skill lock files.

- [ ] **Step 1: Run backend verification**

Run:

```powershell
go test ./...
```

Expected: PASS with no unrelated package failures.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: all tests pass and Vite produces a successful production build.

- [ ] **Step 3: Exercise the local authorized UI without exposing credentials**

Use the already running local JCGO server and a headless browser script that reads the local server token/auth only in memory. Open “我的比赛”, open the completed `博趣杯` event, verify all groups and the highlighted registered group, enter `8级组`, verify the latest round and result rows, switch one round, and return to the cached latest round. Capture only visible labels and request method names/counts; never print token, Cookie, or raw remote payloads.

Expected: one event-groups request for the detail, one latest-round request for the selected group, one request for the newly selected round, and no ranking-table request or prefetch for other groups/rounds.

- [ ] **Step 4: Review diff and mark plan evidence**

Run:

```powershell
git diff --check
git status --short --branch
```

Update this plan with the actual commands and outcomes; leave any pre-existing `.skill-source-lock.json` files untouched.

- [ ] **Step 5: Git finalize**

Invoke `git-workflow` finalize with the true result after all acceptance checks pass. It must stage only task files, commit the implementation, push `origin/master`, and report the resulting commit and remote state.
