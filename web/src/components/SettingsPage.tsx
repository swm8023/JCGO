import { useEffect, useState } from 'react'
import { ArrowLeft, Cpu, Server } from 'lucide-react'
import type { WorkerConfigureInput, WorkerRuntimeStatus, WorkerStatus } from '../api/types'

interface SettingsPageProps {
  workerStatus?: WorkerStatus
  onBack(): void
  onConfigureWorker?(input: WorkerConfigureInput): Promise<void>
}

const workerModels = [
  { label: 'b18 balanced', filename: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz' },
  { label: 'b28 latest', filename: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz' },
  { label: 'zhizi strongest', filename: 'kata1-zhizi-b40c768nbt-s11272M-d5935M.bin.gz' },
]

const emptyWorkerStatus: WorkerStatus = {
  connected: 0,
  available: 0,
  busy: 0,
  workers: [],
}

export function SettingsPage({ workerStatus = emptyWorkerStatus, onBack, onConfigureWorker }: SettingsPageProps) {
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
              <small>{workerStatus.connected} 个 Worker，{workerStatus.available} 个可用，{workerStatus.busy} 个忙碌</small>
            </span>
          </div>

          <dl className="worker-status-grid">
            <div>
              <dt>连接</dt>
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
          </dl>

          {workerStatus.workers.length === 0 ? (
            <p className="worker-empty">暂无 Worker 连接</p>
          ) : (
            <div className="worker-list">
              {workerStatus.workers.map((worker) => (
                <WorkerRow key={worker.id} worker={worker} onConfigureWorker={onConfigureWorker} />
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function WorkerRow({ worker, onConfigureWorker }: { worker: WorkerRuntimeStatus; onConfigureWorker?: (input: WorkerConfigureInput) => Promise<void> }) {
  const [model, setModel] = useState(worker.model || workerModels[0].filename)
  const [maxVisits, setMaxVisits] = useState(String(worker.maxVisits || 500))
  const [saving, setSaving] = useState(false)
  const visitsValue = Number(maxVisits)
  const state = worker.available ? worker.busy ? 'busy' : 'available' : 'unavailable'
  const controlsDisabled = Boolean(!onConfigureWorker || saving)
  const workerName = worker.name || worker.id
  const canSave = !controlsDisabled && workerName.trim().length > 0 && model.trim().length > 0 && Number.isFinite(visitsValue) && visitsValue > 0

  useEffect(() => {
    setModel(worker.model || workerModels[0].filename)
    setMaxVisits(String(worker.maxVisits || 500))
  }, [worker.model, worker.maxVisits])

  const save = async () => {
    if (!onConfigureWorker || !canSave) return
    setSaving(true)
    try {
      await onConfigureWorker({ workerName, model, maxVisits: visitsValue })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="worker-row" data-state={state}>
      <span className="worker-row-icon" aria-hidden="true">
        <Server size={18} />
      </span>
      <span className="worker-row-main">
        <strong>{workerName}</strong>
        <small>{worker.platform || 'unknown platform'}</small>
        <small>{backendLabel(worker.backend)}</small>
        {worker.cpu && <small>{worker.cpu}</small>}
        {worker.gpus?.map((gpu) => <small key={gpu}>{gpu}</small>)}
        {worker.error && <small className="worker-row-error">{worker.error}</small>}
        <span className="worker-controls">
          <label>
            模型
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={controlsDisabled}>
              {workerModels.map((candidate) => (
                <option key={candidate.filename} value={candidate.filename}>{candidate.label}</option>
              ))}
            </select>
          </label>
          <label>
            Visits
            <input value={maxVisits} inputMode="numeric" onChange={(event) => setMaxVisits(event.target.value)} disabled={controlsDisabled} />
          </label>
          <button type="button" onClick={() => void save()} disabled={!canSave}>保存</button>
        </span>
      </span>
      <span className="worker-row-state">{worker.available ? worker.busy ? '忙碌' : '可用' : '不可用'}</span>
    </article>
  )
}

function backendLabel(backend?: string) {
  if (backend === 'opencl') return 'OpenCL'
  if (backend?.toLowerCase().startsWith('cuda')) return 'CUDA'
  return backend || 'unknown backend'
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
