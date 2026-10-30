# EIP Sheet Gestures (SheetPanel)

How the eip bottom sheet is sized, dragged, flung, and dismissed. One component owns
all of it: `src/components/sheet/SheetPanel.tsx` (**moved** 2026-09-04 out of
`src/features/flashcards/FlashcardsLearnPage/`, with its four styled surfaces, when the
compare sheet made it a cross-feature dependency — see
[FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)).

`SheetPanel` is the generic sheet chrome (scrim + rounded container + grabber +
optional tab strip). It hosts a *body* that exposes `{root, scroll}` through a
`SheetPanelBodyHandle` ref: `root` is the element the raw touch listeners bind to,
`scroll` is the element whose `scrollTop` decides resize-vs-scroll, and which the
browser pans natively in `scroll` mode (so it needs `touch-action: pan-y` +
`overscroll-behavior: contain` — see "Gesture mode lock"). Current bodies:
`InfoCardPanelBody` (eip), `CompareWorkspace` (the eip Compare tab AND the standalone
compare sheet, `src/components/CompareSheet.tsx`) and `DecksPanelBody`
(the /decks sets sheet — see **Persistent mode** below). A fourth,
`SettingsPanelBody` (the flp settings sheet), was deleted on 2026-08-28 when the
last of its rows moved out — see [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md).

**Mount sites.** The eip sheet is not flp-private: the sort cards page (scp), the
saved-card cdp and the immersive-world play page all mount the same `InfoCardSection`, and
scp brings the `EipTabStrip` + `useEipTabs` trio with it from each on-deck card's info button
([SORT_CARDS_REQUIREMENTS.md §4.7](./SORT_CARDS_REQUIREMENTS.md)). `IWPlayPage` mounts the
same trio from a tapped word in a speech bubble, and is the only host that takes a **hold on
the page behind it** for the sheet's lifetime — a scene keeps running otherwise, and would
replace the line being read ([IMMERSIVE_WORLD.md § 5.3c](./IMMERSIVE_WORLD.md)). Everything on this
page applies to all of them, and to the compare sheet, which is a plain `SheetPanel`
host of its own ([WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md)) — the first one
to use `depth` for real, stacking over the cdp's eip.

**The eip always shows pinyin (2026-10-04).** It is reference info, so `InfoCardSection`,
`InfoCardPanelBody` and `InfoCardTabContent` take **no `showPinyin` prop** — a study
surface's toggle (a game's pinyin chip, `useFlashcardLearnSettings`) can never reach it.
Before this, `EipSheet` forwarded that chip, so the Reading Center, scp and iw eips went
pinyin-less whenever it was off on the flp (the flp's own chip was later removed
entirely, 2026-10-18 — READING_WRITING_CENTERS.md). The only way left to show no pinyin is a data
gap, which `InfoCardSection` → `useMissingPinyinWarning` reports with a deduped
`console.warn` (a zh entry whose `resolveDisplayPronunciation` is empty). A host whose
entries genuinely have no pinyin must pass `missingPinyinReason="<why>"`; **no host passes
it today**. Spanish entries and the Compare tab never warn.

**A host no longer supplies a positioned parent (2026-08-30).** Both the scrim *and* the
sheet are portaled to the frame-level host (see "The scrim covers the screen"), so
`absolute; inset: 0` and `absolute; bottom: 0` resolve against the whole screen and
`parentElement.clientHeight` — the number the height model caps on — is the frame's.
That is what makes `MAX_HEIGHT_RATIO = 1` mean *the whole screen*: rendered in place the
sheet sat inside the page's content area, which starts **below** the page header and is
clipped by `MobileTabScreen`'s `ScrollArea`, so it could never have covered the header no
matter what ratio it was given.

Two host obligations disappeared with it: stretching the host down through
`FOOTER_CLEARANCE` (scp's old `EipHost` negative bottom — the wrapper was deleted 2026-10-03), and
giving the host a z-index above anything the page lifts. What replaces the latter is
`SCRIM_BASE_Z_INDEX` / `SHEET_BASE_Z_INDEX` (**1200 / 1201**, `+ depth·2` per stack
level): the two layers now sort against the page's *top-level* layers, and those go high
— scp lifts its draggable cards to 1000 and its eip host to 1100. 1200 sits below MUI's
modal layer (1300), so a real `Dialog` still covers the sheet.

Because the sheet is portaled, nothing of `SheetPanel` is left in the page's DOM to walk
up from — so it renders an unpainted **anchor** (`display: none`) in place purely to give
`nearestScrimHost` a starting node, resolves the host in a layout effect (flushed before
paint, so there is no frame in which the sheet is unportaled), and mounts the sheet only
once the host is known. The mount/open-animation effect is keyed on `scrimHost` rather
than `[]` for exactly that reason.

---

## Two modes: modal (every host) and persistent (currently unused)

Everything below describes the **modal** sheet — the eip — which opens with an
animation, dims the page behind a scrim, and is dismissed by dragging it down. **Every
host is modal today**, including the /decks sets sheet (`FlashcardsDecksPage` →
`DecksPanelBody`, `variant="sheet"`), which was converted from persistent mode on
2026-08-24 so its stops and its button-to-open entry point match the eip's.

Passing **`minHeight` > 0** switches the same component into **persistent** mode. The
mode is still implemented and still correct, but **no caller passes `minHeight` any
more** — treat the column below as a spec for the next persistent sheet, not as a
description of something on screen:

| | modal (`minHeight = 0`, default) | persistent (`minHeight > 0`) |
|---|---|---|
| stops | `{0, default, max}` | `{minHeight, max}` — `default` **is** `minHeight` |
| on mount | laid out at `default`, slid up from below the frame (§ Open slide) | painted **at** `minHeight`, no animation |
| drag to the bottom | dismisses (`onClose` after the shrink) | stops dead at `minHeight` |
| release below default | dismiss | snap back to `minHeight` |
| release between the stops | collapse below `collapseThresholdRatio` of the travel, else grow to max | same rule, from `minHeight` |
| fling down | floors at `default` (never dismisses) | floors at `minHeight` |
| scrim | yes | `showScrim={false}` — it is always on screen, so a permanent dim, and a scrim tap would have nothing to dismiss to |
| `onClose` | required in practice | **omitted** — nothing to report |

The three constants are the only branch points in the code (`persistent =
minHeight > 0`): `computeSnapTarget` drops its dismiss stop, the mount effect skips
the open animation, and every `applyResize` floor becomes `minHeightRef.current`
instead of `0`. There is no second implementation of the gesture model.

**Choosing the resting height.** /decks used to derive it from the floating footer's own
geometry — `FOOTER_HEIGHT + FOOTER_EXTRA_GAP
+ SHEET_LIP` — so the lip that showed above the pill (grabber + first caption) survived
any change to the footer. A future persistent sheet should do the same. The footer is rendered at frame level with `zIndex: 100`
(`FooterPresenter`), well above the sheet's internal `11`, so the pill floats **over**
the sheet at every height; a persistent sheet's body must therefore reserve
`FOOTER_CLEARANCE` of bottom padding exactly as a page's scroll area does,
and wear its bottom edge-fade (`EDGE_FADE_MASK_NO_TOP` from `MobileTabScreen`) so the
content dissolves under the pill rather than being cut by it.

A **modal** panel is the other case, and it is the common one: the footer is gone, so the
scroller wears the short sheet band (`sheetEdgeFadeSx`, `src/components/sheet/sheetStyled.ts`)
ending at its own bottom edge. The eip's tab panes take it per pane — each pane in
`InfoCardPanelBody` is its own scroller — as does the generic `SheetBody`. The same mask
fades the scroller's TOP edge over 20px, so a pane's first rows dissolve under the tab
strip as they scroll up. See docs/UX_AND_NAVIGATION.md § Edge fade.

---

## Height model — three stops, one floor

| Stop | Value | Meaning |
|---|---|---|
| `0` | — | dismissed (panel unmounts after the shrink animation) |
| **default** | `parentHeight * defaultHeightRatio` (prop, defaults to `DEFAULT_HEIGHT_RATIO` = 0.6; the Dictionary page's `EipSheet` passes **0.8**), or `initialHeight` for a stacked child panel | the open height; **also the floor** — a downward release snaps back to it and a downward fling's momentum stops at it |
| **max** | `parentHeight * MAX_HEIGHT_RATIO` (**1**) | fully expanded — the sheet IS the screen |

There is **no resting stop between 0 and default**. `computeSnapTarget(h, default,
max, min, collapseRatio)` is the single rule every release path uses: below default →
`0` (dismiss); at or above → collapse back to `default` while the sheet sits below
`default + (max - default) * collapseRatio`, otherwise grow to `max`. A persistent
sheet passes `min > 0`, which suppresses the dismiss stop (see above).

`collapseRatio` comes from the **`collapseThresholdRatio`** prop and defaults to
**0.5**, which is exactly the plain "nearest stop wins" midpoint rule. **The eip itself
passes 0.25** (`InfoCardSection.tsx` → `EIP_COLLAPSE_THRESHOLD_RATIO`, every eip host: flp/td,
cdp, Dictionary, scp, Reading Swipe Grid, IW), so a short upward pull from the open height
maximizes — at the default 0.6 open height the flip point is 0.7 of the screen. A smaller value
moves the collapse point **down**, so the sheet springs back open from heights that
used to close it — a partial pull-down no longer counts as "close it". The /decks collections sheet used to pass **0.3** while it was persistent — it had to be
dragged below 30% of the closed→max travel before a release collapsed it — and now takes
the default 0.5 along with the rest of the eip's model. Note this only decides between the two upper stops; a
modal panel's dismiss floor is still its default height, untouched by the ratio.

The open height is a fixed fraction of the screen, deliberately *not* measured from
content, so every eip tab opens to the same extent.

### The cap is 1, and the top stop MERGES the sheet into the page (2026-08-30)

`MAX_HEIGHT_RATIO` used to be **0.92**, and that 8% strip of visible scrim was doing two
jobs at once: it said "there is a page behind this", and it was the tap-to-dismiss
target. Raising the cap to **1** removes both, so the top stop had to grow chrome that
replaces them. `writeMergeChrome` (`SheetPanel.tsx`) interpolates a ratio `t` from 0 → 1
across the last **`MERGE_ZONE_PX` (64)** of travel below the cap and paints, all of it as
direct style writes on the sheet element:

| at `t = 0` (a sheet) | at `t = 1` (a page) |
|---|---|
| `border-radius: 20px 20px 0 0` | square corners |
| `flashcard.sheetShadow` | no shadow — a merged sheet is not a surface *on* anything |
| `padding-top: 10px` above the grabber | the status-bar inset, so the grabber clears the clock |

The header is **not** in that table: it is permanent chrome, identical at both ends of the
ramp. It was the fourth row until 2026-09-05 (clipped to zero at `t = 0`, full-height and
opaque at `t = 1`).

Because it is a linear function of the sheet's height, the merge is continuous under the
finger — there is no state flip at a threshold to pop mid-drag — and on an *animated*
write it inherits the same `SNAP_DURATION_MS` transition as the height, so the corners,
the shadow and the header all arrive exactly when the sheet reaches its stop. It writes
nothing on a frame where `t` has not moved, which is every frame of a drag below the
merge zone. Like the height, **none of it is React state** — same reason (see "Height is
imperative").

### The panel header

> **The eip does not use it (2026-10-29).** `InfoCardSection` passes no `title` and
> `showClose={false}`: the eip draws its own title row and close control (a down caret, not
> a ✕) in its UPPER panel, and the title row telescopes in only toward max — see **§ Telescope** below. Everything in
> this section still holds for every OTHER titled sheet (decks, compare, account, notebook).

The **`title`** prop supplies it; it is a real `PageHeader` (`size="node"`), not a
lookalike, so the header a panel wears is the app's one header. It lives in
`SheetHeaderSlot` (`sheetStyled.ts`) as the sheet's **second flex child**, directly under
the grabber row.

**The slot re-pads it.** `PageHeader`'s node spec is 23px above the row and **0 below**
(`SIZE_SPEC.node`) — right on a page, where that padding is the gap under the status bar
and nothing sits below the header but the page itself. A panel header is a *band*, with the
grabber above it and the body below, so the same asymmetry reads as the title and the ✕
shoved against the band's bottom edge. `SheetHeaderSlot` overrides both to
`SHEET_HEADER_PAD_Y` (12px), which centres the row at about the height the 23/0 version
had.

**It is present at every height (2026-09-05).** It used to be *merge* chrome — clipped to
zero by the slot and interpolated in over the last `MERGE_ZONE_PX`, so a panel only said
what it was once it had become the whole screen — with a `headerMode="always"` opt-out for
sheets whose body had no title row of its own (the compare sheet). Every call site wanted
the header at every height in the end, so the opt-out became the only mode and the prop is
gone. What this bought, beyond a panel that names itself at 60% height: the ✕ **stops
moving**. Three things went with the change —

- `SheetHeaderSlot` is a plain `flex-shrink: 0` wrapper (it was `height: 0;
  overflow: hidden; opacity: 0`), renamed from `SheetMergeHeaderSlot`;
- the mount-time measurement of the header's natural height is gone, along with
  `MERGE_HEADER_FALLBACK_PX` — nothing interpolates that height any more;
- `writeCloseOffset` is gone entirely (see the close cluster below).

**It carries the close cluster, not a chevron or a flame of its own.** `showBack={false}`
and `showFlame={false}`; the ✕ and, on study surfaces, `MinutePointsFireBadge` are passed
as `rightContent` instead. A chevron beside a permanent ✕ would be a second close button
doing the same thing, and `PageHeader` puts its own flame *last* — outboard of
`rightContent` — which would leave the flame in the corner rather than the ✕. `showFlame`
now has no caller at all in the sheet path; pages must never pass it.

**The whole header resizes the panel.** It is wrapped in `bindHeaderDrag` like the grabber
and the tab strip: the top edge is where a hand reaches to pull a sheet back down, and
before that binding only the 44px pill above it responded. `useDrag`'s `filterTaps` is
what keeps the ✕ inside it tappable.

Titles, one per host: the eip's **"More Info"** / **"Compare"** is drawn by its own upper
panel (§ Telescope), not through this prop; `FlashcardsDecksPage` passes
**"Cards"** / **"Decks"**, matching the pill that opened the sheet; `CompareSheet` passes
**"Compare"**. A panel with no `title` has no header and therefore no ✕ — it still grows to
full height, it just has no way out but a downward drag. Nothing ships in that state.

### The close cluster (✕ + flame)

One cluster per panel, in the header's right slot: `MinutePointsFireBadge` (study surfaces
only) then `SheetCloseX`, so the **✕ is the corner control** on every panel. `showClose`
overrides its presence; the default is "every modal panel has one, a persistent one does
not".

**Why study surfaces get the flame.** A panel covers its page's header, flame included,
and it does that precisely while the learner is reading a definition — which *is* study
time. So the eip panels on flp, scp and the cdp pass `showMinutePoints`, and the
indicator survives at every panel height. **Pull-up dictionary flows never show it**
(2026-10-06): `CompareSheet` and the Writing Notebook's `NotebookWordPickerSheet` omit the
prop. That changes only the indicator, not earning — the host page's own `PageHeader`
stays mounted under the sheet and its `useMinutePoints` tick keeps accruing. Only the **root** panel draws it (`depth === 0`):
a stacked child covers its parent completely, so a second flame would be one indicator
behind another, and a third `useMinutePoints` tick.

**It does not move (2026-09-05).** The cluster used to live in the grabber row and slide
between rows as the panel grew — down into the tab strip's row when the word trail
appeared, and (briefly) onto the merge header's title line once there was one.
`writeCloseOffset` measured the target row's centre against the chrome row's on every
frame of a drag, `EipTabStrip` reserved a 41px `CLOSE_COLUMN_PX` for the cluster to land
in, and `writeMergeChrome` re-ran the measurement whenever the merge ratio moved. All of
that is deleted. The header is permanent, so the cluster simply lives in it, and the panel's
one always-available control is in the same place at every height — which is the property a
thumb actually needs. The trail gets its reserved column back as usable width.

**The eip has no ✕ (2026-10-29).** Its close control is a down caret that closes the whole
panel through the render function's `dismiss` (§ Telescope). The trail's pop rule
(`onCloseX` → pop the showing word; popping the root closes the panel — § The trail is a
breadcrumb stack) now runs only on **Escape**, through `requestClose`; returning `true` from
`onCloseX` still means "handled, stay open".

### The trail is a breadcrumb stack

**Since 2026-10-29** the trail is a STACK, not a set of tabs: the showing word is always the
LAST crumb, and the trail always reads as the path from the root to it.

| Action | Effect on the stack |
|---|---|
| Drill into a NEW word (breakdown row, example segment, "used in" row) | push it |
| Drill into a word ALREADY on the stack, or tap its crumb | pop everything above it — it is the top again |
| Escape (desktop) | pop the top (back one word); popping the root closes the panel |
| Down caret (⌄) | close the panel; the stack is kept (it outlives the panel — below) |
| Open Compare with a Compare crumb already on the stack | pop down to it, refill slot A, clear slot B |

Any pop also cancels an in-flight drill-in lookup, so a fetch that lands after the learner
walked back cannot push onto the trail they left. A popped crumb's state (sub-tab, sense
pick) is discarded with it; the crumbs below keep theirs, so walking back restores each
word's last sub-tab.

Code: `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` → `useEipTabs`
(`activeIndex` is derived as `tabs.length - 1`, never set), `popTo`, `pop`,
`openForEntryKey`, `openCompareTab`; `EipTabStrip.tsx` (crumb tap → `popTo`); the hosts'
`onCloseX` (`EipSheet.tsx`, `FlashcardsLearnPage.tsx` → `pop`).

### The trail scrolls, holds up to 50 words, and outlives the panel

**Its row is always present** — it carries the down caret and the Dictionary eip's Add key
(§ Telescope) — but the **crumbs are hidden until the learner first navigates to another
word**: a panel opened on a word shows an empty trail slot, not a lone crumb repeating the
headword. The first push (a drill-in, or Compare) latches the crumbs on for that trail's
life, so walking back to the root still shows the root crumb; only a new root
(`openForRoot`, `clear`) resets it. Code: `useEipTabs` → `trailShown`, passed to
`EipTabStrip` as `showCrumbs` by `EipSheet.tsx` and `FlashcardsLearnPage.tsx`; the strip keeps
its flex slot while empty so the Add key never moves. It is a bare breadcrumb
(`过去 › 去`: CJK 15px words, the showing one in ink, chevrons between), not filled pills.

Three rules, all changed on **2026-09-06**:

- **It scrolls sideways.** `.eip-entry-tab-list` is an `overflow-x: auto` row: touch pans
  it natively (`touch-action: pan-x`, `overscroll-behavior-x: contain` so the end of the
  trail does not rubber-band the sheet), and desktop drags it with the shared
  `useDragScroll` mouse-drag hook — the same gesture the card shelves use. No scrollbar is
  drawn; the pill cut off at the edge IS the affordance.
  The trail is no longer the upper panel's only sideways scroller: in the Dictionary eip
  (`showAllDefinitions`) the header gloss is a `SwipeableTwoLineText`
  (`src/components/SwipeableTwoLineText.tsx`), also `touch-action: pan-x` so vertical drags
  stay with the sheet's resize, with its own rubber band at the ends
  (`src/hooks/useEdgeRubberBand.ts`). See docs/SHELF_REDESIGN.md § 7b.
- **It is capped by COUNT, not by width** — `MAX_EIP_TABS` (50) in `useEipTabs`. It used to
  be a width gate (`fitsNewTab`, which measured a candidate pill off-DOM and refused any
  word that would not fit the row entirely) because a half-pill reads as "scroll for more"
  on a row that does not scroll. The row scrolls now, so that reading is true, and the
  measuring apparatus (`measureTabWidth`, `readStripGeometry`, `fitsNewTab`, the per-tab
  `measuredWidth` cache, and the `stripRef` the hook took to read the geometry) is deleted.
  `TooManyTabsSnackbar` still fires on the counter, now at 50 rather than after a handful.
- **The active pill is scrolled into view** whenever the active index or the tab count
  changes — twice, because a just-pushed pill is mid-entrance (`eipPillIn` widens it from
  `max-width: 0`) and a scroll aimed at it then lands short. The second pass runs at
  `EIP_PILL_IN_MS`; on an already-mounted pill both passes are no-ops (only the distance
  needed to bring the pill inside the row is scrolled). ⛔ It scrolls the pill row's OWN
  `scrollLeft` (`EipTabStrip.tsx` → `scrollActiveIntoView`), never `scrollIntoView`: that
  scrolls every scrollable ancestor too, and during the open slide (§ Open slide) the pill
  is below the frame — opening Compare scrolled the phone frame itself, which is
  `overflow: hidden` and so stayed shifted (fixed 2026-10-30). The same rule holds for
  anything inside a sheet: no `scrollIntoView`, and `focus({ preventScroll: true })`.

**The trail now outlives the panel.** Closing the eip no longer clears the tabs — the trail
belongs to the CARD, so reopening the sheet on the same card resumes the same drill-in
chain on the same word. It is dropped when the ROOT changes: the flp's next card (the
`currentIndex` reset effect, plus `openForRoot` reseeding), another card's info button on
scp, or the page unmounting. (The cdp is unaffected — it has no entry-tab
strip at all; it drills in by NAVIGATING to the tapped word's own card detail, and its
content sub-tab already survives a close for the page's life.)

### Telescope — the eip's two panels (2026-10-29, Tower Tier 2)

The eip is two stacked panels (design file "Tower Tier 2 - Time of Day", EIP artboards):

| Panel | Rows | Component |
|---|---|---|
| **Upper** — the tinted `ground` | TITLE (⌄ "More Info" / "Compare" + flame — a leaf `PageHeader`; maximized only) · TRAIL (⌄ · words · Add key) · HEADER (headword tile, gloss — a multi-sense word lists every sense, chosen one underlined) | `EipUpperPanel` |
| **Lower** — the white SHELF | its own small grabber · content tabs (sunken segmented track) · tab body | `InfoCardSection` (`.eip-shelf`) + `InfoCardPanelBody` (`hideEntryHeader`) |

The shelf has a 24px top radius and a solid 3px `edge` lip above it; the sheet's `surface`
(the upper panel's ground) shows in its corners.

The content tabs' selected state is ONE white chip that **slides** between the three
segments (`styled.ts` → `InfoSheetTabIndicator`, driven by `selectedTab`), on the same
280 ms easing as the content panes below (`TAB_SWIPE_TRANSITION`), so chip and pane arrive
together whether the tab was tapped or swiped.

**The upper panel TELESCOPES.** It is SheetPanel's opt-in telescope (`telescopeRef`,
`SheetTelescopeHandle`): SheetPanel writes the upper frame's height on every height write,
with the same transition, piecewise linearly in the sheet's height:

```
sheet h:   0 ────────── open (default) height ────────── max
upper:     0 ──linear──▶ rest                ──linear──▶ rest + extra
lower:     the remainder (flex: 1)
```

`rest` is the panel's natural height without the title row, `extra` the title row's (both
measured by a ResizeObserver, never in the per-frame write — `measureTelescope`). So as the
sheet opens, BOTH panels grow from 0 together; pulled toward max, the upper panel grows
again to reveal "More Info" and the flame. The frame clips and bottom-anchors its content
(`justify-content: flex-end`), so a short frame shows the header first and the title row
is the last thing revealed. A content change (a two-line gloss, the Compare tab) re-places
the frame at the current height.

**Close is a down caret (⌄), shown at every height (2026-10-29).** It replaces the ✕
entirely and sits where a page header's back chevron sits. SheetPanel's own header and ✕
are off for the eip (`showClose={false}`, no `title`); the caret calls SheetPanel's
`dismiss` (handed out by the `children` render function), which closes the whole panel —
it does NOT run `onCloseX`, so it never pops a word.

- **At and below the open height** the caret is the first thing in the TRAIL row.
- **Toward max** the TITLE row telescopes in with its own caret, and the trail-row caret's
  slot narrows to 0 and fades over the same travel, so the crumbs slide left into its
  place. It reads `--sheet-telescope-t` (0 at the open height → 1 at max) and
  `--sheet-telescope-transition` (the snap's duration, or `0ms` while dragging), which
  `writeTelescope` sets on the frame alongside its height.

**The title row is a real `PageHeader`** (leaf size, `arrowDirection="down"`,
`safeAreaTop={false}`, `titleColor` = the palette ink, flame only with
`showMinutePoints`), so a maximized eip puts its caret, title and flame on exactly the
pixels a drill-in page's header would: the merged sheet's top padding is the status-bar
inset (`writeMergeChrome`, with `edgePadding` off below), PageHeader adds the leaf's 27px,
and its 18px side padding is the panel's own gutter. The flame rides the title row, so it
shows only toward max.

**There is no top grabber** (`SheetPanel` `showGrabber={false}`, 2026-10-29): the whole
upper panel and the shelf's small pill are the resize handles (`bindHeaderDrag`).

**No sheet edge padding** (`edgePadding={false}`): the sheet container's own 10px top /
18px bottom padding is dropped, so the upper panel starts at the sheet's top edge and the
white shelf runs to its bottom edge — with it on, the time-of-day `surface` showed as a band
under the shelf and a gap above the telescoping upper panel. At full merge the top still
takes the status-bar inset (`writeMergeChrome`).

Code: `src/components/sheet/SheetPanel.tsx` → `SheetTelescopeHandle`, `writeTelescope`,
`measureTelescope`, `surface` / `showGrabber` / `edgePadding` props;
`src/features/flashcards/FlashcardsLearnPage/EipUpperPanel.tsx`, `InfoCardSection.tsx`.

**Removed with it:** SheetPanel's `tabStrip` slot and its "grow the sheet for the strip"
ResizeObserver. The trail was the slot's only user, and an always-present trail inside the
telescope never appears mid-session, so there is nothing to grow for.

### Time of day — the eip's palette (2026-10-29)

The eip follows the learner's time of day, at the same hour as the Deck Tower. The shared
CLOCK is `src/timeOfDay/useDayClock.ts` → `useDayClock` (moved out of `features/deckTower`;
it also carries the feature-tester override, now a module store so every reader agrees).
`eipPalette.ts` → `eipPaletteAt(time)` turns it into an `EipPalette`; `useEipPalette.ts` →
`useEipPalette` samples it; `EipPaletteContext.tsx` → `EipPaletteProvider` (mounted by
`InfoCardSection`) publishes it, and pieces read it with `useEipColors()` (the DAY palette
outside a provider — the cdps' inline panels).

- **Dawn / day / sunset** tint only the upper panel's ground and wells (rose / pale
  sky / peach). Keys, shelf, cards and ink stay as by day.
- **Night** is the design's *Night–inverted*: slate panels (#2A3446 upper, #1E2735 shelf),
  light ink, cards a lifted slate. The provider also **re-themes the subtree** — the
  flashcard palette's ink/border tokens are swapped — so everything that reads
  `theme.palette.flashcard.*` (cpcd, dd, synonyms, compare) follows without knowing.
- Phases **blend** across the 30-minute twilights (`eipPaletteAt` mixes the fills). Ink cannot
  blend; it flips to night's once night is the larger share (`phaseShare`).

**Does not follow night:** anything reading `COLORS.*` directly — notably `SheetCloseX` (fixed `textFaint`). (The SensePicker's
white menu used to be listed here; the eip header no longer mounts the picker.)

**⚠️ Outside the colour framework** (like the tower's `PHASE_SKY`): the phase grounds and
wells, the whole night palette, the shelf grabber (#D2D2D8 — no token is close)
and the Add key's check green (#008A48). Design values mapped to the NEAREST token instead:
`--edge` #E2E2E6 → `COLORS.grey` #E7E7EA; `--line` .08 → `COLORS.rowBorder` (.10); the
selected tab chip's `0 1px 2px @.12` → `SHADOW.rest` (@.05). The Dictionary page's tier-2
ground (`src/timeOfDay/tier2Look.ts`) carries the same dawn/day/sunset hexes for its page.

### Add key — the Dictionary eip's Learning key (2026-10-29)

`EipAddKey` — the design's `.kc.add`, built exactly: a 92px raised key in the trail row,
at its right end (`+ Add` on a 5px lip, lifted 1px; held, it sinks 4px and loses the lip;
`✓ Added!` sits 2px low on a 2px lip with a green check). Driven by `useLearningToggle`
(EipSheet `showLearning`, Dictionary page only); tapping "Added!" removes. The hook is
optimistic: Add ⇄ Added! flips on the tap and the request follows after paint, so the key is
never disabled waiting on the network (LEAF_NODE_PAGES.md § "Read-only dictionary cdp"). **No glow** —
the dictionary cdp keeps its glowing `LearningToggle` under the header speaker. Adding a word
is a Dictionary-flow action only: no other eip host (flp, scp, saved-card cdp, iw) offers one —
the flp's old add-only "+" for drilled-in words was removed 2026-10-29.

**Both eip keycaps press the same way** — the Add key and the headword tile use the app's
raised-key press, `src/theme/keycapPress.ts` → `keycapPressSx`: they SNAP down onto the lip
and back up with no transition. Since 2026-10-29 (by request) that is EVERY raised keycap in
the app — the tower plates (`towerPlate.ts` → `towerPlatePressSx`), the scp toolbar, the
Dictionary page's keycaps and the beginner keyboard all spread the same helper. It used to
animate (the scene plate's 80 ms ease-out sink and 220 ms overshoot pop).

**`:active` does not work in the upper panel.** Both keys sit inside its drag handle, and
`useDrag` captures the pointer onto the handle on pointerdown; Chrome then applies `:active`
to the capture target, not the key under the finger, so a CSS-only press never shows. The
keys get their pressed look from pointer events instead — the app-wide keycap delegate
(`src/utils/keycapPressDelegate.ts` → `installKeycapPress`, below), which hears the release
on `window`, so the handle's capture does not matter.

**Every raised key presses through one delegate** (2026-10-30). `keycapPressSx` marks its
element with the custom property `KEYCAP_MARKER_PROPERTY` (`--keycap-press: 1`, registered
non-inheriting), and a single capture-phase `pointerdown` listener on `window` (installed
in `src/main.tsx`) finds the marked key under the finger and adds `KEYCAP_PRESSED_CLASS`
directly on the DOM — no React render, so the press is on the next frame even when the
tap's click does heavy work. A release sooner than `KEYCAP_MIN_HELD_MS` (100 ms,
`src/theme/keycapPress.ts`) keeps the key down for the rest of it; 8px of travel (a sheet
drag, a scroll) or a `pointercancel` lets it up at once. Disabled keys (`:disabled`,
`aria-disabled="true"`) are skipped, presses are per pointer, and a `MutationObserver` puts
the class back if React rewrites a held key's `className` (the Add key flips to Added! on
the tap itself). No consumer wires anything: the tower plates (Write it, Compare, More
Info), these two eip keys, the scp toolbar, the Dictionary page's keycaps and the beginner
keyboard all get it by spreading `keycapPressSx`.

### Height is imperative, not React state

`heightRef` + a direct write to `element.style.height` (`writeHeight`) are the only
owners of the sheet's height; `height` never appears in the JSX `style` prop, so
React has no record of it and can never overwrite it. This matters because callers
pass `children` as a **render function** (`InfoCardSection`), so any state update in
`SheetPanel` re-renders the whole eip body — which, at one update per touchmove and
per momentum frame, produced the long frames that made flings stutter and die early.

`writeHeight(h, animate)` also owns the CSS transition: it is set for exactly the one
write that wants it and cleared for every other. So grabbing a snapping sheet returns
to 1:1 finger tracking immediately instead of trailing by the snap duration.

`freezeHeight()` pins the sheet to its **on-screen** height (via
`getBoundingClientRect`, minus any open slide's offset) and kills the transition. It is called on a gesture's first
*real movement*, never at touch-down — so a tap can't interrupt the open animation,
but a drag always takes over from what the user sees rather than from an animation's
not-yet-reached target.

### Open slide (transform, not height) — 2026-10-30

A modal sheet's OPEN is the one motion not on the height model: `playEntrySlide` lays the
sheet out at its open height in one write and slides it up from below the frame
(`translateY(h + ENTRY_SLIDE_SHADOW_CLEARANCE_PX)` → `0`, `SNAP_DURATION_MS` ease-out),
then hands back (`endEntrySlide`). Animating `height` from 0 re-laid-out the whole eip body
on every frame of the open; a transform is compositor-only. Side effect: the telescope
frame (upper panel) is at its open height from the first frame rather than growing with
the sheet.

While the slide runs, the visible height is `heightRef − translateY`. **Every height write
takes over from it**: `writeHeight` (and `applyResize`, which reads `heightRef` first)
call `endEntrySlide(true)`, which pins the height to what is on screen and clears the
transform before the write — so a grab, a wheel tick, a scrim-tap dismiss or Escape during
the slide continue from where the sheet visibly is. Drags, snaps and the dismiss still
animate height.

While it slides the sheet is laid out BELOW the frame, so anything in it that asks the
browser to reveal itself (`scrollIntoView`, a `focus()` without `preventScroll`) scrolls
the frame instead — see § "The trail scrolls, holds up to 50 words, and outlives the panel" → the active-pill scroll.

---

## Gesture mode lock

A touch gesture picks one mode on its **first committed move** and keeps it for the
rest of the gesture *and* for its release momentum. Modes never cross over: a resize
that reaches a boundary is a hard stop, and the user must lift and start a fresh
gesture to begin scrolling (or vice versa).

- swipe **up** (`dy > 0`) → `resize` while there is room to grow, else `scroll`
- swipe **down** (`dy < 0`) → `scroll` while the content is off its top, else `resize`

### Only `resize` is driven by JS; `scroll` is native

The mode decides *who moves the pixels*, and this is the load-bearing part:

| Mode | Driver | `preventDefault()`? |
|---|---|---|
| `resize` | `applyResize` → a direct write to `element.style.height` | **yes** |
| `scroll` | the **browser**, panning the body's scroller | **no** — the handler returns |

A body's scroller therefore MUST carry `touch-action: pan-y` (plus
`overscroll-behavior: contain`, since the browser now owns the pan and would
otherwise chain it into the page behind the sheet). `SheetPanel` cancels only the
touchmoves it converts into a resize, and the mode is locked on the gesture's
**first** committed move — the one touchmove that is still cancelable — so a resize
is never lost to a scroll the browser already started.

> **Why (2026-08-24).** `scroll` mode used to do `scrollEl.scrollTop += dy` inside
> this non-passive handler, with the scroller pinned to `touch-action: none`. That
> put the scroll on the **main thread**, so every frame of it waited on whatever
> React/layout work the body was doing. On a light body (the eip) it was invisible;
> on the decks panel — ~470 mini cards, each with a cpcd row that re-measures itself
> — it stuttered badly. The tell was that the *identical* card grid on
> `CollectionViewPage` scrolled fine, because that page has always scrolled
> natively. Handing `scroll` back to the compositor closed the gap.

> **The eip's own panes were missed by that change (fixed 2026-08-28).**
> `InfoCardSection` kept passing `scrollTouchAction="none"` down to
> `InfoCardPanelBody`'s three tab panes, so in the eip `scroll` mode did nothing at
> all: `SheetPanel` correctly stopped writing `scrollTop`, and the browser refused
> to pan a `touch-action: none` element. The symptom was that a drag grew the sheet
> normally but the content stayed frozen once the sheet hit max height — visible
> only on the est tab, the one pane whose content routinely overflows. The panes now
> pass `pan-y`, which also leaves the tab-swipe free to `preventDefault` horizontal
> moves (the browser never owns those under `pan-y`).

---

## Release: snap, dismiss, or fling

Release velocity is measured over the **last `VELOCITY_WINDOW_MS` (90ms)** of samples,
not smoothed over the whole gesture — so a quick flick at the end of a slow drag still
flings. A release landing more than that window after the last move counts as
stationary (velocity 0): the finger was parked when it lifted.

On `touchend` (only when the *last* finger lifts):

1. `resize` mode and height < default → **dismiss**. This is the only way a swipe
   closes the panel.
2. `|v| < FLING_MIN_VELOCITY` → **settle** (`computeSnapTarget`).
3. otherwise → **momentum** — `resize` mode only. A `scroll` gesture is the
   browser's, fling included; running our rAF momentum on top of a native fling
   would double-scroll, so `touchend` returns early for it.

### Momentum floors at the default height

Momentum in `resize` mode is clamped to `[default, max]` — **not** `[0, max]`. So a
downward fling coasts to the default height and **stops there; momentum never
dismisses.** An upward fling stops dead at max. Inertia still cannot cross between
the two modes — not because momentum is mode-locked (it no longer has a `scroll`
arm at all), but because the gesture's mode is locked before either kind of inertia
can start.

Momentum integrates with a capped frame time (`MOMENTUM_MAX_FRAME_MS`, 32ms) so one
janky frame can't teleport the sheet or wipe out the fling through the
`decay^(dt/16)` term. Whenever momentum ends — decayed out or stopped at a boundary —
`resize` mode runs `settle()` so it always comes to rest on a stop.

The live-finger path uses floor `0` (that's the dismiss gesture); only momentum uses
the default-height floor. That's the whole difference, expressed as the `minH`
argument to `applyResize`.

### Wheel (desktop)

`deltaY > 0` grows the sheet; `deltaY < 0` shrinks it, but only from the top of the
content. A wheel gesture has no release, so crossing below the default height
dismisses immediately. Only the top-most mounted `depth` reacts (module-level
`mountedDepths` set); touch is already top-only via DOM hit-testing.

### Escape key (desktop)

Escape does exactly what the ✕ does: both call `requestClose`, which runs `onCloseX`
first and only `dismiss()`es when it does not return `true`. So on the eip, Escape pops
the word that is showing, and the panel closes only when the root itself is popped. Only the **most recently opened dismissible panel** reacts. That panel is tracked
by a module-level `escapeStack` of per-panel tokens in mount order. It is separate from
`mountedDepths` because that set is keyed by depth and also holds persistent sheets.
Persistent panels (`minHeight > 0`) never register. Escape still works while focus is
in a text field inside the sheet. It is ignored when the key auto-repeats (holding
Escape would empty the trail at once), during IME composition, and when it comes from
inside an MUI Modal/Dialog. MUI handles Escape for its own dialogs and does not stop
the event from propagating, so without that check one press would close both the dialog
and the sheet under it.
Code: `src/components/sheet/SheetPanel.tsx` → `requestClose`, `escapeStack`, the
"Escape = the ✕" effect.

### Dismiss

`dismiss()` is idempotent (`dismissingRef`), stops momentum, animates to 0, and calls
`onClose` on a `SNAP_DURATION_MS + 20` timer — a timer rather than `transitionend`
because the duration is ours and a timer can't be missed if the transition is
interrupted or never fires. **Tapping the scrim goes through `dismiss()` too**; it used
to call `onClose` directly, so the sheet and its dim vanished in a single frame while
every other close path shrank.

`dismiss()` also **fades the scrim out** over `SCRIM_FADE_OUT_MS` (= `SNAP_DURATION_MS`),
so the dim leaves with the sheet instead of staying fully lit for the whole shrink and
then popping off. The fade IN is the other half and lives elsewhere: a mount-time
keyframe on `EicScrim` (`eicScrimIn`, 0.18s), because mounting is the whole trigger.
The fade OUT cannot work that way — only `SheetPanel` knows a dismiss has begun — so it
is written imperatively (`scrimRef`), for the same reason the height is: a state flag
would re-render the entire sheet body through the `children` render function on the way
out. It sets `animation: none` first and flushes, so the transition starts from a real
computed opacity of 1 rather than from the finished keyframe.

A host that unmounts the panel WITHOUT going through `dismiss()` (a route change, say)
still gets no fade — there is no animation frame left to play it in.

---

## The scrim covers the screen — and must share the sheet's stacking context

`EicScrim` is `position: absolute; inset: 0`, which dims exactly its nearest positioned
ancestor. Rendered in place that ancestor was the host page's content area (flp's
`ContentArea`), so the page's own header stayed bright and the dim read as covering only
part of the screen. `SheetPanel` therefore **portals** the scrim out, in a layout effect
that walks up from the panel's in-place anchor (`nearestScrimHost`, `SheetPanel.tsx`).
Since 2026-08-30 the **sheet is portaled to the same host**, for the height reason in
"Mount sites" above; everything below about choosing that host applies to both layers.

The host is **not** unconditionally the phone frame. It is the nearest ancestor that
satisfies BOTH of:

1. **It creates a stacking context** (`transform` / `filter` / `perspective` /
   `backdrop-filter` / `contain` / `will-change: transform`) — or it IS the frame-level
   host, which is where the walk stops.
2. **It covers the frame** (rect check). An animated inner box could satisfy (1) without
   filling the screen; hosting there would dim a box instead of the page, so the walk
   falls back to the frame-level host.

`document.body` is the last-resort fallback.

**The frame-level host is `.mobile-demo-frame`** (`FrameRoot`), and it works only because
that element is **positioned**. Sheet layers are `position: absolute`, which resolves
against the nearest positioned ancestor; `FrameRoot` was once static, and hosted there the
sheet escaped the frame entirely and pinned itself to the initial containing block. On
mobile that is invisible (the frame is full-bleed, so the two rects coincide), but on
**desktop the frame is a 402px centered card and the sheet spanned the whole browser
window** (fixed 2026-09-06). `FrameRoot` now carries `position: relative` itself — it is
what the footer bar pins against — and its height is the on-screen height, which is what
`parentElement.clientHeight` in the height model wants.

> Until 2026-09-13 the host was an inner `FrameViewport` box, which existed to reserve a
> strip at the bottom of the iOS home-screen app. That strip turned out to be the bug
> rather than a necessity, so the box is gone and `position: relative` moved up to
> `FrameRoot` — see [IOS_STATUS_BAR_BUG.md](./IOS_STATUS_BAR_BUG.md) § 3 round 6.

**Why (1) matters — the cdp bug (fixed 2026-08-24).** z-indexes only compare inside a
shared stacking context. `NodePage`'s `Surface` carries the page-slide `transform`
(`usePageSlide`), which both creates a stacking context and becomes the containing block
for absolute descendants. The sheet's `11 + depth·2` was sealed inside `Surface`, `Surface`
itself competed at `auto`, and a frame-hosted scrim at `10 + depth·2` painted over the
entire page **including the sheet** — the cdp's eip looked greyed out the whole time it
was open. Hosting the scrim inside `Surface` puts the two back in one context. Any new
page archetype that transforms its surface inherits the fix automatically.

- **Not `position: fixed`** — on desktop that resolves against the viewport and would dim
  the browser window around the phone card.
- **Plain pages are unchanged.** flp's content area is `position: relative` with
  `z-index: auto` and creates no stacking context, so the walk still reaches the frame.
- **The footer is hidden for every modal sheet, by the sheet itself** (2026-08-30).
  `SheetPanel` calls `useHideFooter(minHeight <= 0)`, so the hold covers its whole
  lifetime on every host and is released on unmount. It used to be each page's job —
  `useHideFooter(eipOpen)` in `SortCardsPage`, `useHideFooter(infoOpen)` in
  `VocabCardDetailPage`, **both now deleted** — which left flp and fdp's modal sheets
  without one. A **persistent** sheet keeps the footer: it is page furniture whose
  resting height is chosen to clear the bar, not a modal that takes over the screen.

  Hiding the bar is not cosmetic. It is opaque, rendered at frame level
  (`FooterPresenter`, z-index 100) and outside every page's DOM, so it covered the
  sheet's bottom ~`FOOTER_CLEARANCE`px — including the end of whichever tab pane was
  showing. The pane still scrolled (its content had already reached the end); the end
  was simply underneath the bar, which read as "this tab refuses to scroll". That was
  the cdp definition-tab report (fixed 2026-08-28). Note the sheet's z-index now clears
  the bar on its own (1201 > 100); the hold is what keeps the bar from sitting *beside*
  a full-height sheet with nothing to do.

---

## Drag zones outside `root`

The grabber, the eip's upper panel (trail + entry header) and the shelf's grabber sit
**outside** the body's `root`, so the raw touch listeners never see them. They share `bindHeaderDrag`
(`useDrag`, `axis: "y"`, `filterTaps: true`) instead, which tracks absolutely from
the height captured on the drag's first real movement and calls the same `settle()`
on release. `filterTaps` keeps taps on header icons and tab chips working.

## Off-screen panes mount late

`InfoCardPanelBody` renders only the ACTIVE pane's content on the opening commit. The
other panes' scrollers are mounted (empty) from the start — so `paneRefs`, the edge fades
and the track never change shape — and their `InfoCardTabContent` fills in once
`panesWarm` flips: `OFFSCREEN_PANES_WARM_MS` (260 ms, just past the open slide) after
mount, or at once on the first touchstart on the track (a swipe must find its neighbour
drawn). A tapped tab needs nothing: the active pane always renders. One-way — once warm,
all panes stay mounted for the panel's life.

## Interaction with the body's own horizontal swipe

`InfoCardPanelBody` binds its own **raw** touch listeners on an inner clip box so its
`stopPropagation()` runs before `SheetPanel`'s ancestor listener (React synthetic
handlers would be too late — see the long comment at `InfoCardPanelBody.tsx`'s gesture
effect). It swallows every touchmove until its axis lock resolves; if it resolves `y`
it stops interfering and `SheetPanel` sees one correct larger delta covering the
gesture so far.

### Rubber-band at the ends of the tab strip

Toward a neighboring tab the finger delta is clamped to one pane width. Toward an
**end** of the strip — left on the last tab (breakdown / "used in"), right on the first
(definition) — the track used to clamp to exactly **zero** travel, which is visually
indistinguishable from "this tab has no swipe at all". It now rubber-bands instead:
the track follows the finger at `TAB_SWIPE_EDGE_RUBBER_RATIO` (0.25) of its travel,
capped at `TAB_SWIPE_EDGE_RUBBER_MAX_PX` (40px), and springs back on release. The cap
sits far below the commit threshold (`paneWidth · TAB_SWIPE_COMMIT_RATIO`) and
`settleDrag` rejects out-of-range targets, so an overscroll can never land on a tab
change. See `InfoCardPanelBody.tsx`'s touchmove handler and the constants block in
`src/features/flashcards/constants.ts`.

---

## Word-trail transitions (entry pager)

Two horizontal motions live in this panel and they must not fight:

| Motion | Scale | Owner |
|---|---|---|
| Sub-tab track (definition / examples / breakdown) | one pane | `InfoCardPanelBody` — declarative transform + `TAB_SWIPE_TRANSITION`, plus the drag path above |
| **Entry pager** (word ↔ word in the trail) | whole panel body | `InfoCardSection` |

A drill-in (breakdown character, example segment, "used in" row) pushes a **new pill**
onto the trail whose sub-tab starts at Definitions. Because the body is a single
persistent instance serving every entry tab, that used to show up as the sub-tab track
sliding **backwards** to Definitions — motion that read as "you went back" while the
trail had in fact grown forwards.

Now:

1. **The sub-tab track jumps silently on an entry change.** `InfoCardPanelBody`'s
   entry-jump `useLayoutEffect` pins the track inline with `transition: none` at the new
   entry's resting transform, flushes, and hands the position back to the declarative
   style on the next frame. Its `entryJumpRef` also suppresses the `selectedTab` effect's
   inline-clear for that one frame (which would otherwise restore the transition and let
   the suppressed slide play). Both the rAF and the effect cleanup clear the pin, so a
   second drill-in in the same frame cannot leave the track frozen. The effect depends on
   `selectedTab` as well as the entry key and gates on the key having actually changed —
   a plain sub-tab tap keeps its normal slide.
2. **The panel body slides in from the side the trail moved.** `InfoCardSection` runs a
   WAAPI enter animation (`ENTRY_SLIDE_TRAVEL_PCT` 34%, `ENTRY_SLIDE_MS` 280ms, easing
   matched to `TAB_SWIPE_TRANSITION`) on a wrapper around the body whenever the active
   tab's **id** changes; the direction is the sign of the `activeIndex` delta, so a pushed
   word enters from the right and a pop (Escape, or tapping an earlier crumb) enters from the
   left. Hosts opt in by passing `entryTabId` / `entryTabIndex` (flp and scp do; the
   cdp has no trail and passes neither, disabling the animation).
   - It is **enter-only** — the outgoing word's DOM is already gone — which is why the
     travel is a fraction of the panel width rather than a full page.
   - It is **imperative, not a keyed remount**: remounting would tear down the three
     always-mounted panes, re-bind `bodyKey`'s scroll coupling, and drop per-pane scroll.
   - The wrapper sets `overflow: hidden` only for the animation's duration, so nothing
     the panel legitimately overhangs with (menus/popovers) is clipped at rest.
3. **The new pill grows into the strip.** `EipEntryTab` carries a mount-time keyframe
   (`eipPillIn`, `styled.ts`) animating max-width + horizontal padding + opacity, so the
   pills already on the strip are pushed aside rather than jumped aside. A pill only ever
   mounts when a word is added to the trail, so the mount *is* the trigger — no state.

---

## Header tap-to-copy (headword)

**Added 2026-09-06.** Tapping the eip header's headword copies it. Successive taps
**alternate**: the first copies the **characters**, the next copies the **pinyin**, then it
cycles back — each confirmed by a small floating caption ("Characters Copied!" /
"Pinyin Copied!") that self-dismisses after `COPY_MESSAGE_MS` (1.4 s).

- **Where it lives.** The behaviour is a `CPCDRow` property (`tapToCopy`, defaulting to
  false), threaded through `ForeignText` and switched on for the eip header's
  `ForeignText` in `EipEntryHeader` (and the Dictionary page's result headwords,
  `DictionaryEntryRow.headwordTapToCopy`). It is opt-in because most cpcd surfaces
  already own the tap (flip the card, select a segment); the eip header is the one place
  the headword is shown purely as a reference, so a tap there has nothing else to mean.
- **The headword sits in a pressable KEYCAP (2026-10-29).** The raised tile around it
  (`.mobile-demo-eic-headword-tile`, a `ButtonBase`) sinks onto its 4px lip while held with
  the app's raised-key press (`keycapPressSx`, § Add key), and the WHOLE tile copies: a tap on its padding is forwarded as a click on
  the cpcd row (`EipEntryHeader` → `copyFromTile`), so CPCDRow stays the one copy
  implementation (alternation and caption included).
- **The caption is the est's popup**, not a new widget: `CpcdPopup`
  (`src/components/CpcdPopup.tsx`), anchored to the row's root element, non-interactive,
  class `.cpcd-row__copy-toast`. See
  [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) § "Segment popup → eip drill-in".
- **What is copied.** Characters = the row's items joined; pinyin = each item's syllable
  joined by spaces, empty syllables dropped (so it matches how the row reads on screen and
  how the dictionary stores a pronunciation). A row with **no** pinyin at all never enters
  the pinyin leg — it always copies characters.
- **Which field is next** is a ref, not state: it must advance synchronously so a fast
  double tap sees the first tap's result, and it drives no rendering.
- **Clipboard fallback.** `src/utils/copyToClipboard.ts` prefers
  `navigator.clipboard.writeText` and falls back to a hidden-textarea `execCommand('copy')`,
  because the async Clipboard API only exists in a secure context and this app is regularly
  opened over plain http on the LAN. A failed copy says "Copy failed" rather than claiming
  success.
- **It does not fight the sheet drag.** The header doubles as the drag-to-resize handle
  (`headerDragBind`), but `useDrag` is configured with `filterTaps`, so a tap is not a drag
  and the click still reaches the row.
- **Latin-script (es) headwords are unaffected** — `ForeignText`'s plain-text branch has no
  pinyin half to alternate with and ignores the prop.

---

## Pane scrollbar (overlay, never a gutter)

Each eip tab pane hides its native scrollbar (`hiddenNativeScrollbarSx`) and gets a thin
thumb drawn **over** its content by `OverlayScrollbar`. A classic desktop scrollbar takes
~15px of width, and reserving that width (`scrollbar-gutter: stable`, the old approach)
pushed every pane's content off-centre. The thumb is display-only (`pointer-events:
none`) — wheel/trackpad/touch still scroll the pane — appears while the pane scrolls and
fades out ~0.9s after. It is a sibling of the scroller inside a non-scrolling
`.mobile-demo-tab-pane-slot`, so it neither scrolls with the content nor gets clipped by
the pane's edge-fade mask.

Code: `src/components/OverlayScrollbar.tsx` → `OverlayScrollbar`,
`hiddenNativeScrollbarSx`; `InfoCardPanelBody.tsx` (the pane slot).

## Referenced code

- `src/components/sheet/SheetPanel.tsx` — everything above
  (the scrim portal host, constants block, `computeSnapTarget`, `writeHeight`/`freezeHeight`/`applyResize`,
  the open slide: `playEntrySlide`/`endEntrySlide`/`entrySlideOffset`,
  `settle`/`dismiss`, `bindHeaderDrag`, the wheel + touch effect, `startMomentum`,
  the telescope: `SheetTelescopeHandle`, `writeTelescope`, `measureTelescope`)
- `src/features/flashcards/FlashcardsLearnPage/EipUpperPanel.tsx` — the eip's upper
  panel (PageHeader title row, trail row with the down caret, entry header slot); the
  telescope's frame
- `src/features/flashcards/FlashcardsLearnPage/EipAddKey.tsx` — the Dictionary eip's
  Add ⇄ Added! key
- `src/features/flashcards/FlashcardsLearnPage/eipPalette.ts` (`eipPaletteAt`,
  `EIP_DAY_PALETTE`), `useEipPalette.ts` (`useEipPalette`, `useEipColors`),
  `EipPaletteContext.tsx` (`EipPaletteProvider`) — the time-of-day palette
- `src/timeOfDay/dayPhase.ts` (`timeOfDayAt`, `phaseShare`) and `src/timeOfDay/useDayClock.ts`
  (`useDayClock`) — the shared clock
- `src/components/sheet/SheetCloseX.tsx` — the shared ✕ (every sheet but the eip), also worn by the challenge
  sheet (`src/features/studyChallenge/ChallengeSheet.tsx`, docs/STUDY_CHALLENGE.md § 3.2)
- `src/components/PageHeader.tsx` — `rightContent`, which is how the panel header carries
  the close cluster
- `src/features/flashcards/FlashcardsLearnPage/InfoCardSection.tsx` — eip wiring,
  `bodyKey` (re-binds the coupling when the active tab's scroller changes), the entry
  pager slide (`entryTabId` / `entryTabIndex`)
- `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — body handle,
  per-pane scrollers (each with an `OverlayScrollbar` thumb), deferred off-screen panes
  (`panesWarm`, `OFFSCREEN_PANES_WARM_MS`), horizontal tab-swipe axis lock, end-of-strip rubber-band, the
  entry-jump layout effect (`entryJumpRef`)
- `src/components/OverlayScrollbar.tsx` — the pane scrollbar thumb (§ Pane scrollbar)
- `src/features/flashcards/FlashcardsLearnPage/styled.ts` — `EipEntryTab` + the
  `eipPillIn` entrance keyframes; `InfoSheetTabStrip` / `InfoSheetTab` (the segmented
  content tabs)
- `src/features/flashcards/FlashcardsLearnPage/EipTabStrip.tsx` — the trail breadcrumb
  (always shown; rendered inside EipUpperPanel's trail row)
- `src/features/flashcards/constants.ts` — `TAB_SWIPE_*` gesture constants
  (axis lock, commit ratio, transition, edge rubber-band)
- `src/components/CPCDRow.tsx` — `tapToCopy` (the header copy gesture) and
  `src/components/CpcdPopup.tsx` — the shared caption card it confirms with
- `src/utils/copyToClipboard.ts` — clipboard write with the non-secure-context fallback
- `src/components/CompareWorkspace.tsx` — the other sheet body;
  `src/components/CompareSheet.tsx` — the host that pairs it with a `SheetPanel` off the flp
- `src/features/flashcards/DecksPanelBody.tsx` + `FlashcardsDecksPage.tsx` — a second
  MODAL host (`openSheet`, the `.flashcards-decks__cards-pill` /
  `.flashcards-decks__decks-pill` pair). It was persistent mode's only caller until
  2026-08-24; that mode now has no callers
- `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` — tab state + drill-in
  lookups (`openForRoot`, `openForEntryKey`, `clear`); takes an optional `language` that
  scopes those lookups
- `src/api/dictionary.ts` — `lookupVocabEntry(entryKey, language?)`, the single
  det-lookup-and-adapt every eip host goes through
- `src/features/flashcards/FlashcardsLearnPage/EipSheet.tsx` — the shared non-flp mount
  (`InfoCardSection` + `EipTabStrip` + `TooManyTabsSnackbar`), used by
  `src/features/discover/SortCardsPage.tsx` (`handleOpenCardInfo`),
  `src/features/immersiveworld/play/IWPlayPage.tsx` (`handleSegmentOpen`),
  `src/features/flashcards/centers/ReadingSwipeGrid.tsx` and
  `src/features/dictionary/DictionaryPage.tsx` (`handleEntryClick` — the only host that
  passes `showSynonymsRelated`, `showWordTools` and `showLearning`). `depth` (default 0) is
  forwarded to SheetPanel; scp passes 1 while its hidden skipped-cards sheet
  (`SkippedCardsSheet`, docs/SORT_CARDS_REQUIREMENTS.md §5.1a) is open, so an eip opened
  from a card in that sheet stacks above it
