# Hangzhou Events Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded home toolbar destinations with one app entry, add a four-tab root navigation shell, and show month-filtered Hangzhou Yunbisai events that open their original detail pages.

**Architecture:** Keep the feature frontend-only. A focused API adapter validates and maps Yunbisai data, a dedicated page owns month/loading/error state, and the existing `AppHistoryLayer` model gains four root destinations rendered above a shared bottom tab bar. Root-tab switches replace the current history entry, while existing import subflows continue to push child entries.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Testing Library, Lucide React, existing JCGO CSS.

---

### Task 1: Yunbisai API adapter

**Files:**
- Create: `web/src/api/cloudEvents.ts`
- Create: `web/src/api/cloudEvents.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `web/src/api/cloudEvents.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudEventDetailURL, fetchHangzhouEvents } from './cloudEvents'

describe('cloudEvents API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('queries one Hangzhou month and maps Yunbisai fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: 0,
      datArr: {
        rows: [{
          event_id: '67043',
          title: '棋通杯围棋业余段级位赛',
          event_value: '2',
          min_time: '2026-07-19 00:00:00.000',
          max_time: '2026-07-20 23:59:59.000',
          min_sumcost: '.00',
          pay_num: '290',
          lswlorganization__cname: '杭州棋通少儿棋院',
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHangzhouEvents('2026-07')).resolves.toEqual([{
      id: '67043',
      title: '棋通杯围棋业余段级位赛',
      sport: '围棋',
      startDate: '2026-07-19',
      endDate: '2026-07-20',
      fee: 0,
      registeredCount: 290,
      organizer: '杭州棋通少儿棋院',
    }])

    const [request, init] = fetchMock.mock.calls[0]
    const url = new URL(String(request))
    expect(url.origin + url.pathname).toBe('https://open.yunbisai.com/api/Join/event')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      province_name: '浙江省',
      city_name: '杭州市',
      date: '2026-07',
    })
    expect(init).toMatchObject({ credentials: 'omit' })
  })

  it('rejects invalid months and malformed upstream data', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":0,"datArr":null}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHangzhouEvents('July 2026')).rejects.toThrow('月份格式无效')
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(fetchHangzhouEvents('2026-07')).rejects.toThrow('云比赛数据格式无效')
  })

  it('builds the original Yunbisai detail URL', () => {
    expect(cloudEventDetailURL('67043')).toBe('https://m.yunbisai.com/signUp?eventid=67043')
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run from `web`:

```powershell
npm test -- --run src/api/cloudEvents.test.ts
```

Expected: FAIL because `./cloudEvents` does not exist.

- [ ] **Step 3: Implement the minimal validated adapter**

Create `web/src/api/cloudEvents.ts`:

```ts
export type CloudEvent = {
  id: string
  title: string
  sport: string
  startDate: string
  endDate: string
  fee: number
  registeredCount: number
  organizer: string
}

const endpoint = 'https://open.yunbisai.com/api/Join/event'
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const sportLabels: Record<string, string> = {
  '1': '象棋',
  '2': '围棋',
  '4': '国际象棋',
  '8': '国际跳棋',
  '16': '五子棋',
  '32': '牌类',
  '64': '飞镖',
  '128': '游泳',
  '256': '桥牌',
  '512': '其他',
  '1024': '摔跤',
  '2048': '柔道',
  '4096': '柔术',
}

export async function fetchHangzhouEvents(month: string, signal?: AbortSignal): Promise<CloudEvent[]> {
  if (!monthPattern.test(month)) throw new Error('月份格式无效')

  const url = new URL(endpoint)
  url.searchParams.set('province_name', '浙江省')
  url.searchParams.set('city_name', '杭州市')
  url.searchParams.set('event_value', '')
  url.searchParams.set('date', month)
  url.searchParams.set('pagesize', '')
  url.searchParams.set('page', '')
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`云比赛请求失败（${response.status}）`)

  const payload: unknown = await response.json()
  const root = asRecord(payload)
  const data = asRecord(root?.datArr)
  if (root?.error !== 0 || !Array.isArray(data?.rows)) throw new Error('云比赛数据格式无效')
  return data.rows.map(mapRow)
}

export function cloudEventDetailURL(eventId: string) {
  const url = new URL('https://m.yunbisai.com/signUp')
  url.searchParams.set('eventid', eventId)
  return url.toString()
}

function mapRow(value: unknown): CloudEvent {
  const row = asRecord(value)
  const id = requiredString(row?.event_id)
  const title = requiredString(row?.title)
  const startDate = datePart(requiredString(row?.min_time))
  const endDate = datePart(requiredString(row?.max_time))
  if (!row || !id || !title || !startDate || !endDate) throw new Error('云比赛数据格式无效')
  return {
    id,
    title,
    sport: sportLabels[String(row.event_value ?? '')] ?? '其他',
    startDate,
    endDate,
    fee: numberValue(row.min_sumcost),
    registeredCount: numberValue(row.pay_num),
    organizer: requiredString(row.lswlorganization__cname) || '未知主办方',
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function datePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}
```

- [ ] **Step 4: Run the adapter tests and verify GREEN**

```powershell
npm test -- --run src/api/cloudEvents.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the adapter without adding scope documents**

```powershell
git add web/src/api/cloudEvents.ts web/src/api/cloudEvents.test.ts
git commit -m "feat: add Yunbisai event adapter"
```

### Task 2: Root tab model and bottom navigation

**Files:**
- Modify: `web/src/layout/appLayers.ts`
- Modify: `web/src/layout/appLayers.test.ts`
- Create: `web/src/components/AppTabBar.tsx`
- Create: `web/src/components/AppTabBar.test.tsx`

- [ ] **Step 1: Write failing layer and tab-bar tests**

Extend `web/src/layout/appLayers.test.ts` with:

```ts
import { appLayer, importModeForLayer, isRootPageLayer, pageLayerFor, yuanluoboPickerForLayer } from './appLayers'

it('identifies only the four persistent root tabs', () => {
  expect(appLayer('cloud-events')).toMatchObject({ kind: 'page', title: '云比赛' })
  expect(isRootPageLayer('game-list')).toBe(true)
  expect(isRootPageLayer('import-choose')).toBe(true)
  expect(isRootPageLayer('cloud-events')).toBe(true)
  expect(isRootPageLayer('settings')).toBe(true)
  expect(isRootPageLayer('import-url')).toBe(false)
  expect(isRootPageLayer('import-yuanluobo')).toBe(false)
})
```

Create `web/src/components/AppTabBar.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppTabBar } from './AppTabBar'

describe('AppTabBar', () => {
  it('shows four Chinese root destinations and selects cloud events', async () => {
    const onSelect = vi.fn()
    render(<AppTabBar active="game-list" onSelect={onSelect} />)

    expect(screen.getByRole('navigation', { name: '应用功能' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本地棋局' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '云比赛' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '云比赛' }))
    expect(onSelect).toHaveBeenCalledWith('cloud-events')
  })
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
npm test -- --run src/layout/appLayers.test.ts src/components/AppTabBar.test.tsx
```

Expected: FAIL because `cloud-events`, `isRootPageLayer`, and `AppTabBar` do not exist.

- [ ] **Step 3: Extend the layer model**

In `web/src/layout/appLayers.ts`, add the root-layer type, the new union member and helper:

```ts
export type AppRootLayer = 'game-list' | 'import-choose' | 'cloud-events' | 'settings'

export type AppHistoryLayer =
  | 'home'
  | AppRootLayer
  | 'import-url'
  | 'import-yuanluobo'
  | 'yuanluobo-player-picker'
  | 'yuanluobo-platform-picker'

const rootPageLayers = new Set<AppHistoryLayer>(['game-list', 'import-choose', 'cloud-events', 'settings'])

// Add inside layers:
'cloud-events': { kind: 'page', title: '云比赛' },

export function isRootPageLayer(layer: AppHistoryLayer): layer is AppRootLayer {
  return rootPageLayers.has(layer)
}
```

- [ ] **Step 4: Implement the bottom navigation**

Create `web/src/components/AppTabBar.tsx`:

```tsx
import { CirclePlus, Cloud, Library, Settings, type LucideIcon } from 'lucide-react'
import type { AppRootLayer } from '../layout/appLayers'

type AppTabBarProps = {
  active: AppRootLayer
  onSelect(layer: AppRootLayer): void
}

const tabs: Array<{ layer: AppRootLayer; label: string; icon: LucideIcon }> = [
  { layer: 'game-list', label: '本地棋局', icon: Library },
  { layer: 'import-choose', label: '添加', icon: CirclePlus },
  { layer: 'cloud-events', label: '云比赛', icon: Cloud },
  { layer: 'settings', label: '设置', icon: Settings },
]

export function AppTabBar({ active, onSelect }: AppTabBarProps) {
  return (
    <nav className="app-tab-bar" aria-label="应用功能">
      {tabs.map(({ layer, label, icon: Icon }) => (
        <button
          key={layer}
          type="button"
          className="app-tab-button"
          aria-current={active === layer ? 'page' : undefined}
          onClick={() => onSelect(layer)}
        >
          <Icon size={20} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

```powershell
npm test -- --run src/layout/appLayers.test.ts src/components/AppTabBar.test.tsx
```

Expected: both test files pass.

- [ ] **Step 6: Commit navigation primitives without adding scope documents**

```powershell
git add web/src/layout/appLayers.ts web/src/layout/appLayers.test.ts web/src/components/AppTabBar.tsx web/src/components/AppTabBar.test.tsx
git commit -m "feat: add app root tab navigation"
```

### Task 3: Hangzhou events page

**Files:**
- Create: `web/src/components/CloudEventsPage.tsx`
- Create: `web/src/components/CloudEventsPage.test.tsx`

- [ ] **Step 1: Write failing page behavior tests**

Create `web/src/components/CloudEventsPage.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CloudEvent } from '../api/cloudEvents'
import { CloudEventsPage } from './CloudEventsPage'

const event: CloudEvent = {
  id: '67043',
  title: '棋通杯围棋业余段级位赛',
  sport: '围棋',
  startDate: '2026-07-19',
  endDate: '2026-07-20',
  fee: 0,
  registeredCount: 290,
  organizer: '杭州棋通少儿棋院',
}

describe('CloudEventsPage', () => {
  it('loads the current month and renders an original detail link', async () => {
    const loadEvents = vi.fn(async () => [event])
    render(<CloudEventsPage today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    expect(screen.getByLabelText('比赛月份')).toHaveValue('2026-07')
    expect(await screen.findByText(event.title)).toBeInTheDocument()
    expect(loadEvents).toHaveBeenCalledWith('2026-07', expect.any(AbortSignal))
    expect(screen.getByText('2026-07-19 — 07-20')).toBeInTheDocument()
    expect(screen.getByText('免费')).toBeInTheDocument()
    expect(screen.getByText('已报 290 人')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(event.title) })).toHaveAttribute(
      'href',
      'https://m.yunbisai.com/signUp?eventid=67043',
    )
    expect(screen.getByRole('link', { name: new RegExp(event.title) })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps a stale month response from replacing the selected month', async () => {
    const resolvers = new Map<string, (events: CloudEvent[]) => void>()
    const loadEvents = vi.fn((month: string) => new Promise<CloudEvent[]>((resolve) => resolvers.set(month, resolve)))
    render(<CloudEventsPage today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    fireEvent.change(screen.getByLabelText('比赛月份'), { target: { value: '2026-08' } })
    await act(async () => resolvers.get('2026-08')?.([{ ...event, id: 'aug', title: '8 月比赛' }]))
    expect(await screen.findByText('8 月比赛')).toBeInTheDocument()

    await act(async () => resolvers.get('2026-07')?.([{ ...event, id: 'jul', title: '7 月旧数据' }]))
    expect(screen.queryByText('7 月旧数据')).not.toBeInTheDocument()
  })

  it('shows empty and retryable error states', async () => {
    const loadEvents = vi.fn()
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce([])
    render(<CloudEventsPage today={new Date(2026, 6, 14)} loadEvents={loadEvents} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2026 年 7 月暂无杭州比赛')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the page tests and verify RED**

```powershell
npm test -- --run src/components/CloudEventsPage.test.tsx
```

Expected: FAIL because `CloudEventsPage` does not exist.

- [ ] **Step 3: Implement month, request and display state**

Create `web/src/components/CloudEventsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { cloudEventDetailURL, fetchHangzhouEvents, type CloudEvent } from '../api/cloudEvents'

type CloudEventsPageProps = {
  today?: Date
  loadEvents?: (month: string, signal?: AbortSignal) => Promise<CloudEvent[]>
}

export function CloudEventsPage({ today = new Date(), loadEvents = fetchHangzhouEvents }: CloudEventsPageProps) {
  const [month, setMonth] = useState(() => monthValue(today))
  const [events, setEvents] = useState<CloudEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(undefined)
    setEvents([])
    loadEvents(month, controller.signal).then(
      (nextEvents) => {
        if (!active) return
        setEvents(nextEvents)
        setLoading(false)
      },
      (reason: unknown) => {
        if (!active || isAbortError(reason)) return
        setError(reason instanceof Error ? reason.message : '无法加载云比赛')
        setLoading(false)
      },
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [loadEvents, month, retry])

  return (
    <section className="app-page-body cloud-events-page" role="region" aria-label="杭州云比赛内容">
      <div className="cloud-events-shell">
        <header className="cloud-events-header">
          <div>
            <p className="game-list-eyebrow"><MapPin size={12} aria-hidden /> 杭州市</p>
            <h2>云比赛</h2>
          </div>
          <label className="cloud-events-month">
            <CalendarDays size={16} aria-hidden />
            <input aria-label="比赛月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
        </header>

        <div className="cloud-event-list" aria-live="polite">
          {loading && <p className="cloud-event-state">正在加载杭州比赛…</p>}
          {!loading && error && (
            <div className="cloud-event-state error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button>
            </div>
          )}
          {!loading && !error && events.length === 0 && (
            <p className="cloud-event-state">{monthLabel(month)}暂无杭州比赛</p>
          )}
          {!loading && !error && events.map((event) => (
            <a
              className="cloud-event-card"
              href={cloudEventDetailURL(event.id)}
              target="_blank"
              rel="noopener noreferrer"
              key={event.id}
            >
              <span className="cloud-event-title">{event.title}</span>
              <span className="cloud-event-date">{dateRange(event)}</span>
              <span className="cloud-event-meta">
                <span>{event.sport}</span>
                <span>{event.fee === 0 ? '免费' : `¥${event.fee}`}</span>
                <span><Users size={13} aria-hidden />已报 {event.registeredCount} 人</span>
              </span>
              <span className="cloud-event-organizer">{event.organizer}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

function monthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string) {
  const [year, value] = month.split('-')
  return `${year} 年 ${Number(value)} 月`
}

function dateRange(event: CloudEvent) {
  if (event.startDate === event.endDate) return event.startDate
  return `${event.startDate} — ${event.endDate.slice(5)}`
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError'
}
```

- [ ] **Step 4: Run the page tests and verify GREEN**

```powershell
npm test -- --run src/components/CloudEventsPage.test.tsx
```

Expected: 3 tests pass, including stale-request protection and retry.

- [ ] **Step 5: Commit the page without adding scope documents**

```powershell
git add web/src/components/CloudEventsPage.tsx web/src/components/CloudEventsPage.test.tsx
git commit -m "feat: add Hangzhou cloud events page"
```

### Task 4: Integrate the master entry and root pages

**Files:**
- Modify: `web/src/components/GameSidebar.tsx`
- Modify: `web/src/components/GameSidebar.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.layout.test.ts`

- [ ] **Step 1: Replace sidebar expectations with one master-entry test**

In `web/src/components/GameSidebar.test.tsx`, replace the separate-action test with:

```tsx
it('exposes one master app entry instead of separate destination buttons', () => {
  const onOpenAppMenu = vi.fn()
  const { container } = render(
    <GameSidebar
      onOpenAppMenu={onOpenAppMenu}
      analysisAvailable
      analysisState="idle"
      onStartAnalysis={vi.fn()}
      onStopAnalysis={vi.fn()}
      onRestartAnalysis={vi.fn()}
    />,
  )

  const sidebar = within(container)
  sidebar.getByRole('button', { name: '打开功能菜单' }).click()
  expect(onOpenAppMenu).toHaveBeenCalledOnce()
  expect(sidebar.queryByLabelText('Import SGF')).not.toBeInTheDocument()
  expect(sidebar.queryByLabelText('Open settings')).not.toBeInTheDocument()
})
```

Update every remaining `GameSidebar` test fixture from `onOpenGameList`, `onImport`, and `onSettings` to one `onOpenAppMenu={vi.fn()}` prop. Update the compact-toolbar assertion so `.sidebar-file-actions` contains only the master-entry button.

Add to `web/src/App.layout.test.ts`:

```ts
it('renders the four-tab app shell and Hangzhou events page', () => {
  expect(app).toContain("onOpenAppMenu={() => pushAppHistoryLayer('game-list')}")
  expect(app).toContain("pageLayer === 'cloud-events'")
  expect(app).toContain('<CloudEventsPage />')
  expect(app).toContain('<AppTabBar')
  expect(app).toContain('replaceAppHistoryLayer(layer)')
})
```

- [ ] **Step 2: Run integration-focused tests and verify RED**

```powershell
npm test -- --run src/components/GameSidebar.test.tsx src/App.layout.test.ts
```

Expected: FAIL because the sidebar still has three destination buttons and `App` has no cloud page or tab bar.

- [ ] **Step 3: Reduce `GameSidebar` to one destination prop**

In `web/src/components/GameSidebar.tsx`:

```tsx
import { ArrowLeft, Menu } from 'lucide-react'

interface GameSidebarProps {
  contextualTitle?: string
  onContextBack?(): void
  contextActions?: ReactNode
  onOpenAppMenu(): void
  // Keep the existing analysis-related props unchanged.
}

// Replace onOpenGameList, onImport and onSettings in the component parameters with:
onOpenAppMenu,

// Replace the three destination buttons inside sidebar-file-actions with:
<button className="icon-button" onClick={onOpenAppMenu} aria-label="打开功能菜单">
  <Menu size={17} aria-hidden="true" />
</button>
```

Remove the unused `Plus` and `Settings` imports and destination callback defaults. Keep overlay and analysis controls unchanged.

- [ ] **Step 4: Integrate root replacement history and page rendering**

In `web/src/App.tsx`, add imports:

```tsx
import { AppTabBar } from './components/AppTabBar'
import { CloudEventsPage } from './components/CloudEventsPage'
import { appHistoryLayers, appLayer, importModeForLayer, isImportLayer, isPageLayer, isRootPageLayer, pageLayerFor, yuanluoboPickerForLayer, type AppHistoryLayer, type AppRootLayer } from './layout/appLayers'
```

Add a history replacement callback beside `pushAppHistoryLayer`:

```tsx
const replaceAppHistoryLayer = useCallback((layer: AppHistoryLayer) => {
  if (layer === appHistoryLayerRef.current) return
  applyAppHistoryLayer(layer)
  window.history.replaceState(appHistoryState(layer, appHistorySessionRef.current), '', currentHistoryURL())
}, [applyAppHistoryLayer])
```

After `refreshWorkspaceState` is defined, add root selection:

```tsx
const selectRootLayer = (layer: AppRootLayer) => {
  replaceAppHistoryLayer(layer)
  if (layer === 'settings') void refreshWorkspaceState()
}
```

Change the sidebar destination props to:

```tsx
onOpenAppMenu={() => pushAppHistoryLayer('game-list')}
```

Remove the former direct `onImport` and `onSettings` props. Inside `app-page-workspace`, add the cloud page and render tabs only on roots:

```tsx
{pageLayer === 'cloud-events' && <CloudEventsPage />}
{isRootPageLayer(currentLayer) && (
  <AppTabBar active={currentLayer} onSelect={selectRootLayer} />
)}
```

Keep the tab bar after all page bodies so the workspace grid places it in the second row. Existing `import-url`, `import-yuanluobo`, and picker layers are not root layers, so their tab bar stays hidden and their back behavior remains unchanged.

- [ ] **Step 5: Run integration-focused tests and verify GREEN**

```powershell
npm test -- --run src/components/GameSidebar.test.tsx src/App.layout.test.ts src/layout/appLayers.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit integration without adding scope documents**

```powershell
git add web/src/components/GameSidebar.tsx web/src/components/GameSidebar.test.tsx web/src/App.tsx web/src/App.layout.test.ts
git commit -m "feat: integrate app destination tabs"
```

### Task 5: Responsive JCGO styling

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: Add failing structural style assertions**

Add to `web/src/styles.test.ts`:

```ts
it('allocates a stable bottom tab row and scrollable cloud event list', () => {
  expect(styles).toContain('grid-template-rows: minmax(0, 1fr) auto;')
  expect(styles).toContain('.app-tab-bar {')
  expect(styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));')
  expect(styles).toContain('.app-tab-button[aria-current="page"]')
  expect(styles).toContain('.cloud-events-page {')
  expect(styles).toContain('.cloud-event-list {')
  expect(styles).toContain('overflow: auto;')
  expect(styles).toContain('.cloud-event-card:focus-visible')
})
```

- [ ] **Step 2: Run the style test and verify RED**

```powershell
npm test -- --run src/styles.test.ts
```

Expected: FAIL because the tab and cloud-event selectors do not exist.

- [ ] **Step 3: Add the workspace, tab and event styles**

Add `grid-template-rows` to `.app-page-workspace` and append these focused rules in `web/src/styles.css` near the existing page styles:

```css
.app-page-workspace {
  grid-template-rows: minmax(0, 1fr) auto;
}

.app-tab-bar {
  min-height: 58px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 4px clamp(6px, 2vw, 18px);
  border-top: 1px solid rgb(184 168 152 / 0.42);
  background: rgb(252 250 246 / 0.96);
  box-shadow: 0 -8px 24px rgb(42 30 14 / 0.06);
  backdrop-filter: blur(14px);
}

.app-tab-button {
  min-width: 0;
  min-height: 48px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  padding: 3px 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 750;
}

.app-tab-button[aria-current="page"] {
  background: rgb(26 71 42 / 0.08);
  color: var(--table);
}

.app-tab-button:focus-visible,
.cloud-event-card:focus-visible {
  outline: 2px solid var(--table);
  outline-offset: -2px;
}

.cloud-events-page {
  padding: 12px;
  box-sizing: border-box;
}

.cloud-events-shell {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
}

.cloud-events-header {
  min-height: 44px;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 8px;
  border-bottom: 1px solid rgb(184 168 152 / 0.42);
}

.cloud-events-header h2 {
  margin: 0;
  color: var(--ink);
  font-size: 22px;
  font-weight: 850;
  line-height: 1;
}

.cloud-events-header .game-list-eyebrow {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cloud-events-month {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border: 1px solid rgb(184 168 152 / 0.58);
  border-radius: 9px;
  background: rgb(255 255 255 / 0.64);
  color: var(--table);
}

.cloud-events-month input {
  min-width: 116px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
}

.cloud-event-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 7px;
  padding: 2px 2px 10px;
  overflow: auto;
  overscroll-behavior: contain;
}

.cloud-event-card {
  min-width: 0;
  display: grid;
  gap: 7px;
  padding: 14px 16px;
  border: 1px solid rgb(212 201 184 / 0.72);
  border-radius: 10px;
  background: var(--surface-glaze), var(--surface-raised);
  color: inherit;
  text-decoration: none;
  box-shadow: 0 3px 12px rgb(42 30 14 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.78);
}

.cloud-event-card:hover {
  border-color: rgb(26 71 42 / 0.28);
}

.cloud-event-title {
  color: var(--ink);
  font-size: 15px;
  font-weight: 800;
  line-height: 1.35;
}

.cloud-event-date,
.cloud-event-organizer {
  color: var(--muted);
  font-size: 12px;
}

.cloud-event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cloud-event-meta > span {
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgb(26 71 42 / 0.07);
  color: var(--table);
  font-size: 11px;
  font-weight: 750;
}

.cloud-event-state {
  min-height: 160px;
  display: grid;
  place-items: center;
  gap: 10px;
  margin: 0;
  border: 1px dashed rgb(184 168 152 / 0.46);
  border-radius: 12px;
  color: var(--muted);
  text-align: center;
}

.cloud-event-state.error {
  color: var(--danger);
}

.cloud-event-state p {
  margin: 0;
}
```

Inside the existing `@container app-layout (max-width: 699px)` block, add compact sizing:

```css
.cloud-events-page {
  padding: 8px 10px;
}

.cloud-events-header h2 {
  font-size: 16px;
}

.cloud-events-month {
  min-height: 32px;
  padding: 0 7px;
}

.cloud-event-card {
  gap: 5px;
  padding: 10px 12px;
}
```

- [ ] **Step 4: Run the style and component tests and verify GREEN**

```powershell
npm test -- --run src/styles.test.ts src/components/AppTabBar.test.tsx src/components/CloudEventsPage.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit responsive styles without adding scope documents**

```powershell
git add web/src/styles.css web/src/styles.test.ts
git commit -m "style: add app tabs and event cards"
```

### Task 6: Full verification and repository completion gate

**Files:**
- Verify: all modified frontend files
- Commit: `docs/scope/2026-07-14-hangzhou-events/spec-hangzhou-events.md`
- Commit: `docs/scope/2026-07-14-hangzhou-events/plan-hangzhou-events.md`

- [ ] **Step 1: Run the complete frontend test suite**

From `web`:

```powershell
npm test -- --run
```

Expected: all Vitest files pass with zero failures.

- [ ] **Step 2: Run lint and production build**

```powershell
npm run lint
npm run build
```

Expected: both commands exit 0 with no TypeScript, lint, or Vite build errors.

- [ ] **Step 3: Run backend regression tests even though the backend is unchanged**

From the repository root:

```powershell
go test ./...
```

Expected: every Go package passes.

- [ ] **Step 4: Inspect the final diff and confirm scope boundaries**

```powershell
git status --short
git diff --check
git diff --stat HEAD
```

Expected: only the planned frontend and scope-document files are present; `git diff --check` prints no errors. Confirm there are no Go backend, deploy configuration, token, contact-phone rendering, non-Hangzhou filter, or in-app registration changes.

- [ ] **Step 5: Execute the repository-mandated exact tail sequence**

Determine the current branch before starting the sequence:

```powershell
$branch = git branch --show-current
```

Then run these three commands consecutively:

```powershell
git add -A
git commit -m "feat: add Hangzhou competition browser"
git push origin $branch
```

Expected: the final documentation commit succeeds and the current branch is pushed to `origin`. If any command fails, resolve it and repeat the complete three-command tail sequence before reporting completion.
