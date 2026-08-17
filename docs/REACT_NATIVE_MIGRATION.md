# React Native Migration — Feasibility, Replacement Map & Load Model

> **STATUS: EVALUATION ONLY. NOT DECIDED, NOT STARTED.**
> No migration work has begun and none is scheduled. This document exists so that
> a future decision can be made from a real inventory instead of a guess.
> **Current recommendation: do not migrate.** See
> [§ Recommendation](#recommendation) for the reasoning and the conditions that
> would change it.

The trigger for writing this was perceived performance problems in the current
web build, plus a desire for native capabilities (orientation lock, store
distribution), plus the Night Market's scale targets. All three motives are
addressed below, because they point at *different* solutions — and two of the
three turn out not to require a migration at all.

---

## Table of contents

- [Check the premise first](#check-the-premise-first)
- [Fidelity policy: what must port exactly](#fidelity-policy-what-must-port-exactly)
- [What ports for free](#what-ports-for-free)
- [Replacement map](#replacement-map)
- [Error-proneness ratings](#error-proneness-ratings)
- [The Night Market finding](#the-night-market-finding)
- [Night Market load model (scale targets)](#night-market-load-model-scale-targets)
- [Terrain chunk baking](#terrain-chunk-baking)
- [Device floor](#device-floor)
- [Renderer choice: why Skia, and the alternatives](#renderer-choice-why-skia-and-the-alternatives)
- [The hanzi-writer port](#the-hanzi-writer-port)
- [Distribution: hosting, browsers and the App Store](#distribution-hosting-browsers-and-the-app-store)
- [Capacitor vs React Native: capability matrix](#capacitor-vs-react-native-capability-matrix)
- [The dropped-touch finding (Match Speed)](#the-dropped-touch-finding-match-speed)
- [Decision gates](#decision-gates)
- [The hybrid path](#the-hybrid-path)
- [Open items if we migrate](#open-items-if-we-migrate)
- [Action items if we do not migrate](#action-items-if-we-do-not-migrate)
  - [⏳ Waiting on a human](#-waiting-on-a-human-as-of-2026-08-13) — the short list of what is blocked on you
- [Recommendation](#recommendation)
- [Superseded claims](#superseded-claims)
- [Dependencies (docs ↔ code)](#dependencies-docs--code)

---

## Check the premise first

**A rewrite fixes platform-level performance problems. It carries application-level
ones across unchanged.** Before spending months, establish which kind you have.

The evidence available at the time of writing points at application-level:

| Signal | What it suggests |
|---|---|
| ~~The production build emits a **2,224 kB main chunk**~~ — of **37 routes**, only the **6 games** were lazy; the other 31 pages were statically imported | A large parse-and-execute cost on **every cold start**. ✅ **FIXED 2026-08-13** — all 37 routes are now `React.lazy`; entry chunk **2,229 kB → 436 kB**. See [§ Tier 1 measured result](#measured-result-of-items-13-2026-08-13) |
| ~~**`src/main.tsx` statically imports `pixi.js/unsafe-eval`**~~ — unconditionally, in the entry module, before React | This pinned the PIXI runtime into the main chunk for every user including those who never open Night Market, and **defeated lazy-loading of the viewer components downstream** — while `src/routes/registry.ts`'s own header comment said the registry/routeMeta split existed specifically to keep PIXI out of consumers' module graphs. ✅ **FIXED 2026-08-13** — moved to `src/features/nightmarket/pixiRuntime.ts`; PIXI is verifiably absent from the entry chunk |
| Three distinct stalls found in Speed Reading were: a glyph fetch firing at the round change, a CSS transition running in both directions, and an effect that should have read a cache during render | All three are **writable in React Native too**. None is a platform limitation. See [SPEED_READING_GAME.md](./SPEED_READING_GAME.md) § Answer feedback |
| `PedestrianLayer` re-renders **one React element per pedestrian per frame** (see its own header comment, `PedestrianLayer.tsx`) | At the 1,000-pedestrian target this is 60,000 reconciliations/sec. **Fails on every platform.** See [§ Night Market load model](#night-market-load-model-scale-targets) |

**One signal points the other way.** The Match Speed dropped-touch investigation
(2026-08-08) produced the first candidate *platform*-level defect in this
codebase: on iOS, a simultaneous second finger is sometimes never delivered to
the page at all. It is not yet confirmed as platform-level — one control
experiment settles it and has not been run. Read
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
of the web app. **MUI specifically carries no parity obligation** — it may be
replaced with anything suitable, and the replacement is not required to expose an
MUI-shaped API.

| Tier | Applies to | Rule |
|---|---|---|
| **Exact** | Game rules, scoring, mastery/mark logic, the segmentation and sense-resolution algorithms, API contracts, DB semantics | Behaviour must be identical. These are correctness, not presentation |
| **Close** | Information architecture, navigation structure, what each screen shows and in what order, colour and type *tokens* | Same structure and vocabulary; implementation may differ |
| **Approximate** | Exact spacing, shadows, border radii, transition curves, page-slide choreography, micro-animations | Re-author natively. **Do not** attempt to reproduce CSS behaviour in Reanimated 1:1 |

The Leaf/Node slide archetypes ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md))
are explicitly in the **Approximate** tier: a native stack navigator's default
transitions are an acceptable — likely better — substitute for `usePageSlide`'s
hand-rolled clone-and-slide.

---

## What ports for free

Roughly **half the repo by file count is presentation-independent** and moves
with no changes or trivial ones:

- **`src/engine/market/` — 25 files, zero external imports.** See
  [§ The Night Market finding](#the-night-market-finding).
- **The entire server.** Controllers, services, DAL, migrations, contracts. An RN
  client speaks the same HTTP API.
- **`src/api/http.ts` and the API layer.** `fetch` exists in RN.
- **Pure utilities** — `src/utils/` (definition resolution, mastery compute, tone
  colours, text utils), game logic like `src/games/speed-reading/buildRound.ts`.
- **Type contracts** — `src/types.ts`, `server/contracts/wire.ts`.
- **The whole test suite.** All **39** test files are DOM-free — none imports
  `@testing-library`, `jsdom`, or touches `document`. Vitest → Jest is a config
  change, not a rewrite.
- **Forms.** `react-hook-form` + `@hookform/resolvers` + `zod` are
  platform-agnostic; only `Controller` usage changes.

---

## Replacement map

Ordered by cost. **Fidelity** column refers to the tiers above.

| Piece today | Where | RN replacement | Cost | Fidelity |
|---|---|---|---|---|
| **MUI** (`Box`, `Typography`, `ButtonBase`, `styled`, `sx`) + `@emotion/*` | **149 files** import `@mui/material` | **NativeWind** or **Tamagui**, over the existing `src/theme/` tokens. No parity constraint — author fresh | **Highest — the bulk of the project** | Approximate |
| **PIXI rendering layers** | 9 files in `src/features/nightmarket/` import `pixi.js` | `@shopify/react-native-skia`. See [§ Renderer choice](#renderer-choice-why-skia-and-the-alternatives) | **High risk, low volume** | Close |
| **CSS animation** (`keyframes`, transitions) + `@react-spring/web` | 13 files use `keyframes`; plus `usePageSlide` | Reanimated 3 | Moderate — **reduced by the Approximate tier** | Approximate |
| **`@use-gesture/react`** | ~10 files | `react-native-gesture-handler` | Moderate | Approximate |
| **`localStorage`** (auth tokens) | 17 files | `expo-secure-store` (tokens) + `AsyncStorage` (rest) | Low volume, **but sync → async** | Exact |
| **TTS + time-stretch** | `src/services/tts/` (`CloudTTSProvider`, `WebSpeechProvider`, `timeStretch` via `soundtouchjs`) | Cloud provider survives (it's a fetch). `WebSpeechProvider` → `expo-speech`. **`timeStretch` → `expo-audio`'s `setRate(rate, shouldCorrectPitch: true)`** — native pitch-corrected stretching | Low–Moderate | Close |
| **react-router-dom** (v7) | `src/App.tsx` + `src/routes/{registry,routeMeta}.ts`, 37 routes | React Navigation, native stack. The registry/meta split ports almost directly | Moderate — **likely an upgrade** | Approximate |
| **hanzi-writer** (animated stroke guide) | `src/components/handwriting/{HanziGuide,loadCharData}.{tsx,ts}` | **~150 lines** of `react-native-svg` + Reanimated. See [§ The hanzi-writer port](#the-hanzi-writer-port) | **Low** | Close |
| **`hanzi-writer-data`** | same | Same package (plain JSON) | Low, but **47 MB / 9,575 chars** — bundle the discoverable subset, fetch the tail | Exact |
| **WebAudio game sounds** | `src/games/runtime/gameSounds.ts` | `expo-audio` with real audio files | Low, but **undoes the synthesized-blip design**: you ship audio files and take back the first-play latency the current design avoids | Close |
| **`react-markdown`** | Reader | `react-native-markdown-display` | Low | Close |
| **`GlyphSvg`** (raw SVG `<path d>`) | `src/components/handwriting/GlyphSvg.tsx` | `react-native-svg` | **Low** — near-literal port; the y-flip transform and loader/cache logic already exist and are commented | Exact |
| **`ResizeObserver`** | 10 files | `onLayout` | Low — **simpler than the web version** | Exact |
| **`IntersectionObserver`** | 5 files | FlatList `viewabilityConfig` | Low | Exact |
| **Sideways stage** (the 90° rotation trick) | `src/games/runtime/useSidewaysStage.ts` | **Delete it.** `expo-screen-orientation` | Negative cost | — |
| **`useBlockZoom`, `useBlockEdgeSwipe`, app-wide `touch-action: none` / `user-select: none`** | `src/hooks/`, global CSS | **Delete them.** Nothing to suppress | Negative cost | — |
| **Client perf diagnostics** | `src/utils/perfDiagnostics.ts` | Event Timing is web-only — **redesign**, not port | Moderate | — |
| **Handwriting recognition** | Server-side Google proxy | Unchanged | None | Exact |
| **`vite`** | build | Metro (via Expo) | Low | — |
| **`vitest`** | 39 test files | Jest — config only, zero DOM tests | Low | Exact |
| **Puppeteer checks** | dev only | **Maestro** (simpler than Detox at this scale) | Moderate | — |
| — | new | `expo`, `react-native-safe-area-context`, `expo-image`, `expo-notifications`, `expo-haptics`, **EAS Build** (cloud macOS — there is no Mac on this project) + **EAS Update** (OTA) | — | — |

---

## Error-proneness ratings

**Error-proneness is not volume.** The governing question is *can the mistake be
seen?* An agent writing this migration cannot render pixels, feel gesture
latency, or run an iOS simulator (the dev machine is WSL2 Linux; iOS builds
require macOS or EAS cloud). The danger zone is therefore anything judged
visually or haptically — not anything merely large.

Scale: **0** = mechanical, **5** = will produce something confidently broken that
nobody notices quickly.

| Component | Files | Volume | Error-proneness | Why |
|---|---|---|---|---|
| `src/engine/market/` | 25 | — | **0** | Zero external imports. Copy it; tests prove it |
| Server, contracts, DAL | all | — | **0** | Untouched |
| Test suite | 39 | S | **1** | All DOM-free. Config change |
| `GlyphSvg` | 1 | S | **1** | Near-literal; coordinate flip already solved |
| Auth / token refresh / API layer | ~20 | M | **1** | Pure logic, `fetch` exists, well tested |
| Forms (RHF + zod) | ~8 | S | **1** | Platform-agnostic |
| `ResizeObserver` → `onLayout` | 10 | S | **1** | Simpler than the web version |
| Navigation (37 routes) | 3 | S | **2** | `routeMeta`/`registry` split already models it. Deep links + back behaviour are the traps |
| MUI → RN styling | **149** | **XL** | **1–2 each, ×149** | Mechanical and *visible* — errors are caught instantly. But RN defaults differ systematically (`flexDirection` defaults to `column`; no `display`, no `position: fixed`, no z-index-by-DOM-order, no text-style inheritance, percentage heights need explicit parent heights). Expect the same five mistakes repeated at scale |
| hanzi-writer animated guide | 2 | S | **2** | Algorithm fully specified below |
| Game sounds | 1 | S | **2** | Trivial mechanically; loses the zero-latency synth design |
| `localStorage` → async storage | 17 | M | **3** ⚠️ | Looks trivial, isn't. `localStorage` is **synchronous**; every RN storage API is **async**. Boot-time token reads that currently return inline now return promises. Ships silently, surfaces as a random logout |
| Reanimated port | 13+ | M | **3** | Worklet rules are real (`runOnJS`, no closures over mutable JS state). Rules are knowable; a dropped frame is not visible to an agent |
| `WritingCanvas` (stroke capture) | 1 | S | **3** | Straightforward with RNGH, but coordinate normalization must match `recognize.ts` and the Google proxy. Wrong normalization degrades recognition silently rather than crashing |
| TTS / `timeStretch` | ~6 | M | **3** | A design decision, not a port |
| Perf diagnostics | ~3 | S | **3** | Redesign against a different measurement model |
| Gesture handler (`@use-gesture` → RNGH) | ~10 | M | **4** | Feel is the spec, and feel is invisible to an agent. Simultaneous/exclusive gesture composition is genuinely subtle. Also the layer the dropped-touch bug lives in |
| **Night Market PIXI → Skia** | 9 | M | **5** 🔴 | Depth sorting, camera transforms, atlasing, isometric hit-testing, throughput — all judged by looking. Would render, and be subtly wrong (occlusion order, drift at zoom extremes, frame drops), undetectably |

**Consequence for sequencing:** exactly one component rates a 5 and it is 9 files.
If a migration happens, **Night Market goes last, behind a spike, with the
WebView escape hatch pre-agreed.** The 149-file MUI job is the time sink but the
safest work in the project.

---

## The Night Market finding

**`src/engine/market/` has zero external imports.** All 25 `.ts` files import only
each other — no React, no PIXI, no browser APIs. Verify before relying on it:

```bash
grep -rhn "^import .*from ['\"]" src/engine/market/*.ts | grep -v "from ['\"]\."
# expected: no output
```

This is the single most valuable structural fact in the codebase, and it pays out
**twice**:

1. **Migration insurance.** The simulation — isometric projection, street graph,
   tile graph, pedestrian agents, template stitching, terrain, camera fit/zoom —
   is a pure logic core that ports untouched. Only the 9
   `src/features/nightmarket/*.tsx` PIXI layers need replacing.
2. **Web Worker safety, today.** Because the engine touches no DOM and no
   renderer, the entire 1,000-agent simulation can be moved off the main thread
   **in the current web app, verbatim, with no engine refactoring.** This is what
   removes the main-thread-contention argument for React Native — see
   [§ Night Market load model](#night-market-load-model-scale-targets).

The discipline **should be preserved in new code regardless of whether the
migration ever happens.** Keeping renderer dependencies out of `src/engine/` is
good architecture on its own terms.

> ✅ **First leak observed, and closed (2026-08-13).**
> `src/engine/market/__tests__/pedestrianDepth.test.ts` did `await
> import('pixi.js')` — the first renderer dependency anywhere under `src/engine/`.
> It was **split, not weakened**: the pure depth-math assertions stay in the engine
> test, and the one block that exercises a real Pixi container (proving the
> `sortDirty` cost the rounding avoids — the point of which is that it does *not*
> trust a reading of the source) moved to
> `src/features/nightmarket/__tests__/pedestrianDepthPixi.test.ts`. Renderer
> verification belongs on the renderer side of the line.

See [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md) and
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).

---

## Night Market load model (scale targets)

### Targets (decided)

| Parameter | Value |
|---|---|
| Pedestrians | **1,000**, animated; most visible at max zoom-out |
| Stands | **500** |
| Templates placed | **~100**, typical template **24×24 cells** |
| Max zoom-out | Determined by market size — the **entire** market on screen |
| Frame rate | **30 fps acceptable** |
| Zoom | **Continuous** (not stepped) |
| Art direction | Moving **off pixel art** to larger assets |
| Animation | Stands, streets and vehicles **lightly animated**. Invisible animations may be paused |
| Dynamic lighting | **None.** Separate asset sets per time-of-day and season instead |
| Tappability | Enabled only **above a reasonable zoom threshold** |
| Scope | **Per user** (not a shared world) |
| Off-screen rendering | **Not required** |

### Derived world size

100 templates × 576 cells = **57,600 cells**, laid out ~10×10 → a **240×240 cell**
world. Projected isometric at 32×16 px/tile, that is a **7,680 × 3,840 px**
diamond at 1:1 — a **2:1 landscape** aspect.

### The zoom ladder (390×844 logical phone)

| Zoom | Tile px | Ped px | Cells on screen | Peds visible | Stands animating |
|---|---|---|---|---|---|
| 1.0× | 32 | 16×32 | ~1,300 | ~22 | ~11 |
| 0.5× | 16 | 8×16 | ~5,100 | ~89 | ~45 |
| **0.3×** | **10** | **5×10** | **~14,300** | **~248** | **~124** ← **peak cost** |
| 0.15× | 5 | 2.4×5 | ~57,000 | ~990 | pause |
| 0.11× (full extent, landscape) | 3.5 | 1.8×3.5 | 57,600 (all) | 1,000 | pause |

**Three conclusions follow.**

1. **The worst case is mid-zoom (~0.3×), not full zoom-out.** At 0.3× the scene is
   still legible enough that nothing can be paused: ~250 pedestrians + ~124
   animated stands ≈ **400 animated sprites**. From a single atlas that is a
   rounding error for any GPU of the last decade, in PIXI or Skia.
2. **Full zoom-out is the *easy* case** once LOD exists: one baked backdrop plus
   1,000 moving dots.
3. **Pedestrians are genuinely sub-pixel at full extent.** At 1.8 px they are
   dots, so no walk cycle is rendered there — which is exactly the agreed
   degradation.

### ✅ Zoom-out policy (decided 2026-08-13)

The market diamond is 2:1 landscape; a portrait phone is 1:2.2. Fitting 7,680 px
of width into 390 px yields **1.6 px tiles and sub-pixel pedestrians**. In
landscape it is 3.5 px.

**The decided rule:**

> **Max zoom-out is fit-to-market** — it scales with the market's size rather than
> being a fixed constant. Below a threshold expressed in **on-screen px per cell**,
> pedestrians are demoted to **dots** and stand animations pause.

This dissolves the portrait/landscape problem rather than answering it: portrait
and landscape are the *same* feature and differ only in **where they cross the dot
threshold** — portrait crosses it sooner. Neither needs a special case, and no
max-zoom-out cap is required.

**The threshold value is a tuning constant, not a design input.** The
[zoom ladder](#the-zoom-ladder-390844-logical-phone) puts it near **5 px/cell**
(≈0.15× on a 390 px phone), which is already where the walk cycle is unreadable
and pedestrians are ~2.4 px. Pick that provisionally and tune it by eye once the
LOD ladder is on screen.

**Consequence for the LOD design:** the ladder's breakpoints are stated in
projected on-screen px, so they are independent of both market size and source
asset resolution. See [§ Open items](#open-items-if-we-migrate).

### What actually has to change (platform-independent)

| Technique | Effect | Renderer-specific? |
|---|---|---|
| **Imperative render loop** — pre-allocated sprite pool updated in `useTick`, replacing one React element per pedestrian per frame | Removes the current hard ceiling. At 1,000 peds × 60 fps the present design costs 60,000 reconciliations/sec and fails everywhere | ❌ |
| **Chunk-baked terrain** (below) | ~100× fewer draws for static content | ❌ |
| **LOD ladder** — full sprite → static sprite → dot; pause invisible animations | Makes zoom-out tractable | ❌ |
| **Single texture atlas** | Already close: all pedestrian frames come from one `freeFarmTileset` | ❌ |
| **Amortized simulation** — movement at 30 Hz, `planPath` staggered so ~2% of agents replan per frame | 1,000 FSMs will not fit in a frame budget naively | ❌ |
| **Simulation in a Web Worker** — the engine is already pure | Removes main-thread contention **without** RN | ❌ |

**Every row is renderer- and platform-agnostic.** In the taxonomy of
[§ Check the premise first](#check-the-premise-first), the Night Market scale
target is an **application-level** problem. Migrating before fixing it would
reproduce the same wall in a new language.

### The one genuinely hard part

**1,000 pedestrian FSMs at 30 Hz** — pure CPU, independent of the renderer. At
33 ms/frame the simulation needs ~8 ms, i.e. **~8 µs per agent**: comfortable for
movement, tight if `planPath` runs. Fix by amortizing pathfinding and, if needed,
moving the whole simulation into a Web Worker — which the engine's zero-import
purity permits today with no refactoring.

---

## Terrain chunk baking

The question "how do you bake fixed blocks when terrain varies?" contains the
trap: **do not chunk by template.** Chunk by **screen space at a zoom level**, and
template heterogeneity stops mattering — each chunk rasterizes whatever cells
fall inside it.

This is the **slippy-map / quadtree** model (as used by web map tiles).

### Level ladder

| Level | px/cell | Whole market if fully baked |
|---|---|---|
| L0 | 1 | 480 × 240 px — 0.4 MB |
| L2 | 4 | 1,920 × 960 — 7 MB |
| L4 | 16 | 7,680 × 3,840 — 118 MB |
| L5 | 32 | full res — 472 MB ❌ |

**No level is ever fully baked.** Chunks are **256×256 px of projected space at
that level**, baked on demand and LRU-evicted:

- Visible chunks per screen: `(390/256) × (844/256)` ≈ **8**
- Two levels held during a zoom transition: **~16 chunks**
- **16 × 256 × 256 × 4 B = 4 MB resident — independent of market size**

### Continuous zoom

Pick the level where `cellPx(L) ≥ 32 × s`, draw scaled down with **bilinear**
filtering, cross-fade between levels to prevent popping.

✅ **The move away from pixel art is what makes this work.** Pixel art plus
continuous zoom plus nearest-neighbour filtering fights this technique at every
step; larger smooth assets are strictly better here.

### Cost and invalidation

- **Bake cost:** a 256×256 chunk at L4 covers ~256 cells → ~256 sprite draws into
  a render texture, ~1–2 ms. Bake 2–4 chunks/frame during pan and there is no
  hitch.
- **Terrain is immutable between layout edits.** Bake on layout change, never on
  camera change.
- **Invalidation:** placing a stand or changing a template version dirties only
  the chunks overlapping that template's bounds, at every level. A 24×24 template
  touches a handful. Season / time-of-day switches dirty everything — do it
  behind the existing transition.

> ✅ **Built 2026-08-13.** Everything in this section is implemented in
> `src/engine/market/chunkGrid.ts` (pure math, unit-tested) +
> `src/features/nightmarket/TerrainChunkLayer.tsx` (bake/LRU), behind the nmp
> `chunkedTerrain` debug toggle. **Two constraints emerged during implementation
> that this section did not anticipate**, both documented in
> [NIGHT_MARKET_TERRAIN_CHUNKING.md](./NIGHT_MARKET_TERRAIN_CHUNKING.md):
>
> 1. **Only GROUND can be baked.** Flattening collapses many cell depths into one
>    z, which is lossless only for art that could never sort in front of an entity.
>    Tall decor must stay live so a walker can pass behind it.
> 2. **Baking must be OFF at native zoom.** A raised dirt lip on a nearer cell
>    legitimately occludes a walker behind it, and one flat image cannot reproduce
>    that. Baking engages only below native scale, where the lip is sub-pixel —
>    which ties it to the same LOD-threshold reasoning as
>    [§ Zoom-out policy](#-zoom-out-policy-decided-2026-08-13).

### Static / live split

| Baked (static) | Live (per frame) |
|---|---|
| Terrain layers 1 & 2, streets, walkways, building bodies | 1,000 pedestrians, ~500 stand animations, vehicles |
| Redrawn only on layout or season change | Redrawn every frame; **~400 peak visible** |

---

## Device floor

**Typical 2026 floors:**

| Platform | Common | Comfortable |
|---|---|---|
| iOS | iPhone XR/XS (A12, 2018) | **iPhone 11 (A13, 2019), 4 GB** |
| Android | Android 11, 3 GB RAM | **Android 12+, 4 GB, Vulkan 1.1** |

**The floor that buys the most: 4 GB RAM.**

The failure mode at this scale is **memory**, not shader throughput. Baked chunks
are cheap (4 MB); the pressure is source atlases, and the art direction increases
them twice over — larger non-pixel-art assets (≈4× the texels of 32 px tiles) ×
multiple asset sets for seasons and times of day. A 2048×2048 RGBA atlas is 16 MB
and several will be resident.

On a 3 GB device — sharing memory with the OS and, under Capacitor, with a
separate WebView process that iOS terminates first under pressure — that is
exactly the class of device that dies. **3 GB → 4 GB roughly doubles the usable
texture budget and removes the whole jetsam failure mode**, at the cost of a small
and shrinking slice of the Android market.

Secondary and much cheaper: **Android 12+ / iOS 16+** for reliable Vulkan/Metal
and a modern WebView.

---

## Renderer choice: why Skia, and the alternatives

**Why `@shopify/react-native-skia` is the default pick:**

- Skia is the same 2D rasterizer as Chrome and Flutter; its drawing model (paths,
  images, transforms, blend modes, shaders) is the closest available match to
  PIXI's.
- Its API is *declarative* (`<Canvas><Group transform><Image/></Group></Canvas>`),
  so existing `@pixi/react` components map structurally.
- It can render from Reanimated shared values **on the UI thread**, so animation
  never crosses the bridge.
- It handles thousands of draw ops per frame.
- It has a web build (CanvasKit/WASM), so it survives a react-native-web target.

**Alternatives, with the case against each:**

| Alternative | For | Against |
|---|---|---|
| **Plain RN `<Image>`s** | An isometric market is positioned sprites with depth order; `zIndex` + absolute positioning needs no new tech, error-proneness ~2 | Falls apart above ~100–200 simultaneous views. **Ruled out** by the ~400-sprite peak plus 1,000 dots |
| **expo-gl + PIXI** | Reuses the 9 existing layers nearly as-is — by far the cheapest if it works | expo-gl's WebGL implementation is incomplete, PIXI v8 wants modern WebGL2, `expo-pixi` is abandoned. High chance of a dead end after real effort |
| **`react-native-webview`** | Zero rendering work; canvas ships verbatim | Re-imports the WebKit touch pipeline — the thing a migration would be escaping. Camera/tap bridging is fiddly. Keep as the escape hatch, not the plan |

**Status:** Skia is chosen by reasoning, not measurement. The
[load model](#night-market-load-model-scale-targets) now shows the peak animated
sprite count is only ~400 (+1,000 dots at full extent), which is comfortably
inside PIXI's envelope too — so **this choice only becomes live if a migration is
actually approved.**

---

## The hanzi-writer port

**Scope is far smaller than it appears.** `HanziGuide.tsx` is 98 lines and uses a
five-call slice of the library: `create({showCharacter:false, showOutline:false})`,
`showOutline({duration})`, `hideOutline({duration})`, `loopCharacterAnimation()`,
and `charDataLoader`. No quiz, no grading — deliberately, since recognition is
independent (`HanziGuide.tsx`). **You are porting five behaviours, not a
library.**

### The animation algorithm

Read from `node_modules/hanzi-writer/dist/index.esm.js`:

```
For each stroke:
  clipPath = <Path d={stroke.d}/>               // the stroke's filled outline
  animPath = polyline through stroke.medians,   // the skeleton, in writing order
             extended backwards by STROKE_WIDTH/2 at the start
             stroke="#FFF"  strokeWidth=200  fill="none"
             strokeLinecap="round"  strokeLinejoin="miter"
             clipPath={clipPath}
             strokeDasharray = "L,L"    where L = polylineLength + STROKE_WIDTH/2

  Animate:   strokeDashoffset = L * 0.999 * (1 - progress)      // 1 → 0
```

A fat white line is swept along the stroke's skeleton, clipped to the stroke's own
outline, so the stroke appears written in the correct direction. Constants:
`STROKE_WIDTH = 200`, the `0.999` factor, start-extension of `STROKE_WIDTH/2`.

**Data format** (`hanzi-writer-data/<char>.json`): `{ strokes: string[],
medians: [x,y][][], radStrokes }`. Coordinates are **y-up**, x ∈ [0,1024],
y ∈ [-124,900]; `GlyphSvg.tsx` already documents and applies the
`translate(0,900) scale(1,-1)` flip.

### Why it ports cleanly

`react-native-svg` supports `ClipPath`, `strokeDasharray`, `strokeDashoffset` and
`strokeLinecap`; Reanimated animates `strokeDashoffset` via
`createAnimatedComponent(Path)`.

**Critically: the one hard part is structurally absent.** On web this technique
needs `path.getTotalLength()`, which RN lacks — but medians are **polylines**, so
the length is a sum of segment distances.

### Steps

1. Port `GlyphSvg` to `react-native-svg` — near-literal; y-flip, loader, cache and
   CDN fallback already exist and are commented. *(~1 h)*
2. `medians[] → "M x y L x y…"` + summed length + `extendStart`. *(~30 lines, pure
   math, unit-testable)*
3. Per-stroke `<ClipPath>` + animated median path. *(~50 lines)*
4. Sequence with `delayBetweenStrokes: 250`, loop with `delayBetweenLoops: 1200`
   (Reanimated `withSequence`/`withDelay`).
5. Outline show/hide = 120 ms opacity animation over a stroked-outline layer.

**Total ≈ 150 lines, roughly a day, error-proneness 2.** Residual risks: the
y-flip must apply inside the clip path, and `react-native-svg`'s handling of
`clipPath` on an animated `Path` should be spiked on both platforms (~30 min).

See [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) and
[PRACTICE_WRITING.md](./PRACTICE_WRITING.md).

---

## Distribution: hosting, browsers and the App Store

**Publishing to the App Store is never mandatory.**

| Path | Browser access | iOS install | Store review |
|---|---|---|---|
| **Today (web app)** | ✅ Hosted on your server | Add to Home Screen (PWA) | None |
| **Capacitor** | ✅ **Same build, unchanged** | TestFlight / Ad Hoc / Store | Only for Store |
| **RN + react-native-web** | ✅ `expo export -p web` → static site you host | TestFlight / Ad Hoc / Store | Only for Store |
| **RN, native only** | ❌ | TestFlight / Ad Hoc / Store | Only for Store |

**iOS distribution without the App Store:**

- **TestFlight, internal testers** (≤100) — **no App Review**, live ~10–15 min
  after upload, builds expire every 90 days. The practical path for the developer
  and a few testers.
- **TestFlight, external testers** (≤10,000) — light Beta App Review on the first
  build of each version.
- **Ad Hoc** — 100 devices/year, manual UDID registration.
- All require the **Apple Developer Program, $99/year**.

**Android** needs no store at all — host the `.apk` and download it.

**Deploy velocity** is therefore less damaged than a naive reading suggests:
TestFlight internal has no review, and **EAS Update** ships JS-only changes
over-the-air in minutes. The instrument-deploy-observe-revert loop used for the
dropped-touch investigation would largely survive. Multi-day review applies to
**public releases** and to any change touching native code.

**Shipping web + phone from one codebase:**

| Approach | One codebase? | Assessment |
|---|---|---|
| **Capacitor** | ✅ Literally the same build | Zero divergence, zero recurring maintenance tax |
| **Expo + react-native-web** | ⚠️ One codebase, three targets | Real and widely used, but Skia-on-web is a 2–3 MB CanvasKit WASM payload, some libs are native-only, and three targets need debugging |
| **RN native + keep the web app** | ❌ Two codebases | Every feature built twice, forever. Avoid |

---

## Capacitor vs React Native: capability matrix

**Capacitor covers essentially the entire capability surface**, including several
things sometimes mistaken for gaps:

> push notifications (`@capacitor/push-notifications`, APNs/FCM) · local &
> scheduled notifications · camera · filesystem · key-value storage
> (`@capacitor/preferences`, native-backed and not subject to cache eviction) ·
> keychain/keystore secure storage · SQLite · orientation lock · **haptics** ·
> **status bar** · **share sheet** · **splash screen** · biometrics · geolocation ·
> in-app purchases · deep links · app-state events

One limitation worth knowing: **web push on iOS Safari** requires the PWA be
installed to the Home Screen (iOS 16.4+). Capacitor's *native* push has no such
constraint — that restriction only affects the pure-PWA path.

### Concrete product demands on a native shell

Capability arguments have historically been abstract here ("we *could* do push").
These are features that have actually been specified and that a shell would
materially improve. None is a blocker — each has a working web path — but they are
the ledger against which "ship Capacitor if native packaging is wanted" should be
re-read.

| Demand | From | Web path | What a Capacitor shell adds |
|---|---|---|---|
| **Coarse location** (a ~5 km geohash cell, for arena clustering) | [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 5.2 | `navigator.geolocation` at `enableHighAccuracy: false`, HTTPS-only, and on iOS effectively Safari-only | `@capacitor/geolocation` → CoreLocation: the real `NSLocationWhenInUseUsageDescription` **inside** the system prompt instead of a second dialog we render ourselves; explicit reduced-accuracy authorization (and `ACCESS_COARSE_LOCATION` on Android) rather than a hint; and a deep link to the app's Settings pane, so a denial is recoverable instead of permanent |
| **Notifications** ("your arena opens", "a friend challenged you", "your streak is at risk") | [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 13, [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) § 8 | none — web push on iOS needs a Home-Screen install (16.4+) | native push with no install precondition |
| **Time-critical "join now" invite** (a friend has opened a live Study Challenge room and is waiting) | [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 4 (Q21) | an in-app banner over the live WebSocket, reaching only a player who already has the app open. Live mode is **still fully playable without it** — the waiting room is a permanent rendezvous both players can enter from the challenge screen, so friends coordinate out of band | `@capacitor/push-notifications` → APNs/FCM, deep-linked into the waiting room, capped at one per day per (sender, target). Turns live mode from "arrange it by text first" into something **spontaneous** — a reach improvement, **not** a precondition |

The two notification rows are deliberately separate. The first is a **"come back
sometime"** class — it can be late, batched, or missed without breaking anything, and the
in-app badge already covers it. The second is a **self-expiring summons** worth nothing an
hour later, and its in-app fallback structurally cannot reach the player it is for.
Implementing the first does **not** cover the second.

Neither is a blocker, and the live-invite row is a **weaker** argument than it first looks:
the feature was designed so that a permanent waiting-room entrance carries it, precisely so
that no part of Study Challenge waits on a packaging decision.

The location entry is worth noting for *why* it is not a React Native argument:
**Capacitor supplies it in full.** It moves the packaging question, not the
framework question — consistent with the recommendation below.

### What React Native can do that Capacitor cannot

| Capability | Why Capacitor cannot | Matters here? |
|---|---|---|
| **Animation & gestures on the UI thread** | The WebView has one main thread; JS work blocks compositing | 🟡 **Was the biggest** — largely neutralized by running the pure engine in a Web Worker |
| **Direct native touch (`UITouch`)** | Ships the same WebKit touch pipeline; inherits the dropped-touch bug verbatim | 🔴 **Yes** — pending the control test |
| **App-level GPU/memory budget** | `WKWebView` is a separate process with a harder ceiling; iOS terminates it first under pressure | 🟡 Reduced — chunk baking caps resident textures at ~4 MB. Still relevant for source atlases on 3 GB devices |
| **Off-main-thread simulation** (worklets/JSI/native threads) | Web Workers cannot touch canvas; OffscreenCanvas on iOS is 16.4+ and patchy | 🟢 **Neutralized** — simulation is pure logic, so a plain Web Worker suffices |
| **Native UI rendering** (real `UIView`, recycling lists, native text) | Everything is DOM, always | 🟡 Modest — helps decks/collection lists |
| **Bytecode startup** (Hermes, no JS parse) | Always parses the JS bundle | 🟢 Code splitting mostly closes this |
| **Background execution** (background fetch/audio) | WebView is suspended | 🟢 Only if background features are wanted |
| **Native-only SDKs** | No web equivalent to bridge | 🟢 Nothing currently needed |

**Summary: Capacitor loses on *performance architecture*, not on *capability*.**
It provides ~95% of what the app can *do* and none of the threading/memory model.
The Night Market analysis above shows the threading and memory pressure is
addressable on the web, which leaves the touch pipeline as the only unresolved
platform-level gap.

---

## The dropped-touch finding (Match Speed)

**On iOS, a simultaneous two-finger press sometimes reaches the page as only one
finger.** The second contact produces *no DOM event of any kind* — no
`touchstart`, no `pointerdown`, no `gesturestart`, no `pointercancel`. This is the
first defect found in this codebase that may be genuinely platform-level.

### Symptom

In Match Speed the player presses one card with each thumb. One card selects; the
other never does, so the pair is never evaluated as a match attempt. To the player
it reads as "my second tap did nothing". Reported reproduction rate ≈20%; measured
≈12% (2 of 16 two-thumb presses in the instrumented run).

### What was measured

Instrumentation was added, deployed to prod, exercised across five real sessions,
and then **reverted**. To resurrect it, revert the revert; the originals are
commits `0c07f0a` (window-level tap census), `dc7bfec` (touch-layer probe), and
`41fd700`/`453ec2b`/`2dfbaaf` (on-screen live finger-count overlay).

Device: iPhone, iOS 26.6, Chrome (`CriOS/151`) — i.e. WebKit.

| Observation | Value |
|---|---|
| Two-thumb presses in the analyzed run | 16 |
| …both fingers concurrent (`touches: 2`) | 9 |
| …both fingers sequential (each `touches: 1`, 44–103 ms apart) | 5 |
| …**only one finger ever observed** | **2** |
| `touchstart` / `touchend` / `pointerdown` totals | 30 / 30 / 30 — perfectly balanced |
| Long tasks during the run | 0 |
| `presentation` (paint) p50 / max | 7 ms / 22 ms |
| `processing` (handler cost) p50 | ~0 ms |

A failing press logs exactly two lines:

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
- It is not a performance stall. Zero long tasks, sub-25 ms paints, ~0 ms handlers.
- It is not the pointer-event compatibility layer specifically: the touch layer,
  upstream, is equally blind to the missing finger.
- The absence of `gesturestart` on failing presses means WebKit never recognized a
  second contact at all — not gesture arbitration claiming the finger.

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
motives: a native app receives `UITouch` directly and has no WebKit touch pipeline
to lose contacts in. It would be a *correctness* argument rather than a speed one
— and correctness arguments do not dissolve under profiling the way the speed
arguments in this document have.

Two cautions before treating it as decisive:

- **It is one interaction on one screen.** Match Speed is the only surface where
  two-thumb input is natural. A targeted redesign of that interaction (accept
  sequential taps only, or make the second tap's role explicit) may close the
  user-visible problem entirely.
- **Capacitor does not help here.** It ships the same WebKit web view and inherits
  the bug unchanged. This is the one known issue where the hybrid path is *not* a
  cheaper substitute for RN.

---

## Decision gates

Do not start a migration until all three are true:

1. **Telemetry has been read** and shows rendering-bound or startup-bound cost,
   not JS-bound cost. (`server/scripts/analyze-client-perf.ts`.)
2. **The cheap wins have been taken and measured** — code splitting the 2.22 MB
   chunk, moving the PIXI shim out of `main.tsx`, and the Night Market rework in
   [§ Action items](#action-items-if-we-do-not-migrate) — and the problem persists.
3. **A native capability is actually required** that Capacitor cannot supply.
   Orientation lock, push, camera, storage and store distribution are all
   available through Capacitor without a rewrite; if that is the whole motive, RN
   is the wrong tool.

**Gate 3 has one known exception.** The
[dropped-touch finding](#the-dropped-touch-finding-match-speed) is a defect
Capacitor inherits. If confirmed as platform-level by its control test, it
satisfies gate 3 on its own — but run the control test first, since the same
evidence would otherwise point at a one-line CSS fix.

**Current status: 0 of 3 gates cleared.** Two of them are days of work.

---

## The hybrid path

Available and probably correct if native packaging is wanted soon:

1. **Capacitor now.** Wraps the existing Vite build with no rewrite. Yields native
   orientation lock (letting `useSidewaysStage` become a fallback rather than the
   mechanism), push, camera, secure storage, and store distribution.
2. **Measure per screen** against a frame budget.
3. **Port only the screens that miss it**, incrementally.

This lets measurement decide which screens justify a rewrite instead of paying for
all 355 source files up front. Note that **Capacitor inherits the current web
performance, including its problems** — so gate 2 still applies.

---

## Open items if we migrate

Unresolved questions that must be answered before or during a migration. None is
currently answered.

### Product

1. ~~**Is full-extent zoom-out a landscape-only feature, or does max zoom-out get
   capped?**~~ **ANSWERED 2026-08-13: neither.** Max zoom-out is **fit-to-market**
   (it scales with market size), and a fixed **on-screen px/cell threshold** demotes
   pedestrians to dots and pauses stand animations. Portrait and landscape differ
   only in where they cross that threshold. See
   [§ Zoom-out policy](#-zoom-out-policy-decided-2026-08-13). No longer blocks
   action 8.
2. **Does the RN target include tablets/desktop?** `MobileDemoFrame` has a desktop
   phone-card mode; RN would drop it.
3. **Do validators do their Reader-based validation on desktop?** If so, an
   RN-only build deletes that workflow. See
   [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md).
4. **Is the web app retired, kept via react-native-web, or maintained separately?**
   The third option is the worst outcome and must be ruled out explicitly.
4a. **Does the accumulating demand for native permissions (location, notifications)
   justify shipping a Capacitor shell *now*, ahead of any migration decision?**
   See [§ Concrete product demands on a native shell](#concrete-product-demands-on-a-native-shell).
   Both demands are Capacitor-satisfiable, so this is a **packaging** decision that
   can be taken independently of — and much sooner than — the RN question. It is
   the first item here that argues for doing something rather than measuring
   something.

### Technical

5. **Skia vs. PIXI-in-WebView for Night Market** — needs a spike. The only item
   with genuine unknown-unknowns. The [load model](#night-market-load-model-scale-targets)
   suggests the peak is only ~400 animated sprites, which weakens the case for
   Skia specifically.
6. **What pixel size are the new non-pixel-art tiles?** ⬇️ **Downgraded
   2026-08-13 — the art does not exist yet, and almost nothing waits on it.** Both
   the [chunk-baking level ladder](#terrain-chunk-baking) and the LOD ladder are
   expressed in **projected on-screen px per cell**, i.e. screen space — which is
   the whole reason chunks are cut by screen space rather than by template. Source
   asset resolution therefore does not enter either design. What the number *does*
   gate is narrower: the **texture-atlas memory budget** and the 3 GB vs 4 GB
   [device floor](#device-floor). Both are late decisions, and both need only an
   *intended* figure (64? 128?), not the actual art — action 10 can measure against
   a placeholder atlas cut at the intended size.
7. **Atlas strategy across seasons × times of day.** How many sets, loaded when,
   evicted how.
8. **`hanzi-writer-data` bundling.** 47 MB / 9,575 chars is too large to ship
   whole. Which subset is bundled (the discoverable set?) and what is the
   fetch-the-tail path.
9. **`react-native-svg` `clipPath`-on-animated-`Path` support**, both platforms —
   30-minute spike, blocks the hanzi-writer port.
10. **`localStorage` → async storage.** Every synchronous boot-time token read
    becomes a promise. Needs an explicit auth-bootstrap design, not a mechanical
    find-replace.
11. **Perf diagnostics replacement.** Event Timing is web-only; the telemetry that
    would be most wanted *during* a migration is destroyed by it.
12. **Offline/caching strategy.** Currently browser-cache-shaped; RN needs an
    explicit story.
13. **iOS build infrastructure.** No Mac on this project — EAS Build (cloud
    macOS) is required, plus the $99/yr Apple Developer Program.
14. **`MobileDemoFrame`'s fate** and what replaces it for dev.

### Process

15. **Feature freeze policy.** There are currently **8 open deploy runbooks**;
    several are not yet on prod. A migration means a freeze, by one person, for
    months. This is the largest single cost and needs an explicit decision.
16. **E2E replacement.** Puppeteer → Maestro, and who maintains it.

---

## Action items if we do not migrate

**All of these are required on every path, including a future migration.** None is
wasted work.

### Tier 1 — cheap wins (days), clears decision gate 2

| # | Action | Where | Status |
|---|---|---|---|
| 1 | **Move `import 'pixi.js/unsafe-eval'` out of the entry module** into the Night Market viewers, so PIXI actually code-splits | `src/features/nightmarket/pixiRuntime.ts` | ✅ **done 2026-08-13** |
| 2 | **Lazy-load the 31 eager page routes** via `React.lazy` | `src/routes/registry.ts` | ✅ **done 2026-08-13** |
| 3 | **Re-measure the main chunk** and cold-start after 1 & 2 | `dist/` | ✅ **done — see below** |
| 4 | **Read the perf telemetry** — clears gate 1 | `server/scripts/analyze-client-perf.ts`, [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md) | ⬜ blocked — see below |
| 4a | **Build a synthetic scale harness** — a ped-count knob, synthesized placements/stands, a ped counter in `nmpPerf` | `src/hooks/usePixiPedestrians.ts`, `src/features/nightmarket/{MarketEngineViewer,nmpPerf,NightMarketEnginePage}.ts(x)`, `src/utils/perfDiagnostics.ts` | 🟨 **ped load + measurement bridge done 2026-08-13; stands/templates NOT synthesized** — see below |

> ⚠️ **Item 4 is blocked on the telemetry existing.** The perf sink writes JSONL to
> the **prod host filesystem** (`~/vocabulary-app/server/logs/client-perf-*.jsonl`),
> not to a database table, and the pipeline may not be deployed to prod yet. The
> pull path is the **`/diagnostics-pull`** skill. **Check that prod actually
> has log files before planning around this item.**
>
> 📌 **After the perf pipeline is confirmed live on prod, run a LOAD TEST IN DEV.**
> Prod telemetry answers "what do real users experience"; it cannot answer "what
> happens at the scale target", because no real user has 1,000 pedestrians. Run
> item 4a's harness locally against the same instrumentation so the two data sets
> are directly comparable — same metrics, same analyzer, one synthetic and one
> real. Doing the dev load test *before* the prod pipeline is verified risks
> measuring against instrumentation that later changes shape.

#### Why item 4a exists (added 2026-08-13)

The current market is nowhere near the target, so **a measurement today would come
back green and prove nothing**:

| | Today | Target |
|---|---|---|
| Pedestrians | **8** — a hard constant (`usePixiPedestrians.ts`), not derived from occupants | 1,000 |
| Stands | **0** — `NIGHT_MARKET_UNLOCK_POOL` is an empty array (`nightMarketRegistry.ts`) | 500 |
| Templates placed | a handful of **16×16** boards (`DEFAULT_DIM = 16`), one hub at seed | ~100 × 24×24 |
| Animated per frame | the pedestrian ticker leaf only; terrain and houses are memoized | ~400 sprites |

That also means **items 5, 7 and 9 cannot be justified by evidence until 4a
exists** — they would be rewrites on the strength of an argument, which is the
exact failure mode this document was written to avoid. Correct order:
**harness → measure the failure → fix → re-measure**, so every fix lands with a
number attached.

#### What 4a actually built (2026-08-13), and what it did not

**Built — the pedestrian axis, end to end:**

| Piece | Where | Note |
|---|---|---|
| Load knob (`—/50/200/500/1k`) | `NightMarketEnginePage.tsx` `PED_LOAD_STEPS` | **DEV-only** (`import.meta.env.DEV`). Unlike the overlays beside it this control degrades the page on purpose; a user must not be able to stall their own device with it |
| Re-seed on count change | `usePixiPedestrians.ts` `seededCountRef` | The hook previously re-seeded only on graph identity, so every count change after the first would have been silently ignored |
| Population census | `MarketEngineViewer.tsx` | `nmpPerf.note('pedestrians', n)` + `nmpPerf.load('peds=N')` |
| **Measurement bridge** | `nmpPerf.ts` → `perfDiagnostics.reportFrameStats()` | New record kinds `frame` (window mean) and `frame-worst` (window max), labelled with the load |

The bridge is the part that makes the number worth having. The load-test note
below promises the synthetic and real data sets will be "directly comparable —
same metrics, same analyzer"; **they were not, and could not have been.** `nmpPerf`
reported to `console.info` every 2s and then cleared its counters, while
`analyze-client-perf.ts` reads JSONL — two sinks, two shapes, no shared field. A
harness whose output only lands in a console someone has to be watching does not
produce a measurement. Details: [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md)
§ Frame records.

**Not built, and why:**

| Gap | Reason |
|---|---|
| 500 synthesized **stands** | There is no stand art to synthesize. Both `NIGHT_MARKET_BASE_SET` and `NIGHT_MARKET_UNLOCK_POOL` (`nightMarketRegistry.ts`) are **empty arrays** — occupant slots currently draw placeholder houses. Faking 500 of those would measure the placeholder, not the stand |
| 100 synthesized **template placements** | Placements come from authored template masks stitched by `useMarketWorld`. Multiplying them means fabricating world data upstream of the renderer — a materially larger change than a knob, and one that risks measuring a world the stitcher would never produce |
| Unit test for the re-seed | The suite runs `environment: 'node'` with no `@testing-library/react`, so no hook can be rendered. Adding a jsdom setup for one assertion was out of scope; the knob is verified by using it |

**Consequence for item 10:** the pedestrian target is testable today; the stand
and template targets are not. Since item 5 names the per-pedestrian render as
"the current hard ceiling", the pedestrian axis is also the one most likely to
fail first — so this is the useful half, not merely the easy half.

#### Measured result of items 1–3 (2026-08-13)

Baseline built from `HEAD` (`ef86715`) in a detached worktree; "after" is the same
tree with items 1 and 2 applied.

| Entry chunk | Raw | gzip |
|---|---|---|
| Before | 2,229.21 kB | 738.58 kB |
| **After** | **435.93 kB** | **143.60 kB** |
| Change | **−80.4%** | **−80.6%** |

Vite's >500 kB warning no longer names the entry chunk. PIXI is verifiably absent
from it — the runtime now lands in a lazily-reached chunk (742 kB raw) pulled only
by the four viewer modules.

**What this does and does not establish.** It removes ~1.79 MB of parse-and-execute
from *every* cold start, which is the largest single startup cost in the
[premise table](#check-the-premise-first). It does **not** by itself clear gate 2 —
that needs item 4 (read the telemetry) and a real-device cold-start comparison, not
a bundle-size diff.

**Design notes on how it was done:**

- Laziness is **uniform across all 37 routes**, not a per-route opt-in. A
  hand-maintained "these stay eager" list is the same shape as the four-table sync
  bug `routeMeta.ts` was built to eliminate. Consequently `RouteMeta.lazy` was
  **removed** — it would now be always-true — and `src/App.tsx` wraps every route in
  `<Suspense>` unconditionally, so mounting a lazy component without a boundary is
  structurally impossible rather than merely remembered.
- **Known trade-off:** the entry route now costs one extra request after the main
  chunk (index → route chunk) instead of arriving inside it. If measurement shows
  that waterfall dominates on common landing routes, the fix is a
  `modulepreload` hint or a `manualChunks` grouping — **not** a return to static
  imports.
- The shim lives in its own module (`src/features/nightmarket/pixiRuntime.ts`)
  rather than being inlined into each viewer, so the "why this is not in main.tsx"
  reasoning has one home. Layers that only render PIXI *children* do not import it;
  they can only mount inside a viewer that already applied it.
- Pinned by a new test in `src/__tests__/routeRegistry.test.ts` that fails if any
  route's component is not a `React.lazy` wrapper — the regression is otherwise
  invisible, since adding a page with a plain `import` still works perfectly and
  just quietly moves it back into the main chunk.

### Tier 2 — the Night Market rework (weeks), required by the scale targets

| # | Action | Notes |
|---|---|---|
| 5 | **Replace the React-element-per-pedestrian-per-frame render with an imperative sprite pool** updated in `useTick` | `src/features/nightmarket/PedestrianLayer.tsx`. This is the current hard ceiling and bites long before 1,000 peds |
| 6 | **Move the simulation into a Web Worker** | The engine is already pure and import-free; this is plumbing, not refactoring |
| 7 | **Implement chunk-baked terrain** with the level ladder + LRU | ✅ **built 2026-08-13, OFF by default** behind the nmp `chunkedTerrain` debug toggle. Math is unit-tested; the visual result is not verifiable without a human. Full design + what to eyeball: [NIGHT_MARKET_TERRAIN_CHUNKING.md](./NIGHT_MARKET_TERRAIN_CHUNKING.md) |
| 8 | **Implement the LOD ladder** — full sprite → static sprite → dot; pause invisible animations | ✅ **Unblocked.** Max zoom-out is fit-to-market; a fixed on-screen px/cell threshold (start at ~5 px/cell, tune by eye) demotes peds to dots. See [§ Zoom-out policy](#-zoom-out-policy-decided-2026-08-13) |
| 9 | **Amortize pathfinding** — movement at 30 Hz, ~2% of agents replan per frame | `src/engine/market/pedestrianAgent.ts` |
| 10 | **Measure at 1,000 peds / 500 stands / 100 templates on a real phone** | This is the experiment that settles the migration question on the actual product requirement |

### Tier 3 — settle the open platform question

| # | Action | Notes |
|---|---|---|
| 11 | **Build and run the dropped-touch control test** | Dependency-free two-zone page; two-thumb ~20× each in Safari and Chrome. The only input that can change the *decision* rather than the *estimate* |
| 12 | **Act on its result** — one-line CSS fix, app-shell bisect, or escalate to gate 3 | See the outcome table above |

### Tier 4 — preserve migration optionality (ongoing, ~free)

| # | Action | Notes |
|---|---|---|
| 13 | **Keep `src/engine/` renderer-free** | ✅ **automated 2026-08-13** — `src/engine/__tests__/enginePurity.test.ts` replaces the manual grep and is stricter than it: it covers subdirectories and `__tests__`, catches dynamic `import()`/`require()`, and rejects relative paths that escape the engine (`../../features/…`). Verified against a planted leak, static and dynamic. Allowlist inside engine tests: `vitest`, `fs`, `path` — nothing else |
| 14 | ~~**Move `pedestrianDepth.test.ts` off `pixi.js`**~~ | ✅ **done 2026-08-13.** Split rather than weakened — the real-Pixi `sortDirty` block moved to `src/features/nightmarket/__tests__/pedestrianDepthPixi.test.ts`; the depth math stays in the engine test |
| 15 | **Keep `src/theme/` as the single token source** | Whatever replaces MUI reads from it |
| 16 | **Consider Capacitor** if native packaging, push or orientation lock is wanted | No rewrite; see [§ The hybrid path](#the-hybrid-path) |

### ⏳ Waiting on a human (as of 2026-08-13)

Everything below is blocked on an action only a person can take — a judgement, a
machine, or a pair of eyes. Nothing here is waiting on more code being written.
**Ordered by what unblocks the most.**

| # | What | Why it can't be automated | Unblocks |
|---|---|---|---|
| H1 | **Run Step 0 of [`/diagnostics-pull`](../.claude/commands/diagnostics-pull.md) on the prod box** — three `ls` commands | Needs prod shell access; there is no cross-machine SSH from dev | Item 4 (gate 1). Also tells us whether the pipeline is deployed at all — an empty pull and a healthy app produce identical analyzer output |
| H2 | **Eyeball the chunked terrain** — nmp debug column, the `ViewComfy` toggle | Chunk seams, level-transition popping and ped occlusion are judged by looking; the math is already unit-tested (23 tests) | Item 7 leaving "off by default". Checklist: [NIGHT_MARKET_TERRAIN_CHUNKING.md](./NIGHT_MARKET_TERRAIN_CHUNKING.md) § "What still needs a human" |
| H3 | **Run the dev load test** — nmp in dev with `localStorage.perfDiag = '1'`, cycle the ped-load button through every rung, then `analyze-client-perf.ts` | Someone has to sit at the machine and drive the knob | The first real number on the pedestrian ceiling → justifies (or refutes) items 5, 6, 9. **Do this after H1**, so both data sets share verified instrumentation |
| H4 | **A real phone** for item 10 | It is the target device; a laptop result answers a different question | Item 10, and with it the migration decision on the actual product requirement |
| H5 | **An intended tile pixel size** (open item 6) — a number, not the art | Product decision | Only the atlas memory budget and the 3 GB vs 4 GB device floor, both late. Item 10 measures against a placeholder atlas until then |
| H6 | ~~Tier 3 control test~~ | **Explicitly deprioritized by the user 2026-08-13.** Note that it remains the only experiment that can change the *decision* rather than the *estimate* — see [§ Decision gates](#decision-gates) | Gate 3 |

**Not blocked on anyone:** items 5, 6, 8 and 9 are buildable today. They are held
back deliberately by the ordering rule above (*harness → measure → fix →
re-measure*), not by a missing input — H3 is what releases them.

#### Answers still needed from the product side

**None currently block any action item.**

- ✅ Open item 1 (max zoom-out) — **answered 2026-08-13**, action 8 unblocked.
- ⏸️ Open item 6 (new tile pixel size) — see H5 above.

---

## Recommendation

**Do not migrate. Take the Tier 1 and Tier 2 actions, run the control test, and
ship Capacitor if native packaging is wanted.**

The reasoning, in order of weight:

1. **Every motive examined so far has dissolved under analysis except one.**
   Startup cost is `main.tsx` plus 31 eager routes. The Speed Reading stalls
   were application-level. The Night Market scale target is an architecture
   problem that reproduces identically in Skia. Capabilities are covered by
   Capacitor. What remains unresolved is the dropped-touch finding — **one
   interaction, on one screen, with its decisive experiment unrun.**

2. **The Night Market targets do not require React Native.** This was the most
   promising new argument and it did not survive the arithmetic. The peak load is
   ~400 animated sprites at mid-zoom, not the tens of thousands a naive reading
   suggests; chunk baking caps resident terrain textures at ~4 MB regardless of
   market size; and the 1,000-agent simulation can move off the main thread in a
   plain Web Worker because the engine has no external imports. Every required
   technique is renderer-agnostic.

3. **The largest cost is not in the replacement map.** It is that this is a
   single-developer project with 8 open runbooks, several not yet on prod. A
   migration is a months-long feature freeze. That cost dwarfs any of the
   individual line items and is the reason to demand that all three gates be
   cleared with evidence rather than argument.

4. **The work that is genuinely needed is needed either way.** Tier 1 and Tier 2
   ship value immediately on the web, are prerequisites for the Night Market's
   stated targets, and are exactly what a migration would have to do anyway. There
   is no scenario in which they are wasted.

5. **Optionality is cheap and already being maintained.** The engine's
   zero-import discipline means the migration's hardest structural work is
   permanently pre-paid. Deferring the decision costs almost nothing, while
   deciding early costs months.

**What would change this recommendation:**

- The **control test shows the plain zone dropping contacts** → platform-level
  correctness defect, gate 3 satisfied on its own, migration becomes the leading
  option.
- **Tier 2 completes and the target still misses on a real phone** — specifically
  if the WebView is terminated under memory pressure or the main thread contends
  despite the worker — → measured platform ceiling on a stated product
  requirement, and a strong argument.
- **A required capability appears that Capacitor cannot supply.** Nothing
  currently qualifies. The two newest demands — coarse **location** (Arena
  clustering) and **notifications** — are both squarely inside Capacitor's
  surface; they raise the value of *packaging*, not of *migrating*. See
  [§ Concrete product demands on a native shell](#concrete-product-demands-on-a-native-shell).

**Sequence:** Tier 1 → control test (Tier 3) → Tier 2 → re-evaluate. The control
test is placed early because it is minutes of effort and is the only step that can
change the answer rather than the estimate.

---

## Superseded claims

Earlier revisions of this document asserted the following. They are wrong and
should not be re-derived:

| Superseded claim | Correction |
|---|---|
| "~61 routes" | **37 routes.** 61 was `App.tsx`'s line count. The table lives in `src/routes/routeMeta.ts` |
| "15 Night Market PIXI layers" | **9 files** import `pixi.js` under `src/features/nightmarket/`; the directory has 20 files total |
| "hanzi-writer's animated guide is one of the three items that dominate the effort" | **~150 lines, ~1 day.** The algorithm is fully specified in [§ The hanzi-writer port](#the-hanzi-writer-port). Effort concentrates in **two** places, not three: the MUI restyle and the Night Market renderer |
| "`timeStretch` is WebAudio and has no RN equivalent" | **`expo-audio`'s `setRate(rate, shouldCorrectPitch: true)`** provides native pitch-corrected time-stretching. `react-native-audio-api` is the fallback for finer control |
| "Route splitting exists but is partial (e.g. `WordSearchPage` is its own chunk)" | Accurate in substance, but the mechanism is `GAME_REGISTRY`'s lazy game routes; **all 31 non-game pages are eager** |
| Deploy velocity "collapses" to multi-day cycles | Overstated for the debug loop. **TestFlight internal has no App Review** and **EAS Update** ships JS-only changes OTA in minutes. Multi-day review applies to public releases and native-code changes |
| The Night Market scale target is a strong argument for RN | **Withdrawn.** See [§ Night Market load model](#night-market-load-model-scale-targets) — the required techniques are all platform-agnostic |

---

## Dependencies (docs ↔ code)

| This doc's section | Code / docs it describes |
|---|---|
| Check the premise first | `src/main.tsx`, `src/features/nightmarket/pixiRuntime.ts`, `src/routes/registry.ts`, `src/routes/routeMeta.ts`, `src/App.tsx`, `src/__tests__/routeRegistry.test.ts`, [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § Every route is code-split, `server/scripts/analyze-client-perf.ts`, [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md), `vite.config.ts`, [SPEED_READING_GAME.md](./SPEED_READING_GAME.md) § Answer feedback |
| Fidelity policy | `src/theme/colors.ts`, `fonts.ts`, `scale.ts`; [designGuidelines.md](./designGuidelines.md); [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) |
| What ports for free | `src/engine/market/*.ts`, `src/api/http.ts`, `src/utils/`, `src/types.ts`, `server/contracts/wire.ts`, all `*.test.ts*` |
| Replacement map | `src/features/nightmarket/*.tsx`, `src/components/handwriting/*`, `src/services/tts/*`, `src/games/runtime/{gameSounds,useSidewaysStage}.ts`, `src/hooks/{usePageSlide,useBlockZoom,useBlockEdgeSwipe}.ts`, `src/App.tsx`, `package.json` |
| Error-proneness ratings | as Replacement map |
| The Night Market finding | `src/engine/market/` (all 25 files), `src/engine/__tests__/enginePurity.test.ts` (**enforces the rule**), `src/engine/market/__tests__/pedestrianDepth.test.ts`, [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § `src/engine/` imports nothing outside itself, [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md), [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) |
| Why item 4a exists / what it built | `src/hooks/usePixiPedestrians.ts` (`seededCountRef`), `src/features/nightmarket/{NightMarketEnginePage,MarketEngineViewer,nmpPerf}.ts(x)`, `src/utils/perfDiagnostics.ts` (`reportFrameStats`), `src/engine/market/nightMarketRegistry.ts` (the empty asset pools), [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md) § Frame records, [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md) § Load-testing it |
| Night Market load model | `src/features/nightmarket/PedestrianLayer.tsx`, `src/engine/market/{pedestrianAgent,isometric,templateStitch,tileRegistry,cameraZoom}.ts`, [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md), [PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md) |
| Terrain chunk baking | `src/features/nightmarket/{EditorTerrainLayer,TemplateTerrainLayer,GroundBackdropLayer}.tsx`, `src/engine/market/templateStitch.ts` |
| The hanzi-writer port | `src/components/handwriting/{HanziGuide,GlyphSvg,loadCharData}.{tsx,ts}`, `node_modules/hanzi-writer/dist/index.esm.js`, [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md), [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) |
| The dropped-touch finding | `src/games/match-speed/MatchSpeedBoard.tsx` (`handleTap`), `src/hooks/useBlockZoom.ts`, `src/utils/perfDiagnostics.ts` (`reportTap`), `server/scripts/analyze-client-perf.ts`, [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md), [CLIENT_PERF_DIAGNOSTICS.md](./CLIENT_PERF_DIAGNOSTICS.md), [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) |
| Capacitor vs RN / concrete demands | [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 5.2 (location), [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) § 8 + [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 7 (notifications) — none of these has code yet |
| The hybrid path | `src/components/MobileDemoFrame.tsx`, `src/games/runtime/useSidewaysStage.ts` |
| Open / action items | all of the above |

**The dropped-touch finding is as of 2026-08-08**; its instrumentation has been
reverted out of the tree, so the numbers there cannot be re-derived without
restoring the commits listed in that section.

**Counts in this document are as of 2026-08-12** (355 source files, 149 MUI
importers, 13 `keyframes` users, 9 Night Market PIXI importers, 25 engine files,
37 routes, 39 DOM-free test files) — **except the main chunk, which is 436 kB as
of 2026-08-13** after Tier 1 items 1–2 (it was 2,229 kB). Re-run the greps before
trusting them — they are the basis of every estimate here. The reproduction
commands are in [§ The Night Market finding](#the-night-market-finding) and:

```bash
grep -rl "@mui/material" src --include=*.tsx --include=*.ts | wc -l
grep -rl "pixi" src/features/nightmarket | wc -l
grep -c "path:" src/routes/routeMeta.ts
find src server -name "*.test.ts*" | wc -l
ls -la dist/assets/index-*.js
```
