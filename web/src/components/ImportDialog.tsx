import { type ChangeEvent, useRef } from 'react'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
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

export function ImportDialog({ onImport, onCancel }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

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
    releaseImportOrientation()
    onCancel()
  }

  return (
    <div className="import-dialog" role="dialog" aria-label="Import SGF">
      <div className="import-dialog-body">
        <button onClick={choose}>Choose SGF</button>
        <button onClick={cancel}>Cancel</button>
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
