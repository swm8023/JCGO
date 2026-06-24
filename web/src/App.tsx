import { useEffect, useMemo, useState } from 'react'
import { RPCClient } from './api/jsonrpc'
import type { CandidateMove, GameRecord, ImportResult, ListResult, Snapshot, SnapshotResult } from './api/types'
import { Board } from './components/Board'
import { GameSidebar } from './components/GameSidebar'
import { ImportDialog } from './components/ImportDialog'
import { NavigationControls } from './components/NavigationControls'
import { TokenGate } from './components/TokenGate'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))
  const [client, setClient] = useState<RPCClient>()
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [activePV, setActivePV] = useState<string[]>()
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft') void goPrevious()
      if (event.key === 'ArrowRight') void goNext()
      if (event.key === 'Escape') {
        if (activePV?.length) setActivePV(undefined)
        else if (snapshot?.canBackToMain) void backToMain()
        else if (showImport) setShowImport(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!token) return <TokenGate onSubmit={setToken} />

  const importGame = async (displayName: string, originalFilename: string, sgfText: string) => {
    if (!client) return
    const result = await client.call<ImportResult>('game.importSgf', { displayName, originalFilename, sgfText })
    setGames((current) => [result.game, ...current.filter((game) => game.gameId !== result.game.gameId)])
    setSelectedGameId(result.game.gameId)
    setSnapshot(result.snapshot)
    setActivePV(undefined)
    setShowImport(false)
  }

  const selectGame = async (gameId: string) => {
    if (!client) return
    const result = await client.call<SnapshotResult>('game.select', { gameId })
    setSelectedGameId(gameId)
    setSnapshot(result.snapshot)
    setActivePV(undefined)
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

  const gotoMove = async (moveNumber: number) => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.goto', { gameId: selectedGameId, moveNumber })
    setSnapshot(result.snapshot)
    setActivePV(undefined)
  }

  const goPrevious = () => gotoMove(Math.max(0, (snapshot?.moveNumber ?? 0) - 1))
  const goNext = () => gotoMove(Math.min(snapshot?.totalMoves ?? 0, (snapshot?.moveNumber ?? 0) + 1))

  const playMove = async (move: string) => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.play', { gameId: selectedGameId, move })
    setSnapshot(result.snapshot)
    setActivePV(undefined)
  }

  const pass = async () => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.pass', { gameId: selectedGameId })
    setSnapshot(result.snapshot)
  }

  const backToMain = async () => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.backToMain', { gameId: selectedGameId })
    setSnapshot(result.snapshot)
    setActivePV(undefined)
  }

  const deleteVariationNode = async () => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.deleteVariationNode', { gameId: selectedGameId })
    setSnapshot(result.snapshot)
  }

  const clearVariation = async () => {
    if (!client || !selectedGameId) return
    const result = await client.call<SnapshotResult>('game.clearVariation', { gameId: selectedGameId })
    setSnapshot(result.snapshot)
  }

  const previewPV = (candidate: CandidateMove) => setActivePV(candidate.pv)

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
        <Board snapshot={snapshot} activePV={activePV} onPlay={playMove} onPreviewPV={previewPV} onClearPV={() => setActivePV(undefined)} />
        <NavigationControls
          moveNumber={snapshot?.moveNumber ?? 0}
          totalMoves={snapshot?.totalMoves ?? 0}
          canBackToMain={snapshot?.canBackToMain ?? false}
          onFirst={() => void gotoMove(0)}
          onPrevious={() => void goPrevious()}
          onNext={() => void goNext()}
          onLast={() => void gotoMove(snapshot?.totalMoves ?? 0)}
          onBackToMain={() => void backToMain()}
          onPass={() => void pass()}
          onDeleteVariationNode={() => void deleteVariationNode()}
          onClearVariation={() => void clearVariation()}
        />
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
