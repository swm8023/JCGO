import type { GameRecord } from '../api/types'

interface GameSidebarProps {
  games: GameRecord[]
  selectedGameId?: string
  onImport(): void
  onSelect(gameId: string): void
  onRename(gameId: string, displayName: string): void
  onDelete(gameId: string): void
}

export function GameSidebar({ games, selectedGameId, onImport, onSelect, onRename, onDelete }: GameSidebarProps) {
  return (
    <aside className="game-sidebar">
      <div className="sidebar-header">
        <h1>JCGO</h1>
        <button className="icon-button" onClick={onImport} aria-label="Import SGF">
          +
        </button>
      </div>
      <div className="game-list">
        {games.map((game) => (
          <div className={game.gameId === selectedGameId ? 'game-row selected' : 'game-row'} key={game.gameId}>
            <button className="game-title" onClick={() => onSelect(game.gameId)}>
              <span>{game.displayName}</span>
              <small>{game.result || 'Unknown result'}</small>
            </button>
            <button
              className="icon-button"
              aria-label={`Rename ${game.displayName}`}
              onClick={() => {
                const name = window.prompt('Rename game', game.displayName)
                if (name && name.trim()) onRename(game.gameId, name.trim())
              }}
            >
              A
            </button>
            <button
              className="icon-button"
              aria-label={`Delete ${game.displayName}`}
              onClick={() => {
                if (window.confirm(`Delete ${game.displayName}?`)) onDelete(game.gameId)
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
