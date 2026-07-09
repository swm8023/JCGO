import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Grid3X3, LogOut, RefreshCw, UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type {
  ImportResult,
  YuanluoboLoginPoll,
  YuanluoboPlayer,
  YuanluoboQRCode,
  YuanluoboRecord,
  YuanluoboRecordsResult,
  YuanluoboStatusResult,
} from '../api/types'

export interface YuanluoboImportAPI {
  status(): Promise<YuanluoboStatusResult>
  loginStart(): Promise<YuanluoboQRCode>
  loginPoll(key: string): Promise<YuanluoboLoginPoll>
  logout(): Promise<void>
  players(): Promise<YuanluoboPlayer[]>
  records(params: { playerId: string; gameMode: number; page: number }): Promise<YuanluoboRecordsResult>
  importRecord(sessionId: string): Promise<ImportResult>
}

interface YuanluoboImportDialogProps {
  api: YuanluoboImportAPI
  onBack(): void
  pickerKind?: YuanluoboPickerKind
  onOpenPicker(kind: YuanluoboPickerKind): void
  onClosePicker(): void
}

type LoginState = 'checking' | 'logged-out' | 'polling' | 'logged-in'
type YuanluoboRecordCategory = { title: string; gameMode: number }
export type YuanluoboPickerKind = 'player' | 'platform'
const defaultYuanluoboCategory: YuanluoboRecordCategory = { title: '元萝卜AI', gameMode: 1 }
const defaultYuanluoboGameMode = defaultYuanluoboCategory.gameMode

export function YuanluoboImportDialog({ api, onBack, pickerKind, onOpenPicker, onClosePicker }: YuanluoboImportDialogProps) {
  const [loginState, setLoginState] = useState<LoginState>('checking')
  const [qr, setQR] = useState<YuanluoboQRCode>()
  const [pollDesc, setPollDesc] = useState('未扫码')
  const [error, setError] = useState<string>()
  const pollTimer = useRef<number | undefined>(undefined)

  const pollLogin = async (key: string) => {
    try {
      const result = await api.loginPoll(key)
      setPollDesc(result.desc || qrStatusLabel(result.status))
      if (result.status === 2) {
        if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
        setLoginState('logged-in')
      }
      if (result.status === 3 && pollTimer.current !== undefined) {
        window.clearInterval(pollTimer.current)
      }
    } catch (reason) {
      if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
      setError(errorMessage(reason))
    }
  }

  const startLogin = async () => {
    if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
    setError(undefined)
    setPollDesc('未扫码')
    const nextQR = await api.loginStart()
    setQR(nextQR)
    setLoginState('polling')
    pollTimer.current = window.setInterval(() => {
      void pollLogin(nextQR.key)
    }, 3000)
    void pollLogin(nextQR.key)
  }

  useEffect(() => {
    let cancelled = false
    api.status()
      .then((status) => {
        if (cancelled) return
        if (status.loggedIn) {
          setLoginState('logged-in')
        } else {
          setLoginState('logged-out')
          void startLogin()
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason))
      })
    return () => {
      cancelled = true
      if (pollTimer.current !== undefined) window.clearInterval(pollTimer.current)
    }
  }, [])

  if (loginState === 'checking') {
    return (
      <section className="yuanluobo-panel yuanluobo-fullscreen-page yuanluobo-login-layout" role="region" aria-label="元萝卜登录">
        <p className="yuanluobo-muted">正在检查元萝卜登录...</p>
      </section>
    )
  }

  if (loginState !== 'logged-in') {
    return (
      <section className="yuanluobo-panel yuanluobo-fullscreen-page yuanluobo-login-layout" role="region" aria-label="元萝卜登录">
        <div className="yuanluobo-login-copy">
          <button className="yuanluobo-back-button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回
          </button>
          <div>
            <p className="yuanluobo-eyebrow">Account import</p>
            <h2>元萝卜账号</h2>
            <p>扫码后读取账号棋局，选择后导入到本地棋盘。</p>
          </div>
          <div className="yuanluobo-scan-status" aria-label="扫码状态">
            <span className="yuanluobo-status-dot" aria-hidden="true" />
            {pollDesc}
          </div>
        </div>

        <div className="yuanluobo-qr-card">
          {qr && (
            <QRCodeSVG
              className="yuanluobo-qr"
              value={qr.scanUrl}
              role="img"
              aria-label="元萝卜登录二维码"
              data-qr-value={qr.scanUrl}
              includeMargin
            />
          )}
          <p className="yuanluobo-muted">请使用元萝卜 App 扫码确认</p>
          <button className="yuanluobo-refresh-button" onClick={() => void startLogin()}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新二维码
          </button>
        </div>
        {error && <p className="import-error">{error}</p>}
      </section>
    )
  }

  return (
    <YuanluoboRecordBrowser
      api={api}
      onBack={onBack}
      pickerKind={pickerKind}
      onOpenPicker={onOpenPicker}
      onClosePicker={onClosePicker}
    />
  )
}

function YuanluoboRecordBrowser({ api, onBack, pickerKind, onOpenPicker, onClosePicker }: YuanluoboImportDialogProps) {
  const [players, setPlayers] = useState<YuanluoboPlayer[]>([])
  const [playerId, setPlayerId] = useState(() => readStorage('jcgo.yuanluobo.playerId') ?? '')
  const [categories, setCategories] = useState<YuanluoboRecordCategory[]>([defaultYuanluoboCategory])
  const [gameMode, setGameMode] = useState(() => {
    const stored = readStorage('jcgo.yuanluobo.gameMode')
    return stored ? Number(stored) : defaultYuanluoboGameMode
  })
  const [page, setPage] = useState(1)
  const [pageTotal, setPageTotal] = useState(0)
  const [total, setTotal] = useState(0)
  const [records, setRecords] = useState<YuanluoboRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const loadRecords = async (nextPlayerId: string, nextGameMode: number, nextPage: number) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.records({ playerId: nextPlayerId, gameMode: nextGameMode, page: nextPage })
      setCategories(result.categories.length > 0 ? result.categories : [defaultYuanluoboCategory])
      setRecords(result.records)
      setTotal(result.total)
      setPageTotal(result.pageTotal)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api.players()
      .then((nextPlayers) => {
        if (cancelled) return
        setPlayers(nextPlayers)
        const storedPlayerId = readStorage('jcgo.yuanluobo.playerId')
        const matched = storedPlayerId && nextPlayers.some((p) => p.playerId === storedPlayerId)
        setPlayerId(matched ? storedPlayerId : (nextPlayers[0]?.playerId ?? ''))
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!playerId) return
    void loadRecords(playerId, gameMode, page)
  }, [playerId, gameMode, page])

  const openPicker = (kind: YuanluoboPickerKind) => {
    onOpenPicker(kind)
  }

  const choosePlayer = (nextPlayerId: string) => {
    setPlayerId(nextPlayerId)
    setPage(1)
    writeStorage('jcgo.yuanluobo.playerId', nextPlayerId)
    onClosePicker()
  }

  const choosePlatform = (nextGameMode: number) => {
    setGameMode(nextGameMode)
    setPage(1)
    writeStorage('jcgo.yuanluobo.gameMode', String(nextGameMode))
    onClosePicker()
  }

  const chooseRecord = async (record: YuanluoboRecord) => {
    await api.importRecord(record.sessionId)
    await loadRecords(playerId, gameMode, page)
  }

  const selectedPlayer = players.find((player) => player.playerId === playerId)
  const selectedCategory = categories.find((category) => category.gameMode === gameMode) ?? defaultYuanluoboCategory

  return (
    <section className="yuanluobo-panel yuanluobo-fullscreen-page yuanluobo-browser" role="region" aria-label="元萝卜棋局浏览">
      <header className="yuanluobo-header">
        <button className="yuanluobo-back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回
        </button>
        <div className="yuanluobo-title-block">
          <p className="yuanluobo-eyebrow">Account games</p>
          <h2>元萝卜棋局</h2>
          <span>共 {total} 局</span>
        </div>
        <button className="yuanluobo-logout-button" onClick={() => void api.logout().then(onBack)}>
          <LogOut size={16} aria-hidden="true" />
          退出
        </button>
      </header>

      <div className="yuanluobo-filter-bar">
        <button
          className="yuanluobo-filter-trigger"
          type="button"
          aria-label={`棋手 ${selectedPlayer?.name ?? '未选择'}`}
          onClick={() => openPicker('player')}
        >
          <span className="yuanluobo-filter-icon" aria-hidden="true">
            <UserRound size={19} />
          </span>
          <span className="yuanluobo-filter-label">棋手</span>
          <span className="yuanluobo-filter-divider" aria-hidden="true" />
          <strong>{selectedPlayer?.name ?? '未选择'}</strong>
          <ChevronDown className="yuanluobo-filter-chevron" size={18} aria-hidden="true" />
        </button>
        <button
          className="yuanluobo-filter-trigger"
          type="button"
          aria-label={`平台 ${selectedCategory.title}`}
          onClick={() => openPicker('platform')}
        >
          <span className="yuanluobo-filter-icon" aria-hidden="true">
            <Grid3X3 size={19} />
          </span>
          <span className="yuanluobo-filter-label">平台</span>
          <span className="yuanluobo-filter-divider" aria-hidden="true" />
          <strong>{selectedCategory.title}</strong>
          <ChevronDown className="yuanluobo-filter-chevron" size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="yuanluobo-record-toolbar">
        <div>
          <strong>棋局记录</strong>
        </div>
      </div>

      <div className="yuanluobo-browser-body">
        {error && <p className="import-error">{error}</p>}
        {loading && <p className="yuanluobo-muted">加载中...</p>}

        {records.length === 0 && !loading ? (
          <p className="yuanluobo-empty">当前分类暂无棋局</p>
        ) : (
          <div className="yuanluobo-record-list">
            {records.map((record) => {
              const outcome = viewerOutcome(record, selectedPlayer?.name)
              return (
                <button
                  key={record.sessionId}
                  className="yuanluobo-record-row"
                  data-outcome={outcome}
                  onClick={() => void chooseRecord(record)}
                >
                  <span className="yuanluobo-record-main">
                    <span className="yuanluobo-record-title">
                      <span className="yuanluobo-player-name">
                        <span className="yuanluobo-stone black" aria-hidden="true" />
                        {record.blackPlayerName}
                      </span>
                      <span className="yuanluobo-vs">vs</span>
                      <span className="yuanluobo-player-name">
                        <span className="yuanluobo-stone white" aria-hidden="true" />
                        {record.whitePlayerName}
                      </span>
                    </span>
                    {record.imported && <span className="yuanluobo-imported-badge">已导入</span>}
                  </span>
                  <span className="yuanluobo-record-meta">
                    {record.startDate}
                    <span className="yuanluobo-meta-sep" aria-hidden="true" />
                    {record.totalRound}手
                    <span className="yuanluobo-meta-sep" aria-hidden="true" />
                    {record.resultLabel}
                  </span>
                  {outcome !== 'unknown' && (
                    <span className={`yuanluobo-result-watermark ${outcome}`} aria-hidden="true">
                      {outcomeLabel(outcome)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <footer className="yuanluobo-pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
        <span>{page} / {Math.max(pageTotal, 1)}</span>
        <button disabled={pageTotal > 0 && page >= pageTotal} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </footer>

      {pickerKind && (
        <div className="yuanluobo-picker-backdrop" onClick={onClosePicker}>
          <div
            className="yuanluobo-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={pickerKind === 'player' ? '选择棋手' : '选择平台'}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="yuanluobo-picker-handle" aria-hidden="true" />
            <header className="yuanluobo-picker-header">
              <span aria-hidden="true">◆</span>
              <h3>{pickerKind === 'player' ? '选择棋手' : '选择平台'}</h3>
              <span aria-hidden="true">◆</span>
            </header>
            <div className="yuanluobo-picker-options">
              {pickerKind === 'player' ? (
                players.length === 0 ? (
                  <p className="yuanluobo-picker-empty">暂无棋手</p>
                ) : (
                  players.map((player) => (
                    <button
                      key={player.playerId}
                      className="yuanluobo-picker-option"
                      type="button"
                      data-selected={player.playerId === playerId ? 'true' : undefined}
                      aria-current={player.playerId === playerId ? 'true' : undefined}
                      onClick={() => choosePlayer(player.playerId)}
                    >
                      <span className="yuanluobo-picker-mark" data-tone="person" aria-hidden="true">
                        {player.name.slice(0, 1) || '棋'}
                      </span>
                      <strong>{player.name}</strong>
                    </button>
                  ))
                )
              ) : categories.length === 0 ? (
                <p className="yuanluobo-picker-empty">暂无平台</p>
              ) : (
                categories.map((category) => (
                  <button
                    key={category.gameMode}
                    className="yuanluobo-picker-option"
                    type="button"
                    data-selected={category.gameMode === gameMode ? 'true' : undefined}
                    aria-current={category.gameMode === gameMode ? 'true' : undefined}
                    onClick={() => choosePlatform(category.gameMode)}
                  >
                    <span className="yuanluobo-picker-mark" data-tone={categoryTone(category.gameMode)} aria-hidden="true">
                      {categoryShortName(category)}
                    </span>
                    <strong>{category.title}</strong>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type ViewerOutcome = 'win' | 'loss' | 'draw' | 'unknown'

function viewerOutcome(record: YuanluoboRecord, playerName = ''): ViewerOutcome {
  if (record.resultWinner === 'draw') return 'draw'
  const selectedName = playerName.trim()
  if (!selectedName) return 'unknown'

  const isBlack = record.blackPlayerName.trim() === selectedName
  const isWhite = record.whitePlayerName.trim() === selectedName
  if (!isBlack && !isWhite) return 'unknown'

  if (record.resultWinner === 'B') return isBlack ? 'win' : 'loss'
  return isWhite ? 'win' : 'loss'
}

function outcomeLabel(outcome: ViewerOutcome) {
  if (outcome === 'win') return '胜'
  if (outcome === 'loss') return '负'
  if (outcome === 'draw') return '和'
  return ''
}

function categoryShortName(category: YuanluoboRecordCategory) {
  if (category.gameMode === 1) return '元'
  if (category.gameMode === 15) return '★'
  if (category.gameMode === 2) return '山'
  if (category.gameMode === 5) return '99'
  if (category.gameMode === 6) return '新'
  if (category.gameMode === 7 || category.gameMode === 14) return '少'
  if (category.gameMode === 8) return '弈'
  if (category.gameMode === 9) return '佳'
  if (category.gameMode === 4) return '五'
  if (category.gameMode === 3) return '友'
  if (category.gameMode === 13) return '狐'
  return category.title.slice(0, 1)
}

function categoryTone(gameMode: number) {
  if (gameMode === 1) return 'green'
  if (gameMode === 15 || gameMode === 3) return 'purple'
  if (gameMode === 2) return 'blue'
  if (gameMode === 5 || gameMode === 17) return 'red'
  if (gameMode === 6 || gameMode === 8) return 'teal'
  if (gameMode === 7 || gameMode === 14) return 'gold'
  if (gameMode === 9 || gameMode === 13) return 'orange'
  if (gameMode === 4) return 'brown'
  return 'gray'
}

function qrStatusLabel(status: number) {
  if (status === 1) return '扫码成功，请在手机上确认'
  if (status === 2) return '登录成功'
  if (status === 3) return '二维码已过期'
  return '未扫码'
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : '元萝卜请求失败'
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}
