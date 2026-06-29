import 'pixi.js/unsafe-eval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import { initPerfDiagnostics } from './utils/perfDiagnostics'
import { initErrorReporting } from './utils/errorReporting'

// Interaction-latency telemetry. The footer/decks tap-lag only reproduces in
// prod, so we instrument real users there. `localStorage.perfDiag = "1"` opts a
// dev/local session in for verifying the pipeline end-to-end.
if (import.meta.env.MODE === 'production' || localStorage.getItem('perfDiag') === '1') {
  initPerfDiagnostics()
}

// Client crash reporting (error boundary + global error/unhandledrejection
// listeners → POST /api/diagnostics/error). Always on: front-end crashes were
// previously invisible (no boundary, no reporting), so we capture them in every
// session rather than prod-sampling like the perf telemetry above.
initErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
