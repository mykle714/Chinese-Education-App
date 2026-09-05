// NOTE: `pixi.js/unsafe-eval` deliberately does NOT live here. A static import in
// the entry module pinned the whole PIXI runtime into the main chunk for every
// user and defeated code-splitting of the Night Market viewers. It now lives in
// src/features/nightmarket/pixiRuntime.ts, imported by the four modules that
// actually construct a renderer.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
import { initPerfDiagnostics } from './utils/perfDiagnostics'
import { initErrorReporting } from './utils/errorReporting'
import { restoreCjkFontOverride } from './theme/cjkFontOverride'
import { restoreLabelFontOverride } from './pages/fontLab/labelFontOverride'

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

// Font lab (src/pages/fontLab/FontLabPage.tsx): re-apply a pinned typeface so a
// candidate can be judged on the real pages, not just the lab's specimens. One per lab
// mode — the Chinese face (`--cjk-font`) and the overline face (`--label-font`) are
// independent decisions. Dev-only, and each is a no-op unless that lab has set one.
if (import.meta.env.DEV) {
  restoreCjkFontOverride()
  restoreLabelFontOverride()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
