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

  connect(url: string, token: string): Promise<void> {
    this.ws = new WebSocket(url, buildProtocols(token))
    this.ws.onmessage = (event) => this.handleMessage(event.data)
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('websocket not initialized'))
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('websocket connection failed'))
    })
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    const id = String(++this.seq)
    const request = makeRequest(id, method, params)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.ws?.send(JSON.stringify(request))
    })
  }

  on(method: string, handler: NotificationHandler) {
    const list = this.notifications.get(method) ?? []
    list.push(handler)
    this.notifications.set(method, list)
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
}
