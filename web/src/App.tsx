import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { TokenGate } from './components/TokenGate'
import { playCaptureSound, playStoneSound } from './board/stoneSound'
import { computeSideActionPlacement, type SideActionPlacement } from './layout/sideActionRail'
import { analysisForCurrent, analysisProgressForState, badMovesForState, chartPointsForState, playedPointLossForCurrent, trialMovesForState } from './state/selectors'

const defaultOverlays: OverlayState = { candidates: true, ownership: true, deadStones: true }
const jumpStep = 5

type NavigationCommand = { method: 'game.goto'; moveNumber: number } | { method: 'game.gotoNode'; nodeId: string }
type RememberedView = { gameId?: string; nodeId?: string }

const accessTokenKey = 'jcgo.accessToken'
const selectedGameKey = 'jcgo.selectedGameId'
const viewGameKey = 'jcgo.view.gameId'
const viewNodeKey = 'jcgo.view.nodeId'
const sharedSGFURL = '/shared-sgf/latest'
const shareTargetRedirectPath = '/?share-target=sgf'
const emptySideActionPlacement = computeSideActionPlacement({
  layoutWidth: 0,
  layoutHeight: 0,
  boardStageRight: 0,
  boardRight: 0,
  boardTop: 0,
  boardHeight: 0,
}, false)

type SharedSGFFile = { name: string; text: string }
type SharedSGFPayload = { files?: Array<{ name?: unknown; text?: unknown }> }

export default function App() {
  const [token, setToken] = useState(localStorage.getItem(accessTokenKey))
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
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const wasConnected = useRef(false)
  const currentViewRef = useRef<RememberedView>(readRememberedView())
  const handledShareTargetRef = useRef(false)
  const layoutRef = useRef<HTMLElement>(null)
  const boardStageRef = useRef<HTMLElement>(null)
  const boardFrameRef = useRef<HTMLDivElement>(null)
  const actionRailRef = useRef<HTMLElement>(null)
  const sideActionEnabledRef = useRef(false)
  const [sideActionPlacement, setSideActionPlacement] = useState<SideActionPlacement>(emptySideActionPlacement)
  const wsUrl = useMemo(() => websocketURL(), [])

  const applyWorkspaceState = (state: StatePayload) => {
    const analysis = analysisForCurrent(state)
    currentViewRef.current = rememberCurrentView(state)
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
    localStorage.removeItem(accessTokenKey)
    clearRememberedView()
    currentViewRef.current = {}
    wasConnected.current = false
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
    let cancelled = false
    let reconnectTimer: number | undefined
    const reconnect = () => {
      if (cancelled) return
      if (reconnectTimer !== undefined) return
      setClient(undefined)
      setError('连接已断开，正在重连...')
      reconnectTimer = window.setTimeout(() => setConnectionAttempt((attempt) => attempt + 1), 500)
    }
    setError(undefined)
    setClient(nextClient)
    nextClient.on('analysis.update', (params) => {
      const state = params as StatePayload
      if (shouldApplyAnalysisUpdate(state, currentViewRef.current)) applyWorkspaceState(state)
    })
    nextClient.onClose(() => {
      if (wasConnected.current) reconnect()
    })
    nextClient
      .connect(wsUrl, token)
      .then(async () => {
        if (cancelled) return
        wasConnected.current = true
        const state = await nextClient.call<StatePayload>('workspace.state')
        const restoredState = await restoreCurrentView(nextClient, state)
        if (!cancelled) applyWorkspaceState(restoredState)
      })
      .catch(() => {
        if (cancelled) return
        if (wasConnected.current) reconnect()
        else returnToTokenGate()
      })
    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      nextClient.close()
    }
  }, [token, wsUrl, connectionAttempt])

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

  const importFromUrl = async (url: string) => {
    if (!client) return
    await client.call('game.importSgf', { url })
    await refreshWorkspaceState()
    setActivePV(undefined)
    setTryMode(false)
    setShowImport(false)
    setGameListOpen(true)
  }

  useEffect(() => {
    if (!token || !client || handledShareTargetRef.current || !isShareTargetLaunch()) return
    handledShareTargetRef.current = true
    let cancelled = false
    const importSharedSGF = async () => {
      try {
        const response = await fetch(sharedSGFURL, { cache: 'no-store' })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return
        const payload = (await response.json()) as SharedSGFPayload
        await fetch(sharedSGFURL, { method: 'DELETE' }).catch(() => undefined)
        const files = (payload.files ?? []).filter(isSharedSGFFile)
        for (const file of files) {
          if (cancelled) return
          await client.call('game.importSgf', {
            displayName: displayNameFromFilename(file.name),
            originalFilename: file.name,
            sgfText: file.text,
          })
        }
        if (cancelled || files.length === 0) return
        const state = await client.call<StatePayload>('workspace.state')
        if (cancelled) return
        applyWorkspaceState(state)
        setActivePV(undefined)
        setTryMode(false)
        setShowImport(false)
        setGameListOpen(true)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'shared SGF import failed')
      } finally {
        if (!cancelled) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
      }
    }
    void importSharedSGF()
    return () => {
      cancelled = true
    }
  }, [client, token])

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

  useEffect(() => {
    const updatePlacement = () => {
      const layout = layoutRef.current
      const boardStage = boardStageRef.current
      const board = boardFrameRef.current?.querySelector<Element>('.go-board')
      if (!layout || !boardStage || !board) {
        sideActionEnabledRef.current = false
        setSideActionPlacement((current) => sideActionPlacementsEqual(current, emptySideActionPlacement) ? current : emptySideActionPlacement)
        return
      }

      const layoutRect = layout.getBoundingClientRect()
      const stageRect = boardStage.getBoundingClientRect()
      const boardRect = board.getBoundingClientRect()
      const next = computeSideActionPlacement({
        layoutWidth: layoutRect.width,
        layoutHeight: layoutRect.height,
        boardStageRight: stageRect.right - layoutRect.left,
        boardRight: boardRect.right - layoutRect.left,
        boardTop: boardRect.top - layoutRect.top,
        boardHeight: boardRect.height,
      }, sideActionEnabledRef.current)

      sideActionEnabledRef.current = next.enabled
      setSideActionPlacement((current) => sideActionPlacementsEqual(current, next) ? current : next)
    }

    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updatePlacement)
      const observed: Element[] = []
      for (const element of [layoutRef.current, boardStageRef.current, boardFrameRef.current, actionRailRef.current]) {
        if (element) observed.push(element)
      }
      const board = boardFrameRef.current?.querySelector<Element>('.go-board')
      if (board) observed.push(board)
      observed.forEach((element) => observer?.observe(element))
    }

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      observer?.disconnect()
    }
  }, [snapshot, token])

  if (!token) return <TokenGate onSubmit={setToken} />

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
    const prevMoveNumber = snapshot?.moveNumber ?? 0
    const params = command.method === 'game.goto'
      ? { gameId: selectedGameId, moveNumber: command.moveNumber }
      : { gameId: selectedGameId, nodeId: command.nodeId }
    const state = await client.call<StatePayload>(command.method, params)
    applyWorkspaceState(state)
    setActivePV(undefined)
    if (!keepTryMode) setTryMode(false)
    const newMoveNumber = state.snapshot?.moveNumber ?? 0
    if (newMoveNumber < prevMoveNumber) playCaptureSound()
    else playStoneSound()
  }

  const gotoMove = async (moveNumber: number) => runNavigation({ method: 'game.goto', moveNumber })
  const keepTrialNavigation = () => tryMode || snapshot?.branchMode === 'variation'
  const goFirst = () => runNavigation(firstNavigation(snapshot, workspace), keepTrialNavigation())
  const goPrevious = () => runNavigation(previousNavigation(snapshot, workspace), keepTrialNavigation())
  const goBackFive = () => runNavigation(jumpNavigation(snapshot, workspace, -jumpStep), keepTrialNavigation())
  const goNext = () => runNavigation(nextNavigation(snapshot, workspace, tryMode), keepTrialNavigation())
  const goForwardFive = () => runNavigation(jumpNavigation(snapshot, workspace, jumpStep), keepTrialNavigation())
  const goLast = () => runNavigation(lastNavigation(snapshot, workspace), keepTrialNavigation())

  const hasCaptures = (before: Snapshot | undefined, after: Snapshot | undefined): boolean => {
    if (!before?.captures || !after?.captures) return false
    return after.captures.B !== before.captures.B || after.captures.W !== before.captures.W
  }

  const playMove = async (move: string) => {
    if (!client || !selectedGameId) return
    const prevSnapshot = snapshot
    const state = await client.call<StatePayload>('game.play', { gameId: selectedGameId, move })
    applyWorkspaceState(state)
    setActivePV(undefined)
    if (hasCaptures(prevSnapshot, state.snapshot)) playCaptureSound()
    else playStoneSound()
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

  const layoutStyle = sideActionPlacement.enabled ? sideActionStyle(sideActionPlacement) : undefined

  return (
    <>
      <main ref={layoutRef} className={sideActionPlacement.enabled ? 'app-layout side-action-layout' : 'app-layout'} style={layoutStyle}>
      <GameSidebar
        games={games}
        listOpen={gameListOpen}
        selectedGameId={selectedGameId}
        analysisAvailable={analysisState !== 'unavailable'}
        analysisError={error}
        analysisState={analysisState}
        analysisProgress={analysisProgressForState(workspace)}
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
      <section ref={boardStageRef} className="board-stage">
        <div className="board-layout">
          <BoardInfo blackName={snapshot?.blackName} whiteName={snapshot?.whiteName} result={snapshot?.result} />
          <div ref={boardFrameRef} className="board-frame">
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
        </div>
        {error && <p className="app-error">{error}</p>}
      </section>
      <nav ref={actionRailRef} className="action-rail">
        <NavigationControls
          moveNumber={snapshot?.moveNumber ?? 0}
          totalMoves={snapshot?.totalMoves ?? 0}
          toPlay={snapshot?.toPlay}
          canBackToMain={snapshot?.canBackToMain ?? false}
          tryMode={tryMode}
          onFirst={() => void goFirst()}
          onPrevious={() => void goPrevious()}
          onBackFive={() => void goBackFive()}
          onNext={() => void goNext()}
          onForwardFive={() => void goForwardFive()}
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
      </main>
      {showImport && <ImportDialog onImport={importGame} onImportUrl={importFromUrl} onCancel={() => setShowImport(false)} />}
    </>
  )
}

type SideActionStyle = CSSProperties & {
  '--side-action-left': string
  '--side-action-top': string
  '--side-action-width': string
  '--side-action-row-height': string
}

function sideActionStyle(placement: SideActionPlacement): SideActionStyle {
  return {
    '--side-action-left': `${placement.left}px`,
    '--side-action-top': `${placement.top}px`,
    '--side-action-width': `${placement.width}px`,
    '--side-action-row-height': `${placement.rowHeight}px`,
  }
}

function sideActionPlacementsEqual(left: SideActionPlacement, right: SideActionPlacement) {
  return left.enabled === right.enabled
    && left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.rowHeight === right.rowHeight
}

function websocketURL() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function isShareTargetLaunch() {
  const current = new URLSearchParams(window.location.search)
  const expected = new URLSearchParams(new URL(shareTargetRedirectPath, window.location.href).search)
  return current.get('share-target') === expected.get('share-target')
}

function isSharedSGFFile(file: { name?: unknown; text?: unknown }): file is SharedSGFFile {
  return typeof file.name === 'string' && typeof file.text === 'string'
}

function displayNameFromFilename(name: string) {
  return name.replace(/\.sgf$/i, '').trim() || 'Shared SGF'
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

function jumpNavigation(snapshot: Snapshot | undefined, workspace: StatePayload | undefined, delta: number): NavigationCommand | undefined {
  if (!snapshot) return undefined
  if (snapshot.branchMode === 'variation' && workspace?.variation) {
    const nodeIDs = workspace.variation.timeline.nodeIds ?? []
    const index = nodeIDs.indexOf(snapshot.nodeId)
    if (index < 0) return undefined
    const targetIndex = index + delta
    if (targetIndex < 0) return { method: 'game.goto', moveNumber: workspace.variation.baseMoveNumber }
    const targetNodeID = nodeIDs[Math.min(nodeIDs.length - 1, targetIndex)]
    return targetNodeID ? { method: 'game.gotoNode', nodeId: targetNodeID } : undefined
  }
  return { method: 'game.goto', moveNumber: clamp(snapshot.moveNumber + delta, 0, snapshot.totalMoves) }
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

async function restoreCurrentView(client: RPCClient, state: StatePayload) {
  const remembered = readRememberedView()
  if (!remembered.gameId) return state
  if (!(state.games ?? []).some((game) => game.gameId === remembered.gameId)) {
    clearRememberedView()
    return state
  }

  const current = viewFromState(state)
  if (remembered.nodeId && (current.gameId !== remembered.gameId || current.nodeId !== remembered.nodeId)) {
    return restoreRememberedNode(client, remembered.gameId, remembered.nodeId)
  }
  if (current.gameId !== remembered.gameId) {
    return client.call<StatePayload>('game.select', { gameId: remembered.gameId })
  }
  return state
}

async function restoreRememberedNode(client: RPCClient, gameId: string, nodeId: string) {
  try {
    const moveNumber = mainlineMoveNumber(nodeId)
    if (moveNumber !== undefined) return client.call<StatePayload>('game.goto', { gameId, moveNumber })
    return client.call<StatePayload>('game.gotoNode', { gameId, nodeId })
  } catch {
    sessionStorage.removeItem(viewNodeKey)
    return client.call<StatePayload>('game.select', { gameId })
  }
}

function shouldApplyAnalysisUpdate(state: StatePayload, current: RememberedView) {
  if (!current.gameId) return true
  const update = viewFromState(state)
  if (update.gameId !== current.gameId) return false
  if (!current.nodeId) return true
  return update.nodeId === current.nodeId
}

function rememberCurrentView(state: StatePayload): RememberedView {
  const current = viewFromState(state)
  if (current.gameId) {
    localStorage.setItem(selectedGameKey, current.gameId)
    sessionStorage.setItem(viewGameKey, current.gameId)
    if (current.nodeId) sessionStorage.setItem(viewNodeKey, current.nodeId)
    else sessionStorage.removeItem(viewNodeKey)
    return current
  }

  const remembered = readRememberedView()
  if (remembered.gameId && !(state.games ?? []).some((game) => game.gameId === remembered.gameId)) {
    clearRememberedView()
    return {}
  }
  return remembered
}

function readRememberedView(): RememberedView {
  const sessionGameId = sessionStorage.getItem(viewGameKey) ?? undefined
  if (sessionGameId) {
    return {
      gameId: sessionGameId,
      nodeId: sessionStorage.getItem(viewNodeKey) ?? undefined,
    }
  }
  return { gameId: localStorage.getItem(selectedGameKey) ?? undefined }
}

function clearRememberedView() {
  localStorage.removeItem(selectedGameKey)
  sessionStorage.removeItem(viewGameKey)
  sessionStorage.removeItem(viewNodeKey)
}

function viewFromState(state: StatePayload): RememberedView {
  return {
    gameId: state.gameId ?? state.snapshot?.gameId,
    nodeId: state.currentNodeId ?? state.snapshot?.nodeId ?? state.current?.nodeId,
  }
}

function mainlineMoveNumber(nodeId: string) {
  const match = /^main:(\d+)$/.exec(nodeId)
  if (!match) return undefined
  return Number(match[1])
}
