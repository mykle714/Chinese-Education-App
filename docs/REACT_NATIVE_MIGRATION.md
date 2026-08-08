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
- [The dropped-touch finding (Match Speed)](#the-dropped-touch-finding-match-speed)
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

**One signal now points the other way.** Every row above is application-level. The
Match Speed dropped-touch investigation (2026-08-08) produced the first candidate
*platform*-level defect in this codebase: on iOS, a simultaneous second finger is
sometimes never delivered to the page at all. It is not yet confirmed as
platform-level — one control experiment settles it and has not been run. Read
[§ The dropped-touch finding](#the-dropped-touch-finding-match-speed) before
concluding that the premise still fails.

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

## The dropped-touch finding (Match Speed)

**On iOS, a simultaneous two-finger press sometimes reaches the page as only one
finger.** The second contact produces *no DOM event of any kind* — no
`touchstart`, no `pointerdown`, no `gesturestart`, no `pointercancel`. This is the
first defect found in this codebase that may be genuinely platform-level, which is
why it lives in this document rather than only in the game's own.

### Symptom

In Match Speed, the player presses one card with each thumb. One card selects; the
other never does, so the pair is never evaluated as a match attempt. To the player
it reads as "my second tap did nothing". Reported reproduction rate ≈20%; measured
≈12% (2 of 16 two-thumb presses in the instrumented run).

### What was measured

Instrumentation was added, deployed to prod, exercised across five real sessions,
and then **reverted** — the bug is understood well enough that leaving telemetry in
the app costs more than it returns. To resurrect it, revert the revert; the
originals are commits `0c07f0a` (window-level tap census), `dc7bfec` (touch-layer
probe: `touchstart`/`touchend`/`pointercancel`/`gesturestart` with touch counts),
and `41fd700`/`453ec2b`/`2dfbaaf` (on-screen live finger-count overlay).

Device: iPhone, iOS 26.6, Chrome (`CriOS/151`) — i.e. WebKit.

| Observation | Value |
|---|---|
| Two-thumb presses in the analyzed run | 16 |
| …both fingers concurrent (`touches: 2`) | 9 |
| …both fingers sequential (each `touches: 1`, 44–103ms apart) | 5 |
| …**only one finger ever observed** | **2** |
| `touchstart` / `touchend` / `pointerdown` totals | 30 / 30 / 30 — perfectly balanced |
| Long tasks during the run | 0 |
| `presentation` (paint) p50 / max | 7ms / 22ms |
| `processing` (handler cost) p50 | ~0ms |

A failing press logs exactly two lines and nothing else:

```
12.835  touchstart  touches=1 changed=1  div.match-speed__card[三sān]
12.890  touchend    touches=0 changed=1  div.match-speed__card[三sān]
```

against a healthy press's five:

```
17.277  touchstart     touches=1 changed=1  span.char-pinyin-display__character[下]
17.295  gesturestart
17.301  touchstart     touches=2 changed=1  div.match-speed__card[he]
17.309  touchend       touches=1 changed=1  span.char-pinyin-display__character[下]
17.3xx  touchend       touches=0 changed=1  div.match-speed__card[he]
```

### What this establishes — and what it does not

**Established:**

- The app is not at fault for *handling*. The census listened on `window` in the
  **capture phase**, which runs window→target before any element handler and
  cannot be suppressed by `stopPropagation`, `pointer-events: none`, or a guard
  clause. An event that existed would have been recorded.
- It is not a performance stall. Zero long tasks, sub-25ms paints, ~0ms handlers.
  Every tap that *did* arrive was handled correctly and fast.
- It is not the pointer-event compatibility layer specifically: the touch layer,
  which sits upstream, is equally blind to the missing finger.
- The absence of `gesturestart` on failing presses means WebKit never recognized a
  second contact at all — it is not gesture arbitration claiming the finger.

**Not established — and this is the gap that matters:**

> **The control experiment was never run.** Nothing proves the *browser* is at
> fault rather than *our page*. A bare static HTML page with no React, no MUI, and
> none of the app's CSS was designed for this and not built. Until it runs, "iOS
> drops the touch" and "something in our shell causes iOS to drop the touch" are
> both live, and they have wildly different price tags.

The intended test: serve a dependency-free page with two zones — one plain, one
carrying the same `touch-action: none` / `user-select: none` the game surfaces use
(see [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md)) — and two-thumb each ~20
times, in Safari as well as Chrome.

| Result | Conclusion |
|---|---|
| Plain zone also drops contacts | Platform-level. A real argument for RN |
| Plain zone clean, `touch-action: none` zone drops | **Our CSS.** A one-line fix, not a rewrite |
| Both clean | Something else in the app shell; bisect from there |

Suspects for the third case, in rough order: `useBlockZoom`'s `gesturestart`
cancellation (`src/hooks/useBlockZoom.ts`), `useBlockEdgeSwipe`, and the
`MobileDemoFrame` wrapper.

### Bearing on the migration decision

**If** the control test shows the platform at fault, this is the strongest
migration argument on file, and qualitatively different from the performance
motives in [§ Check the premise first](#check-the-premise-first): a native app
receives `UITouch` directly and has no WebKit touch pipeline to lose contacts in.
It would be a *correctness* argument rather than a speed one — and correctness
arguments do not dissolve under profiling the way speed arguments have here.

Two cautions before it is treated as decisive:

- **It is one interaction on one screen.** Match Speed is the only surface where
  two-thumb input is natural. A defect affecting one game does not by itself
  justify rewriting 348 source files; a targeted redesign of that interaction
  (e.g. accept sequential taps only, or make the second tap's role explicit) may
  close the user-visible problem entirely.
- **Capacitor does not help here.** It ships the same WebKit web view, so it
  inherits this bug unchanged — see [§ The hybrid path](#the-hybrid-path). This is
  the one known issue where the hybrid path is *not* a cheaper substitute for RN,
  which makes settling the control test worth doing before any packaging decision.

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

**Gate 3 has one known exception.** The
[dropped-touch finding](#the-dropped-touch-finding-match-speed) is a defect
Capacitor inherits, because Capacitor ships the same WebKit web view. If that
finding is confirmed as platform-level by its control test, it satisfies gate 3 on
its own — but run the control test first, since the same evidence would otherwise
point at a one-line CSS fix.

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
| The dropped-touch finding | `src/games/match-speed/MatchSpeedBoard.tsx` (`handleTap`), `src/hooks/useBlockZoom.ts`, `src/utils/perfDiagnostics.ts` (`reportTap`), `server/scripts/analyze-client-perf.ts`, [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md), [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md), [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) |
| The hybrid path | `src/components/MobileDemoFrame.tsx`, `src/games/runtime/useSidewaysStage.ts` |

**The dropped-touch finding is as of 2026-08-08**; its instrumentation has been
reverted out of the tree, so the numbers there cannot be re-derived without
restoring the commits listed in that section.

**Counts in this document are as of 2026-07-29** (348 source files, 140 MUI
importers, 13 `keyframes` users, 15 Night Market PIXI layers, 23 engine files,
2,168 kB main chunk). Re-run the greps before trusting them — they are the basis
of every estimate here.
