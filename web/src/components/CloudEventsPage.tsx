import { useEffect, useState } from 'react'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import type { YunbisaiMyEventsAPI } from '../api/types'
import {
  cloudEventDetailURL,
  fetchHangzhouEvents,
  type CloudEvent,
} from '../api/cloudEvents'
import { YunbisaiMyEventsPanel } from './YunbisaiMyEventsPanel'

type CloudEventsPageProps = {
  myEventsApi: YunbisaiMyEventsAPI
  today?: Date
  loadEvents?: (month: string, signal?: AbortSignal) => Promise<CloudEvent[]>
}

export function CloudEventsPage({ myEventsApi, today = new Date(), loadEvents = fetchHangzhouEvents }: CloudEventsPageProps) {
  const [activeTab, setActiveTab] = useState<'public' | 'mine'>('public')
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
    <section className="app-page-body cloud-events-page" role="region" aria-label="云比赛内容">
      <div className="cloud-events-shell">
        <header className="cloud-events-header">
          <div>
            <p className="game-list-eyebrow"><MapPin size={12} aria-hidden /> 杭州市</p>
            <h2>云比赛</h2>
          </div>
          {activeTab === 'public' && (
            <label className="cloud-events-month">
              <CalendarDays size={16} aria-hidden />
              <input aria-label="比赛月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
          )}
        </header>

        <nav className="cloud-events-tabs" role="tablist" aria-label="云比赛分类">
          <button
            className="cloud-events-tab"
            id="cloud-events-public-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'public'}
            aria-controls="cloud-events-public-panel"
            tabIndex={activeTab === 'public' ? 0 : -1}
            onClick={() => setActiveTab('public')}
          >
            杭州比赛
          </button>
          <button
            className="cloud-events-tab"
            id="cloud-events-mine-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === 'mine'}
            aria-controls="cloud-events-mine-panel"
            tabIndex={activeTab === 'mine' ? 0 : -1}
            onClick={() => setActiveTab('mine')}
          >
            我的比赛
          </button>
        </nav>

        {activeTab === 'public' ? (
          <div
            className="cloud-event-list"
            id="cloud-events-public-panel"
            role="tabpanel"
            aria-labelledby="cloud-events-public-tab"
            aria-live="polite"
          >
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
        ) : (
          <div
            className="cloud-events-mine-panel"
            id="cloud-events-mine-panel"
            role="tabpanel"
            aria-labelledby="cloud-events-mine-tab"
          >
            <YunbisaiMyEventsPanel api={myEventsApi} />
          </div>
        )}
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
