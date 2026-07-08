import { useEffect, useRef, useState } from 'react'
import type {
  ImportResult,
  YuanluoboLoginPoll,
  YuanluoboPlayer,
  YuanluoboQRCode,
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
  const pollTimer = useRef<number>()

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

  return <YuanluoboRecordBrowser onBack={onBack} />
}

function YuanluoboRecordBrowser({ onBack }: Pick<YuanluoboImportDialogProps, 'onBack'>) {
  return (
    <div className="yuanluobo-panel">
      <header className="yuanluobo-header">
        <button onClick={onBack}>返回</button>
        <strong>元萝卜棋局</strong>
      </header>
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
