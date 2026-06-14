import 'pixi.js/unsafe-eval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initPerfDiagnostics } from './utils/perfDiagnostics'

// Interaction-latency telemetry. The footer/decks tap-lag only reproduces in
// prod, so we instrument real users there. `localStorage.perfDiag = "1"` opts a
// dev/local session in for verifying the pipeline end-to-end.
if (import.meta.env.MODE === 'production' || localStorage.getItem('perfDiag') === '1') {
  initPerfDiagnostics()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
