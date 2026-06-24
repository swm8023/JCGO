import { useEffect, useMemo, useState } from 'react'
import { RPCClient } from './api/jsonrpc'
import type { GameRecord, ImportResult, ListResult, Snapshot, SnapshotResult } from './api/types'
import { GameSidebar } from './components/GameSidebar'
import { ImportDialog } from './components/ImportDialog'
import { TokenGate } from './components/TokenGate'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))
  const [client, setClient] = useState<RPCClient>()
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [showImport, setShowImport] = useState(false)
  const [error, setError] = useState<string>()
  const wsUrl = useMemo(() => websocketURL(), [])

  useEffect(() => {
    if (!token) return
    const nextClient = new RPCClient()
    setClient(nextClient)
    nextClient
      .connect(wsUrl, token)
      .then(async () => {
        const result = await nextClient.call<ListResult>('game.list')
        setGames(result.games)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [token, wsUrl])

  if (!token) return <TokenGate onSubmit={setToken} />

  const importGame = async (displayName: string, originalFilename: string, sgfText: string) => {
    if (!client) return
    const result = await client.call<ImportResult>('game.importSgf', { displayName, originalFilename, sgfText })
    setGames((current) => [result.game, ...current.filter((game) => game.gameId !== result.game.gameId)])
    setSelectedGameId(result.game.gameId)
    setSnapshot(result.snapshot)
    setShowImport(false)
  }

  const selectGame = async (gameId: string) => {
    if (!client) return
    const result = await client.call<SnapshotResult>('game.select', { gameId })
    setSelectedGameId(gameId)
    setSnapshot(result.snapshot)
  }

  const renameGame = async (gameId: string, displayName: string) => {
    if (!client) return
    await client.call('game.rename', { gameId, displayName })
    const result = await client.call<ListResult>('game.list')
    setGames(result.games)
  }

  const deleteGame = async (gameId: string) => {
    if (!client) return
    await client.call('game.delete', { gameId })
    setGames((current) => current.filter((game) => game.gameId !== gameId))
    if (selectedGameId === gameId) {
      setSelectedGameId(undefined)
      setSnapshot(undefined)
    }
  }

  return (
    <main className="app-layout">
      <GameSidebar
        games={games}
        selectedGameId={selectedGameId}
        onImport={() => setShowImport(true)}
        onSelect={selectGame}
        onRename={renameGame}
        onDelete={deleteGame}
      />
      <section className="board-stage">
        {snapshot ? `${snapshot.moveNumber} / ${snapshot.totalMoves}` : 'Workspace connected'}
        {error && <p className="app-error">{error}</p>}
      </section>
      <aside className="analysis-rail">Analysis</aside>
      {showImport && <ImportDialog onImport={importGame} onCancel={() => setShowImport(false)} />}
    </main>
  )
}

function websocketURL() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
