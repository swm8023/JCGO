import { useEffect, useMemo, useState } from 'react'
import { RPCClient } from './api/jsonrpc'
import type { AnalysisState, BadMove, BadMovePromptResult, CandidateMove, ChartPoint, GameRecord, Snapshot, StatePayload } from './api/types'
import { AnalysisCharts } from './components/AnalysisCharts'
import { AnalysisDetailTabs } from './components/AnalysisDetailTabs'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Board } from './components/Board'
import { BoardInfo } from './components/BoardInfo'
import { GameSidebar } from './components/GameSidebar'
import { ImportDialog } from './components/ImportDialog'
import { NavigationControls } from './components/NavigationControls'
import { OverlayToggles, type OverlayState } from './components/OverlayToggles'
import { RotatePrompt } from './components/RotatePrompt'
import { TokenGate } from './components/TokenGate'
import { analysisForCurrent, badMovesForState, chartPointsForState, playedPointLossForCurrent, trialMovesForState } from './state/selectors'

const defaultOverlays: OverlayState = { candidates: true, ownership: true, deadStones: true }

type NavigationCommand = { method: 'game.goto'; moveNumber: number } | { method: 'game.gotoNode'; nodeId: string }

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))
  const [client, setClient] = useState<RPCClient>()
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [activePV, setActivePV] = useState<string[]>()
  const [tryMode, setTryMode] = useState(false)
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [badMoves, setBadMoves] = useState<BadMove[]>([])
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
  const [workspace, setWorkspace] = useState<StatePayload>()
  const [overlays, setOverlays] = useState<OverlayState>(() => readOverlayState())
  const [showImport, setShowImport] = useState(false)
  const [gameListOpen, setGameListOpen] = useState(false)
  const [error, setError] = useState<string>()
  const wsUrl = useMemo(() => websocketURL(), [])

  const applyWorkspaceState = (state: StatePayload) => {
    const analysis = analysisForCurrent(state)
    setWorkspace(state)
    setGames(state.games ?? [])
    setSelectedGameId(state.gameId)
    setSnapshot(state.snapshot ? { ...state.snapshot, analysis } : undefined)
    setChartPoints(chartPointsForState(state))
    setBadMoves(badMovesForState(state))
    setAnalysisState(state.analysisState)
  }

  const updateOverlays = (value: OverlayState) => {
    setOverlays(value)
    localStorage.setItem('jcgo.boardOverlays', JSON.stringify(value))
  }

  const returnToTokenGate = () => {
    localStorage.removeItem('jcgo.accessToken')
    setToken(null)
    setClient(undefined)
    setGames([])
    setSelectedGameId(undefined)
    setSnapshot(undefined)
    setActivePV(undefined)
    setTryMode(false)
    setChartPoints([])
    setBadMoves([])
    setAnalysisState('idle')
    setWorkspace(undefined)
    setShowImport(false)
    setGameListOpen(false)
  }

  useEffect(() => {
    if (!token) return
    const nextClient = new RPCClient()
    setError(undefined)
    setClient(nextClient)
    nextClient.on('analysis.update', (params) => applyWorkspaceState(params as StatePayload))
    nextClient
      .connect(wsUrl, token)
      .then(async () => {
        const state = await nextClient.call<StatePayload>('workspace.state')
        applyWorkspaceState(state)
      })
      .catch(() => returnToTokenGate())
  }, [token, wsUrl])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft') void goPrevious()
      if (event.key === 'ArrowRight') void goNext()
      if (event.key === 'Escape') {
        if (activePV?.length) setActivePV(undefined)
        else if (tryMode || snapshot?.canBackToMain) void exitTryMode()
        else if (showImport) setShowImport(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!token) return <TokenGate onSubmit={setToken} />

  const refreshWorkspaceState = async (activeClient = client) => {
    if (!activeClient) return
    const state = await activeClient.call<StatePayload>('workspace.state')
    applyWorkspaceState(state)
  }

  const importGame = async (displayName: string, originalFilename: string, sgfText: string) => {
    if (!client) return
    await client.call('game.importSgf', { displayName, originalFilename, sgfText })
    await refreshWorkspaceState()
    setActivePV(undefined)
    setTryMode(false)
    setShowImport(false)
    setGameListOpen(true)
  }

  const selectGame = async (gameId: string) => {
    if (!client) return
    const state = await client.call<StatePayload>('game.select', { gameId })
    applyWorkspaceState(state)
    setActivePV(undefined)
    setTryMode(false)
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
    setTryMode(false)
  }

  const runNavigation = async (command: NavigationCommand | undefined, keepTryMode = false) => {
    if (!client || !selectedGameId || !command) return
    const params = command.method === 'game.goto'
      ? { gameId: selectedGameId, moveNumber: command.moveNumber }
      : { gameId: selectedGameId, nodeId: command.nodeId }
    const state = await client.call<StatePayload>(command.method, params)
    applyWorkspaceState(state)
    setActivePV(undefined)
    if (!keepTryMode) setTryMode(false)
  }

  const gotoMove = async (moveNumber: number) => runNavigation({ method: 'game.goto', moveNumber })
  const keepTrialNavigation = () => tryMode || snapshot?.branchMode === 'variation'
  const goFirst = () => runNavigation(firstNavigation(snapshot, workspace), keepTrialNavigation())
  const goPrevious = () => runNavigation(previousNavigation(snapshot, workspace), keepTrialNavigation())
  const goNext = () => runNavigation(nextNavigation(snapshot, workspace, tryMode), keepTrialNavigation())
  const goLast = () => runNavigation(lastNavigation(snapshot, workspace), keepTrialNavigation())

  const playMove = async (move: string) => {
    if (!client || !selectedGameId) return
    const state = await client.call<StatePayload>('game.play', { gameId: selectedGameId, move })
    applyWorkspaceState(state)
    setActivePV(undefined)
  }

  const previewPV = (candidate: CandidateMove) => {
    setTryMode(false)
    setActivePV(candidate.pv)
  }

  const requestBadMovePrompt = async (move: BadMove) => {
    if (!client || !selectedGameId) throw new Error('game not selected')
    const result = await client.call<BadMovePromptResult>('analysis.badMovePrompt', { gameId: selectedGameId, nodeId: move.nodeId })
    return result.prompt
  }

  const enterTryMode = () => {
    setActivePV(undefined)
    setTryMode(true)
  }

  const exitTryMode = async () => {
    setTryMode(false)
    setActivePV(undefined)
    if (!client || !selectedGameId || !snapshot?.canBackToMain) return
    const state = await client.call<StatePayload>('game.clearVariation', { gameId: selectedGameId })
    applyWorkspaceState(state)
  }

  const startAnalysis = async () => {
    if (!client || !selectedGameId) return
    setAnalysisState('running')
    try {
      const state = await client.call<StatePayload>('analysis.start', { gameId: selectedGameId })
      applyWorkspaceState(state)
    } catch (reason) {
      setAnalysisState('unavailable')
      setError(reason instanceof Error ? reason.message : 'analysis unavailable')
    }
  }

  const stopAnalysis = async () => {
    if (!client || !selectedGameId) return
    const state = await client.call<StatePayload>('analysis.stop', { gameId: selectedGameId })
    applyWorkspaceState(state)
  }

  const restartAnalysis = async () => {
    if (!client || !selectedGameId) return
    setAnalysisState('running')
    const state = await client.call<StatePayload>('analysis.restart', { gameId: selectedGameId })
    applyWorkspaceState(state)
  }

  return (
    <>
      <main className="app-layout">
      <GameSidebar
        games={games}
        listOpen={gameListOpen}
        selectedGameId={selectedGameId}
        analysisAvailable={analysisState !== 'unavailable'}
        analysisError={error}
        analysisState={analysisState}
        onToggleList={() => setGameListOpen((open) => !open)}
        onImport={() => setShowImport(true)}
        onSelect={selectGame}
        onRename={renameGame}
        onDelete={deleteGame}
        onStartAnalysis={startAnalysis}
        onStopAnalysis={stopAnalysis}
        onRestartAnalysis={restartAnalysis}
        toolbarSlot={<OverlayToggles value={overlays} onChange={updateOverlays} />}
      />
      <section className="board-stage">
        <div className="board-layout">
          <BoardInfo blackName={snapshot?.blackName} whiteName={snapshot?.whiteName} komi={snapshot?.komi} rules={snapshot?.rules} />
          <Board
            snapshot={snapshot}
            candidates={snapshot?.analysis?.candidates ?? []}
            ownership={workspace?.current?.ownership}
            playedPointLoss={playedPointLossForCurrent(workspace)}
            overlays={overlays}
            activePV={activePV}
            trialMoves={trialMovesForState(workspace)}
            tryMode={tryMode}
            onPlay={playMove}
            onPreviewPV={previewPV}
          />
        </div>
        {error && <p className="app-error">{error}</p>}
      </section>
      <nav className="action-rail">
        <NavigationControls
          moveNumber={snapshot?.moveNumber ?? 0}
          totalMoves={snapshot?.totalMoves ?? 0}
          canBackToMain={snapshot?.canBackToMain ?? false}
          tryMode={tryMode}
          onFirst={() => void goFirst()}
          onPrevious={() => void goPrevious()}
          onNext={() => void goNext()}
          onLast={() => void goLast()}
          onEnterTryMode={enterTryMode}
          onExitTryMode={() => void exitTryMode()}
        />
      </nav>
      <aside className="analysis-rail">
        <section className="analysis-overview rail-section" aria-label="局面曲线">
          <AnalysisPanel analysis={snapshot?.analysis} />
          <AnalysisCharts points={chartPoints} currentMoveNumber={snapshot?.moveNumber} onJump={(moveNumber) => void gotoMove(moveNumber)} />
        </section>
        <AnalysisDetailTabs
          badMoves={badMoves}
          candidates={snapshot?.analysis?.candidates ?? []}
          onJump={(moveNumber) => void gotoMove(moveNumber)}
          onCandidateClick={previewPV}
          onRequestBadMovePrompt={requestBadMovePrompt}
        />
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

function firstNavigation(snapshot?: Snapshot, workspace?: StatePayload): NavigationCommand | undefined {
  if (!snapshot) return undefined
  if (snapshot.branchMode === 'variation' && workspace?.variation) {
    return { method: 'game.goto', moveNumber: workspace.variation.baseMoveNumber }
  }
  return { method: 'game.goto', moveNumber: 0 }
}

function previousNavigation(snapshot?: Snapshot, workspace?: StatePayload): NavigationCommand | undefined {
  if (!snapshot) return undefined
  if (snapshot.branchMode === 'variation' && workspace?.variation) {
    const nodeIDs = workspace.variation.timeline.nodeIds ?? []
    const index = nodeIDs.indexOf(snapshot.nodeId)
    if (index > 0) return { method: 'game.gotoNode', nodeId: nodeIDs[index - 1] }
    return { method: 'game.goto', moveNumber: workspace.variation.baseMoveNumber }
  }
  return { method: 'game.goto', moveNumber: Math.max(0, snapshot.moveNumber - 1) }
}

function nextNavigation(snapshot?: Snapshot, workspace?: StatePayload, tryMode = false): NavigationCommand | undefined {
  if (!snapshot) return undefined
  if (snapshot.branchMode === 'variation' && workspace?.variation) {
    const nodeIDs = workspace.variation.timeline.nodeIds ?? []
    const index = nodeIDs.indexOf(snapshot.nodeId)
    if (index >= 0 && index < nodeIDs.length - 1) return { method: 'game.gotoNode', nodeId: nodeIDs[index + 1] }
    return variationChildNavigation(snapshot)
  }
  if (tryMode) {
    const variationChild = variationChildNavigation(snapshot)
    if (variationChild) return variationChild
  }
  return { method: 'game.goto', moveNumber: Math.min(snapshot.totalMoves, snapshot.moveNumber + 1) }
}

function lastNavigation(snapshot?: Snapshot, workspace?: StatePayload): NavigationCommand | undefined {
  if (!snapshot) return undefined
  if (snapshot.branchMode === 'variation' && workspace?.variation) {
    const nodeIDs = workspace.variation.timeline.nodeIds ?? []
    const lastNodeID = nodeIDs.at(-1)
    if (lastNodeID) return { method: 'game.gotoNode', nodeId: lastNodeID }
  }
  return { method: 'game.goto', moveNumber: snapshot.totalMoves }
}

function variationChildNavigation(snapshot: Snapshot): NavigationCommand | undefined {
  const child = snapshot.children.find((candidate) => candidate.nodeId.startsWith('var:'))
  if (!child) return undefined
  return { method: 'game.gotoNode', nodeId: child.nodeId }
}

function readOverlayState(): OverlayState {
  const raw = localStorage.getItem('jcgo.boardOverlays')
  if (!raw) return defaultOverlays
  try {
    return { ...defaultOverlays, ...JSON.parse(raw) }
  } catch {
    return defaultOverlays
  }
}
