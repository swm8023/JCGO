import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { Cloud, FileUp, Link2 } from 'lucide-react'
import { AppSheet } from './AppSheet'
import { YuanluoboImportDialog, type YuanluoboImportAPI, type YuanluoboPickerKind } from './YuanluoboImportDialog'

interface ImportDialogProps {
  mode: ImportDialogMode
  onImport(displayName: string, originalFilename: string, sgfText: string): void | Promise<void>
  onImportUrl(url: string): void | Promise<void>
  onOpenUrl(): void
  onOpenYuanluobo(): void
  yuanluoboApi: YuanluoboImportAPI
  yuanluoboPickerKind?: YuanluoboPickerKind
  onOpenYuanluoboPicker(kind: YuanluoboPickerKind): void
  onCloseYuanluoboPicker(): void
  onLoginStateChange?(loggedIn: boolean): void
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

export type ImportDialogMode = 'choose' | 'url' | 'yuanluobo'

export function ImportDialog({
  mode,
  onImport,
  onImportUrl,
  onOpenUrl,
  onOpenYuanluobo,
  yuanluoboApi,
  yuanluoboPickerKind,
  onOpenYuanluoboPicker,
  onCloseYuanluoboPicker,
  onLoginStateChange,
}: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File>()
  const [displayName, setDisplayName] = useState('')
  const [fileImporting, setFileImporting] = useState(false)
  const [fileImportError, setFileImportError] = useState<string>()

  const choose = () => {
    const picker = (window as FilePickerWindow).showOpenFilePicker
    if (picker) {
      void chooseWithPicker(picker)
      return
    }
    inputRef.current?.click()
  }

  const prepareFileImport = (file: File) => {
    setPendingFile(file)
    setDisplayName(file.name.replace(/\.sgf$/i, ''))
    setFileImportError(undefined)
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) prepareFileImport(file)
    event.target.value = ''
  }

  useEffect(() => {
    if (mode !== 'url') {
      setUrl('')
      setError(null)
      setLoading(false)
    }
    setPendingFile(undefined)
    setFileImportError(undefined)
  }, [mode])

  const dismissFileImport = () => {
    if (fileImporting) return
    setPendingFile(undefined)
    setFileImportError(undefined)
  }

  const confirmFileImport = async () => {
    const name = displayName.trim()
    if (!pendingFile || !name || fileImporting) return
    setFileImporting(true)
    setFileImportError(undefined)
    try {
      await onImport(name, pendingFile.name, await pendingFile.text())
      setPendingFile(undefined)
    } catch (reason) {
      setFileImportError(reason instanceof Error ? reason.message : '导入失败')
    } finally {
      setFileImporting(false)
    }
  }

  const handleUrlSubmit = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      await onImportUrl(url.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
      setLoading(false)
    }
  }

  if (mode === 'url') {
    return (
      <section className="app-page-body import-page import-url-page" role="region" aria-label="从链接导入内容">
        <p className="import-page-description">粘贴元萝卜复盘链接，系统会读取棋局并生成 SGF。</p>
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
            <button className="import-primary-button" onClick={handleUrlSubmit} disabled={loading || !url.trim()}>
              {loading ? '导入中...' : '导入'}
            </button>
          </div>
      </section>
    )
  }

  if (mode === 'yuanluobo') {
    return (
      <YuanluoboImportDialog
        api={yuanluoboApi}
        pickerKind={yuanluoboPickerKind}
        onOpenPicker={onOpenYuanluoboPicker}
        onClosePicker={onCloseYuanluoboPicker}
        onLoginStateChange={onLoginStateChange}
      />
    )
  }

  return (
    <>
      <section className="app-page-body import-page" role="region" aria-label="导入棋局内容">
        <p className="import-page-description">选择一个来源，导入后会进入当前棋盘。</p>
        <div className="import-source-grid">
          <button className="import-source-card" onClick={choose}>
            <span className="import-source-icon"><FileUp size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>SGF 文件</strong>
              <small>从本地选择 .sgf 文件</small>
            </span>
          </button>
          <button className="import-source-card" onClick={onOpenUrl}>
            <span className="import-source-icon"><Link2 size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>复盘链接</strong>
              <small>粘贴元萝卜分享链接</small>
            </span>
          </button>
          <button className="import-source-card primary" onClick={onOpenYuanluobo}>
            <span className="import-source-icon"><Cloud size={20} aria-hidden="true" /></span>
            <span className="import-source-copy">
              <strong>元萝卜账号</strong>
              <small>扫码后浏览历史棋局</small>
            </span>
          </button>
        </div>
        <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
      </section>
      {pendingFile && (
        <AppSheet
          title="命名棋局"
          onDismiss={dismissFileImport}
          actions={(
            <>
              <button className="app-sheet-button" type="button" onClick={dismissFileImport} disabled={fileImporting}>取消</button>
              <button
                className="app-sheet-button primary"
                type="button"
                onClick={() => void confirmFileImport()}
                disabled={fileImporting || !displayName.trim()}
              >
                {fileImporting ? '导入中...' : '导入'}
              </button>
            </>
          )}
        >
          <label className="app-sheet-field">
            <span>棋局名称</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus disabled={fileImporting} />
          </label>
          <p className="app-sheet-file">{pendingFile.name}</p>
          {fileImportError && <p className="import-error">{fileImportError}</p>}
        </AppSheet>
      )}
    </>
  )

  async function chooseWithPicker(picker: NonNullable<FilePickerWindow['showOpenFilePicker']>) {
    try {
      const [handle] = await picker(sgfPickerOptions)
      if (!handle) return
      prepareFileImport(await handle.getFile())
    } catch {
      // Users can cancel the native picker.
    }
  }
}
