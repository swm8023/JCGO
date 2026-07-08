import { type ChangeEvent, useRef, useState } from 'react'
import { ArrowLeft, Cloud, FileUp, Link2, X } from 'lucide-react'
import { YuanluoboImportDialog, type YuanluoboImportAPI } from './YuanluoboImportDialog'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
  onImportUrl(url: string): void
  onCancel(): void
  yuanluoboApi: YuanluoboImportAPI
  onOpenGame(gameId: string): void | Promise<void>
}

type SGFPickerOptions = {
  id: string
  startIn: 'documents'
  multiple: false
  types: Array<{
    description: string
    accept: Record<string, string[]>
  }>
}

type FilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options: SGFPickerOptions) => Promise<Array<{ getFile(): Promise<File> }>>
  }

const sgfPickerOptions: SGFPickerOptions = {
  id: 'jcgo-sgf-import',
  startIn: 'documents',
  multiple: false,
  types: [
    {
      description: 'SGF files',
      accept: {
        'application/x-go-sgf': ['.sgf'],
        'text/plain': ['.sgf'],
      },
    },
  ],
}

type DialogMode = 'choose' | 'url' | 'yuanluobo'

export function ImportDialog({ onImport, onImportUrl, onCancel, yuanluoboApi, onOpenGame }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<DialogMode>('choose')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = () => {
    const picker = (window as FilePickerWindow).showOpenFilePicker
    if (picker) {
      void chooseWithPicker(picker)
      return
    }
    inputRef.current?.click()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    try {
      if (file) await importFile(file, onImport)
    } finally {
      event.target.value = ''
    }
  }

  const cancel = () => {
    if (mode === 'url' || mode === 'yuanluobo') {
      setMode('choose')
      setUrl('')
      setError(null)
      return
    }
    onCancel()
  }

  const handleUrlSubmit = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      onImportUrl(url.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
      setLoading(false)
    }
  }

  if (mode === 'url') {
    return (
      <div className="import-dialog" role="dialog" aria-label="从链接导入">
        <div className="import-dialog-body import-url-panel">
          <header className="import-panel-header">
            <button className="import-icon-button" onClick={cancel} disabled={loading} aria-label="返回导入来源">
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            <div>
              <p className="import-panel-eyebrow">URL</p>
              <h2>从链接导入</h2>
              <p>粘贴元萝卜复盘链接，系统会读取棋局并生成 SGF。</p>
            </div>
          </header>
          <label className="import-url-field">
            <span>复盘链接</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://jupiter.yuanluobo.com/..."
              disabled={loading}
              autoFocus
            />
          </label>
          {error && <div className="import-error">{error}</div>}
          <div className="import-dialog-actions">
            <button className="import-secondary-button" onClick={cancel} disabled={loading}>返回</button>
            <button className="import-primary-button" onClick={handleUrlSubmit} disabled={loading || !url.trim()}>
              {loading ? '导入中...' : '导入'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'yuanluobo') {
    return (
      <div className="import-dialog yuanluobo-fullscreen-dialog" role="dialog" aria-label="元萝卜导入">
        <YuanluoboImportDialog api={yuanluoboApi} onOpenGame={onOpenGame} onBack={() => setMode('choose')} />
      </div>
    )
  }

  return (
    <div className="import-dialog" role="dialog" aria-label="导入棋局">
      <div className="import-dialog-body import-source-panel">
        <header className="import-panel-header">
          <div>
            <p className="import-panel-eyebrow">Import</p>
            <h2>导入棋局</h2>
            <p>选择一个来源，导入后会进入当前棋盘。</p>
          </div>
          <button className="import-icon-button" onClick={cancel} aria-label="关闭导入">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="import-source-grid">
          <button className="import-source-card" onClick={choose}>
            <span className="import-source-icon"><FileUp size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>SGF 文件</strong>
              <small>从本地选择 .sgf 文件</small>
            </span>
          </button>
          <button className="import-source-card" onClick={() => setMode('url')}>
            <span className="import-source-icon"><Link2 size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>复盘链接</strong>
              <small>粘贴元萝卜分享链接</small>
            </span>
          </button>
          <button className="import-source-card primary" onClick={() => setMode('yuanluobo')}>
            <span className="import-source-icon"><Cloud size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>元萝卜账号</strong>
              <small>扫码后浏览历史棋局</small>
            </span>
          </button>
        </div>
        <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
      </div>
    </div>
  )

  async function chooseWithPicker(picker: NonNullable<FilePickerWindow['showOpenFilePicker']>) {
    try {
      const [handle] = await picker(sgfPickerOptions)
      if (!handle) return
      await importFile(await handle.getFile(), onImport)
    } catch {
      // Users can cancel the native picker.
    }
  }
}

async function importFile(file: File, onImport: ImportDialogProps['onImport']) {
  const defaultName = file.name.replace(/\.sgf$/i, '')
  const displayName = window.prompt('Game name', defaultName)?.trim()
  if (!displayName) return
  const sgfText = await file.text()
  onImport(displayName, file.name, sgfText)
}
