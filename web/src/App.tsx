import { useState } from 'react'
import { TokenGate } from './components/TokenGate'

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('jcgo.accessToken'))

  if (!token) return <TokenGate onSubmit={setToken} />

  return (
    <main className="app-layout">
      <aside className="game-sidebar">
        <h1>JCGO</h1>
      </aside>
      <section className="board-stage">Workspace connected</section>
      <aside className="analysis-rail">Analysis</aside>
    </main>
  )
}
