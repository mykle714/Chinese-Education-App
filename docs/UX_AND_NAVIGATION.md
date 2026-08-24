# UX & Navigation

Umbrella reference for how users move through the app and how the mobile shell
behaves. This is the index for the navigation archetypes, the scrollable-page
layout, and the global touch/scroll/selection rules. Start here, then drill into the
specific doc.

## Sub-documents

| Concept | Doc | One-liner |
|---|---|---|
| **App navigation structure** | [NAVIGATION.md](./NAVIGATION.md) | No hamburger/sidebar; nav is the footer tabs (Flashcards / Discover / Home / Account) + the `/` Home menu + back-arrow drill-ins. Settings + Logout live on the Account page. |
| **Scrollable footer-tab layout** | [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) | Every scrollable footer-tab page uses `MobileTabScreen` (header scrolls away inside the scroll area; bottom nav is a flat full-width bar). Home, Decks, Discover, Games hub, Account use it. |
| **Drill-in page archetypes** | [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) | Two back-arrow archetypes. **Leaf** (`LeafPage`): down arrow, no footer, back-arrow-only exit, slides up/down. **Node** (`NodePage`): left arrow, keeps footer, slides in/out to the right. Rule of thumb: no footer ⇒ leaf, has footer ⇒ node. |
| **eip bottom-sheet gestures** | [EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) | `SheetPanel`'s height model: three stops (0 / default / max) with the default height as the floor, one snap rule, the resize-vs-scroll mode lock, and release momentum that stops at the default height instead of dismissing. |
| **Discover surface** | [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) | Two-level Discover surface: the `/discover` hub menu (footer tab) → `/discover/sort/:language` drag-to-sort page (back-arrow header, no footer). |

---

## Touch & Scroll (mobile)

This is a mobile-first app built around drag gestures. Components you create should
default to `touchAction: "none"` so background/empty-area touches don't trigger the
browser's native pan/scroll (which fights the drag interactions). Only set a
scroll-permitting value (`auto`, `pan-y`, etc.) on a component when explicitly told
it should be scrollable.

⚠️ **But a container that IS scrollable must scroll natively.** `touch-action: none`
on a scroller means something has to move it from JS, and a `scrollTop += dy` inside a
non-passive `touchmove` runs on the **main thread** — so the scroll advances only as
fast as the main thread finishes each frame, and any render/layout work in the content
becomes visible stutter. Use `pan-y` (+ `overscroll-behavior: contain`) and let the
compositor pan it; if a gesture handler must also claim some of those touches, have it
`preventDefault()` only the ones it actually takes, on the gesture's first (cancelable)
move. Learned from the decks sheet, 2026-08-24 — see
[EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) § "Only `resize` is driven by JS".

**The app shell is non-scrollable by default — scrolling is opt-in per page.**
`html`/`body` are pinned to the visible viewport with `overflow: hidden` (see
`src/index.css`), and `#root` is the only shell-level scroller (`100dvh`,
`overflow-y: auto`, in `src/App.css`) — it exists solely to reveal the desktop
phone card and never scrolls on mobile. A page that needs to scroll must provide
its **own inner scroll container**; nothing should make the whole page (header +
footer) scroll. For footer-tab hub pages this container is `MobileTabScreen`'s
`ScrollArea`. Never reintroduce `overflow-y: auto` / `min-height: 100vh` on
`html`/`body` — that lets the entire app scroll and drags the scroll-away header
and the footer bar with it.

Text is **non-selectable by default app-wide** — `src/index.css` sets `user-select:
none` on `body` (it cascades to everything). Form fields (`input`/`textarea`/
`contenteditable`) are re-enabled there. The **only** selectable content exception is
**cpcd** (`.cpcd-row__chars` / `.cpcd-row__pinyin-cell`), and only on non-touch
devices — the `@media (hover: hover) and (pointer: fine)` block in `index.css` makes
cpcd selectable on desktop but keeps it non-selectable on mobile. Don't sprinkle
per-component `userSelect: "none"`; rely on the global default and only opt specific
content into `userSelect: "text"` (desktop-gated) when called out.

### Pan/zoom surfaces

Two surfaces let the user move a camera over a world larger than the screen, and they
are built differently on purpose:

* **Night market** (`src/features/nightmarket/`) — Pixi, isometric, hundreds of sprites
  with per-frame animation. It needs a scene graph.
* **Memory Map** (`src/games/memory-map/MemoryMapWorld.tsx`) — plain DOM, one CSS
  `transform` on a world div, no rAF loop. It is capped at 100 absolutely-positioned
  word nodes (`MEMORY_MAP_CAPACITY`), which is what makes that safe: nothing to cull,
  no scene graph to justify. Its camera is stored as **the world coordinate at the
  centre of the viewport, plus a zoom** rather than as a pixel offset, so a run saved on
  one screen size resumes looking at the same place on another.

A future pan/zoom surface should follow whichever of these its content resembles — and
should not grow a *second* Pixi host if it needs one; borrow the night market's
(`pixiRuntime.ts`).

> ⚠️ **`@use-gesture` drag + pinch on touch — two traps, same symptom.** Both present as
> "panning is broken on mobile" (see MEMORY_MAP_GAME.md § 14.5):
>
> 1. Binding `drag` and `pinch` together requires `drag: { pointer: { touch: true } }`.
>    Otherwise the pointer-event stream is cancelled on touch devices once the browser
>    arbitrates between the two gestures, and the pan **works with a mouse and does
>    nothing on a phone**. A plain `useDrag` with nothing competing (SortCardsPage) does
>    not need it — it is the combination that breaks.
> 2. If you need `eventOptions: { passive: false }` (to preventDefault the browser's own
>    pinch-zoom), you **must** bind with the `target` option and must **not** spread
>    `bind()`. React's synthetic listeners are always passive, so asking for both yields
>    a half-bound gesture rather than an error — and because spread handlers are rebuilt
>    on every render, the gesture dies the first time the surface re-renders during play.
>
> Relatedly: on a surface where draggable content covers most of the screen, child
> elements with their own tap handlers must distinguish a tap from a pan themselves
> (a press-position + slop check), or every pan that begins on a child fires that
> child's tap (§ 14.6).

**Games must block the mobile edge-swipe-back gesture by default.** Every game page
should call `useBlockEdgeSwipe(true)` (`src/hooks/useBlockEdgeSwipe.ts`) so a swipe
from the left/right screen edge doesn't navigate away mid-drag. `touch-action: none`
does NOT stop this — the browser claims the history-navigation gesture before the
element sees the touch, so it must be cancelled at the touch-event layer. Reference
implementation: `src/games/bubble-match/BubbleMatchPage.tsx`.

---

## Referenced code

- `src/index.css` — shell `overflow: hidden`, global `user-select: none`, cpcd desktop-selectable exception
- `src/App.css` — `#root` shell scroller
- `src/hooks/useBlockEdgeSwipe.ts` — edge-swipe-back blocker
- `src/games/bubble-match/BubbleMatchPage.tsx` — edge-swipe reference implementation
- `MobileTabScreen`, `LeafPage`, `NodePage` components — see the sub-docs above

### Collection pages (Flashcards tab drill-ins)

Several **node** routes share one component, `CollectionViewPage`
([DECKS_FEATURE.md](./DECKS_FEATURE.md)):

| Path | Shows |
| --- | --- |
| `/flashcards/collection/learn-now` | The sorted Learn Now cards (moved off `/decks`) — `-reading` / `-writing` variants show the same idea for those bars |
| `/flashcards/collection/mastered` | The Mastered cards (replaces the old `/flashcards/mastered` page) — likewise `-reading` / `-writing` |
| `/flashcards/collection/all` | Every sorted card |
| `/flashcards/deck/:id` | One user-authored deck |

`/flashcards/mastered` still exists as a **redirect** to the second of these, so
older links keep working.

Two more Flashcards-tab node pages sit beside them — the **Mastery Centers**,
`/flashcards/reading` and `/flashcards/writing` (`MasteryCenterPage`). Each is the
`/decks` panel rendered as a page and read through one skill bar; they are reached from
two buttons under the Study Mix slab, present only when that account goal is set. See
[DECKS_FEATURE.md § Mastery Centers](./DECKS_FEATURE.md).

Two route shapes rather than one `:collectionId` on purpose: a deck is addressed by
its numeric id under its own segment, so a deck a user names "mastered" can never
shadow the built-in route.

All of them keep the Flashcards footer tab lit and are reached from `/decks`, which is
now a **deck list** (two built-in collection rows + the user's decks) rather than an
inline card grid.
