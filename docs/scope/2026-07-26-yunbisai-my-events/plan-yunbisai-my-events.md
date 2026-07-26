# Yunbisai My Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有云比赛页内通过微信扫码授权，原生展示用户有效的云比赛报名订单与赛事详情。

**Architecture:** 沿用现有元萝卜集成的边界：Go 后端通过 JSON-RPC 暴露登录、状态、订单和详情能力，并把远端会话以 `0600` 文件保存在 `~/.jcgo/config`；React 前端只接收脱敏领域模型。云比赛远端协议封装在独立 client/service 中，公开杭州比赛仍由现有前端公开接口独立加载。

**Tech Stack:** Go 1.25、`net/http`、JSON-RPC/WebSocket、React 19、TypeScript、Vitest、Testing Library、Vite。

---

### Task 1: Commit the approved design

**Files:**
- Add: `docs/scope/2026-07-26-yunbisai-my-events/spec-yunbisai-my-events.md`
- Add: `docs/scope/2026-07-26-yunbisai-my-events/plan-yunbisai-my-events.md`

- [ ] **Step 1: Verify the documents are internally complete**

Run:

```powershell
rg -n "T[B]D|T[O]DO|implement[ ]later|[待]定" docs/scope/2026-07-26-yunbisai-my-events
git diff --check
```

Expected: `rg` has no matches and `git diff --check` has no output.

- [ ] **Step 2: Commit the approved design**

```powershell
git add docs/scope/2026-07-26-yunbisai-my-events
git commit -m "docs: plan Yunbisai my events"
```

### Task 2: Persist Yunbisai credentials only on the backend

**Files:**
- Create: `internal/app/yunbisai_auth.go`
- Create: `internal/app/yunbisai_auth_test.go`

- [ ] **Step 1: Write failing auth-store tests**

Cover missing-file load, save/load, `0600` permissions, and clear:

```go
func TestYunbisaiFileAuthStoreSavesLoadsAndClears(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "yunbisai_auth.json")
	store := NewYunbisaiFileAuthStore(path)

	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("initial load = ok %v err %v", ok, err)
	}
	want := YunbisaiAuth{
		Token:     "token-1",
		LoginType: "3",
		Account:   YunbisaiAccount{LoginID: "7", Name: "棋手甲", Account: "138****0000"},
		Cookies:   []YunbisaiCookie{{Name: "token", Value: "token-1", Domain: ".yunbisai.com", Path: "/"}},
	}
	if err := store.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.Load(ctx)
	if err != nil || !ok || got.Token != want.Token || got.Account.Name != want.Account.Name {
		t.Fatalf("load = %#v ok %v err %v", got, ok, err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %v err %v", info.Mode().Perm(), err)
		}
	}
	if err := store.Clear(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Load(ctx); err != nil || ok {
		t.Fatalf("after clear = ok %v err %v", ok, err)
	}
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
go test ./internal/app -run TestYunbisaiFileAuthStore -count=1
```

Expected: FAIL because the Yunbisai auth types and store do not exist.

- [ ] **Step 3: Implement the auth model and stores**

Use these persisted types and validation rules:

```go
type YunbisaiCookie struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Domain  string `json:"domain"`
	Path    string `json:"path"`
	Expires int64  `json:"expires,omitempty"`
}

type YunbisaiAccount struct {
	LoginID  string `json:"loginId"`
	Name     string `json:"name"`
	Account  string `json:"account"`
	ImageURL string `json:"imageUrl,omitempty"`
}

type YunbisaiAuth struct {
	Token     string           `json:"token"`
	LoginType string           `json:"loginType"`
	Account   YunbisaiAccount `json:"account"`
	Cookies   []YunbisaiCookie `json:"cookies"`
	UpdatedAt time.Time        `json:"updatedAt"`
}

type YunbisaiAuthStore interface {
	Load(context.Context) (YunbisaiAuth, bool, error)
	Save(context.Context, YunbisaiAuth) error
	Clear(context.Context) error
}
```

`Save` must reject an empty token or login ID, set `UpdatedAt`, create the parent with `0755`, and write JSON with `0600`. Add a mutex-backed memory store for service tests, matching the existing `YuanluoboAuthStore` pattern.

- [ ] **Step 4: Verify GREEN**

```powershell
go test ./internal/app -run "TestYunbisai(File|Memory)AuthStore" -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/app/yunbisai_auth.go internal/app/yunbisai_auth_test.go
git commit -m "feat: persist Yunbisai authorization"
```

### Task 3: Implement the official QR, order, and detail client

**Files:**
- Create: `internal/app/yunbisai_client.go`
- Create: `internal/app/yunbisai_client_test.go`

- [ ] **Step 1: Write failing protocol tests with `httptest.Server`**

The test server must cover:

```go
func TestYunbisaiClientLoginAndOrders(t *testing.T) {
	// GET /api/wechat/loginQRCode -> qrcode_src + scene_id
	// GET /api/wechat/login/polling/scene-1 -> waiting, then user_list
	// POST /api/wechat/login/select-login-user -> key + Set-Cookie token
	// GET /request/Login/createSession -> Set-Cookie session
	// GET /api/order/list -> assert token header and query, return rows
	// POST /request/index/index -> assert form orderID/act, return order detail
}
```

Assertions must verify:

```go
if r.Header.Get("token") != "token-1" {
	t.Fatalf("token header = %q", r.Header.Get("token"))
}
if r.FormValue("act") != "orderdetail" || r.FormValue("orderID") != "order-1" {
	t.Fatalf("detail form = %#v", r.Form)
}
```

Add separate tests for non-2xx responses, malformed envelopes, `error:255` authentication expiry, and for ensuring returned error text never contains token/cookie values.

- [ ] **Step 2: Run the client tests and verify RED**

```powershell
go test ./internal/app -run TestYunbisaiClient -count=1
```

Expected: FAIL because `NewYunbisaiClient` and its methods do not exist.

- [ ] **Step 3: Define remote protocol types and endpoints**

Implement these public client results:

```go
type YunbisaiQRCode struct {
	SceneID string `json:"-"`
	ImageURL string `json:"imageUrl"`
}

type YunbisaiLoginPoll struct {
	Status   string
	OpenID   string
	SCode    string
	Accounts []YunbisaiAccount
}

type YunbisaiOrder struct {
	OrderID       string
	OrderName     string
	OrderType     string
	State         string
	CreatedAt     string
	ReceiptAmount string
}

type YunbisaiOrderPage struct {
	Total int
	Rows  []YunbisaiOrder
}

type YunbisaiOrderDetail struct {
	OrderInfo  map[string]any
	GameInfo   map[string]any
	PlayerInfo map[string]any
}
```

Use configurable base URLs in `YunbisaiClientOptions`; production defaults are:

```go
const (
	defaultYunbisaiDataCenterURL = "https://data-center.yunbisai.com"
	defaultYunbisaiOpenURL       = "https://open.yunbisai.com"
	defaultYunbisaiAPIURL        = "https://api.yunbisai.com"
	defaultYunbisaiWWWURL        = "https://www.yunbisai.com"
)
```

- [ ] **Step 4: Implement request and cookie handling**

Implement methods with strict envelope validation:

```go
func (c *YunbisaiClient) LoginStart(ctx context.Context) (YunbisaiQRCode, error)
func (c *YunbisaiClient) LoginPoll(ctx context.Context, sceneID string) (YunbisaiLoginPoll, error)
func (c *YunbisaiClient) LoginSelect(ctx context.Context, poll YunbisaiLoginPoll, account YunbisaiAccount) (YunbisaiAuth, error)
func (c *YunbisaiClient) Orders(ctx context.Context, auth YunbisaiAuth, page int) (YunbisaiOrderPage, error)
func (c *YunbisaiClient) OrderDetail(ctx context.Context, auth YunbisaiAuth, orderID string) (YunbisaiOrderDetail, error)
```

`LoginSelect` posts form data to `/api/wechat/login/select-login-user`, calls `/request/Login/createSession?key=...`, captures `Set-Cookie`, extracts the `token` cookie, and returns an auth object. Authenticated calls send captured cookies and the `token` header. Define `YunbisaiAuthInvalidError` and return it for HTTP 401/403 or envelope `error:255`.

- [ ] **Step 5: Verify GREEN**

```powershell
go test ./internal/app -run TestYunbisaiClient -count=1
```

Expected: PASS.

- [ ] **Step 6: Perform the real protocol checkpoint**

Run the JCGO client through a temporary diagnostic test that prints only status names and field presence, never credential values. Scan one generated QR and confirm:

```text
poll=accounts
select=authorized tokenPresent=true cookieCount>0
orders=http200
```

Delete the diagnostic test immediately after the checkpoint. If `tokenPresent` is false, stop execution and report that the current Yunbisai protocol does not provide a reusable backend credential.

- [ ] **Step 7: Commit**

```powershell
git add internal/app/yunbisai_client.go internal/app/yunbisai_client_test.go
git commit -m "feat: add Yunbisai API client"
```

### Task 4: Add the backend session and domain service

**Files:**
- Create: `internal/app/yunbisai.go`
- Create: `internal/app/yunbisai_test.go`

- [ ] **Step 1: Write failing service tests**

Use a fake client to cover:

```go
func TestYunbisaiServiceUsesOpaqueLoginFlowAndFiltersOrders(t *testing.T)
func TestYunbisaiServiceAutoSelectsSingleAccount(t *testing.T)
func TestYunbisaiServiceRequiresSelectionForMultipleAccounts(t *testing.T)
func TestYunbisaiServiceClearsExpiredAuthorization(t *testing.T)
func TestYunbisaiServiceMapsOrderDetail(t *testing.T)
```

The filter fixture must include types `1`, `40`, `3`, `20`, `42` and states `1`, `2`, plus excluded type/state values. Assert only the five event types in active states remain.

- [ ] **Step 2: Run the service tests and verify RED**

```powershell
go test ./internal/app -run TestYunbisaiService -count=1
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the frontend-safe domain contract**

```go
type YunbisaiStatusResult struct {
	LoggedIn bool              `json:"loggedIn"`
	Account  *YunbisaiAccount `json:"account,omitempty"`
}

type YunbisaiLoginStartResult struct {
	FlowID   string `json:"flowId"`
	ImageURL string `json:"imageUrl"`
}

type YunbisaiLoginPollResult struct {
	Status   string              `json:"status"` // waiting, accounts, authorized, expired
	Accounts []YunbisaiAccount  `json:"accounts,omitempty"`
}

type YunbisaiMyEvent struct {
	OrderID       string `json:"orderId"`
	EventID       string `json:"eventId,omitempty"`
	Title         string `json:"title"`
	Status        string `json:"status"` // pending, paid
	CreatedAt     string `json:"createdAt"`
	Amount        string `json:"amount"`
	OfficialURL   string `json:"officialUrl"`
}

type YunbisaiMyEventsResult struct {
	LoggedIn bool               `json:"loggedIn"`
	Total    int                `json:"total"`
	Page     int                `json:"page"`
	Events   []YunbisaiMyEvent `json:"events"`
}

type YunbisaiMyEventDetail struct {
	LoggedIn   bool               `json:"loggedIn"`
	OrderID    string             `json:"orderId,omitempty"`
	EventID    string             `json:"eventId,omitempty"`
	Title      string             `json:"title,omitempty"`
	Status     string             `json:"status,omitempty"`
	StartTime  string             `json:"startTime,omitempty"`
	EndTime    string             `json:"endTime,omitempty"`
	Address    string             `json:"address,omitempty"`
	Organizer  string             `json:"organizer,omitempty"`
	Amount     string             `json:"amount,omitempty"`
	CreatedAt  string             `json:"createdAt,omitempty"`
	OfficialURL string            `json:"officialUrl,omitempty"`
	Players    []YunbisaiPlayer  `json:"players,omitempty"`
}

type YunbisaiPlayer struct {
	Name      string `json:"name"`
	GroupName string `json:"groupName,omitempty"`
	TeamName  string `json:"teamName,omitempty"`
}
```

- [ ] **Step 4: Implement flow isolation, filtering, and expiry**

Generate a random opaque `flowId`; keep `sceneId/openId/sCode` only in a mutex-protected in-memory map with a ten-minute expiry. `LoginPoll` returns account display data but never remote login secrets. A single account is selected automatically; multiple accounts require `LoginSelect(flowID, loginID)`.

`MyEvents` fixes page size at 10, filters event order types and active states, and clears saved auth when the client returns `YunbisaiAuthInvalidError`. `MyEventDetail` maps `orderInfo`, `GameInfo`, and `PlayerInfo.playerinfo` defensively and constructs the public original event URL as `https://m.yunbisai.com/event/{eventId}`.

- [ ] **Step 5: Verify GREEN**

```powershell
go test ./internal/app -run TestYunbisaiService -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add internal/app/yunbisai.go internal/app/yunbisai_test.go
git commit -m "feat: add Yunbisai my events service"
```

### Task 5: Expose the service through existing JSON-RPC wiring

**Files:**
- Create: `internal/app/yunbisai_handlers.go`
- Create: `internal/app/yunbisai_handlers_test.go`
- Modify: `internal/app/handlers.go`
- Modify: `internal/app/app.go`

- [ ] **Step 1: Write failing handler tests**

Test parameter validation and dispatch for:

```text
yunbisai.status
yunbisai.loginStart
yunbisai.loginPoll        { flowId }
yunbisai.loginSelect      { flowId, loginId }
yunbisai.logout
yunbisai.myEvents         { page }
yunbisai.myEventDetail    { orderId }
```

Assert blank IDs fail and that no RPC result contains `token`, `cookie`, `openId`, `sCode`, `sceneId`, or `key`.

- [ ] **Step 2: Run and verify RED**

```powershell
go test ./internal/app -run "TestYunbisaiHandler|TestHandlerCallYunbisai" -count=1
```

Expected: FAIL because dispatch and handler methods are absent.

- [ ] **Step 3: Wire the service**

Extend `HandlerOptions` and `Handler`:

```go
type HandlerOptions struct {
	YuanluoboAuthStore   YuanluoboAuthStore
	YuanluoboHTTPClient  *http.Client
	YuanluoboBaseURL     string
	YunbisaiAuthStore    YunbisaiAuthStore
	YunbisaiHTTPClient   *http.Client
	YunbisaiClientOptions YunbisaiClientOptions
	WorkerStatusProvider WorkerStatusProvider
}
```

Construct `NewYunbisaiService(...)` in `NewHandlerWithOptions`, add the seven switch cases, and put parameter decoding in `yunbisai_handlers.go`. In `app.New`, persist to:

```go
NewYunbisaiFileAuthStore(filepath.Join(cfg.Dir, "config", "yunbisai_auth.json"))
```

- [ ] **Step 4: Verify GREEN and app regression**

```powershell
go test ./internal/app ./cmd/jcgo -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add internal/app/yunbisai_handlers.go internal/app/yunbisai_handlers_test.go internal/app/handlers.go internal/app/app.go
git commit -m "feat: expose Yunbisai RPC methods"
```

### Task 6: Add the typed frontend API contract

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.auth.test.tsx`

- [ ] **Step 1: Write a failing App wiring test**

Render `App` with its RPC test double, open 云比赛 → 我的比赛, and assert calls use:

```ts
expect(call).toHaveBeenCalledWith('yunbisai.status', undefined)
expect(call).toHaveBeenCalledWith('yunbisai.myEvents', { page: 1 })
```

- [ ] **Step 2: Run and verify RED**

```powershell
cd web
npm test -- --run src/App.auth.test.tsx
```

Expected: FAIL because the Yunbisai API is not passed to `CloudEventsPage`.

- [ ] **Step 3: Add TypeScript models and API wiring**

Add TypeScript equivalents of the Task 4 JSON models. Define:

```ts
export interface YunbisaiMyEventsAPI {
  status(): Promise<YunbisaiStatusResult>
  loginStart(): Promise<YunbisaiLoginStartResult>
  loginPoll(flowId: string): Promise<YunbisaiLoginPollResult>
  loginSelect(flowId: string, loginId: string): Promise<YunbisaiStatusResult>
  logout(): Promise<void>
  myEvents(page: number): Promise<YunbisaiMyEventsResult>
  myEventDetail(orderId: string): Promise<YunbisaiMyEventDetail>
}
```

Build the implementation next to `yuanluoboApi` in `App.tsx` and pass it as `<CloudEventsPage myEventsApi={yunbisaiApi} />`.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- --run src/App.auth.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/types.ts web/src/App.tsx web/src/App.auth.test.tsx
git commit -m "feat: wire Yunbisai frontend API"
```

### Task 7: Build the login, list, and detail panel

**Files:**
- Create: `web/src/components/YunbisaiMyEventsPanel.tsx`
- Create: `web/src/components/YunbisaiMyEventsPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Use a real in-memory fake API and fake timers to cover:

```ts
it('shows and refreshes the WeChat QR code while logged out')
it('polls every three seconds and auto-selects one account')
it('asks the user to choose when several accounts are returned')
it('loads active events continuously without filters')
it('returns to login when the backend reports loggedIn false')
it('opens an in-tab detail and returns to the list')
it('logs out and switches accounts without exposing credentials')
```

For detail, assert the accessible UI:

```ts
await userEvent.click(screen.getByRole('button', { name: /杭州围棋公开赛/ }))
expect(await screen.findByRole('heading', { name: '杭州围棋公开赛' })).toBeInTheDocument()
expect(screen.getByText('棋手甲')).toBeInTheDocument()
expect(screen.getByRole('link', { name: '打开云比赛原始详情' }))
  .toHaveAttribute('href', 'https://m.yunbisai.com/event/67043')
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the state machine**

Use:

```ts
type View = 'login' | 'accounts' | 'list' | 'detail'
type LoadState = 'idle' | 'loading' | 'error'
```

On mount call `status`; start a QR flow when logged out. Poll every three seconds and clear the timer on unmount, authorization, error, or expiry. Render the official `imageUrl` with `<img>` rather than re-encoding it. Load page 1 after authorization, append subsequent pages through a “加载更多” button, and deduplicate by `orderId`.

The list has no month/city/status controls. The detail view remains inside this component and provides back, official-detail, switch-account, and logout actions. Never render arbitrary HTML returned by Yunbisai.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- --run src/components/YunbisaiMyEventsPanel.test.tsx
```

Expected: PASS with no unhandled timer or React update warnings.

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/YunbisaiMyEventsPanel.tsx web/src/components/YunbisaiMyEventsPanel.test.tsx
git commit -m "feat: add Yunbisai my events panel"
```

### Task 8: Integrate top-level tabs and responsive styling

**Files:**
- Modify: `web/src/components/CloudEventsPage.tsx`
- Modify: `web/src/components/CloudEventsPage.test.tsx`
- Modify: `web/src/api/cloudEvents.ts`
- Modify: `web/src/api/cloudEvents.test.ts`
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: Write failing tab and regression tests**

Assert:

```ts
expect(screen.getByRole('tab', { name: '杭州比赛' })).toHaveAttribute('aria-selected', 'true')
await userEvent.click(screen.getByRole('tab', { name: '我的比赛' }))
expect(screen.queryByLabelText('比赛月份')).not.toBeInTheDocument()
expect(screen.getByRole('region', { name: '我的比赛内容' })).toBeInTheDocument()
await userEvent.click(screen.getByRole('tab', { name: '杭州比赛' }))
expect(screen.getByLabelText('比赛月份')).toBeInTheDocument()
```

Remove expectations for the old external “登录/切换账号”和“我的比赛” links. Keep the public event detail URL test.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- --run src/components/CloudEventsPage.test.tsx src/api/cloudEvents.test.ts src/styles.test.ts
```

Expected: FAIL because tabs and the native panel are absent.

- [ ] **Step 3: Implement the tabs**

Add `myEventsApi: YunbisaiMyEventsAPI` to `CloudEventsPageProps`. Use an ARIA tablist with default `public` tab; render the month input and public event list only for `public`, and render `<YunbisaiMyEventsPanel api={myEventsApi} />` only for `mine`.

Delete `cloudMyEventsURL` and `cloudAccountLoginURL` plus their obsolete tests. Preserve `fetchHangzhouEvents` and `cloudEventDetailURL` unchanged.

- [ ] **Step 4: Add responsive styles**

Add focused classes for:

```text
.cloud-events-tabs
.cloud-events-tab
.yunbisai-login
.yunbisai-qr-card
.yunbisai-account-list
.yunbisai-my-event-list
.yunbisai-my-event-card
.yunbisai-my-event-detail
.yunbisai-session-actions
```

Use the existing cloud-event spacing, colors, focus rings, and mobile breakpoint. The QR must remain at least `180px` and fit a narrow viewport; detail labels use a two-column grid that collapses to one column on mobile.

- [ ] **Step 5: Verify GREEN**

```powershell
npm test -- --run src/components/CloudEventsPage.test.tsx src/components/YunbisaiMyEventsPanel.test.tsx src/api/cloudEvents.test.ts src/styles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Stage the final integration for the completion commit**

```powershell
git add web/src/components/CloudEventsPage.tsx web/src/components/CloudEventsPage.test.tsx web/src/api/cloudEvents.ts web/src/api/cloudEvents.test.ts web/src/styles.css web/src/styles.test.ts
git diff --cached --check
```

Expected: the tab integration is staged and the cached diff check has no output.

### Task 9: Full validation, release, and runtime verification

**Files:**
- Modify only files required to fix failures caused by this feature.

- [ ] **Step 1: Run all automated validation**

```powershell
go test ./...
cd web
npm test -- --run
npm run build
```

Expected: all Go packages pass, all Vitest tests pass, and Vite produces `dist/index.html` plus hashed assets.

- [ ] **Step 2: Perform manual browser validation**

At desktop and narrow mobile widths verify:

```text
杭州比赛 is the default tab
month input exists only on 杭州比赛
我的比赛 shows QR when logged out
scan -> account choice -> active order list
refresh and JCGO restart preserve login
order click -> in-tab detail -> back
official event link opens a new tab
switch account and logout return to QR
```

Inspect network and rendered DOM to confirm no Yunbisai token, Cookie, `open_id`, `s_code`, scene ID, or login key appears.

- [ ] **Step 3: Rebase before the completion commit**

```powershell
cd D:\Code\JCGO
git pull --rebase --autostash origin master
git diff --check
```

Expected: rebase succeeds and diff check is clean.

- [ ] **Step 4: Execute the repository completion gate**

```powershell
git add -A
git commit -m "feat: show Yunbisai registered events"
git push origin master
```

- [ ] **Step 5: Deploy and restart**

```powershell
.\deploy.bat
& "$HOME\.jcgo\start.bat"
```

Expected: deploy and start both report `[OK]`.

- [ ] **Step 6: Verify the served build**

Request `http://127.0.0.1:4380/`, extract its hashed JS asset, and assert it matches `web/dist/index.html`. Confirm HTTP 200 for both HTML and JS, then verify `jcgo.exe`, `jcgo-worker.exe`, and `katago.exe` are running.
