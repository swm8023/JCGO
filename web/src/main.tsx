import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { installViewportInteractionGuards } from './pwa/viewportInteraction'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
installViewportInteractionGuards()
