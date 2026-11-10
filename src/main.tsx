// NOTE: keep heavy renderer imports OUT of this entry module. A static
// `pixi.js/unsafe-eval` import here once pinned the whole PIXI runtime into the
// main chunk for every user (the Night Market that needed it was removed
// 2026-11-09). See docs/FRONTEND_LAYERING.md § "Every route is code-split".
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import { initPerfDiagnostics } from './utils/perfDiagnostics'
import { initErrorReporting } from './utils/errorReporting'
import { installKeycapPress } from './utils/keycapPressDelegate'

// Interaction-latency telemetry. Tap-lag on the footer and the landing page (the
// Deck Tower at `/`) reproduced only in PPE, so we instrument real users there. `localStorage.perfDiag = "1"` opts a
// dev/local session in for verifying the pipeline end-to-end.
if (import.meta.env.MODE === 'production' || localStorage.getItem('perfDiag') === '1') {
  initPerfDiagnostics()
}

// Client crash reporting (error boundary + global error/unhandledrejection
// listeners → POST /api/diagnostics/error). Always on: front-end crashes were
// previously invisible (no boundary, no reporting), so we capture them in every
// session rather than ppe-sampling like the perf telemetry above.
initErrorReporting()

// Every raised keycap's press (pointerdown → pressed, min held time) — keycapPressDelegate.ts.
installKeycapPress()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
