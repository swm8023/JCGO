import { useEffect, type ReactNode } from 'react'

interface AppSheetProps {
  title: string
  children: ReactNode
  actions: ReactNode
  onDismiss(): void
}

export function AppSheet({ title, children, actions, onDismiss }: AppSheetProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onDismiss])

  return (
    <div className="app-sheet-backdrop" onClick={onDismiss}>
      <section
        className="app-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="app-sheet-handle" aria-hidden="true" />
        <header className="app-sheet-header">
          <h2>{title}</h2>
        </header>
        <div className="app-sheet-body">{children}</div>
        <footer className="app-sheet-actions">{actions}</footer>
      </section>
    </div>
  )
}
