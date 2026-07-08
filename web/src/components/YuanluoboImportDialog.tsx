import { useEffect, useRef, useState } from 'react'
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
  onOpenGame(gameId: string): void | Promise<void>
  onBack(): void
}

type LoginState = 'checking' | 'logged-out' | 'polling' | 'logged-in'

export function YuanluoboImportDialog({ api, onOpenGame, onBack }: YuanluoboImportDialogProps) {
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
    return <div className="yuanluobo-panel">正在检查元萝卜登录...</div>
  }

  if (loginState !== 'logged-in') {
    return (
      <div className="yuanluobo-panel">
        <header className="yuanluobo-header">
          <button onClick={onBack}>返回</button>
          <strong>元萝卜扫码登录</strong>
        </header>
        {qr && <img className="yuanluobo-qr" src={`data:image/jpeg;base64,${qr.image}`} alt="元萝卜登录二维码" />}
        <p className="yuanluobo-muted">请使用元萝卜 App 扫码确认</p>
        <p className="yuanluobo-muted">{pollDesc}</p>
        {error && <p className="import-error">{error}</p>}
        <button onClick={() => void startLogin()}>刷新二维码</button>
      </div>
    )
  }

  return <YuanluoboRecordBrowser api={api} onOpenGame={onOpenGame} onBack={onBack} />
}

function YuanluoboRecordBrowser({ api, onOpenGame, onBack }: YuanluoboImportDialogProps) {
  const [players, setPlayers] = useState<YuanluoboPlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [categories, setCategories] = useState<{ title: string; gameMode: number }[]>([])
  const [gameMode, setGameMode] = useState(0)
  const [page, setPage] = useState(1)
  const [pageTotal, setPageTotal] = useState(0)
  const [records, setRecords] = useState<YuanluoboRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const loadRecords = async (nextPlayerId: string, nextGameMode: number, nextPage: number) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await api.records({ playerId: nextPlayerId, gameMode: nextGameMode, page: nextPage })
      setCategories(result.categories)
      setRecords(result.records)
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
        setPlayerId(nextPlayers[0]?.playerId ?? '')
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

  const chooseRecord = async (record: YuanluoboRecord) => {
    if (record.imported && record.gameId) {
      await onOpenGame(record.gameId)
      return
    }
    const result = await api.importRecord(record.sessionId)
    await onOpenGame(result.game.gameId)
  }

  return (
    <div className="yuanluobo-panel">
      <header className="yuanluobo-header">
        <button onClick={onBack}>返回</button>
        <strong>元萝卜棋局</strong>
        <button onClick={() => void api.logout().then(onBack)}>退出</button>
      </header>

      <label className="yuanluobo-player-select">
        <span>棋手</span>
        <select value={playerId} onChange={(event) => { setPlayerId(event.target.value); setPage(1) }}>
          {players.map((player) => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}
        </select>
      </label>

      <div className="yuanluobo-tabs" role="tablist" aria-label="元萝卜分类">
        {categories.map((category) => (
          <button
            key={category.gameMode}
            role="tab"
            aria-selected={gameMode === category.gameMode}
            onClick={() => { setGameMode(category.gameMode); setPage(1) }}
          >
            {category.title}
          </button>
        ))}
      </div>

      {error && <p className="import-error">{error}</p>}
      {loading && <p className="yuanluobo-muted">加载中...</p>}

      <div className="yuanluobo-record-list">
        {records.map((record) => (
          <button key={record.sessionId} className="yuanluobo-record-row" onClick={() => void chooseRecord(record)}>
            <span className="yuanluobo-record-title">{record.blackPlayerName} vs {record.whitePlayerName}</span>
            <span className="yuanluobo-record-meta">{record.startDate} · {record.category} · {record.result}</span>
            {record.imported && <span className="yuanluobo-imported-badge">已导入</span>}
          </button>
        ))}
      </div>

      <footer className="yuanluobo-pager">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
        <span>{page} / {Math.max(pageTotal, 1)}</span>
        <button disabled={pageTotal > 0 && page >= pageTotal} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </footer>
    </div>
  )
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
