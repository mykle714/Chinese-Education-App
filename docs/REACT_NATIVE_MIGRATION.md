# React Native Migration — Feasibility & Replacement Map

> **STATUS: EVALUATION ONLY. NOT DECIDED, NOT STARTED.**
> No migration work has begun and none is scheduled. This document exists so that
> a future decision can be made from a real inventory instead of a guess. Nothing
> here is a commitment, and the recommendation at the time of writing is **do not
> migrate yet** — see [§ Check the premise first](#check-the-premise-first).

The trigger for writing this was perceived performance problems in the current
web build, plus a desire for native capabilities (orientation lock, store
distribution). Both motives are addressed below, because they point at
*different* solutions.

---

## Table of contents

- [Check the premise first](#check-the-premise-first)
- [Fidelity policy: what must port exactly](#fidelity-policy-what-must-port-exactly)
- [What ports for free](#what-ports-for-free)
- [Replacement map](#replacement-map)
- [Where the effort actually concentrates](#where-the-effort-actually-concentrates)
- [The Night Market finding](#the-night-market-finding)
- [Decision gates](#decision-gates)
- [The hybrid path](#the-hybrid-path)
- [Open questions](#open-questions)
- [Dependencies (docs ↔ code)](#dependencies-docs--code)

---

## Check the premise first

**A rewrite fixes platform-level performance problems. It carries application-level
ones across unchanged.** Before spending months, establish which kind you have.

The evidence available at the time of writing points at application-level:

| Signal | What it suggests |
|---|---|
| The production build emits a **2,168 kB main chunk (721 kB gzipped)**, with Vite warning about it. Route splitting exists but is partial (e.g. `WordSearchPage` is its own chunk) | A large parse-and-execute cost on **every cold start**. Fixable in days via `React.lazy` + `manualChunks`. RN would fix this too — at vastly higher cost |
| Three distinct stalls found in Speed Reading were: a glyph fetch firing at the round change, a CSS transition running in both directions, and an effect that should have read a cache during render | All three are **writable in React Native too**. None is a platform limitation. See [SPEED_READING_GAME.md](./SPEED_READING_GAME.md) § Answer feedback |
| PIXI (`WebGLRenderer`, `WebGPURenderer`, `RenderTargetSystem` chunks) ships to users who never open Night Market | Lazy-loading the market engine is a contained change |

**You already collect the data needed to settle this.** Real-user tap-latency
telemetry (Event Timing + long tasks) posts to `POST /api/diagnostics/perf` and is
analyzed by `server/scripts/analyze-client-perf.ts` — see
[CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md). Read it before
deciding. It distinguishes the three cases:

| Telemetry shows | Cause | Does RN fix it? |
|---|---|---|
| Long tasks / blocked main thread | JS work | ❌ Follows you across |
| Slow paint & rendering, fine JS | WebView rendering | ✅ Yes |
| Slow startup, fine steady-state | Bundle size | ✅ — but so does code splitting, far cheaper |

---

## Fidelity policy: what must port exactly

**Decided:** visual styling and animation do **not** need to port faithfully. An
RN build is allowed to look and move like a native app rather than a pixel copy
of the web app. This materially shrinks the two largest line items.

| Tier | Applies to | Rule |
|---|---|---|
| **Exact** | Game rules, scoring, mastery/mark logic, the segmentation and sense-resolution algorithms, API contracts, DB semantics | Behaviour must be identical. These are correctness, not presentation |
| **Close** | Information architecture, navigation structure, what each screen shows and in what order, colour and type *tokens* | Same structure and vocabulary; implementation may differ |
| **Approximate** | Exact spacing, shadows, border radii, transition curves, page-slide choreography, micro-animations | Re-author natively. **Do not** attempt to reproduce CSS behaviour in Reanimated 1:1 |

The Leaf/Node slide archetypes ([LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) are
explicitly in the **Approximate** tier: a native stack navigator's default
transitions are an acceptable — likely better — substitute for `usePageSlide`'s
hand-rolled clone-and-slide.

---

## What ports for free

Roughly **half the repo by file count is presentation-independent** and moves
with no changes or trivial ones:

- **`src/engine/market/` — 23 files, zero external imports.** See
  [§ The Night Market finding](#the-night-market-finding).
- **The entire server.** Controllers, services, DAL, migrations, contracts. An RN
  client speaks the same HTTP API.
- **`src/api/http.ts` and the API layer.** `fetch` exists in RN.
- **Pure utilities** — `src/utils/` (definition resolution, mastery compute, tone
  colours, text utils), game logic like `src/games/speed-reading/buildRound.ts`.
- **Type contracts** — `src/types.ts`, `server/contracts/wire.ts`.
- **Logic tests.** Vitest → Jest is mostly a config change for tests that touch no
  DOM (e.g. `src/__tests__/speedReadingBuildRound.test.ts`, the engine tests in
  `src/engine/market/__tests__/`).

---

## Replacement map

Ordered by cost. **Fidelity** column refers to the tiers above.

| Piece today | Where | RN replacement | Cost | Fidelity |
|---|---|---|---|---|
| **MUI** (`Box`, `Typography`, `ButtonBase`, `styled`, `sx`) | **140 files** import `@mui/material` | `StyleSheet` + a kit (Tamagui / gluestack / RN Paper) or hand-rolled primitives over the existing `src/theme/` tokens | **Highest — the bulk of the project** | Approximate |
| **PIXI rendering layers** | 15 files in `src/features/nightmarket/` | `react-native-skia` (best fit for 2D isometric), or `expo-gl` + PIXI, or embed the existing canvas in `react-native-webview` | **High risk, moderate volume** | Close |
| **CSS animation** (`keyframes`, transitions) | 13 files use `keyframes`; plus `usePageSlide` | Reanimated 3 | Moderate — **reduced by the Approximate tier** | Approximate |
| **hanzi-writer** (animated stroke guide) | `src/components/handwriting/HanziGuide.tsx`, `loadCharData.ts` | Data (stroke path strings) is portable; the library is DOM/SVG-bound. Redraw with `react-native-svg` + Reanimated | Moderate | Close |
| **TTS + time-stretch** | `src/services/tts/` (`CloudTTSProvider`, `WebSpeechProvider`, `timeStretch`) | Cloud provider survives (it's a fetch). `WebSpeechProvider` → `expo-speech`. **`timeStretch` is WebAudio and has no RN equivalent** — needs a native audio lib or server-side stretching | Moderate | Close |
| **react-router-dom** (v7) | `src/App.tsx` (~61 routes) | React Navigation, native stack | Moderate — **likely an upgrade** | Approximate |
| **WebAudio game sounds** | `src/games/runtime/gameSounds.ts` | `expo-av` / `react-native-sound` with real audio files | Low, but **undoes the synthesized-blip design**: you ship two `.mp3`s and take back the first-play latency the current design avoids | Close |
| **`GlyphSvg`** (raw SVG `<path d>`) | `src/components/handwriting/GlyphSvg.tsx` | `react-native-svg` | **Low** — near-literal port, you already render raw path strings | Exact |
| **`localStorage`** (auth tokens) | 16 files | `AsyncStorage`, or `expo-secure-store` for tokens | Low | Exact |
| **`ResizeObserver`** | `useSidewaysStage.ts`, `SpeedReadingPage.tsx` | `onLayout` | Low — **simpler than the web version** | Exact |
| **Sideways stage** (the 90° rotation trick) | `src/games/runtime/useSidewaysStage.ts` | **Delete it.** Native per-screen orientation lock | Negative cost | — |
| **Handwriting recognition** | Server-side Google proxy | Unchanged | None | Exact |
| **Puppeteer checks** | dev only | Detox or Maestro | Moderate | — |

---

## Where the effort actually concentrates

Three items dominate; everything else is mechanical.

1. **The MUI restyle (140 files).** Unavoidable and large, but the Approximate
   fidelity tier means it is *re-authoring*, not *reproducing*. Preserve
   `src/theme/` (`colors.ts`, `fonts.ts`, `scale.ts`) as the token source and the
   app stays visually coherent without matching the web pixel-for-pixel.
2. **PIXI → Skia (15 rendering files).** The genuine technical risk. Mitigated by
   the finding below, and by the WebView escape hatch if Skia proves awkward.
3. **hanzi-writer's animated guide.** Static glyph rendering is easy; the animated
   writing guide is real work. Note the drill's requirements in
   [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) before estimating.

---

## The Night Market finding

**`src/engine/market/` has zero external imports.** All 23 `.ts` files import only
each other — no React, no PIXI, no browser APIs. Verify before relying on it:

```bash
grep -rhn "^import .*from ['\"]" src/engine/market/*.ts | grep -v "from ['\"]\."
# expected: no output
```

This is the single most valuable structural fact for a migration. The Night
Market's simulation — isometric projection, street graph, tile graph, pedestrian
agents, template stitching, terrain, camera fit/zoom — is a **pure logic core that
ports untouched**. Only the 15 `src/features/nightmarket/*.tsx` PIXI layers
(which draw the engine's output) need replacing.

The same discipline is what makes the port tractable, and **it should be preserved
in new code regardless of whether the migration ever happens.** Keeping renderer
dependencies out of `src/engine/` is good architecture on its own terms; it also
happens to be migration insurance. See
[NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md) and
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).

---

## Decision gates

Do not start a migration until all three are true:

1. **Telemetry has been read** and shows rendering-bound or startup-bound cost,
   not JS-bound cost. (`server/scripts/analyze-client-perf.ts`.)
2. **The cheap wins have been taken and measured** — code splitting the 2.17 MB
   chunk, lazy-loading Night Market's PIXI engine — and the problem persists.
3. **A native capability is actually required** that Capacitor cannot supply.
   Orientation lock, push, camera and store distribution are all available through
   Capacitor without a rewrite; if that is the whole motive, RN is the wrong tool.

---

## The hybrid path

Available and probably correct if native packaging is wanted soon:

1. **Capacitor now.** Wraps the existing Vite build with no rewrite. Yields native
   orientation lock (letting `useSidewaysStage` become a fallback rather than the
   mechanism), push, camera, and store distribution.
2. **Measure per screen** against a frame budget.
3. **Port only the screens that miss it**, incrementally.

This lets measurement decide which screens justify a rewrite instead of paying for
all 348 source files up front. Note that **Capacitor inherits the current web
performance, including its problems** — the tap-latency issue would follow it in
unchanged, so gate 2 above still applies.

---

## Open questions

- **Does the RN target include tablets/desktop?** `MobileDemoFrame` has a desktop
  phone-card mode; RN would drop it, which may be fine or may lose a use case.
- **`timeStretch` replacement.** No RN WebAudio. Native lib vs. server-side
  stretching is unresolved and affects the TTS pipeline design.
- **Skia vs. WebView for Night Market.** Needs a spike before it can be estimated
  honestly; it is the only item here with genuine unknown-unknowns.
- **Offline/caching strategy.** Currently browser-cache-shaped; RN would need an
  explicit story.

---

## Dependencies (docs ↔ code)

| This doc's section | Code / docs it describes |
|---|---|
| Check the premise first | `server/scripts/analyze-client-perf.ts`, [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md), `vite.config.ts` (chunking), [SPEED_READING_GAME.md](./SPEED_READING_GAME.md) § Answer feedback |
| Fidelity policy | `src/theme/colors.ts`, `fonts.ts`, `scale.ts`; [designGuidelines.md](./designGuidelines.md); [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) |
| What ports for free | `src/engine/market/*.ts`, `src/api/http.ts`, `src/utils/`, `src/types.ts`, `server/contracts/wire.ts` |
| Replacement map | `src/features/nightmarket/*.tsx`, `src/components/handwriting/{GlyphSvg,HanziGuide,loadCharData}.{tsx,ts}`, `src/services/tts/*`, `src/games/runtime/{gameSounds,useSidewaysStage}.ts`, `src/hooks/usePageSlide.ts`, `src/App.tsx` |
| The Night Market finding | `src/engine/market/` (all 23 files), [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md), [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) |
| The hybrid path | `src/components/MobileDemoFrame.tsx`, `src/games/runtime/useSidewaysStage.ts` |

**Counts in this document are as of 2026-07-29** (348 source files, 140 MUI
importers, 13 `keyframes` users, 15 Night Market PIXI layers, 23 engine files,
2,168 kB main chunk). Re-run the greps before trusting them — they are the basis
of every estimate here.
