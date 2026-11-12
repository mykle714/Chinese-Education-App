# Active-Duty Pages

A registry of pages and surfaces a user can **actually reach from td** (`/`, the home
page). It is a cache for the "Unreachable components" check in CLAUDE.md § Code Quality
Standards: before tracing a component's entry points by hand, look it up here. If it is
listed (or it is rendered only by something listed), it is active duty and needs no
re-check. If it is not listed, trace it. If it is reachable, add it here. If it is not,
ask the user whether to deprecate it and record the answer under § Orphans.

**What counts as reachable:** some chain of taps starting at `/` gets there: the footer
tabs, the Menu popover (hp), the Deck Tower's platforms/props, the AccountSheet (td's
header avatar), or a drill-in from any of those. A route that exists only in
`ROUTE_META`, is reachable only by typing its URL, or whose only entry point is behind a
feature flag that is OFF is **not** reachable.

**Keeping it current:** when you delete an entry point, move its page to § Orphans (or
remove the row if the page is deleted too). When you add a page, add its row with the
entry chain. The `Verified` column is the date someone last traced the chain against the
code. Re-trace a row only if the code along its chain has changed since then.

Referenced code: `src/routes/routeMeta.ts` → `ROUTE_META`, `FLAGGED_OFF_PATHS`;
`src/routes/registry.ts`; `src/components/MobileFooter.tsx` (tab list);
`src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations`;
`server/contracts/featureFlags.ts` → `FEATURE_FLAGS`, `GAME_FLAGS`.

---

## Routes

| Route | Page | Entry chain from td | Verified |
|---|---|---|---|
| `/` | `DeckTowerPage` (td) | — the home page; footer **Flashcards** tab | 2026-11-10 |
| `/lessons` | `LessonsPage` (placeholder) | footer **Lessons** tab (`MobileFooter`) | 2026-11-10 |
| `/dictionary` | Dictionary | footer **Dictionary** tab | 2026-11-11 |
| `/flashcards/card/:id` | `VocabCardDetailPage` (cdp) | td cards page → a card (`DeckTowerPage` → `slideNavigate(withLens(...))`) | 2026-11-10 |
| `/discover/sort/:language` | acp | td's sort platform (`DeckTowerPage` → `useDiscoverNavigation().sortPath`) | 2026-11-10 |
| `/flashcards/writing/notebook` | `WritingNotebookPage` | td writing world → notebook stack (`DeckTowerPage` → `NOTEBOOK_PATH`) | 2026-11-10 |
| `/reader` | `ReaderPage` | Menu popover → **Reader** | 2026-11-10 |
| `/reader/:id` | `ReaderDocumentPage` | Reader → a document (`ReaderPage` → `slideNavigate`) | 2026-11-10 |
| `/arena` | `ArenaPage` | Menu popover → **Arena** (flag `arena`, on) | 2026-11-10 |
| `/tester-dashboard` | `TesterDashboardPage` (tdp) | Menu popover → gated **Tester Dashboard** row (testers / admins only) | 2026-11-10 |
| `/friends/sent`, `/friends/requests`, `/friends/remove` | Friends action pages | td avatar → AccountSheet → Friends tab (`FriendsBody`) | 2026-11-10 |
| `/users/:userId` | user profile | `FriendsBody` / `IncomingRequestsPage` / `RemoveFriendsPage` → a person | 2026-11-10 |
| `/settings/account` | `AccountSecurityPage` | td avatar → AccountSheet → Settings tab (`SettingsBody`) → account chevron row | 2026-11-10 |
| `/settings` | `SettingsPage` | only as `/settings/account`'s Back target (Settings is normally read inside AccountSheet) | 2026-11-10 |

## Non-route surfaces

Rendered in place, with no URL of their own. Everything they render is active duty too.

| Surface | Raised from | Verified |
|---|---|---|
| flp (`FlashcardsLearnPage`) and its eip | td → tap the Learning tower (study in place) | 2026-11-10 |
| Menu popover (hp) | footer **Menu** tab | 2026-11-10 |
| AccountSheet (Account / Friends / Settings tabs) | td header avatar (`DeckTowerAvatar`) | 2026-11-10 |
| td launch screen | td, once per launch | 2026-11-11 |

## Flagged off (reachable once the flag flips)

Not active duty today, but intentionally kept. Do **not** prompt for deprecation; the flag
is the decision.

| Route / surface | Flag | Entry chain once on |
|---|---|---|
| `/community` | `community` | Menu popover → Community |
| `/friends/challenges`, `/friends/challenges/history`, `/friends/challenges/:challengeId` | `studyChallenge` | AccountSheet → Friends tab → Challenges |
| Routed game pages (`src/games/registry.ts`) | `standaloneGames` | none today: the Games hub was deleted 2026-11-06. Games run as flp breaks inside td. |

## Orphans (no entry point; awaiting a decision)

Pages with a route but no way to reach them from td. Record the user's decision here
(deprecate / archive / wire up / keep as a URL-only tool).

| Route | Page | Finding | Decision |
|---|---|---|---|
| `/font-lab` | `FontLabPage` | Dev-only type lab, reachable only by typing the URL (by design, per its `ROUTE_META` note). | keep (dev tool), until told otherwise |
