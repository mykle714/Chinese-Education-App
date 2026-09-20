# Back Navigation

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md). Sibling of
> [NAVIGATION.md](./NAVIGATION.md) (where the app's destinations are) and
> [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) (the page archetypes and their motion).

This doc covers **leaving a page backwards**, in three parts:

1. **Reference:** every way Back happens and what the code does for each.
2. **Framework:** the rules a new page follows, plus a decision procedure.
3. **Audit:** where the current pages follow or break those rules.

Part 3 is a snapshot as of 2026-09-13. Re-audit it when you touch a back handler.

---

## Part 1 — How Back happens

### 1.1 The ways a learner goes back

| # | Trigger | Platform | Reaches our code as | Can the app intercept it? |
|---|---|---|---|---|
| **A** | The header's **← / ↓ arrow** | all | our `onBack` handler | **Yes.** It is ours; we can confirm, gate or redirect. |
| **B** | Browser **back button**, mouse back button, Alt+← | desktop | a `POP` navigation (popstate) | **No.** It has already happened by the time React hears it. |
| **C** | **Edge swipe** from the left edge | iOS Safari, Android Chrome | a `POP` navigation, **after** the browser has animated its own page picture | **Only by blocking the gesture itself** (`useBlockEdgeSwipe`). A started swipe cannot be vetoed. |
| **D** | Android **system back** | Android | a `POP` navigation | No |
| **E** | A **programmatic exit** after an action: deleting a deck, a finished sort set, "Next round" | all | a `navigate(...)` we call | Yes |

A footer-tab tap is **not** Back. It is a lateral push to a tab root (`MobileFooter` → `TABS`), and nothing in this doc treats it as a return.

The central fact: **A and E are ours; B, C and D belong to the browser.** Any rule that works only for the arrow is half a rule. Two consequences:
- Every guard needs a fallback that also runs on unmount or `pagehide`.
- Every arrow handler should land where the browser's own Back would land (§ 2.1).

### 1.2 The history model

The app uses React Router 7's component `<BrowserRouter>`. The facts that matter:

- **`location.key`** is unique per history entry, and the *same* key comes back when that entry is returned to with Back. This is the identity that per-entry restore keys on (`backRestore.ts`, § 1.5).
- **`window.history.state.idx`** is the entry's index in this tab's stack, and `0` means the page is the first entry. On a deep link or reload, `navigate(-1)` from `idx === 0` **leaves the app**. `SortCardsPage` → `exitToOrigin` is the one place that checks this today.
- **`useNavigationType()`** returns `"PUSH"`, `"REPLACE"` or `"POP"`. Every B/C/D trigger, the arrow's `navigate(-1)`, and the initial page load are all `POP`.
- **`location.state`** is stored per entry and survives Back, so it can carry "where did I come from" (`ChallengeDetailPage` reads `state.from`).
- **`navigate(path)`** pushes a *new* entry even when `path` is the logical parent. Tapping an arrow wired this way leaves the old entries on the stack. The next browser Back returns to the page you just "backed out of".

### 1.3 What the arrow does mechanically

`LeafPage` and `NodePage` both route their arrow through `usePageSlide` → `exit(onBack)`:

1. It clones the leaving page's DOM onto the phone frame (`.mobile-demo-frame__viewport`).
2. It arms the skip-enter latch (`armSkipNextEnter`).
3. It calls `onBack` **immediately**, so the destination mounts beneath the clone.
4. It slides the clone off: down for a leaf page, right for a node page.

The destination therefore appears static beneath a departing page. `onBack` is not delayed until the slide ends. Full detail: [LEAF_NODE_PAGES.md § Slide hook](./LEAF_NODE_PAGES.md).

`PageHeader` falls back to `navigate(-1)` when no `onBack` is passed.

### 1.4 Motion rules on the way back

- **Forward** navigation slides the new page in with a View Transition (`useSlideNavigate`).
- **Back** never slides the destination in:
  - The arrow's latch keeps the destination static.
  - Any `POP` also starts static: `usePageSlide` checks `useNavigationType() === "POP"`. Without that, a page the browser had already swiped back to would slide in a second time from the right.
- ⚠️ **A back arrow that calls `slideNavigate(parent)`** runs *both* motions: the exit clone slides right while a forward View Transition slides the parent in from the right. See Audit § 3.2.

### 1.5 State on the way back

A page that remounts on Back loses its component state. There are two stores that bring it back, and they differ by lifetime:

| Store | Keyed on | Survives | Used by |
|---|---|---|---|
| `dictionaryBrowseState` (`src/features/dictionary/dictionaryBrowseState.ts`) | a **route space** (`isDictionarySpacePath`) | any move inside `/dictionary` and `/dictionary/card/*`; cleared by `Layout` on exit | `DictionaryPage` |
| `backRestore` (`src/features/flashcards/backRestore.ts`) | the **history entry** (`location.key`) | only a return to that exact entry; a fresh arrival at the same URL opens fresh | fdp sheets, `MasteryCenterPage`, `CollectionViewPage` |

Per-entry keying is the model to copy for new pages (§ 2.3). The dictionary singleton predates it; see Audit § 3.4.

### 1.6 Platform behaviour you cannot see in the code

**iOS Safari edge swipe and snapshot matching.**
- A swipe drags a *picture* of the previous page, taken when the learner left it.
- After the gesture, WebKit keeps that picture up and **blocks input** until the live page resembles it. If it never does, a watchdog releases it after a few seconds.
- So a page that comes back looking different from how it was left freezes the tab for seconds. That different look can be a closed sheet, a spinner instead of a grid, a replayed entrance animation, or an extra slide-in.
- This is why the fdp's swipe back froze on PPE until 2026-09-13, while the arrow (which uses no picture) was instant.
- **So restoring state on Back is load-bearing on iOS, not cosmetic.** (Diagnosed by elimination, not profiled on a device.)

**Games block the swipe.** Every game page calls `useBlockEdgeSwipe(true)` ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md)): a stray edge drag must not end a run. The hook cancels edge-originating horizontal `touchmove`s. On a game page, the arrow is effectively the only way back.

---

## Part 2 — The framework

### 2.1 Rule 1: The arrow means "undo the last forward step"

The arrow should land exactly where browser Back (B/C/D) would land. That keeps all back paths consistent and keeps history from growing on every exit.

- **Default:** `navigate(-1)`. Guard it for a first-entry page (deep link or reload), where `-1` would leave the app. Fall back to the page's logical parent.
- **Fixed-path push** (`navigate(parent)`) is acceptable only when **both** hold:
  - the page can be reached from exactly one parent, and
  - that parent is a tab root or hub where a duplicate history entry is harmless.
- **Never** `slideNavigate(...)` from a back handler. It is a forward navigation with forward motion (§ 1.4).

> **Recommended helper — not built yet.** Today the idx-guarded pattern exists once, inline, in `SortCardsPage` → `exitToOrigin`. A shared hook would make it the one-line default:
> `useBack(fallbackPath)` → `() => (history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate(fallbackPath, { replace: true })`.

### 2.2 Rule 2: A consumed entry is replaced, not left behind

If the page just left can never be returned to meaningfully, the exit must use `{ replace: true }`. Otherwise Back lands on a dead page. Current examples:
- the page's object was deleted (`CollectionViewPage` → `handleDelete`);
- a one-shot action spent it (`ChallengeRoundScoreboard` "Next round");
- the learner is not allowed there (the `isTemplateAuthor` / `isValidator` bounces);
- a required launch parameter is missing (Bubble Match with no level, Word Search with no mode).

### 2.3 Rule 3: Back returns the page as it was left

Save view state on the way out when a page holds any of:
- scroll position,
- an open sheet,
- search, sort or filter,
- a paged or loaded list.

The pattern, as implemented by the three `backRestore` callers:
1. **Save at the moment of leaving,** in the handler that navigates forward, keyed by `location.key`. Hold the save function in a ref so memoized row handlers stay stable.
2. **Seed state from the snapshot on mount:** `useState(() => snapshot?.x ?? default)`. Read it once per mount.
3. **Paint the final state on the first frame.** Keep cached lists on screen, skip entrance animations and paced reveals (`MiniVocabCardGrid` → `revealImmediately`), and open sheets at their height (`SheetPanel` → `restoreHeight`).
4. **Refresh in the background without flipping to loading.** Swapping in a spinner throws away the restored scroll, and on iOS it also breaks the snapshot match (§ 1.6).
5. **Restore scroll once, after the scroller exists,** then never fight the learner's own scrolling.

Use **per-entry** keys: only Back restores, and a fresh arrival opens fresh. Use a route-space singleton only when the state should also survive a *forward* re-entry, and say so explicitly.

### 2.4 Rule 4: Guards are courtesies, never locks

A confirm on Back can only intercept the arrow (A). B, C and D cannot be awaited.
- Put the confirm on the arrow, e.g. `useGameBack` for an armed challenge round, or `IWSceneEditorPage` → `handleBack` for unsaved edits.
- Make the *outcome* correct on every path anyway. Challenge rounds finalise on unmount and `pagehide` in `useChallengeRound`, not in the confirm.
- If losing the page by accident is genuinely costly, block the gesture (`useBlockEdgeSwipe`) rather than trusting the confirm. Games do this.

Arrow-only **interceptors** follow the same rule, e.g. flp's `ProvisionalSortOffer` on the first Back tap. The swipe skips them, so what they offer must be optional.

### 2.5 Rule 5: The leaving page owns the motion

- Leaf pages slide down on exit and node pages slide right; the destination stays static (§ 1.4).
- Do not add an entrance animation that runs on `POP`.
- Do not start a View Transition from a back handler.

### 2.6 Rule 6: "Where did I come from" rides the entry

When a page has several possible parents, record the origin on the forward navigation and read it on the way back. Do not guess it from global state.
- Per-entry: `navigate(to, { state: { from } })`; read `location.state.from`. It survives Back and dies with the entry. Example: `ChallengeHistoryPage` → `ChallengeDetailPage`.
- Shareable or reload-proof: a `?from=` query param. Example: `ProvisionalSortOffer` → `SortCardsPage`.

This is also the fallback source for Rule 1's first-entry case.

### 2.7 Decision procedure for a new page

```
1. How many parents can reach this page?
     one tab root / hub   → navigate(parent) is acceptable (Rule 1 exception)
     several, or a drill-in chain → navigate(-1), idx-guarded with a fallback (Rule 1)
       └─ fallback = location.state.from / ?from= if recorded (Rule 6), else the logical parent

2. Does any exit consume this entry (delete, one-shot action, access bounce)?
     yes → that exit uses { replace: true } (Rule 2)

3. Does the page hold scroll / sheet / search / sort / a loaded list?
     yes → backRestore snapshot, saved on the way out (Rule 3)

4. Can leaving by accident lose work or spend something?
     lose work  → confirm on the arrow + make every exit path safe (Rule 4)
     mid-game   → useBlockEdgeSwipe(true) + useGameBack (Rule 4)

5. Leaf or node? → LeafPage / NodePage; never animate on POP (Rule 5)
```

---

## Part 3 — Audit (2026-09-13)

✅ follows the framework · ⚠️ deviates, see the notes below the table · — not applicable. "Arrow" is `onBack`.

### 3.1 Inventory

| Page | File | Arrow | R1 | R3 restore | Guard |
|---|---|---|---|---|---|
| Card detail (saved) | `VocabCardDetailPage.tsx` | `navigate(-1)` | ⚠️ no idx guard | — | — |
| Card detail (dictionary) | `DictionaryCardDetailPage.tsx` | `navigate(-1)` | ⚠️ no idx guard | — | — |
| Collection / deck | `CollectionViewPage.tsx` | `navigate(-1)` | ⚠️ no idx guard | ✅ backRestore | delete → `replace` ✅ |
| Mastery Center | `MasteryCenterPage.tsx` | `navigate("/flashcards/decks")` | ⚠️ push to parent | ✅ backRestore | — |
| Decks (fdp) | `FlashcardsDecksPage.tsx` | tab root | — | ✅ backRestore | — |
| User profile | `UserProfilePage.tsx` | `navigate(-1)` | ⚠️ no idx guard | — | — |
| Night Market visit | `NightMarketVisitPage.tsx` | `navigate(-1)` | ⚠️ no idx guard | — | — |
| Sort Cards | `SortCardsPage.tsx` | `navigate("/discover")`; set mode `exitToOrigin` | ✅ set mode (idx-guarded) | — | done popup (arrow-independent) ✅ |
| Quick Mark / Skipped | `QuickMarkPage.tsx`, `SkippedCardsPage.tsx` | `navigate("/discover")` | ✅ single hub parent | — | — |
| flp | `FlashcardsLearnPage.tsx` → `handleBack` | `leaveSession` | — | — | provisional sort offer (arrow-only) ✅ |
| Friends hub | `FriendsPage.tsx` | `navigate("/")` | ✅ hub | — | — |
| Friends sub-pages | `SentRequestsPage`, `IncomingRequestsPage`, `RemoveFriendsPage`, `ChallengesPage` | `slideNavigate("/friends")` | ⚠️ forward slide on Back | — | — |
| Challenge history | `ChallengeHistoryPage.tsx` | `slideNavigate("/friends/challenges")` | ⚠️ forward slide on Back | — | — |
| Challenge detail | `ChallengeDetailPage.tsx` | `slideNavigate(state.from ?? "/friends/challenges")` | ⚠️ forward slide on Back; ✅ Rule 6 origin | — | — |
| Arena | `ArenaPage.tsx` | `slideNavigate("/")` | ⚠️ forward slide on Back | — | — |
| Account security | `AccountSecurityPage.tsx` | `slideNavigate("/settings")` | ⚠️ forward slide on Back | — | — |
| Settings | `SettingsPage.tsx` | `navigate("/account")` | ✅ single parent | — | — |
| Dictionary / Games / Community / Reader / Night Market / Tester Dashboard | hub pages | `navigate("/")` | ✅ hub | Dictionary: route-space singleton | — |
| Reader document | `ReaderDocumentPage.tsx` | `navigate("/reader")` | ✅ single parent | — | ⚠️ no guard for an unsaved inline edit |
| IW world / play | `IWWorldPage.tsx`, `IWPlayPage.tsx` | `"/"` / `"/immersive-world"` | ✅ | — | play blocks swipe ✅ |
| IW scene editor | `IWSceneEditorPage.tsx` | confirm if dirty → `navigate("/")` | ✅ | — | ✅ Rule 4 (arrow only; no unmount save) |
| Template editor / sandbox | `TemplateEditorPage.tsx`, `TemplateSandboxPage.tsx` | `navigate("/")` | ✅ | — | — |
| Bubble Match, Hydra Bubbles, Match Speed, Word Search | game pages | `useGameBack` → challenge or `/games` | ✅ | Word Search: saved game | ✅ confirm + swipe blocked + unmount finalise |
| Memory Map, Speed Reading | game pages | `navigate("/games")` | ✅ | — | swipe blocked ✅ |

### 3.2 Findings

1. **Six pages call `slideNavigate` from their back arrow.** These are the three Friends sub-pages, `ChallengesPage`, `ChallengeHistoryPage`, `ChallengeDetailPage`, `ArenaPage` and `AccountSecurityPage`. Each one:
   - pushes a new entry, so history grows on every "back";
   - starts a *forward* View Transition while `NodePage`'s exit clone slides right, which is probably a doubled animation (verify on a device);
   - lets a following browser Back return to the page just left.

   *Guess at intent:* the parent should be "held beneath" like a forward drill-in. *Proposed:* switch to Rule 1 (`navigate(-1)` with fallback), keeping `ChallengeDetailPage`'s `state.from` as its fallback.
2. **Five `navigate(-1)` arrows have no first-entry guard:** both cdps, `CollectionViewPage`, `UserProfilePage` and `NightMarketVisitPage`. Opened from a shared link or after a reload, the arrow leaves the app. `PageHeader`'s default `onBack` has the same problem. *Proposed:* the `useBack(fallback)` helper from Rule 1.
3. **`MasteryCenterPage` pushes to fdp.** It has only one parent, so this meets Rule 1's exception. But it grows history, and because it arrives as a PUSH it skips fdp's back-restore (fdp opens with its sheets closed). *Proposed:* `navigate(-1)` with fallback `/flashcards/decks`.
4. **The cdp delete sends dead state.** `VocabCardDetailPage` → `handleDeleteConfirmed` navigates with `state: { refresh: Date.now() }`, and nothing reads `location.state.refresh`. It is also a push onto an entry whose card no longer exists, so browser Back returns to a deleted card's page. *Guess:* a leftover from when fdp listed cards directly. *Proposed:* `navigate(-1)` (or `replace` to fdp), and drop the unread state.
5. **The Reader document has no guard for an inline edit.** `ReaderDocumentPage` → `handleBack` leaves mid-edit with nothing said. Compare `IWSceneEditorPage`. Add a Rule 4 confirm if an unsaved edit is worth protecting.

### 3.3 Open questions

- **Re-tapping the active footer tab.** Does it push a duplicate entry (`MobileFooter` → `TABS` calls a plain `navigate`)? Unverified. If it does, repeated taps pad the stack that browser Back walks through.
- **Hub parents.** Should "hub" pages (Dictionary, Games, Community) return with `navigate(-1)` too? They are reachable from Home only today, which meets the Rule 1 exception. Revisit if a second entry point appears.

### 3.4 Dictionary browse state

The dictionary predates per-entry restore. Its singleton also restores on a *forward* re-entry within the space, and it clears on any exit. This works, but it is the one place where "Back" and "come here again" behave the same. Moving it onto `backRestore`-style keys would unify the two models. It is not planned.

---

## Code ↔ doc dependencies

| Section | Code |
|---|---|
| § 1.2 History model | React Router `useLocation` (`key`, `state`), `useNavigationType`; `SortCardsPage.tsx` → `exitToOrigin` (`history.state.idx`) |
| § 1.3 Arrow mechanics | `src/hooks/usePageSlide.ts` (`exit`, `armSkipNextEnter`, `clearSkipNextEnter`); `src/components/LeafPage.tsx`, `NodePage.tsx` (`handleBack`); `src/components/PageHeader.tsx` (default `onBack`); `src/components/Layout.tsx` (latch clear) |
| § 1.4 Motion | `src/hooks/useSlideNavigate.ts`; `src/utils/pageTransition.ts` (`routeSlideDir`); `usePageSlide.ts` (`POP` start-in-place) |
| § 1.5 / Rule 3 State | `src/features/flashcards/backRestore.ts`; `useDecksPanel.ts` (`restore`, `snapshot`); `DecksPanelBody.tsx` (`initialScrollTop`); `SheetPanel.tsx` (`restoreHeight`); `MiniVocabCardGrid.tsx` (`revealImmediately`); `src/features/dictionary/dictionaryBrowseState.ts` |
| § 1.6 Platform | `src/hooks/useBlockEdgeSwipe.ts` |
| Rule 2 | `CollectionViewPage.tsx` → `handleDelete`; `src/games/runtime/ChallengeRoundScoreboard.tsx`; access bounces in `TemplateEditorPage`, `TemplateSandboxPage`, `IWSceneEditorPage`, `TesterDashboardPage`; `BubbleMatchPage`, `WordSearchPage` launch guards |
| Rule 4 | `src/games/runtime/useGameBack.ts`; `useChallengeRound.ts` (unmount / `pagehide` finalise); `IWSceneEditorPage.tsx` → `handleBack`; `FlashcardsLearnPage.tsx` → `handleBack` + `ProvisionalSortOffer` |
| Rule 6 | `ChallengeHistoryPage.tsx` (`state.from`) → `ChallengeDetailPage.tsx` (`backTo`); `ProvisionalSortOffer` → `SortCardsPage.tsx` (`?from=`, `originLabelFor`) |
| § 3.1 Inventory | every `onBack=` in `src/` (`grep -rn "onBack={" src`) |
