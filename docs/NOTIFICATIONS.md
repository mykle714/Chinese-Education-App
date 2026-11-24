# Notifications — the app's one notification system

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
> Related: [HINT_PAWN.md](./HINT_PAWN.md) (the bubble look it borrows),
> [SORT_CARDS_REQUIREMENTS.md § 5.4](./SORT_CARDS_REQUIREMENTS.md) (acp's deck-fill notices, its first sticky user).

A notification is a short message the app raises on its own, such as a failed save, a
one-time hint or a deck-size nudge. Every one goes through `useNotify()`. **MUI
`Snackbar` / `Alert` toasts are deprecated and must not be added.** The one left is behind
the OFF Community flag ([DEFERRED_WORK.md](./DEFERRED_WORK.md) #53).

---

## 1. Layers

| Piece | Layer | File |
|---|---|---|
| Types, constants, pure transitions | shared client model | `src/components/notifications/notificationModel.ts` → `NotificationInput`, `resolveNotification`, `upsertNotification`, `TONE_ICON`, `DEFAULT_AUTO_HIDE_MS`, `NOTIFICATION_TOP`, `NOTIFICATION_Z_INDEX` |
| State + timers | shared client provider, mounted once in `src/App.tsx` around `Layout` | `NotificationProvider.tsx` |
| Drawing | shared shell presentation, rendered by the shell | `NotificationViewport.tsx` — `placement="frame"` in `MobileDemoFrame`, `placement="window"` in `Layout`'s plain shell |
| Call-site API | shared client hooks | `useNotify.ts` → `useNotify`, `useNotificationFor` |

The provider holds state only. The viewport is a sibling of the pages and the footer in
the phone frame, so a banner is never sealed inside a transformed page surface or sheet
(the trap described in `src/components/overlayHost.ts`). It also needs no per-site
`zIndex` / `<Portal>` / `top` hacks, which the retired Snackbars each carried.

## 2. Look

Each notification is a **tailless hint bubble**: `HintBubbleSurface` with `tailSide="none"`
(owner, 2026-11-14: "styled the same way our flp hints are"). It uses the flp hint pawn's
white, outlined bubble with `SHADOW.chip`, grows down out of its top edge
(`growInFromAbove`) and **fades away** when it leaves (`exit="fade"`, over
`HINT_MOTION.popMs`; owner, 2026-11-14 — the pop was too loud for a dismissal).

- **Placement:** a centred column under the page header (`NOTIFICATION_TOP` = 68px +
  `SAFE_TOP`), up to 360px wide with a 16px gutter, at `NOTIFICATION_Z_INDEX` (2000). That
  puts it above the footer, dims and sheets, so an error raised inside the eip or the
  AccountSheet is still seen.
- **Content:** a leading 20px `Icon` and the message in caption/semibold ink (the hint
  pawn's line style). **Sticky** banners also print the pawn's "Tap / to / dismiss" cue
  (`src/components/hintBubble/DismissCue.tsx`, shared with `PawnHintBody`). Auto-hiding
  ones don't, because they leave by themselves.
- **Tone is the icon only.** Our framework sets every semantic ink to ink
  (`src/theme/colors.ts` § "Semantic roles"), so no tone has a hue. `TONE_ICON`: info →
  `info`, success → `check_circle`, warning → `warning`, error → `error`. A caller may name
  another glyph (`icon`).
- **Tapping a banner anywhere dismisses it.** The column itself ignores the pointer.
- At most `MAX_VISIBLE_NOTIFICATIONS` (3) show at once. A fourth evicts the oldest.

*Code:* `NotificationViewport.tsx`; `src/components/hintBubble/HintBubbleSurface.tsx`
(`tailSide="none"`).

## 3. Behaviour

- **Identity.** `notify({ id, … })` with an id already showing **updates it in place**: same
  slot, new text, no re-grow. acp's live "N more" count relies on this. With no id, every
  call is a new banner. Two mounts of one call site (the flp and its eip) share an id and so
  show one banner.
- **Lifetime.** `autoHideMs` omitted → the tone's default (`DEFAULT_AUTO_HIDE_MS`: info 4 s,
  success 3 s, warning 5 s, error 4 s). A number → that. `null` → sticky until tapped or
  dismissed. Re-notifying an id restarts its timer.
- **`onClose(reason)`** fires once per notification: `tap`, `timeout`, `evicted` or
  `dismissed` (the owner called `dismiss(id)`). It is called outside any setState updater, so
  it never double-fires under StrictMode.
- **`useNotificationFor(message, clear, { id, tone })`** mirrors one piece of nullable
  message state, the shape every retired `<Snackbar open={err !== null}>` had. Non-null
  shows or updates it. A tap or timeout runs `clear()`. The owner nulling it dismisses it.
  Unmount dismisses it.
- `notify` / `dismiss` keep one identity for the app's lifetime (the api and the stack are
  separate contexts), so they are safe in effect deps.

## 3a. Failures

How a failed server call reaches the learner (owner, 2026-11-23: "I don't see error popups
like this a lot"). The aim is to show as few errors as possible, the way most apps do:

1. **Retry quietly first.** `src/api/http.ts` retries a transient failure (a network error or
   a 502/503/504) twice over ~2 s before the caller sees it (`RETRY_DELAYS_MS`). Every GET is
   retried; a write only when its API function passes `retry: true`, which is allowed only
   for an endpoint that is safe to receive twice (`RequestOptions.retry` lists them and the
   rule — a flashcard mark is never retried). Most failures are a network blip this absorbs.
2. **Say "No connection" once.** `ConnectionNoticeHost` (mounted in `src/App.tsx`) shows one
   sticky warning banner, id `connection-lost`, while the device is offline (`offline` /
   `online` events) or a request has failed at the network level after its retries
   (`CONNECTION_EVENT`). The next request that gets any response takes it down. Individual
   sites do not add their own banner for a network failure.
3. **Otherwise, a failure is shown where it happened, or not at all.** A site whose screen
   already shows the action did not happen (a switch snapping back, a card returning to its
   slot, a button turning back on) adds nothing. A banner is used only when the screen would
   otherwise claim success; an in-place line when the failing control has room for one.

| Site | How a failure shows |
|---|---|
| Focus lever save (`useFocusLever` → `onConfirm`) | Banner `focus-mode-save-error` (error): the dialog closes as if the switch went through. Not raised for a network failure (`TypeError`), which the connection notice covers. |
| Writing flp check (`useWritingFlashcard` → `handleSubmit`) | In place: the card's bottom line reads "Couldn't check · tap to try again" (`checkFailed`). |
| Writing Grid / Practice Writing check, acp sort / skip / undo, goal switch, card removal, notebook summary and next-empty jump | Nothing of their own: the screen already shows the action did not happen. |
| Deck Tower counts (`DeckTowerPage` → `countsFailed`) | In place: the stack's ↻ retry imprint (DECK_TOWER.md § "Counts that fail"). |

*Code:* `src/api/http.ts` → `request`, `RETRY_DELAYS_MS`, `CONNECTION_EVENT`;
`src/components/notifications/ConnectionNoticeHost.tsx`.

## 4. Call sites

| Site | Id | Tone / lifetime | What |
|---|---|---|---|
| `src/features/flashcards/FlashcardsLearnPage/useEipOverflowNotice.ts` (flp + `EipSheet`) | `eip-too-many-tabs` | info, 2.5 s | eip trail at `MAX_EIP_TABS` |
| `EipSheet.tsx` | `eip-sheet-learning-error` | error, 2.5 s | Learning add/remove failed |
| `FlashcardsLearnPage.tsx` | `flp-eip-learning-error` | error, 2.5 s | eip Add key failed |
| `FlashcardsLearnPage.tsx`, `features/deckTower/cardView/TowerCardView.tsx` | `card-icon-save-error` | error, 4 s | fie layout save/reset failed |
| `src/components/notifications/ConnectionNoticeHost.tsx` (app-wide, `src/App.tsx`) | `connection-lost` | warning (`wifi_off`), sticky until the connection is back | offline, or a request unreachable after its quiet retries (§ 3a) |
| `src/features/deckTower/useFocusLever.tsx` | `focus-mode-save-error` | error, 4 s | focus lever switch failed to save (§ 3a) |
| `src/pages/settings/SettingsBody.tsx` | `settings-language-result` | success 3 s / error 5 s | language preference saved / failed |
| `src/features/reader/ReaderDocumentPage.tsx` | `reader-edit-save-error` | error, 4 s | inline edit failed to save |
| `src/features/discover/useDeckFillNotices.ts` (acp) | `acp-deck-fill-goal` | info (`style`), sticky | "Sort at least N…" goal, counting down |
| `useDeckFillNotices.ts` (acp) | `acp-deck-fill-warning` | warning, sticky | today's deck at/over 40 (on arrival or after a sort) |

## 5. Tests

`src/__tests__/notificationModel.test.ts`: default resolution, in-place update, eviction.
