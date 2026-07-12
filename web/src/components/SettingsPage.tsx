import { useEffect, useState } from 'react'
import { Cpu, Server } from 'lucide-react'
import type { WorkerConfigureInput, WorkerRuntimeStatus, WorkerStatus } from '../api/types'

interface SettingsPageProps {
  workerStatus?: WorkerStatus
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

export function SettingsPage({ workerStatus = emptyWorkerStatus, onConfigureWorker }: SettingsPageProps) {
  const statusLabel = workerStatusLabel(workerStatus)
  return (
    <section className="app-page-body settings-page" role="region" aria-label="设置内容">
      <section className="settings-section" role="region" aria-label="Worker 状态">
          <div className="worker-status-summary" data-state={workerStatusTone(workerStatus)}>
            <span className="worker-summary-state">
              <span className="worker-status-icon" aria-hidden="true">
                <Cpu size={18} />
              </span>
              <span className="worker-status-copy">
                <strong>{statusLabel}</strong>
                <small>Worker 运行状态</small>
              </span>
            </span>
            <dl className="worker-summary-metrics" aria-label="Worker 数量">
              <div>
                <dt>连接</dt>
                <dd>{workerStatus.connected}</dd>
              </div>
              <div>
                <dt>可用</dt>
                <dd>{workerStatus.available}</dd>
              </div>
              <div>
                <dt>忙碌</dt>
                <dd>{workerStatus.busy}</dd>
              </div>
            </dl>
          </div>

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
  )
}

function WorkerRow({ worker, onConfigureWorker }: { worker: WorkerRuntimeStatus; onConfigureWorker?: (input: WorkerConfigureInput) => Promise<void> }) {
  const [model, setModel] = useState(worker.model || workerModels[0].filename)
  const [maxVisits, setMaxVisits] = useState(String(worker.maxVisits || 500))
  const [priority, setPriority] = useState(String(worker.priority || 100))
  const [saving, setSaving] = useState(false)
  const visitsValue = Number(maxVisits)
  const priorityValue = Number(priority)
  const state = worker.available ? worker.busy ? 'busy' : 'available' : 'unavailable'
  const controlsDisabled = Boolean(!onConfigureWorker || saving)
  const workerName = worker.name || worker.id
  const canSave = !controlsDisabled && workerName.trim().length > 0 && model.trim().length > 0 && Number.isFinite(visitsValue) && visitsValue > 0 && Number.isInteger(priorityValue) && priorityValue > 0

  useEffect(() => {
    setModel(worker.model || workerModels[0].filename)
    setMaxVisits(String(worker.maxVisits || 500))
    setPriority(String(worker.priority || 100))
  }, [worker.model, worker.maxVisits, worker.priority])

  const save = async () => {
    if (!onConfigureWorker || !canSave) return
    setSaving(true)
    try {
      await onConfigureWorker({ workerName, model, maxVisits: visitsValue, priority: priorityValue })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="worker-row" data-state={state}>
      <span className="worker-row-identity">
        <span className="worker-row-icon" aria-hidden="true">
          <Server size={17} />
        </span>
        <span className="worker-row-main">
          <strong>{workerName}</strong>
          <span className="worker-row-meta">
            <small>{worker.platform || 'unknown platform'}</small>
            <small>{backendLabel(worker.backend)}</small>
            {worker.cpu && <small>{worker.cpu}</small>}
            {worker.gpus?.map((gpu) => <small key={gpu}>{gpu}</small>)}
          </span>
        </span>
      </span>
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
        <label>
          优先级
          <input type="number" value={priority} inputMode="numeric" min="1" onChange={(event) => setPriority(event.target.value)} disabled={controlsDisabled} />
        </label>
        <button type="button" onClick={() => void save()} disabled={!canSave}>保存</button>
      </span>
      <span className="worker-row-state">{worker.available ? worker.busy ? '忙碌' : '可用' : '不可用'}</span>
      {worker.error && <small className="worker-row-error">{worker.error}</small>}
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
