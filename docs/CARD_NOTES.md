# Card Notes

**Status: BUILT 2026-08-28. Migration 155 — applied on dev, NOT yet on prod.**

A learner's own free-text note about ONE of their flashcards — the thing the dictionary
cannot tell them ("my landlord says this one", "not the 借 one", "from ch. 4"). At most
**200 characters**. Shown at the **bottom edge of the card's answer face (side 2) only**,
and edited **in place** there from the card-operations rail.

---

## 1 · The shape of the feature

| | |
|---|---|
| **Where it is stored** | `vocabentries_zh."note"` / `vocabentries_es."note"` — `text`, NULL = no note (migration 155) |
| **Whose it is** | per **user, per word** — the vet row's identity is `(userId, entryKey, language)`. Two learners studying 什么 keep separate notes; the shared det entry is untouched |
| **How long** | `CARD_NOTE_MAX_LENGTH` = 200 characters, enforced in code (see § 3) |
| **Where it shows** | the **answer face only** — side 2 of the flashcard, pinned to the bottom edge |
| **Where it is written** | in place on that same strip, opened from `CardOpsRail`'s `note` cell |

### Why the answer face only

A note is the learner's commentary on the **answer**. On the question face it would be an
unrequested hint, and on a recognition prompt it could hand over the answer outright. The
face gate is the caller's (`CardFace` mounts `CardNote` in side 2's `bottomNote` slot and
nowhere else), which is the same rule the icon layer follows — icons render only on
English-bearing faces (see [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)).

### Why the bottom EDGE and not a text block

The two card text blocks (foreign / english) are **movable**: the fie can drag, scale and
rotate them anywhere on the card. The note is deliberately **not** part of that system. It
is chrome, not card design, so it keeps a fixed berth along the bottom where it can never
be dragged over the word it annotates, and the fie's canvas suppresses it entirely while
an edit is open (the canvas edits a design; the note is not part of that design).

### Why delete left the rail

`CardOpsRail` had three cells: customize / add to deck / **delete**. The note took delete's
slot. Deleting a card is rare, irreversible and takes its whole review history with it, so
it belongs on a surface the learner has navigated **to** — the cdp header, and the shelf's
multi-select bulk delete — rather than one tap from the card they are drilling. See
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md) artboard 21.

One consequence: `useWorkingLoop.dropCurrentCard` (remove the front card from the session
without marking it) lost its only caller and was **deleted** along with the flow — the
hook no longer exposes it. A future in-session delete has to re-derive its non-obvious
half, re-anchoring on the successor by id rather than by index; the reasoning is in this
file's git history and in `handleCardDismiss`, which does the same promotion with an
animation.

---

## 2 · Layers

| Layer | File → symbol | Responsibility |
|---|---|---|
| **DB** | `database/migrations/155-add-note-to-vocabentries.sql` | adds `note text` to both vet tables |
| **Contract** | `server/contracts/wire.ts` → `VocabEntryBase.note`, `CARD_NOTE_MAX_LENGTH` | the field and the one cap both sides read |
| **Route** | `server/routes/vocabEntryRoutes.ts` | `PATCH /api/vocabEntries/:id/note` |
| **Controller** | `VocabEntryController` → `updateNote` | type-guards the body (`string \| null`), echoes the **persisted** value |
| **Service** | `VocabEntryService` → `updateNote` | the only place the note's meaning is normalized — trim, blank → `null`, cap |
| **DAL** | `VocabEntryDAL` → `updateNote` (iface `IVocabEntryDAL`) | one `UPDATE … WHERE id AND "userId"`, routed by `vetTableForLanguage` |
| **Client API** | `src/utils/vocabApi.ts` → `saveCardNote` | thin PATCH; returns the persisted note |
| **Client state** | `src/cardIcons/editor/useCardIconEditor.ts` → `persistNote`, `noteOverrides` | optimistic session override + rollback, merged into the entry by `applyIconOverride` |
| **Page** | `FlashcardsLearnPage` → `noteEditing`, `handleSaveNote` | owns only *is the editor open*, because that flag also gates the drag handlers |
| **Card plumbing** | `FlashCardSection` → `CardFace` | renders `CardNote` into side 2's `bottomNote`; detaches drag/flip handlers while editing |
| **Face slot** | `src/features/flashcards/card/CardFace.tsx` → `CardFaceSide` prop `bottomNote` | a node slot in the OUTER face box, like `topRail` |
| **UI** | `src/features/flashcards/card/CardNote.tsx` → `CardNote` | the strip itself: read mode, inline edit mode, counter, ✓/✕ |
| **Entry point** | `FlashcardsLearnPage/CardOpsRail.tsx` → `onEditNote` | the rail's third cell |

The read path needs **no** changes: vocab reads select `ve.*` and the zh read wrapper
(`server/dal/shared/vetTable.ts` → `vetReadFrom`) uses `SELECT *`, so `note` arrives on
every entry the client already fetches.

---

## 3 · Normalization — one place, one number

`VocabEntryService.updateNote` is the single authority on what a note *is*:

* **trimmed** — leading/trailing whitespace typed on the card is not content;
* **blank → `NULL`**, never `''` — "no note" has exactly one representation, so the render
  path's check is a plain truthiness test and an all-spaces note does not reserve a strip
  at the bottom of the card;
* **capped at `CARD_NOTE_MAX_LENGTH`** — truncate rather than reject, matching how
  `selectedSense` bounds its label.

The cap lives in `server/contracts/wire.ts` and is re-exported through `server/types/index.ts`
and `src/types.ts`, so the on-card counter and the server's truncation are literally the
same number. The editor also sets `maxLength` on the textarea, so the learner never types
text the server would silently drop. Because the server can still change what it was sent
(trim, cap), the controller echoes the **persisted** value and `persistNote` writes that
echo back over its optimistic override — the card ends up showing what is stored.

It is a `text` column, not `varchar(200)`, on purpose: raising the cap is then a code
deploy rather than a table rewrite.

---

## 4 · Interaction: inert to read, guarded to edit

### Read mode is completely inert

The displayed note is **`pointerEvents: none`**. It is a label sitting on the card, not a
control on it, so it is not a hit target at all — a tap that lands on the note **flips the
card**, and a swipe that starts on it **marks the card**, exactly as if the note were not
there. The learner never has to aim around their own note.

This is stronger than letting the event bubble to the card's handlers. Bubbling still makes
the strip the gesture's **target**, which is what a long-press, a text-selection drag or a
stray `user-select` on the paragraph would act on. Taking it out of hit-testing removes the
whole class.

The consequence to remember: **the note cannot open its own editor by being tapped.** The
card rail's `note` cell is the only affordance. If tap-to-edit is ever wanted, read mode
stops being inert and inherits every guard below — that is the trade, and it is why the
rail owns the entry point.

### Edit mode is the one exception

The open editor is the only interactive state, and it sits on the card's flip/drag target,
so it carries two guards — both scoped to the open editor, neither active in read mode:

1. **`CardNote` stops its own events.** Every `pointerdown` / `mousedown` / `touchstart` /
   `touchend` / `click` inside the editor is stopped, so a press aimed at the textarea or
   its buttons is never read as a flip or a swipe-to-mark.
2. **The host detaches the card's handlers** while `noteEditing` is true
   (`FlashCardSection`, the same gate `editMode` uses). This covers gestures that *start*
   on the editor and travel off it, which stopping propagation alone cannot.

This is why the open/close flag lives on the page and not inside `CardNote`: the component
cannot reach the drag handlers. The **draft text**, by contrast, is local to `CardNote`, so
a keystroke does not re-render the card slot.

Other behaviours worth keeping:

* The editor closes on its own ✓ / ✕, never on an outside tap — an outside tap on this
  surface is a flip or a mark, and spending it on dismissal would eat the gesture or mark
  the card by accident. Same rule as `CardOpsRail`.
* The page closes the editor whenever the front card changes (`currentEntry?.id`), so a
  promoted card is never handed an open editor seeded from the previous card's note.
* The textarea opts **out** of the app-wide `user-select: none` (CLAUDE.md "Touch &
  Scroll") — without it the learner cannot place a caret or select what they wrote.
* Read mode clamps to **three lines**; a full 200-character note is taller than the berth.
  The whole text is always reachable by reopening the editor.
* The peeking back card renders its note read-only (so it does not pop in on promotion)
  but is never editable — and the whole back card is `pointerEvents: none` regardless.

---

## 5 · Save semantics

`persistNote` (in `useCardIconEditor`, beside `persistSelectedSense`) is **optimistic**:
the session override is seeded immediately so the note appears the moment the editor
closes, and the PATCH runs in the background. On success the echoed value replaces the
optimistic one; on failure the override rolls back to the entry's server value and the
existing save-error toast fires — the note visibly disappearing from the card is the
honest signal that it did not save.

Like every other write there, it takes **no dependency on `token`**: `saveCardNote` reads
the bearer token at call time via `src/api/http.ts`. See CLAUDE.md, "Never reload/reset a
page on a silent token refresh".

---

## 6 · Not built (deliberately)

* **No note anywhere but the flp card face.** The cdp, the shelf's mini cards, the games
  and the eip do not show it. A note is study-time commentary on the answer; surfacing it
  in a game would leak an answer, and in a list it would be noise.
* **No search over notes.** Nothing indexes the column.
* **No history/versioning.** A note is overwritten in place.
* **No per-sense notes.** The note belongs to the CARD, not to a `definitionClusters`
  sense — unlike `selectedSense`. If a learner needs sense-specific commentary, that is a
  design change, not a config.

---

## 7 · Deploying

Migration 155 adds a nullable column to two tables — it is **inert for old code** (nothing
reads or writes it) and **required by new code only on the write path**, so it can be
applied either side of the container rebuild. No runbook is needed; `migrate.sh` picks it
up. Rollback is `ALTER TABLE … DROP COLUMN "note"` on both vet tables, after reverting the
code.

---

## Referenced by / references

* [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) — artboard 21, `CardOpsRail`'s cells
* [CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md) — the movable text blocks the note is NOT one of
* [DECKS_FEATURE.md](./DECKS_FEATURE.md) — the rail's `add to deck` cell
* [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) — `selectedSense`, the per-card column
  this one is modelled on
