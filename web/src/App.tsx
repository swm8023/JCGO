import { useEffect, useMemo, useState } from 'react'
import { RPCClient } from './api/jsonrpc'
import type { AnalysisState, BadMove, CandidateMove, ChartPoint, GameRecord, Snapshot, WorkspaceState } from './api/types'
import { AnalysisCharts } from './components/AnalysisCharts'
import { AnalysisPanel } from './components/AnalysisPanel'
import { BadMoveList } from './components/BadMoveList'
import { Board } from './components/Board'
import { CandidateList } from './components/CandidateList'
import { GameSidebar } from './components/GameSidebar'
import { ImportDialog } from './components/ImportDialog'
import { NavigationControls } from './components/NavigationControls'
import { RotatePrompt } from './components/RotatePrompt'
import { TokenGate } from './components/TokenGate'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))
  const [client, setClient] = useState<RPCClient>()
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [activePV, setActivePV] = useState<string[]>()
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [badMoves, setBadMoves] = useState<BadMove[]>([])
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
  const [showImport, setShowImport] = useState(false)
  const [gameListOpen, setGameListOpen] = useState(false)
  const [error, setError] = useState<string>()
  const wsUrl = useMemo(() => websocketURL(), [])

  const applyWorkspaceState = (state: WorkspaceState) => {
    setGames(state.games)
    setSelectedGameId(state.selectedGameId)
    setSnapshot(state.snapshot)
    setChartPoints(state.chartPoints)
    setBadMoves(state.badMoves)
    setAnalysisState(state.analysisState)
  }

  useEffect(() => {
    if (!token) return
    const nextClient = new RPCClient()
    setClient(nextClient)
    nextClient.on('analysis.update', (params) => applyWorkspaceState(params as WorkspaceState))
    nextClient
      .connect(wsUrl, token)
      .then(async () => {
        const state = await nextClient.call<WorkspaceState>('workspace.state')
        applyWorkspaceState(state)
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

  const refreshWorkspaceState = async (activeClient = client) => {
    if (!activeClient) return
    const state = await activeClient.call<WorkspaceState>('workspace.state')
    applyWorkspaceState(state)
  }

  const importGame = async (displayName: string, originalFilename: string, sgfText: string) => {
    if (!client) return
    await client.call('game.importSgf', { displayName, originalFilename, sgfText })
    await refreshWorkspaceState()
    setActivePV(undefined)
    setShowImport(false)
    setGameListOpen(true)
  }

  const selectGame = async (gameId: string) => {
    if (!client) return
    await client.call('game.select', { gameId })
    await refreshWorkspaceState()
    setActivePV(undefined)
    setGameListOpen(false)
  }

  const renameGame = async (gameId: string, displayName: string) => {
    if (!client) return
    await client.call('game.rename', { gameId, displayName })
    await refreshWorkspaceState()
  }

  const deleteGame = async (gameId: string) => {
    if (!client) return
    await client.call('game.delete', { gameId })
    await refreshWorkspaceState()
    setActivePV(undefined)
  }

  const gotoMove = async (moveNumber: number) => {
    if (!client || !selectedGameId) return
    await client.call('game.goto', { gameId: selectedGameId, moveNumber })
    await refreshWorkspaceState()
    setActivePV(undefined)
  }

  const goPrevious = () => gotoMove(Math.max(0, (snapshot?.moveNumber ?? 0) - 1))
  const goNext = () => gotoMove(Math.min(snapshot?.totalMoves ?? 0, (snapshot?.moveNumber ?? 0) + 1))

  const playMove = async (move: string) => {
    if (!client || !selectedGameId) return
    await client.call('game.play', { gameId: selectedGameId, move })
    await refreshWorkspaceState()
    setActivePV(undefined)
  }

  const pass = async () => {
    if (!client || !selectedGameId) return
    await client.call('game.pass', { gameId: selectedGameId })
    await refreshWorkspaceState()
  }

  const backToMain = async () => {
    if (!client || !selectedGameId) return
    await client.call('game.backToMain', { gameId: selectedGameId })
    await refreshWorkspaceState()
    setActivePV(undefined)
  }

  const deleteVariationNode = async () => {
    if (!client || !selectedGameId) return
    await client.call('game.deleteVariationNode', { gameId: selectedGameId })
    await refreshWorkspaceState()
  }

  const clearVariation = async () => {
    if (!client || !selectedGameId) return
    await client.call('game.clearVariation', { gameId: selectedGameId })
    await refreshWorkspaceState()
  }

  const previewPV = (candidate: CandidateMove) => setActivePV(candidate.pv)

  const startAnalysis = async () => {
    if (!client || !selectedGameId) return
    setAnalysisState('running')
    try {
      await client.call('analysis.start', { gameId: selectedGameId })
      await refreshWorkspaceState()
    } catch (reason) {
      setAnalysisState('unavailable')
      setError(reason instanceof Error ? reason.message : 'analysis unavailable')
    }
  }

  const stopAnalysis = async () => {
    if (!client || !selectedGameId) return
    await client.call('analysis.stop', { gameId: selectedGameId })
    await refreshWorkspaceState()
  }

  const restartAnalysis = async () => {
    if (!client || !selectedGameId) return
    setAnalysisState('running')
    await client.call('analysis.restart', { gameId: selectedGameId })
    await refreshWorkspaceState()
  }

  return (
    <>
      <main className="app-layout">
      <GameSidebar
        games={games}
        listOpen={gameListOpen}
        selectedGameId={selectedGameId}
        onToggleList={() => setGameListOpen((open) => !open)}
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
      <aside className="analysis-rail">
        <AnalysisPanel
          engineStatus={{ available: analysisState !== 'unavailable', error }}
          analysis={snapshot?.analysis}
          analysisState={analysisState}
          onStart={startAnalysis}
          onStop={stopAnalysis}
          onRestart={restartAnalysis}
        />
        <AnalysisCharts points={chartPoints} onJump={(moveNumber) => void gotoMove(moveNumber)} />
        <BadMoveList badMoves={badMoves} onJump={(moveNumber) => void gotoMove(moveNumber)} />
        <CandidateList candidates={snapshot?.analysis?.candidates ?? []} onCandidateClick={playMove} />
      </aside>
      {showImport && <ImportDialog onImport={importGame} onCancel={() => setShowImport(false)} />}
      </main>
      <RotatePrompt />
    </>
  )
}

function websocketURL() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
