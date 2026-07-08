import { ArrowLeft, Cpu, Server } from 'lucide-react'
import type { WorkerRuntimeStatus, WorkerStatus } from '../api/types'

interface SettingsPageProps {
  workerStatus?: WorkerStatus
  onBack(): void
}

const emptyWorkerStatus: WorkerStatus = {
  connected: 0,
  available: 0,
  busy: 0,
  local: { available: false, error: 'worker status unavailable' },
  workers: [],
}

export function SettingsPage({ workerStatus = emptyWorkerStatus, onBack }: SettingsPageProps) {
  const statusLabel = workerStatusLabel(workerStatus)
  return (
    <div className="settings-page" role="dialog" aria-label="设置">
      <section className="settings-panel">
        <header className="settings-header">
          <button className="settings-back-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回
          </button>
          <div className="settings-title-block">
            <p className="settings-eyebrow">Settings</p>
            <h2>设置</h2>
          </div>
        </header>

        <section className="settings-section" role="region" aria-label="Worker 状态">
          <div className="worker-status-card" data-state={workerStatusTone(workerStatus)}>
            <span className="worker-status-icon" aria-hidden="true">
              <Cpu size={20} />
            </span>
            <span className="worker-status-copy">
              <strong>{statusLabel}</strong>
              <small>{workerStatus.connected} 个远程 Worker，{workerStatus.available} 个可用，{workerStatus.busy} 个忙碌</small>
            </span>
          </div>

          <dl className="worker-status-grid">
            <div>
              <dt>远程连接</dt>
              <dd>{workerStatus.connected}</dd>
            </div>
            <div>
              <dt>可用 Worker</dt>
              <dd>{workerStatus.available}</dd>
            </div>
            <div>
              <dt>忙碌 Worker</dt>
              <dd>{workerStatus.busy}</dd>
            </div>
            <div>
              <dt>本机分析</dt>
              <dd>{workerStatus.local.available ? '可用' : '不可用'}</dd>
            </div>
          </dl>

          {workerStatus.local.error && <p className="worker-status-error">{workerStatus.local.error}</p>}

          {workerStatus.workers.length === 0 ? (
            <p className="worker-empty">暂无远程 Worker 连接</p>
          ) : (
            <div className="worker-list">
              {workerStatus.workers.map((worker) => (
                <WorkerRow key={worker.id} worker={worker} />
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function WorkerRow({ worker }: { worker: WorkerRuntimeStatus }) {
  return (
    <article className="worker-row" data-state={worker.available ? worker.busy ? 'busy' : 'available' : 'unavailable'}>
      <span className="worker-row-icon" aria-hidden="true">
        <Server size={18} />
      </span>
      <span className="worker-row-main">
        <strong>{worker.name || worker.id}</strong>
        <small>{worker.platform || 'unknown platform'}</small>
        {worker.error && <small className="worker-row-error">{worker.error}</small>}
      </span>
      <span className="worker-row-state">{worker.available ? worker.busy ? '忙碌' : '可用' : '不可用'}</span>
    </article>
  )
}

function workerStatusLabel(status: WorkerStatus) {
  if (status.connected === 0) return '未连接'
  if (status.available === 0) return '不可用'
  if (status.busy >= status.available) return '忙碌'
  return '可用'
}

function workerStatusTone(status: WorkerStatus) {
  if (status.connected === 0 || status.available === 0) return 'unavailable'
  if (status.busy >= status.available) return 'busy'
  return 'available'
}
