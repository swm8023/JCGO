import { type ChangeEvent, useRef, useState } from 'react'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
  onImportUrl(url: string): void
  onCancel(): void
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

type DialogMode = 'choose' | 'url'

export function ImportDialog({ onImport, onImportUrl, onCancel }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<DialogMode>('choose')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = () => {
    requestImportOrientation()
    const picker = (window as FilePickerWindow).showOpenFilePicker
    if (picker) {
      void chooseWithPicker(picker)
      return
    }
    window.addEventListener('focus', releaseImportOrientation, { once: true })
    inputRef.current?.click()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    try {
      if (file) await importFile(file, onImport)
    } finally {
      event.target.value = ''
      releaseImportOrientation()
    }
  }

  const cancel = () => {
    if (mode === 'url') {
      setMode('choose')
      setUrl('')
      setError(null)
      return
    }
    releaseImportOrientation()
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
      <div className="import-dialog" role="dialog" aria-label="Import from URL">
        <div className="import-dialog-body">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴元萝卜复盘链接"
            disabled={loading}
            autoFocus
          />
          {error && <div className="import-error">{error}</div>}
          <div className="import-dialog-actions">
            <button onClick={handleUrlSubmit} disabled={loading || !url.trim()}>
              {loading ? '导入中...' : '确认'}
            </button>
            <button onClick={cancel} disabled={loading}>取消</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="import-dialog" role="dialog" aria-label="Import SGF">
      <div className="import-dialog-body">
        <button onClick={choose}>选择 SGF 文件</button>
        <button onClick={() => setMode('url')}>从链接导入</button>
        <button onClick={cancel}>取消</button>
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
      // Users can cancel the native picker; unsupported orientation locks also fail silently.
    } finally {
      releaseImportOrientation()
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

function requestImportOrientation() {
  const orientation = screen.orientation as ScreenOrientation | undefined
  orientation?.lock?.('portrait')?.catch(() => undefined)
}

function releaseImportOrientation() {
  const orientation = screen.orientation as ScreenOrientation | undefined
  orientation?.unlock?.()
}
