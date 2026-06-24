import { type FormEvent, useState } from 'react'

interface TokenGateProps {
  onSubmit(token: string): void
}

export function TokenGate({ onSubmit }: TokenGateProps) {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken') ?? '')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) return
    localStorage.setItem('jcgo.accessToken', trimmed)
    onSubmit(trimmed)
  }

  return (
    <main className="token-gate">
      <form onSubmit={submit} className="token-form">
        <h1>JCGO</h1>
        <label>
          Access token
          <input value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
        </label>
        <button type="submit">Connect</button>
      </form>
    </main>
  )
}
