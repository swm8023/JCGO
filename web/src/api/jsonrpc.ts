export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
}

interface PendingCall {
  resolve(value: unknown): void
  reject(reason: unknown): void
}

type NotificationHandler = (params: unknown) => void
type CloseHandler = () => void

export function buildProtocols(token: string): string[] {
  return ['jcgo-jsonrpc', `token.${token}`]
}

export function makeRequest(id: string, method: string, params?: unknown): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params }
}

export class RPCClient {
  private ws?: WebSocket
  private seq = 0
  private pending = new Map<string, PendingCall>()
  private notifications = new Map<string, NotificationHandler[]>()
  private closeHandlers: CloseHandler[] = []
  private closedByClient = false

  connect(url: string, token: string): Promise<void> {
    this.closedByClient = false
    const ws = new WebSocket(url, buildProtocols(token))
    this.ws = ws
    ws.onmessage = (event) => this.handleMessage(event.data)
    return new Promise((resolve, reject) => {
      let settled = false
      const rejectOnce = (reason: Error) => {
        if (settled) return
        settled = true
        reject(reason)
      }
      ws.onopen = () => {
        settled = true
        resolve()
      }
      ws.onerror = () => rejectOnce(new Error('websocket connection failed'))
      ws.onclose = () => {
        const reason = new Error('websocket closed')
        this.rejectPending(reason)
        rejectOnce(reason)
        if (!this.closedByClient) {
          for (const handler of this.closeHandlers) handler()
        }
      }
    })
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('websocket is not connected'))
    }
    const id = String(++this.seq)
    const request = makeRequest(id, method, params)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        this.ws?.send(JSON.stringify(request))
      } catch (reason) {
        this.pending.delete(id)
        reject(reason)
      }
    })
  }

  on(method: string, handler: NotificationHandler) {
    const list = this.notifications.get(method) ?? []
    list.push(handler)
    this.notifications.set(method, list)
  }

  onClose(handler: CloseHandler) {
    this.closeHandlers.push(handler)
  }

  close() {
    this.closedByClient = true
    this.rejectPending(new Error('websocket closed'))
    this.ws?.close()
    this.ws = undefined
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw)
    if (message.method && !message.id) {
      for (const handler of this.notifications.get(String(message.method)) ?? []) handler(message.params)
      return
    }
    if (!message.id) return
    const pending = this.pending.get(String(message.id))
    if (!pending) return
    this.pending.delete(String(message.id))
    if (message.error) pending.reject(message.error)
    else pending.resolve(message.result)
  }

  private rejectPending(reason: Error) {
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
  }
}
