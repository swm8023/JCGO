import { type ChangeEvent, useRef } from 'react'

interface ImportDialogProps {
  onImport(displayName: string, originalFilename: string, sgfText: string): void
  onCancel(): void
}

export function ImportDialog({ onImport, onCancel }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const choose = () => inputRef.current?.click()

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const defaultName = file.name.replace(/\.sgf$/i, '')
    const displayName = window.prompt('Game name', defaultName)?.trim()
    if (!displayName) return
    const sgfText = await file.text()
    onImport(displayName, file.name, sgfText)
  }

  return (
    <div className="import-dialog" role="dialog" aria-label="Import SGF">
      <div className="import-dialog-body">
        <button onClick={choose}>Choose SGF</button>
        <button onClick={onCancel}>Cancel</button>
        <input ref={inputRef} type="file" accept=".sgf" hidden onChange={onFile} />
      </div>
    </div>
  )
}
