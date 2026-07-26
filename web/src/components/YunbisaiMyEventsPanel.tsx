import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarCheck2, ChevronLeft, ExternalLink, LogOut, RefreshCw, UserRound } from 'lucide-react'
import type {
  YunbisaiAccount,
  YunbisaiMyEvent,
  YunbisaiMyEventDetail,
  YunbisaiMyEventsAPI,
} from '../api/types'

type View = 'login' | 'accounts' | 'list' | 'detail'
type LoadState = 'idle' | 'loading' | 'error'

type YunbisaiMyEventsPanelProps = {
  api: YunbisaiMyEventsAPI
}

export function YunbisaiMyEventsPanel({ api }: YunbisaiMyEventsPanelProps) {
  const [checking, setChecking] = useState(true)
  const [view, setView] = useState<View>('login')
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [error, setError] = useState<string>()
  const [flowID, setFlowID] = useState<string>()
  const [imageURL, setImageURL] = useState<string>()
  const [accounts, setAccounts] = useState<YunbisaiAccount[]>([])
  const [account, setAccount] = useState<YunbisaiAccount>()
  const [events, setEvents] = useState<YunbisaiMyEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<YunbisaiMyEventDetail>()
  const mounted = useRef(false)
  const pollBusy = useRef(false)

  const beginLogin = useCallback(async () => {
    setView('login')
    setFlowID(undefined)
    setImageURL(undefined)
    setAccounts([])
    setDetail(undefined)
    setError(undefined)
    setLoadState('loading')
    setChecking(false)
    try {
      const result = await api.loginStart()
      if (!mounted.current) return
      setFlowID(result.flowId)
      setImageURL(result.imageUrl)
      setLoadState('idle')
    } catch (reason) {
      if (!mounted.current) return
      setError(errorMessage(reason))
      setLoadState('error')
    }
  }, [api])

  const loadEvents = useCallback(async (nextPage: number, replace: boolean) => {
    setError(undefined)
    setLoadState('loading')
    try {
      const result = await api.myEvents(nextPage)
      if (!mounted.current) return
      if (!result.loggedIn) {
        setAccount(undefined)
        setEvents([])
        setTotal(0)
        await beginLogin()
        return
      }
      setEvents((current) => deduplicateEvents(replace ? result.events : [...current, ...result.events]))
      setTotal(result.total)
      setPage(result.page)
      setDetail(undefined)
      setView('list')
      setChecking(false)
      setLoadState('idle')
    } catch (reason) {
      if (!mounted.current) return
      setError(errorMessage(reason))
      setLoadState('error')
      setChecking(false)
    }
  }, [api, beginLogin])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    api.status()
      .then(async (status) => {
        if (cancelled) return
        if (status.loggedIn) {
          setAccount(status.account)
          await loadEvents(1, true)
          return
        }
        await beginLogin()
      })
      .catch((reason) => {
        if (cancelled) return
        setError(errorMessage(reason))
        setLoadState('error')
        setChecking(false)
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [api, beginLogin, loadEvents])

  useEffect(() => {
    if (view !== 'login' || !flowID) return
    const timer = window.setInterval(async () => {
      if (pollBusy.current) return
      pollBusy.current = true
      try {
        const result = await api.loginPoll(flowID)
        if (!mounted.current) return
        if (result.status === 'waiting') return
        if (result.status === 'accounts') {
          setAccounts(result.accounts ?? [])
          setView('accounts')
          return
        }
        if (result.status === 'authorized') {
          setFlowID(undefined)
          await loadEvents(1, true)
          return
        }
        setFlowID(undefined)
        await beginLogin()
      } catch (reason) {
        if (!mounted.current) return
        setFlowID(undefined)
        setError(errorMessage(reason))
        setLoadState('error')
      } finally {
        pollBusy.current = false
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [api, beginLogin, flowID, loadEvents, view])

  const chooseAccount = async (selected: YunbisaiAccount) => {
    if (!flowID) return
    setError(undefined)
    setLoadState('loading')
    try {
      const status = await api.loginSelect(flowID, selected.loginId)
      if (!status.loggedIn) {
        await beginLogin()
        return
      }
      setAccount(status.account ?? selected)
      setFlowID(undefined)
      await loadEvents(1, true)
    } catch (reason) {
      if (!mounted.current) return
      setError(errorMessage(reason))
      setLoadState('error')
    }
  }

  const openDetail = async (orderID: string) => {
    setError(undefined)
    setLoadState('loading')
    try {
      const result = await api.myEventDetail(orderID)
      if (!mounted.current) return
      if (!result.loggedIn) {
        setAccount(undefined)
        await beginLogin()
        return
      }
      setDetail(result)
      setView('detail')
      setLoadState('idle')
    } catch (reason) {
      if (!mounted.current) return
      setError(errorMessage(reason))
      setLoadState('error')
    }
  }

  const endSession = async () => {
    setError(undefined)
    setLoadState('loading')
    try {
      await api.logout()
      if (!mounted.current) return
      setAccount(undefined)
      setEvents([])
      setTotal(0)
      await beginLogin()
    } catch (reason) {
      if (!mounted.current) return
      setError(errorMessage(reason))
      setLoadState('error')
    }
  }

  if (checking) {
    return (
      <section className="yunbisai-my-events" role="region" aria-label="我的比赛内容">
        <p className="cloud-event-state">正在检查云比赛登录…</p>
      </section>
    )
  }

  return (
    <section className="yunbisai-my-events" role="region" aria-label="我的比赛内容">
      {view === 'login' && (
        <div className="yunbisai-login">
          <div className="yunbisai-login-copy">
            <p className="game-list-eyebrow"><UserRound size={13} aria-hidden /> 微信授权</p>
            <h3>登录云比赛</h3>
            <p>请使用微信扫码登录云比赛</p>
            <p className="yunbisai-login-note">登录信息仅保存在 JCGO 后端，不会发送到浏览器。</p>
          </div>
          <div className="yunbisai-qr-card">
            {imageURL
              ? <img src={imageURL} alt="云比赛登录二维码" />
              : <span className="yunbisai-qr-placeholder" aria-label="正在生成二维码" />}
            <button type="button" onClick={() => void beginLogin()}>
              <RefreshCw size={16} aria-hidden />
              刷新二维码
            </button>
          </div>
        </div>
      )}

      {view === 'accounts' && (
        <div className="yunbisai-account-panel">
          <h3>选择云比赛账号</h3>
          <p>这个微信绑定了多个账号，请选择要查看比赛的账号。</p>
          <div className="yunbisai-account-list" role="list" aria-label="云比赛账号">
            {accounts.map((item) => (
              <div key={item.loginId} role="listitem">
                <button
                  type="button"
                  onClick={() => void chooseAccount(item)}
                >
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt="" />
                    : <span className="yunbisai-account-avatar" aria-hidden>{item.name.slice(0, 1) || '棋'}</span>}
                  <span>
                    <strong>{item.name || '云比赛账号'}</strong>
                    {item.account && <small>{item.account}</small>}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <button className="yunbisai-secondary-action" type="button" onClick={() => void beginLogin()}>
            <RefreshCw size={15} aria-hidden />
            重新扫码
          </button>
        </div>
      )}

      {view === 'list' && (
        <div className="yunbisai-my-event-browser">
          <header className="yunbisai-my-events-header">
            <div>
              <p className="game-list-eyebrow"><CalendarCheck2 size={13} aria-hidden /> 已报名赛事</p>
              <h3>我的比赛</h3>
              <p>{total > 0 ? `共 ${total} 场有效比赛` : '暂无有效比赛'}</p>
            </div>
            <SessionActions account={account} onEndSession={endSession} />
          </header>

          {events.length === 0 && loadState !== 'loading' && (
            <p className="cloud-event-state">当前账号没有待支付或已报名的比赛</p>
          )}
          <div className="yunbisai-my-event-list">
            {events.map((item) => (
              <button
                key={item.orderId}
                className="yunbisai-my-event-card"
                type="button"
                aria-label={item.title}
                onClick={() => void openDetail(item.orderId)}
              >
                <span className="yunbisai-my-event-main">
                  <strong>{item.title}</strong>
                  <span className={`yunbisai-order-status ${item.status}`}>{statusLabel(item.status)}</span>
                </span>
                <span className="yunbisai-my-event-meta">
                  {item.createdAt && <span>下单 {item.createdAt}</span>}
                  {item.amount && <span>¥{item.amount}</span>}
                </span>
              </button>
            ))}
          </div>
          {events.length < total && (
            <button
              className="yunbisai-load-more"
              type="button"
              disabled={loadState === 'loading'}
              onClick={() => void loadEvents(page + 1, false)}
            >
              加载更多
            </button>
          )}
        </div>
      )}

      {view === 'detail' && detail && (
        <div className="yunbisai-my-event-detail">
          <header>
            <button className="yunbisai-detail-back" type="button" onClick={() => setView('list')}>
              <ChevronLeft size={17} aria-hidden />
              返回我的比赛
            </button>
            <SessionActions account={account} onEndSession={endSession} />
          </header>
          <div className="yunbisai-detail-title">
            <div>
              <p className="game-list-eyebrow">赛事详情</p>
              <h3>{detail.title || '云比赛赛事'}</h3>
            </div>
            {detail.status && <span className={`yunbisai-order-status ${detail.status}`}>{statusLabel(detail.status)}</span>}
          </div>
          <dl className="yunbisai-detail-grid">
            <DetailField label="比赛时间" value={formatTimeRange(detail.startTime, detail.endTime)} />
            <DetailField label="比赛地点" value={detail.address} />
            <DetailField label="主办方" value={detail.organizer} />
            <DetailField label="报名金额" value={detail.amount ? `¥${detail.amount}` : undefined} />
            <DetailField label="下单时间" value={detail.createdAt} />
            <DetailField label="订单编号" value={detail.orderId} />
          </dl>
          {(detail.players?.length ?? 0) > 0 && (
            <section className="yunbisai-player-section" aria-label="参赛棋手">
              <h4>参赛棋手</h4>
              <div className="yunbisai-player-list">
                {detail.players?.map((player, index) => (
                  <article key={`${player.name}-${index}`}>
                    <strong>{player.name}</strong>
                    <span>{[player.groupName, player.teamName].filter(Boolean).join(' · ')}</span>
                  </article>
                ))}
              </div>
            </section>
          )}
          {detail.officialUrl && (
            <a
              className="yunbisai-official-link"
              href={detail.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden />
              打开云比赛原始详情
            </a>
          )}
        </div>
      )}

      {loadState === 'loading' && view !== 'login' && (
        <p className="cloud-event-state" aria-live="polite">正在加载…</p>
      )}
      {error && <p className="cloud-event-state error" role="alert">{error}</p>}
    </section>
  )
}

function SessionActions({
  account,
  onEndSession,
}: {
  account?: YunbisaiAccount
  onEndSession(): void | Promise<void>
}) {
  return (
    <div className="yunbisai-session-actions">
      {account?.name && <span>{account.name}</span>}
      <button type="button" onClick={() => void onEndSession()}>切换账号</button>
      <button type="button" aria-label="退出登录" onClick={() => void onEndSession()}>
        <LogOut size={15} aria-hidden />
        退出
      </button>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function deduplicateEvents(events: YunbisaiMyEvent[]) {
  const byOrderID = new Map<string, YunbisaiMyEvent>()
  for (const item of events) byOrderID.set(item.orderId, item)
  return [...byOrderID.values()]
}

function statusLabel(status: YunbisaiMyEvent['status']) {
  return status === 'pending' ? '待支付' : '已报名'
}

function formatTimeRange(start?: string, end?: string) {
  if (start && end) return `${start} — ${end}`
  return start || end
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object' && 'message' in reason) return String(reason.message)
  return '云比赛请求失败'
}
