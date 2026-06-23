# UX & Navigation

Umbrella reference for how users move through the app and how the mobile shell
behaves. This is the index for the navigation archetypes, the scrollable-page
layout, and the global touch/scroll/selection rules. Start here, then drill into the
specific doc.

## Sub-documents

| Concept | Doc | One-liner |
|---|---|---|
| **App navigation structure** | [NAVIGATION.md](./NAVIGATION.md) | No hamburger/sidebar; nav is the footer tabs (Flashcards / Discover / Home / Account) + the `/` Home menu + back-arrow drill-ins. Settings + Logout live on the Account page. |
| **Scrollable footer-tab layout** | [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) | Every scrollable footer-tab page uses `MobileTabScreen` (header scrolls away inside the scroll area; bottom nav is a floating pill). Home, Decks, Discover, Games hub, Account use it. |
| **Drill-in page archetypes** | [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) | Two back-arrow archetypes. **Leaf** (`LeafPage`): down arrow, no footer, back-arrow-only exit, slides up/down. **Node** (`NodePage`): left arrow, keeps footer, slides in/out to the right. Rule of thumb: no footer ⇒ leaf, has footer ⇒ node. |
| **Discover surface** | [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) | Two-level Discover surface: the `/discover` hub menu (footer tab) → `/discover/sort/:language` drag-to-sort page (back-arrow header, no footer). |

---

## Touch & Scroll (mobile)

This is a mobile-first app built around drag gestures. Components you create should
default to `touchAction: "none"` so background/empty-area touches don't trigger the
browser's native pan/scroll (which fights the drag interactions). Only set a
scroll-permitting value (`auto`, `pan-y`, etc.) on a component when explicitly told
it should be scrollable.

**The app shell is non-scrollable by default — scrolling is opt-in per page.**
`html`/`body` are pinned to the visible viewport with `overflow: hidden` (see
`src/index.css`), and `#root` is the only shell-level scroller (`100dvh`,
`overflow-y: auto`, in `src/App.css`) — it exists solely to reveal the desktop
phone card and never scrolls on mobile. A page that needs to scroll must provide
its **own inner scroll container**; nothing should make the whole page (header +
footer) scroll. For footer-tab hub pages this container is `MobileTabScreen`'s
`ScrollArea`. Never reintroduce `overflow-y: auto` / `min-height: 100vh` on
`html`/`body` — that lets the entire app scroll and drags the scroll-away header
and floating-footer pill with it.

Text is **non-selectable by default app-wide** — `src/index.css` sets `user-select:
none` on `body` (it cascades to everything). Form fields (`input`/`textarea`/
`contenteditable`) are re-enabled there. The **only** selectable content exception is
**cpcd** (`.cpcd-row__chars` / `.cpcd-row__pinyin-cell`), and only on non-touch
devices — the `@media (hover: hover) and (pointer: fine)` block in `index.css` makes
cpcd selectable on desktop but keeps it non-selectable on mobile. Don't sprinkle
per-component `userSelect: "none"`; rely on the global default and only opt specific
content into `userSelect: "text"` (desktop-gated) when called out.

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
