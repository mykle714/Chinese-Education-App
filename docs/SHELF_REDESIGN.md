# Shelf Redesign — app-wide visual system

> **STATUS: IN PROGRESS.** Part A is complete except **A7's `.cpcd`**, which is now the
> only shared widget left (`.banner` shipped inside entry 9; `.ladder` is closed as
> superseded — see A7).
> Part B has shipped entries **1, 2, 3 (menu only), 4, 5, 7, 8, 9, 12–16, 18 and 19–25**;
> **6** and **11/11b** are still plan, and **10** is rejected at the card (see its entry). Every artboard in the
> spec file now HAS an entry (see the table below) — an entry with no `Status: DONE` line
> is unbuilt, not undrawn.
> The design questions were **answered 2026-08-20** — see the **Decisions** section
> near the bottom, which is binding. What is still unsettled is listed under
> **Still open**, just above the Decisions section.
> (This line used to say "Q6 and Q8 remain open"; the numbered question list it
> referred to is not in this file and is not in its git history, so the reference
> was dangling. **Still open** is the live list.)
> Part A is shared groundwork; Part B is one entry per artboard, each independently
> pickup-able once Part A lands. Update each entry's **Status** line as work lands.
> Delete this file once every entry reads DONE and the behaviour has been folded
> into the owning feature docs.

## Source of truth

The design lives in the user's Claude Design project **"Cow"**
(`b8b44c24-1f0e-4579-8d9a-e802136416ee`), read via the `DesignSync` MCP tool:

| File | What it is |
|---|---|
| `App Redesign - Shelf System.html` | 18 phone artboards, one per screen. The spec. |
| `shelf-system.css` | The stylesheet those artboards share — token + primitive definitions. |

Sibling explorations in the same project are **earlier alternatives or narrower
studies, not the spec**: `Centers - Directions.html`, `Color Grammar.html`,
`Decks Minimized - Directions.html` / `- Directions v2.html`,
`Arena Division Banners.html`, `Sort Flow - Shelf System.html`. Read them for context
on a decision, never as a source of values. (The `Home Menu - 12 Directions.html`,
`Decks Page - 12 Directions.html`, `Tone Color Explorations.html` and
`Definition Tab Explorations.html` files this section used to list are **no longer in
the project** — the list above is what `DesignSync.list_files` returned on 2026-08-23.)

**PART B NOW COVERS THE WHOLE ARTBOARD SET.** This file was originally written against
artboards 1–18 (with a numbering hole at 17). As of 2026-08-24 the spec file holds **27**
artboards and every one has an entry; `data-screen-label` remains the authoritative list.

| Range | Where its entry is |
|---|---|
| 1–16, 18 | their own numbered entries below |
| **17 Deck Preview panel** | the "hole" is the pull-up sheet entry 2 draws — the `.sheet` atom, built in A3 |
| **2b Decks minimized hand** | a second STATE of entry 2, needing no separate work: it is the same page with the sheet at its resting lip |
| **19 Flashcard Learn, 20 + 20b Extra Info Panel, 21 Card menu, 22 Swipe coaching, 23 Sense sheet, 24 EIP examples, 25 EIP breakdown** | one combined entry, **19–25**, after entry 18 |

## The idea in one paragraph

Two layout primitives carry the whole app, and which one a screen uses is decided
by what the screen holds:

- **Shelf** — for a **collection** the user owns or has accumulated. Items render
  as book *spines* on a wooden *board*, and a spine's **height encodes its count**.
- **Bento** — for a **menu** of destinations. Weighted rounded tiles in a 2-column
  grid; the most important destination spans both columns, the least important get
  a short (`.bt.lo`) tile.

Everything else (rows, cards, chips, fields) is supporting cast. Today the app uses
one vertical `HubMenu` for all three hubs and MUI `Paper` stacks elsewhere.

**Size key** used below: **S** ≈ restyle in place · **M** ≈ restructure one page ·
**L** ≈ new components or new routes/data.

---

# Part A · Foundations

Everything here is **shared** — used by two or more pages in Part B, and in the
case of A2 by pages that have no artboard at all. All of it lands before any single
page is converted; otherwise each page invents its own copy of the same primitive
and the "system" is a coincidence rather than a system.

Do them in order: **A1 → A2 → A3/A4/A5 (parallelizable) → A6/A7.**

A1 now lands app-wide on day one (D1), so nothing is gated on a page being converted
first — but the whole app changes colour and type before any layout does. That is
expected, not a regression.

| | Entry | Shared by | Size |
|---|---|---|---|
| A1 | Tokens and fonts | everything | M |
| A2 | App chrome — footer, headers, shell | **every page, designed or not** | M |
| A3 | Shelf — the collection primitive | 2, 3, 6, 18 | L |
| A4 | Bento — the menu primitive | 1, 3, 4, 5 | L |
| A5 | Generic atoms (rows, cards, buttons, chips, labels) | all 17 | M — **DONE** |
| A6 | Game surface chrome | 12–16 + Memory Map | M — **DONE** |
| A7 | Data-display widgets (leaderboard, mastery, cpcd) | 2, 8, 9, 10, 18 | L — **`.bd` done** |

## A1 · Tokens and fonts

**Status: DONE (2026-08-20), corrected the same day.** Typecheck and `npm run build`
both clean.

> **Correction pass (2026-08-20).** The first cut applied one rule — "everything moves
> to the ramp" — to two sets the design never moved, and pinyin plus the mastery cells
> came out off-design. Tone colours, mark colours, the ready-check green, the swipe
> overlays and Hydra's ladder rings are back on their original saturated hexes and are
> now commented **literal on purpose** with their design citation. Surfaces stay
> pastel. The governing rule is **D2b**; read it before touching a colour.
>
> **Second correction (2026-08-20): AI provenance got its own token.** The first cut
> folded the AI-generated highlight into `COLORS.warnInk` (`--orgA` `#A46400`) on the
> reasoning that both were "the orange one". Two things were wrong with that.
> `warnInk` means *caution* — it says something is wrong with the content, where the
> AI mark only says a machine wrote it and no human has approved it yet. And `--orgA`
> is a dark gold, so the treatment went muddy. The colour is now
> **`COLORS.aiGenerated` `#FF9E5A`** — the app's original AI orange, restored
> unchanged — sitting deliberately **outside the ramp** beside `fireActive`. Its hue
> (oklch 78.6% 0.143 **54**) falls in the gap between `--red` (20) and `--org` (70),
> which is exactly what keeps an AI-flagged surface from reading as an Unfamiliar or
> Target band when the two appear together; snapping it onto the hue-70 axis (which
> would give `#F3A744`) would lose that. Call sites: `theme/aiGeneratedStyling.ts`
> (border + 8% tint), `components/AiGeneratedBadge.tsx`, and the Dictionary page's AI
> chip + "Asking AI…" loader. `warnInk` keeps the genuinely cautionary users — the
> Validate/Flag button and Memory Map's green/orange/red outcome triad.
>
> ⚠️ One known consequence, unchanged from before the redesign: `#FF9E5A` as **text**
> on paper is about 2:1, which is below AA. It is fine as a border and as an 8% tint,
> which is most of its use. If the sparkle badge's label ever needs to be legible at
> arm's length rather than merely noticeable, give the text its own darker member of
> the same hue rather than moving the whole token.

**What landed**
- `src/theme/colors.ts` — `COLORS` rewritten to the OKLCH ramp. Every existing key
  kept; new keys added for the raw ramp (`grey/greyA`, `pur/purA`, `blu/bluA`,
  `red/redA`, `org/orgA`, `grn/grnA`, `tea/teaA`), the ink tones (`textFaint`,
  `white`) and the shelf/overlay tones (`wood`, `scrim`, `modalScrim`, `zoneUpRow`,
  `zoneDownRow`).
- `src/utils/categoryColors.ts` — `CATEGORY_COLORS`, `BAND_COLORS`,
  `LEARN_NOW_COLORS`, `MASTERY_BAR_COLORS` re-pointed at the ramp. Names and shapes
  unchanged.
- `src/utils/masteryCompute.ts` — `MARK_TYPE_COLORS` **left on its original four
  saturated hexes** (see D2b) and `MASTERY_READY_COLOR` added for the design's
  `#05C793` ready-check icon.
- `src/theme/fonts.ts` — Instrument Sans / Instrument Serif / JetBrains Mono, plus a
  new `FONTS.icons`. `hanziComponents` untouched.
- `index.html` — webfont links swapped; Material Symbols Rounded added on its own
  `<link>`.
- `src/index.css` — root family updated; the `.ms` rule added.
- `src/components/Icon.tsx` — **new**, the ligature wrapper.
- **Stragglers converted** (files that held literal copies of the old palette and
  would have been stranded off-ramp): `src/features/flashcards/collectionRef.ts`
  (the two deck-palette arrays); `src/features/flashcards/constants.ts` →
  `TAB_COLORS` (aliased to `MARK_TYPE_COLORS`); `src/pages/SettingsPage.tsx`
  (danger color); `src/games/hydra-bubbles/HydraStage.tsx` → `FILL_BY_COLOR`.
- **Stragglers deliberately NOT converted** — the design spells these values out
  literally, so aliasing them to the ramp moves them off the design rather than onto
  it (see D2b): `src/utils/toneColors.ts` → `TONE_COLORS`;
  `src/utils/masteryCompute.ts` → `MARK_TYPE_COLORS`, `MASTERY_READY_COLOR`;
  `src/features/flashcards/constants.ts` → `CORRECT_COLOR`, `INCORRECT_COLOR`.

**Notes for whoever picks up A2**
- **Hex, not `oklch()`.** MUI's `alpha()` cannot parse an `oklch()` string and throws;
  it is called on `COLORS.successInk` / `COLORS.warnInk` in `ValidateFlagButtonsView`
  and on tone colors in the flp. Values are authored in oklch (noted per line in
  `colors.ts`) and shipped as the exact sRGB hex. The conversion script is below.
- **`FONTS.serif` carries TWO faces on purpose** — `"Instrument Serif", "Noto Serif SC"`.
  Instrument Serif has no CJK coverage, so a Chinese headword falls through per glyph
  and stays a serif. Dropping the second face silently un-serifs every CJK hero.
- **`FONTS.cjk` is no longer a fixed stack — the Chinese face is an ACCOUNT SETTING.**
  It resolves to `var(--cjk-font, <the same default stack>)`, and
  `users."chineseFont"` (migration 157) decides what writes that property. Six
  selectable faces; new accounts default to 975 Maru SC, accounts predating the
  migration stay on Noto Sans SC. The var's fallback is still the original stack, so
  anything rendered before the preference loads (and every signed-out screen) looks
  exactly as it did. Setting `--cjk-font` on any element re-faces every Chinese glyph
  beneath it without touching the token or its 11 call sites.
  → [CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md) (the setting's full path, the
  `/font-lab` compare page, and the 1em han-advance constraint cpcd imposes).
- **Material Symbols loads with `display=block`, not `swap`** — it renders ligatures,
  so a swap period would flash the literal string `nights_stay`.
- **Hydra's Target-yellow deviation survives, and is now better justified.** Its file
  carried an escape hatch reading "if the app-wide Target band is ever retuned to a
  true yellow, go back to `CATEGORY_COLORS.Target`". Target was retuned — to `--org`
  `#FFE6C8`, a pale peach that is a fill tier and cannot carry a ring. The hatch is
  dead; the comment now says so.
- **Two open colour questions the correction pass surfaced**, both deliberately left
  alone because they sit outside tokens: (1) `COLORS.dangerInk` / `successInk` are
  `--redA` / `--grnA`, but the design's delete and success text are `#EF476F` /
  `#05C793` — the same deviation, across ~51 text call sites; (2) artboards 17 and
  19–22 use off-palette pinyin hexes (`#0B8AD9`, `#F4A700`) and artboard 17 swaps
  tone 1 and 2. Both read as drafting slips against the `current` set; confirm with
  the user before acting on either.
- **Not converted, deliberately:** the Dark / Ocean / Nature branches in
  `ThemeContext.tsx` still hold old literals. D4 parks them.
- **`TONE_COLORS` are ink, not fills.** Tone-colored pinyin is TEXT, so the four tones
  take the `*A` members even though the categories take pastels. Tones are their own
  semantic axis — a tone color does not mean "this syllable is comfortable"; the hue
  sharing is palette economy only.
- **Hydra's bubbles needed the full pair.** `bg: pastel / border: CATEGORY_COLORS` no
  longer works now that `CATEGORY_COLORS` is itself pastel — that is a pastel ring on
  a pastel fill. Bubbles are `bg: COLORS.red / border: COLORS.redA`, because the
  player reads the payout tier off a moving bubble and needs the separation.
- **Arena's division ladder has no colours at all now.** `DIVISION_COLORS` (the partially
  repaired walk over UI tokens) was deleted in entry 9, and its replacement — the design's
  twelve material plates — was withdrawn on the user's ruling rather than minting ~30
  hexes outside the ramp. Every rung is the same neutral grey pending a decision. See
  entry 9 and DEFERRED_WORK.md; this is the **largest open visual gap** in the redesign.
- **Sort Cards' drop buckets render at `opacity: 0.23` when inactive.** A pastel at
  23% may now be too faint even with the ring. Flagged in the file; needs a device.
- **Unverified, and wanting eyes on a real screen rather than a typecheck:** the
  mark cells at 8px, the flp's tone-colored pinyin, and the three category chips
  that flipped from white-on-saturated to ink-on-pastel. Two of the three are now
  **gone**: CardFace's `CategoryChip` was deleted on 2026-08-28 with the card-back
  category, and MiniVocabCard's corner badge was replaced by the eight-mark mastery
  window (see [MASTERY_REWORK.md](./MASTERY_REWORK.md) § "Mini cards — the eight-mark window").
  Only VocabCardDetailBody's chip remains to verify.

<details><summary>oklch → sRGB hex, for re-deriving a value</summary>

```python
import math
def oklch_to_hex(L, C, H):           # L as 0..1, C as authored, H in degrees
    h = math.radians(H); a = C*math.cos(h); b = C*math.sin(h)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r  =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g  = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    def f(x):
        x = max(0.0, min(1.0, x))
        return 12.92*x if x <= 0.0031308 else 1.055*(x**(1/2.4)) - 0.055
    return "#{:02X}{:02X}{:02X}".format(*[round(f(v)*255) for v in (r, g, bb)])
```
</details>

> ⚠️ **The mono half of this decision was revisited on 2026-09-04.** JetBrains Mono is
> gone: overlines moved to `FONTS.label` (**Public Sans**) and data to `FONTS.mono`
> (**Azeret Mono**). See [INFO_TYPE_LAB.md](./INFO_TYPE_LAB.md). D1's Instrument
> Sans / Instrument Serif choices are unchanged.

**Type.** Design wants Instrument Sans (UI), Instrument Serif (display), JetBrains
Mono (labels/metadata/numerics), Noto Sans SC (CJK). The app ships Inter + Noto
Sans SC + Noto Serif SC, declared in `index.html` and stacked in
`src/theme/fonts.ts` → `FONTS`.

> `FONTS.hanziComponents` is a **self-hosted** subset face (declared in
> `src/index.css`, generated by
> `server/scripts/backfill/chinese/generate-component-font.js`). It must survive
> any font change untouched — Word Search's No-Pinyin hint row depends on it.

**Color.** *(Decided — see D1/D2.)* Design defines pastel-surface / saturated-accent pairs in **OKLCH**
(`--pur`/`--purA`, `--blu`/`--bluA`, `--red`/`--redA`, `--org`/`--orgA`,
`--grn`/`--grnA`, `--tea`/`--teaA`, `--grey`/`--greyA`), a paper ground
(`--paper` `#FBFAF8`) and an ink ramp (`--ink`/`--ink2`/`--muted`/`--faint`). The
app has hex equivalents in `src/theme/colors.ts` → `COLORS`, whose `*Main` values
re-export `CATEGORY_COLORS` from `src/utils/categoryColors.ts`.

**Decided (D1, D2, D3, D4): rewrite in place, one light palette, Material Symbols.**

**Work**
1. Rewrite `COLORS` in `src/theme/colors.ts` to the OKLCH ramp. Keep every exported
   key name so the ~everything that imports it keeps compiling.
2. Rewrite `CATEGORY_COLORS` values per the D2 table — **name and shape unchanged**.
   Check contrast at the 8px mark-cell size before committing.
3. Rewrite `FONTS` to Instrument Sans / Instrument Serif / JetBrains Mono / Noto Sans
   SC. Leave `FONTS.hanziComponents` alone.
4. Add the webfont `<link>`s to `index.html`, including Material Symbols Rounded,
   with `font-display` set so the ligature FOUT is contained.
5. Add `src/components/Icon.tsx` — a thin `<Icon name="nights_stay" />` wrapper over
   the `.ms` span, so no page writes a bare ligature. Then run the mechanical
   `@mui/icons-material` → ligature-name rename across the app.
6. Leave `ThemeContext`'s other three themes in place but underived (D4).

**Code:** `src/theme/colors.ts` → `COLORS`; `src/theme/fonts.ts` → `FONTS`;
`src/theme/scale.ts` → `SIZE`, `WEIGHT`, `LEADING`, `TRACKING`;
`src/theme/index.ts`; `src/utils/categoryColors.ts` → `CATEGORY_COLORS`;
`index.html`; `src/index.css`. **Size: M.**

### A1 addendum · Elevation (added 2026-08-24)

A1 moved colour and type onto the design's tokens but left SHADOWS alone, so every card
in the app kept a pure-black, diagonally-cast, tight-and-dark drop while its colour and
geometry matched the artboards. The design's shadow system now lives in
`src/theme/shadows.ts` as `SHADOW`, exported from the `theme` barrel alongside `COLORS`,
`FONTS`, `SIZE`. The three rules it encodes and the roles it names are in **D13**; read
that before authoring a new `boxShadow`.

Where a shadow only makes sense alongside a border and a radius — a CARD — take the whole
recipe from `src/theme/surfaces.ts` (`CARD_SURFACE`) instead of authoring the three
separately; see **D14**.

**Code:** `src/theme/shadows.ts` → `SHADOW`; `src/theme/surfaces.ts` → `CARD_SURFACE`,
`CARD_SURFACE_RADIUS`; `src/theme/index.ts`; `src/contexts/ThemeContext.tsx` →
`flashcard.cardShadow` / `.cardShadowSubtle` / `.sheetShadow`.

## A2 · App chrome — footer, headers, shell

**Status: DONE (2026-08-20)** — all three sub-entries (A2a footer, A2b headers,
A2c shell) landed. Depended on A1. **Touches every page in the app**, including
the ~dozen that have no artboard, so it landed before any single page was converted.

This is the highest-leverage entry in the plan and the one with the largest blast
radius: `MobileTabScreen` has **20** importers, `NodePage` **25**, `LeafPage` **21**,
`PageHeader` **13**. Change these once and every page moves together; convert pages
first and they drift.

### A2a · Footer nav bar — **a shape change, not a restyle**

**Status: DONE (2026-08-20).** Typecheck and `npm run build` both clean. What landed
and the decisions taken are recorded at the end of this sub-entry.

| | Today (`MobileFooter.tsx`) | Design (`.fbar`) |
|---|---|---|
| Form | detached **rounded pill**, `position:absolute`, inset 16 on all sides | **full-width flat bar** flush to the bottom edge |
| Height | `FOOTER_HEIGHT` 64 | 74 |
| Separation | drop shadow `0 6px 24px` | `border-top: 1px solid var(--line)` |
| Content | icon **+** label per tab (`HomeIcon`, `StyleIcon`, `LanguageIcon`, `AccountCircleIcon`) | **label only** — no icons |
| Active state | `opacity: 1` vs `0.6` | ink color + weight 600 + a 14×2 underline bar (`.fbar div.on::after`) |
| Dividers | `FooterDivider`, 1×32 | none |
| Ground | `COLORS.header` | `var(--paper)` |

**Consequences to plan for — these are why this is its own entry:**

- **Every clearance number changes.** `FOOTER_HEIGHT`, `_INSET`,
  `_EXTRA_GAP` and the derived `FOOTER_CLEARANCE` are consumed by
  `FooterSpacer` (rendered as the last child of *every* footer-bearing scroll
  surface), by `MobileTabScreen`'s `ScrollArea` padding, and by
  `FooterPresenter`'s `HIDDEN_OFFSET` slide-out distance. A flat bar has no inset,
  so `_INSET` becomes 0 and the constant arithmetic must be re-derived, not
  find-and-replaced.
- **The edge fade becomes a real element.** The app fades content at the scroll
  edges with a CSS **mask** anchored to the viewport (`EDGE_FADE_TOP` and a bottom
  band sized to the pill). The design uses a separate painted gradient element
  (`.fade`, 34px tall, sitting exactly on `bottom: 74px`) plus a `.clear` 90px
  spacer. Pick one mechanism; do not ship both.
- **Icons come out (D5).** Four text labels with a 2px underline, per `.fbar`.
  `HomeIcon` / `StyleIcon` / `LanguageIcon` / `AccountCircleIcon` are deleted from
  `MobileFooter`. This is a quieter target on the most-tapped control in the app —
  worth a look on a real device once it lands.
- **`FooterPresenter` keeps its job unchanged.** The pill is rendered once, outside
  the page-slide transitions, and animates on its own axis. That architecture
  survives — only the geometry it animates changes.

**Work**
1. Rewrite `MobileFooter.tsx`'s styled parts (`Footer`, `FooterContent`,
   `FooterItem`, `FooterDivider` — the last is deleted).
2. Re-derive the clearance constants; leave the *names* alone so the 20+ call sites
   keep compiling, then rename `FLOATING_FOOTER_*` → `FOOTER_*` once the bar stops
   floating (offer, don't assume).
3. Decide mask-vs-gradient for the fade and apply it in `MobileTabScreen` only.
4. Leave `FooterPresenter`, `FooterVisibilityContext`, `useHideFooter` and
   `routeFooterTab` untouched.

**Code:** `src/components/MobileFooter.tsx` → `MobileFooter`, `FooterSpacer`,
`FooterTab`, `FOOTER_HEIGHT`, `FOOTER_EXTRA_GAP`, `FOOTER_CLEARANCE`;
`src/components/FooterPresenter.tsx` → `HIDDEN_OFFSET`;
`src/components/FooterVisibilityContext.tsx`; `src/hooks/useHideFooter.ts`;
`src/routes/routeMeta.ts` → `routeFooterTab`.
**Docs:** `docs/UX_AND_NAVIGATION.md`, `docs/MOBILE_TAB_SCREEN_LAYOUT.md`,
`docs/LEAF_NODE_PAGES.md`. **Size: M.**

**What landed**
- `src/components/MobileFooter.tsx` — flat full-width bar: `left/right/bottom: 0`,
  height **74**, `border-top` `--line`, `--paper` ground, no radius, no shadow.
  `FooterDivider` and the four `@mui/icons-material` imports are deleted. The four
  copy-pasted tab blocks collapsed into a `TABS` array.
- **Clearance re-derived, names kept:** `HEIGHT` 64 → **74**, `INSET` 16 → **0**,
  `EXTRA_GAP` 12 → **16**, so `CLEARANCE` 108 → **90** — which is exactly the
  design's `.clear` spacer. The ~8 downstream call sites
  (`FlashcardsDecksPage`'s `SHEET_CLOSED_HEIGHT` / `STUDY_AREA_BOTTOM_PAD` — the
  former is gone since the sets sheet became modal, see DECKS_FEATURE.md,
  `SortCardsPage`, `DecksPanelBody`, `CompareWorkspace`) all compose
  the named constants, so they re-derived themselves with no edit.
- `src/components/FooterPresenter.tsx` — `HIDDEN_OFFSET` is now just
  `FOOTER_HEIGHT`. The old `INSET + HEIGHT + 16` added a pill inset and a
  shadow allowance that no longer exist.
- `src/components/MobileTabScreen.tsx` — **fade mechanism decided: keep the mask.**
  The design paints `.fade` as its own 34px gradient element at `bottom: 74px`; the
  app's mask is anchored to the scroll viewport and therefore already covers every
  page, whereas an element would have to be added per surface. So the mask stays and
  only its stops moved: `EDGE_FADE_BOTTOM` (one band running to the frame bottom) is
  replaced by `EDGE_FADE_BOTTOM_BAND` (34) + `EDGE_FADE_BOTTOM_START`
  (`HEIGHT + 34`), reaching transparent exactly at the bar's top edge. Both
  mechanisms are **not** shipped.
- Docs swept for "floating pill" wording: `MOBILE_TAB_SCREEN_LAYOUT.md` (footer
  section + geometry table rewritten), `NAVIGATION.md` (icon column dropped, tab
  order corrected), `UX_AND_NAVIGATION.md`, `LEAF_NODE_PAGES.md`,
  `BENTO_SYSTEM.md`, `DECKS_FEATURE.md`, `QUICK_MARK.md`,
  `SORT_CARDS_REQUIREMENTS.md`, `WORD_COMPARE_FEATURE.md`, `ARCHITECTURE_REVIEW.md`.

**Decisions taken, and what is left**
- **`FLOATING_FOOTER_*` renamed to `FOOTER_*`**, and `FLOATING_FOOTER_INSET` was
  **deleted** rather than renamed — a permanently-zero constant named "gap from the
  edges" is a trap for the next reader, not a tuning knob. `SHEET_CLOSED_HEIGHT` in
  `FlashcardsDecksPage` was the only expression that composed it. The family is now
  `FOOTER_HEIGHT` (74) / `FOOTER_EXTRA_GAP` (16) / `FOOTER_CLEARANCE` (90).
- **Page tints retired, because the bar is always paper.** The bar is rendered at
  FRAME level and painted `--paper`; the design gives `.fbar` no other ground. So a
  page with a distinctly different `surfaceColor` gets a colour step across the bottom
  74px. `/decks` and the Mastery Centers passed the grey `COLORS.header` and did
  exactly that — both now use the default paper ground, which is also what artboard 2
  shows. The **inversion survives**: `InfoSheetContainer` moved from
  `theme.palette.flashcard.background` (the same value as the page behind it, so the
  sheet read as a sheet only because of its shadow) to `COLORS.white`, matching the
  design's `.sheet` / `.eic` / `.pnl`. The two card-detail pages kept
  `COLORS.yellowAccent` (within ~1% of paper, so there was no step) until **2026-08-28**,
  when they too moved to the default paper ground at the owner's request — no page paints
  its own now. The rule is written into `docs/MOBILE_TAB_SCREEN_LAYOUT.md` so it does not
  come back.
- **Inactive tabs carry a transparent underline placeholder.** The design only
  specifies `.fbar div.on::after`; without a placeholder the active tab's 8px
  underline would push its label 8px above the other three.
- **Label size is a flat `12`, not a `SIZE` token** — the design pins `.fbar` labels
  independently of the body ramp.
- **Not yet checked on a real device.** The bar is the most-tapped control in the app
  and it just lost its icons; A2's own note flags this as worth a look on hardware.

### A2b · Headers — the design also has exactly two

**Status: DONE (2026-08-20).**

The app's `PageHeader` → `LeafPageHeader` / `NodePageHeader` split maps **1:1** onto
the design's two header classes. Keep the composition hierarchy; change the skin.

| | App | Design | Notes |
|---|---|---|---|
| Hub / node header | `PageHeader` — fixed 60px bar, `COLORS.header` background, `ExpandMoreIcon` rotated per `arrowDirection` | `.hd` — **no bar**, sits on the paper ground, `padding: 23px 22px 0`, title 24px/600/-0.025em, `.back` is an inline chevron + title | The background bar disappears entirely |
| Leaf / game header | same `PageHeader`, `arrowDirection="down"` | `.lhd` — `padding: 21px 18px 0`, title **17px**, down chevron, plus a `.tg` toggle-chip slot and a `.fire` streak slot | Two title sizes, one component |

Right-hand slots the design uses in `.hd`, all of which land in `PageHeader`'s
existing `rightContent` prop: `.meta` (mono uppercase metadata), `.btn` (32×32
rounded-11 outlined icon button), `.fire` (streak flame + count, `#E65100`).
`.lhd` adds `.tg` / `.tg.on` — a mono toggle chip, which is what Word Search and
Hydra want for their in-header toggles (see entries 13 and 16).

**What landed**
- **The header bar is gone.** No `COLORS.header` ground, no border, no fixed 60px
  height, no `Toolbar` inner element — the title sits on the paper ground with the
  design's padding. Nothing in the app measured the old 60px, so nothing had to move.
- **`size` prop, with THREE values, not two.** The plan said `"hub" | "leaf"`; the
  artboards need a third. `.hd` appears at 24px on a hub with no back button and at
  **21px** once a chevron shares the line (`style="font-size:21px"` on Games, Reader,
  Dictionary, Friends, Arena, Community), which is a real distinction rather than
  drafting noise — the chevron eats horizontal room. So: `hub` 24 / `node` 21 /
  `leaf` 17, with tracking tightening as the title grows.
  `size` **defaults** from the props already being passed (no back → `hub`, `"left"`
  → `node`, `"down"` → `leaf`), so not one existing call site had to change.
- **Two glyphs, not one rotated one.** `arrowDirection` now selects between the
  design's `arrow_back` (node) and `keyboard_arrow_down` (leaf) via `<Icon>`, instead
  of rendering one `ExpandMoreIcon` rotated 90°. A rotated chevron is not the same
  shape as an arrow, and the artboards draw both.
- **The back chevron and the title are one tappable group** (`.hd .back`, gap 9),
  replacing the `IconButton` whose 40px ripple target was what made the two look
  detached.
- **Three slot primitives** exported beside `PageHeader`: `HeaderMetaLabel` (`.meta`),
  `HeaderIconButton` (`.hd .btn`, in `outlined` and `bare` variants) and
  `HeaderToggleChip` (`.lhd .tg`).
- **`LeafPageHeader` / `NodePageHeader` unchanged** — still thin specializations, and
  they pick up the new sizes through the `size` default.
- `touchAction: "none"` on the header stays; it sits over drag-to-sort and game
  surfaces.

**Call sites converted** (this is where the duplication was)
- `FlashcardsLearnHeader`, `BubbleMatchHeader` and `WordSearchHeader` each carried a
  **byte-identical 14-line `toggleSx` helper**. All three are gone; the chip skin
  lives once in `HeaderToggleChip`. Those three plus `MatchSpeedHeader` also dropped
  their `@mui/icons-material` imports for `<Icon>` names (D3).
- `AccountPage`'s settings gear is the app's one `outlined` `HeaderIconButton` — it
  is the only header carrying a single lone action on bare paper, which is exactly
  the case the artboard boxes.

**Decisions taken**
- **No `HeaderStreak`.** The plan listed it as a fourth export, but the app already
  ships the design's `.fire` as `src/minutePoints/MinutePointsFireBadge.tsx` — flame
  plus count in `COLORS.fireActive`, which **is** the design's `#E65100`. Adding
  `HeaderStreak` would have been a second component drawing the same badge.
- **The badge itself was converted to `.hd .fire` on 2026-08-21** — Material Symbols
  Rounded `local_fire_department` at **15px**, mono count at **11px**, 4px gap, both in
  `fireActive`. (The glyph went to **22.5px**, 50% over the design, on 2026-08-24 when it
  took on the fill level — see the next entry; the count stayed at 11px.) What came off it: the MUI `Badge` count bubble with its border, the
  animated `drop-shadow` glow, the `IconButton` ground, and the `@mui/icons-material`
  import (D5). The old badge was the loudest thing in every header while reporting
  something ambient — that time is accruing, which is true nearly always. It is now quiet
  when unread and legible when read, and the one moment worth noticing (a point landing)
  is still a scale pulse, which now has no glow competing with it.
  Two affordances the design has no opinion on were KEPT because they are functional:
  progress toward the next point and the paused state (now a **strikethrough on the count**
  — the old treatment overlaid a large red no-entry glyph, which at 15px would be a smudge).
- **The live-seconds figure became the flame's fill on 2026-08-24.** It had been a 9px
  faint `42s` suffix beside the count, which put two numbers in one readout where only
  one of them (the count) is worth reading. The glyph now renders twice — a 24%-opacity
  ghost under a solid `fireActive` copy clipped to a bottom-anchored window whose height
  is `progressToNextPoint`, mapped onto the glyph's ink band (8%–94% of the em box,
  because a Material Symbols glyph does not touch its box edges and a raw 0–100% clip
  would look stalled at both ends). The window carries a **1s linear** transition, but it
  plays for one shape of change only: a rise of about **1/60 of the band**, which is what
  one second of study is worth (`SMOOTH_STEP_LIMIT_PCT`). Everything else snaps — the wrap
  at a point landing (interpolating it would drain the flame and read as losing progress;
  the scale pulse marks the moment instead) and any larger rise, which is a load or a
  resync and would otherwise sweep a whole minute past the eye in a second. **The level is
  never reset by going idle**: `ACTIVITY_TIMEOUT_MS` is 15s, so `isActive` flips off
  constantly, and an early version that zeroed the fill while idle replayed a full 0→level
  climb on every resume — the visible bug that produced this rule. **Idle changes the ink
  and nothing else**: the 24% ghost and the solid level are drawn in every state, so a
  greyed flame still shows how far into the minute the learner was when they stopped. The
  exact
  seconds survive in the badge's `title`. **The glyph was enlarged 50% (15px → 22.5px,
  `FLAME_SIZE_PX`) in the same change**: at 15px the ink band is ~13px tall, so one second
  is a fifth of a pixel and the creep is invisible. The size is what makes the animation
  readable. The count stays at 11px, so the flame rather than the number is now the thing
  the eye lands on — which matches what it reports.
- **The fill is a STUDY-SURFACE treatment only, since 2026-08-28.** Off-study pages —
  every hub, the cdp, the deck/collection browsers — now draw a single **solid
  `fireActive` flame** beside the count: no 24% ghost, no clipped fill layer, no pulse.
  The badge branches on `isEligiblePage`, deliberately NOT on `!isActive`, because
  "cannot earn here" and "could earn here but has gone quiet" are different answers and
  only the second has a level worth showing. The previous behaviour carried the greyed
  gauge everywhere, which put a part-full level on pages where it is frozen by
  construction — the eye re-reads it on every visit and gets nothing back. The fill layer
  is UNMOUNTED off-study rather than pinned at 100%, so it cannot animate on the way in
  or out; the base glyph simply goes from 24% opacity to full.
- **The flame moved into `PageHeader` itself on 2026-08-24, and is now on EVERY header.**
  It used to be opt-in — each page passed `<MinutePointsFireBadge />` into `rightContent`
  — so it appeared on the earning surfaces only, and was simply absent on the menus
  (Home, Games, Discover, Decks & Cards, Dictionary, Arena, Friends, …), on the cdp, and
  on two game pages that had forgotten it (Hydra Bubbles, Speed Reading). "Am I earning
  right now?" is a question the learner can only ask where the answer is drawn, so the
  header now draws it everywhere: on an ineligible page the badge renders its own
  OFF-STUDY treatment, which is the correct answer rather than a missing one. Position is **last in the
  right slot** (flush right, page actions queueing to its left) so it holds the same
  screen corner regardless of how many actions a page contributes — the Account artboard
  draws flame-then-gear, and that one ordering was traded for a fixed position app-wide.
  All ~12 per-page call sites were deleted; pages no longer import it.
  Two consequences worth keeping in mind: exactly ONE `PageHeader` may be mounted at a
  time on an earning page (`useMinutePoints` runs a 1s accrual tick per instance), and
  the badge renders `null` when signed out.
- **Eligibility was narrowed in the same pass** so "grey on a menu" is actually true:
  `MINUTE_POINTS_ELIGIBLE_PAGES` had the bare prefix `/flashcards`, which made the cdp,
  Decks & Cards, the deck/collection browsers and the mastery centers all accrue minutes.
  The prefix list is now study surfaces only (`/flashcards/learn`, `/reader`,
  `/discover/sort`, the games), with the legacy desktop `/flashcards` page moved to a new
  exact-match list, `MINUTE_POINTS_ELIGIBLE_EXACT_PAGES`, so its browse-screen descendants
  do not inherit eligibility. See docs/MINUTE_POINTS_SYSTEM.md.
- **The same glyph now appears wherever a flame does.** `MinutePointsBadge` — the legacy
  circular badge on the old desktop flashcards page — swapped its `@mui/icons-material`
  flame for the `Icon` primitive, so the two never disagree about what a flame looks like;
  its pre-redesign chrome (gradient ground, glow, progress ring) is untouched and belongs
  to whenever that page is redone. Arena's score column draws it at 13px (§ A7).
- **The hub header's left tab badge was removed.** Hub headers drew the active footer
  tab's icon left of the title; no artboard has one. It was doubly redundant — the
  footer already marks the active tab and the title already names the page — and it
  took four more `@mui/icons-material` imports with it (D5).
- **`MobileTabScreen`'s `activePage` was removed outright**, along with `NodePage`'s.
  The tab badge was its last reader — `FooterPresenter` resolves the active tab from
  the route via `routeMeta`, and always did. 26 page files dropped the prop and the
  two shell components dropped it from their prop shapes and their `FooterTab`
  imports. Nothing replaced it: a required prop that nothing reads is worse than no
  prop, because the next reader assumes it does something.
- **Word Search's `hint` button was NOT converted to a toggle chip.** It borrows the
  chip's geometry so it lines up with them, but keeps its amber "armed" ground: the
  chip's on-state is solid ink, which says "this setting is on", not "you have earned
  a hint". The design has no hint control to copy. Left for entry 13 to settle.
- **The design's 18px `.hd` titles are modelled as a fourth size, `dense`.** Card
  Detail and Learn set `font-size:18px` inline. It does not track title length ("Card
  Detail" is short) — it tracks how full the line is: every 18px header carries a back
  chevron AND four right-slot actions, while the 21px ones carry one or two. So it is
  a system size after all, just one keyed on something the navigation props cannot
  see. `dense` is therefore the only size that must be **asked for**; the other three
  keep falling out of `showBack` / `arrowDirection`.
  Reached via `size` (`PageHeader`, `MobileDemoHeader`) or `headerSize`
  (`MobileTabScreen`, `NodePage`). Applied to `VocabCardDetailPage`,
  `DictionaryCardDetailPage` and `FlashcardsLearnHeader`.
  Deriving it by counting `rightContent`'s children was the obvious alternative and is
  a trap — most callers pass a single wrapping `Box` or fragment, so the count is 1
  regardless of how many buttons are inside.
- **Node/leaf assignment was not re-litigated.** The design draws flp as `.hd` with
  `arrow_back`; the app renders it with the down chevron. That is a navigation-model
  question, not a skin question, so it stays as-is for entry 12.

**Not yet converted** (their own entries own them): the hand-rolled `IconButton`s in
`VocabCardDetailPage`, `DictionaryCardDetailPage`, `CollectionViewPage`,
`UserProfilePage`, `QuickMarkPage` and `SortCardsPage` header slots. They should
become `HeaderIconButton`s when entries 2 / 18 convert those pages.

**Code:** `src/components/PageHeader.tsx` → `PageHeader`, `Header`, `BackGroup`,
`SIZE_SPEC`, `HeaderMetaLabel`, `HeaderIconButton`, `HeaderToggleChip`;
`src/components/MobileDemoHeader.tsx`; `src/components/MobileTabScreen.tsx`;
`src/components/LeafPageHeader.tsx`; `src/components/NodePageHeader.tsx`;
`src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnHeader.tsx`;
`src/games/bubble-match/BubbleMatchHeader.tsx`;
`src/games/word-search/WordSearchHeader.tsx`;
`src/games/match-speed/MatchSpeedHeader.tsx`; `src/pages/AccountPage.tsx`.
**Docs:** `docs/LEAF_NODE_PAGES.md`, `docs/MOBILE_TAB_SCREEN_LAYOUT.md`,
`docs/GAMES_FEATURE.md`. **Size: M.**

### A2c · The shell itself

**Status: DONE (2026-08-20).**

`MobileTabScreen` keeps both of its rules (scroll-away header inside the scroll
area; footer clearance reserved), and its ground was already `--paper` — A2a and
A2b had between them left nothing for A2c to do inside that file. The real work
was one layer out: the phone frame, and the Vite scaffold still sitting under
everything in `index.css`.

**What landed**

- **`MobileDemoFrame` now IS the design's `.phone`.** Desktop was a 393px card
  with a 20px radius and no shadow; it is now **402 × 874, radius 44**, with the
  design's two-layer drop shadow. The numbers are exported as `PHONE_WIDTH` /
  `PHONE_HEIGHT` / `PHONE_RADIUS`.

  This is not a desktop-cosmetics change. **Every artboard is drawn inside a
  402-wide box**, so a page's `22px` gutters, spine widths and bento columns only
  land where the design puts them at that width. Judging a converted page against
  an artboard at 393 compares two different layouts.
- **The two phone-shaped OVERLAYS stopped hand-copying the geometry.** Practice
  Writing's popup and the community design zoom each carried a byte-identical
  `PaperProps.sx` with `md: 393` / `maxHeight: 932`. Both now spread
  `PHONE_OVERLAY_SX`, exported from `MobileDemoFrame` beside `desktopSx` because
  it is the same box. Left alone they would have sat 9px narrower than the frame
  they exist to be pinned to — the exact drift the duplication invited.
- **`index.css`'s `:root` is no longer Vite's scaffold.** It declared
  `color-scheme: light dark` with white text on `#242424`, plus a
  `@media (prefers-color-scheme: light)` block fighting it, indigo `#646cff`
  links, a bare `h1 { font-size: 3.2em }` and a dark-grounded bare `button`.
  It is now `color-scheme: light` (decision D4 — one palette; a dark-mode OS was
  rendering native form controls, scrollbars and autofill dark inside an entirely
  light UI) with `--ink` on `--paper`, and the design's ink/muted link colors.
  The `h1` / `button` / media-query blocks are deleted — every heading is an MUI
  `Typography` with its own size, and `.MuiButtonBase-root` outranks a bare
  element selector, so the `button` rule only ever reached the one hand-rolled
  `<button>` (`ProvisionalCardsNotice`), which styles itself inline.
- **Stale `393` prose** swept from six code comments and four docs.

**Known consequence, deliberately not fixed here**

`DeckTile`'s `cardWidth: 100` was derived from a **337px** content column (393
frame − 28px gutter) so three tiles fill the fdp row. At 402 the column is 374 and
the row under-fills by ~38px on desktop. It was not retuned, because the number was
about to be deleted — **A3 has since deleted it**, along with `DeckTile` itself, and
the shelf row has no width arithmetic to get wrong.

**Still open**

The desktop BACKDROP behind the phone card is MUI's
`palette.background.default` = `#ffffff` (`ThemeContext`), one percentage point
off `--paper`. Fixing it would also re-ground every **non-frame** page (Reader,
Night Market, Settings, auth), none of which is converted yet, so it is left for
the entry that converts them rather than changed blind here.

**Code:** `src/components/phoneGeometry.ts` (new) → `PHONE_WIDTH`, `PHONE_HEIGHT`,
`PHONE_RADIUS`, `PHONE_SHADOW`, `PHONE_OVERLAY_SX`;
`src/components/MobileDemoFrame.tsx` → `FrameRoot`, `desktopSx`; `src/index.css` → `:root`;
`src/components/handwriting/PracticeWritingPopup.tsx`;
`src/features/community/CommunityDesignZoom.tsx`. Unchanged after review: `src/components/MobileTabScreen.tsx`,
`src/components/MobileDemoHeader.tsx`, `src/components/Layout.tsx`. **Size: S.**

## A3 · Shelf — the collection primitive

**Status: DONE (2026-08-20).**

Used by: **2** (Decks), **6** (Reader), **3** (Discover), **18** (Card Detail's
related shelves). Built once; no page invents a copy.

### What landed

`src/components/shelf/` — import from the barrel (`./shelf`), not the files:

| Export | Design class | Notes |
|---|---|---|
| `Shelf` | `.shelf` | The padded container; owns the 22px page gutter. |
| `ShelfHeader` | `.shelfhd` | A row's caption + an optional right-hand affordance icon. Carries its own gutter, so it is a SIBLING of `Shelf`, not a child. |
| `ShelfRow` | `.shrow` + `.spines` + `.board` | One row. A `scrollable` row also gets the scroll stretch — spines spread apart under a fling and close back up when it stops ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § "Scroll stretch"); a wrapping row opts out, never scrolling. |
| `ShelfNote` | `.shnote` | A sentence under a row. |
| `Spine` | `.sp` and all its modifiers | The set-of-cards atom. |
| `AddSpine` | `.sp.add` | The "make a new one" affordance. |
| `spineHeight(count)` | — | The count→height band function. |

All six spine variants exist from day one — `base` 74×116, `tall` 140, `short` 96,
`uni` 126, `vol` 86×134, plus `AddSpine` — as are the three slots (`pin`, `caption`,
`glyph`) and `vol`'s own (`meta`, `ownerGlyph`). The sheet's 74px squat is the
`height` prop rather than a seventh variant.

### Decisions taken while building

- **`AddSpine` is its own component, not a `Spine` variant.** It shares only the
  BOX: no body colour, no strap, no shadow, no title, no count, none of the slots.
  Folding it in would make every one of those a conditional inside `Spine` for a
  shape that carries no data.
- **The reference width is PER VARIANT, and the scaling is JS, not `cqw`.** The plan
  said to author every interior size at one `REFERENCE_WIDTH` and render in `cqw`.
  Both halves needed correcting, and the second one only showed up in a browser:
  - Per variant, because the design authors `.sp.vol`'s interior at its own 86px
    width (`.ti` is 11.5px there, the same numeral as `.nm` at 74px), so a single 74
    reference would render vol's text ~16% larger than the artboard.
  - **JS, because an element cannot query itself.** `container-type: inline-size`
    makes a box a container for its DESCENDANTS, so the spine's own padding in `cqw`
    resolved against the next container out — the 402px phone frame — giving
    `padding: 54px 49px` on a 74px spine. With `box-sizing: border-box` the box could
    not shrink below its own padding (it rendered 98px wide) and its content box
    collapsed to ZERO, which took every descendant's `cqw` to `0px`. The name, the
    count and the glyph were all in the DOM at `font-size: 0` — the spines looked
    like empty coloured blocks. `spineScale()` is plain arithmetic now, which is
    exact because a spine is `flex-shrink: 0` and always given an explicit width.
    (`DeckTile` was `flex: 1 1 auto` and genuinely did not know its width; that is
    what container units are for, and it is not this case.)
- **A spine takes ONE colour, not the `main`/`accent` pair.** The pair was a
  `DeckTile`-ism — its lighter inner fill. A spine's body is a single pastel and the
  inset white highlight down its right edge does that job, so `accentColor` had
  nowhere to go. `BAND_COLORS`/`deckTileColors` still return pairs for other
  surfaces; the shelf reads only `.main`.
- **Rows scroll sideways rather than wrapping, where the list grows.** Spines are
  `flex-shrink: 0`, so a wrapped second line stands on no board at all. The fixed
  Collections row wraps (it is known to fit); the challenges and decks lists scroll.
- **Every row is left-aligned.** `DecksPanelBody` used to centre its short rows and
  left-align its growing ones. Centring is wrong on a shelf: the board runs the full
  row width, and spines floating in the middle of it read as a mistake.

### Consequences worth a second look

- **The fdp's "+ new deck" moved** out of the Decks section header and onto an
  `AddSpine` at the end of the row (the design's own affordance). It is therefore
  hidden while that section is collapsed.
- **The `spineHeight` cutoffs are a first cut** — `< 20` short, `< 100` base, `100+`
  tall. The design specifies the three heights but not where a set moves between
  them. Chosen against the app's actual spreads; wants real accounts on screen.
- **Two counts on Account, one on the fdp.** A3 warns against encoding the count as
  both height and numeral by reflex. Account keeps both (it is a stats block — the
  height compares the four bands, the numeral is the figure you went there for).
  The fdp sheet has no banding at all, because `.sheet .sp` flattens every spine to
  74.

### The glyph slot, and what a browser pass changed

The first cut of `Spine` had **no** home for the collection glyphs and dropped them:
the design's own corner glyph `.mine` is a top-LEFT mark, which is exactly where
`label` starts, so the two overlap on any spine with a name. That was wrong — it
threw away the thing that tells two spines of the same colour apart, and it broke a
designed Study Challenge feature (duplicate `vs Bob` deck names, disambiguated by the
opponent's icon).

The fix is the design's OTHER glyph slot: `.sp.vol .own` — a glyph pinned to the right
edge, clear of the foot content — generalised to every variant. On a base spine it
renders as the right-hand end of a **foot row**, opposite the count. A real flex row
rather than two absolutely-positioned corners, so the two cannot overlap however long
the numeral gets. `collectionIcon.tsx` became `collectionGlyph.ts` in the process: it
returns a Material Symbols NAME rather than a `@mui/icons-material` element (D3),
because the spine scales the glyph against its own width and cannot do that to an
opaque element. `DeckBuckets`' `BUCKET_GLYPHS` did the same.

Three more things only a browser showed:

- **Rows were centred, and the board was a short bar.** `ShelfRow` had no `width:
  100%`, so inside a centred flex column it shrank to its spines. The board sizes to
  the row, so it shrank too — a stub under the spines rather than a shelf they stand
  on.
- **The panel needed its own gutter.** `Shelf` carries the design's 22px PAGE gutter,
  but every section heading in the decks panel is inset by the panel's own 28px. A
  shelf 6px narrower than its own caption reads as a misalignment, so `PanelShelf`
  overrides it to 28.
- **The three `LineSeparator`s are gone.** The board already sits at the foot of every
  row; a 280px hairline 12px under it is a seam, not a separation.

### Labels that do not fit a 74px spine

`Unfamiliar` measures **56.02px** into the spine's **56px** of content — it misses by
two hundredths of a pixel and wrapped to "Unfamilia / r". The `.nm` tracking is
therefore `-0.01em` rather than the design's `-0.005em`: 0.5% of tracking is
invisible, a ten-letter word broken after its ninth letter is not.

`Comfortable` (70px) can never fit, so it has to break, and:

- `overflow-wrap: anywhere` — the design's value — creates a soft-wrap opportunity at
  EVERY character, so the line-breaker always fills to the last one that fits and
  hyphenation never gets a look in. `.nm` uses `break-word`, which only breaks a word
  that cannot fit a line of its own.
- `hyphens: auto` is set but is **not** relied on: it needs the browser to ship
  hyphenation data for the document's language, and headless Chrome does not, so it
  could not be verified here.
- So the CALLER supplies a soft hyphen: `BUCKET_LABELS.Comfortable` is
  `"Comfort\u00ADable"`, which renders "Comfort- / able". Knowing where an English
  word divides is caller knowledge — `Spine` renders whatever string it is given and
  has no business carrying a hyphenation dictionary.

**Code:** `src/components/shelf/{Shelf,Spine,AddSpine,spineGeometry,index}.tsx|ts`
(new); `src/features/flashcards/collectionGlyph.ts` (new, from `collectionIcon.tsx`);
`src/components/DeckBuckets.tsx`; `src/features/flashcards/DecksPanelBody.tsx`;
`src/features/flashcards/FlashcardsDecksPage.tsx`; `src/utils/categoryColors.ts`.
**Deleted:** `src/components/DeckTile.tsx` (422 lines),
`src/features/flashcards/collectionIcon.tsx`.
**Docs:** `docs/DECKS_FEATURE.md`, `docs/STUDY_CHALLENGE.md`.
**Verified in a browser** (Account + the fdp sheet), not only by typecheck. **Size: L.**

## A4 · Bento — the menu primitive

**Status: DONE (2026-08-21).** Components shipped, **all three hub callers
converted**, and **D8 is complete**: `HubMenu.tsx` (439 lines) and
`hubMenuCardBase.ts` (31) are deleted, and `docs/HUB_MENU_SYSTEM.md` was rewritten
as [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) with its 9 inbound doc links and the
CLAUDE.md entry retargeted.

**`src/components/MarkTypeChip.tsx` had NO caller and was DELETED on 2026-08-22.**
The open "does the chip come back?" question is answered *no*: every hub card now
names its track in its SUBTITLE (`tileSubtitle()`), and the last card that could not —
Bubble Match, whose sub-tile subtitles are level labels — names both of its tracks on
its strip header instead, on the control that picks between them
(`BubbleMatchTrackToggle`; see [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) § `BentoStrip`).
Typecheck and `npm run build` clean. Shipped `src/components/bento/` —
`Bento`/`BentoTile`/`BentoStrip`/`BentoSubTile` (`Bento.tsx`), `CollectionChip`
(`CollectionChip.tsx`), and a barrel `index.ts`. Work items 1 and 2 are done; item 3
(deleting `HubMenu` + rewriting its 10 importers) was always budgeted into entry 4,
and item 4 (picking the ghost glyphs) is a per-hub choice made when entries 1/4/5
place the tiles.

**Corrections made once the artboards were read against the components:**

- **The ghost glyph is the tile's OWN ink, not neutral ink.** The artboards set
  `color:var(--purA)` on `.bt` and let `.bg` inherit it, so the ghost is a deeper wash
  of the tile's own hue. Drawing it in neutral ink — which the first cut did — makes a
  tile read as two colours instead of one.
- **This forced `RAMP` (`src/theme/colors.ts`),** the seven hues as `{fill, ink, tint}`
  triples with a `RampHue` key type. A tile needs two tiers of ONE hue at once, and a
  fill from one hue beside an ink from another is the palette mistake that typechecks,
  looks deliberate, and is invisible in review. `BentoTile`/`BentoSubTile` and
  `GameDef` now take a hue KEY, so the pairing cannot be broken at a call site.
- **Tiles are real anchors.** `to`/`state` render the tile as a `RouterLink`, giving
  middle-click, new-tab and keyboard focus for free; `onClick` receives the event so a
  tile can intercept its own activation (Word Search confirming before clobbering a
  save) while leaving modified clicks to the anchor.
- **`BentoStrip` gained a `meta` slot** (`.lab`, mono uppercase) — the artboards end a
  strip header with a FACT about the set ("×14 wins", "2 modes"), not the chevron a
  `ShelfHeader` ends with. That is the difference between the two headers.
- **`CollectionChip` gained the trailing `expand_more`** the artboard draws, plus a
  `trailing` slot for non-figure content.

**Decisions taken while building:**

- **`BentoTile` is the app's one exception to "every pastel fill carries
  `markOutline`" (D2).** The design draws the distinction itself: `.msb .cells i` —
  15px tall, no content — gets the 12% inset ring, while `.bt` — 112px tall, carrying
  a title and subtitle — gets a soft `0 1px 2px` drop shadow instead. At tile size the
  content and shadow do the separating work and an inset hairline on a 19px radius
  reads as a stray border. **The rule is therefore: a pastel needs an outline UNLESS it
  is large and occupied.** Recorded in the component's header comment.
- **Variant geometry is a table, not branches.** `TILE_VARIANTS` keys `base`/`hero`/
  `low` to min-height, span, title size, letter-spacing, subtitle size, and the ghost
  glyph's size + top offset. The ghost's size is PAIRED with the tile's — `hero` is
  140px at `top:-26`, the others 92px at `top:-14` — and that pairing is what breaks
  first when the variants are spread across conditionals.
- **The ghost glyph is documented as decoration, not information.** Clipped, behind
  the text, 15% on a pastel. The prop comment says explicitly not to rely on it to
  tell two tiles apart, because the title is doing that.
- **`position: relative` on the title/subtitle is load-bearing** and commented as
  such: the ghost is an absolutely-positioned earlier sibling, so without it the glyph
  paints over the text.
- **Two gutters on purpose.** The grid is 16px (a tile's own 14px padding already
  insets its text); `CollectionChip` is 18px, because it is a bordered box whose 1px
  edge would otherwise sit proud of the tiles below it. Both are the design's numbers.
- **`BentoSubTile` carries `minWidth: 0`** — not in the design's CSS, but without it a
  long title widens the sub-tile instead of wrapping and the strip's even split (the
  thing that makes it read as a set) is lost.
- **`CollectionChip` is white and outlined among a grid of pastels on purpose**, and
  says so in its header: it is not a destination, it changes what the destinations
  use, so it must not read as one more tile.

Used by: **1** (Home), **3** (Discover), **4** (Games), **5** (Account).
This is the component that **replaces `HubMenu`** — deleted outright (D8).

**Classes** — `.bento` (2-col grid, gap 10), `.bt` (tile: radius 19, min-height
112, content bottom-aligned), `.bt.w2` (hero — spans both columns, min-height 150,
title jumps 15.5 → 23px), `.bt.lo` (short, 90), `.bg` (the oversized ghost icon
bleeding off the top-right at `opacity:.15`), `.t` / `.s` (title/subtitle),
`.pin` (a pill badge, top-right).

**`.strip`** is the nested variant: a full-width cell containing `.sh` (a small
header with a label and a right-hand affordance) over `.row` of `.st` sub-tiles
(radius 15, min-height 80, smaller ghost icon, optional `.star`). Games uses it for
level rows; Home uses it for grouped destinations.

**`.chipsel`** — the collection-selector chip (white, outlined, radius 14: icon +
bold label + mono trailing count). Today this is `GamesCollectionSelector` rendered
into `HubMenu`'s `header` slot.

**The rule that makes the system work** — repeat it in the component's header
comment: *Bento is for **menus of destinations**; Shelf is for **collections the
user owns**. If a tile navigates, it is a Bento tile. If it represents a thing with
a count, it is a spine.*

**Work**
1. `src/components/bento/Bento.tsx` — `Bento`, `BentoTile` (`hero` / `low`
   variants), `BentoStrip`, `BentoSubTile`.
2. `src/components/bento/CollectionChip.tsx` — `.chipsel`.
3. Then delete `HubMenu.tsx` + `hubMenuCardBase.ts`, which means rewriting its
   **10** importers — including `WordSearchHubItem.tsx` (~390 lines, imports six
   named exports) and `GamesCollectionSelector`. That rewrite is budgeted in
   **entry 4**, not here.
4. **Pick the tiles' ghost glyphs (D5).** Each `.bt` carries an oversized `.bg`
   icon at `opacity:.15`. These are a fresh selection from Material Symbols matched
   to the design's vocabulary, not a port of the current MUI icons — do the whole
   set in one pass so the hubs read as one family.

**Code:** new `src/components/bento/*`; `src/components/HubMenu.tsx` → `HubMenu`,
`HubMenuRow`, `HubMenuArrayItem`, `HubMenuGroup`, `HubMenuGroupHeader`,
`HubMenuCardTitle`, `HubMenuCardEdgeSlot`, `HubMenuRowIconTile`,
`HubMenuStatBadge`; `src/components/hubMenuCardBase.ts` → `cardBaseSx`,
`CARD_PADDING_PX`; `src/games/word-search/WordSearchHubItem.tsx`.
**Docs:** `docs/BENTO_SYSTEM.md` (this entry effectively rewrites it).
**Size: L.**

## A5 · Generic atoms

**Status: DONE (2026-08-21); `Segmented` added 2026-08-24 with entry 18.** Depends on A1.
Small individually, but **every** Part B entry uses several, so they were done as one pass
rather than 17 partial ones.

The pass split the fifteen classes three ways, on one question: *does MUI already ship
this control?*

| Where it landed | Classes | Why |
|---|---|---|
| **New primitives** — `src/components/primitives/` | `.lab`, `.sec2`, `.shelfhd`, `.rw` + `.rows`, `.card` | No MUI analogue worth bending. `ListItem` is a full-bleed strip with a divider; `.rw` is a discrete outlined card. |
| **MUI theme overrides** — `src/contexts/ThemeContext.tsx` | `.btn2`, `.btn3`, `.chip`/`.chip.on`, `.field`, `.mode` | ~157 `<Button>`s, 35 `<TextField>`s, 14 `<Chip>`s already exist. A theme override re-skins all of them with no call-site edits. |
| **Already existed** | `.tip`, `.dots` | `TipBox.tsx` was restyled during A4. `FrequencyScoreDots.tsx` already matched `.dots` exactly (8px, 1.5px border, 4px gap) — verified, not touched. |

Not built, deliberately: `.modal`, `.sheet`, `.scrim`. Each has a live bespoke
implementation (`HydraLendNotice`, the decks panel from entry 2, MUI `Backdrop`) and
none of the three is repeated often enough to have drifted yet. They are A5's leftovers,
tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md).

### The primitives

> ⚠️ **The `.lab` face is under review (2026-09-04).** `Label` now reads `FONTS.label`
> rather than `FONTS.mono` — a new token whose default stack is byte-identical to the old
> one, so nothing moved. The split exists because that one token was setting both PROSE
> (`sense 1 · to be located at`) and DATA (`×12 wins`), and mono is only right for the
> second. `/font-lab` → Info type is where the replacement face is being chosen; ~19
> hand-rolled copies of this flavour still sit on `FONTS.mono` and are listed for
> conversion in [INFO_TYPE_LAB.md](./INFO_TYPE_LAB.md) § 5.

**`src/components/primitives/Label.tsx`** → `Label`, `SectionRule`, `SectionHeader`.

All three exist for one reason: in this design a section is announced by a **mono
uppercase overline**, not by a bold sentence-case heading, and the four values that make
that work (10px / `.14em` / `FONTS.mono` / `COLORS.textFaint`) were being re-typed per
page and drifting. `Label` is those four values. `SectionRule` (`.sec2`) adds a hairline
running to the right edge — grown as a flex child, so it starts *after* the text rather
than underlining it. `SectionHeader` (`.shelfhd`) adds a right-hand affordance icon, and
should be used **only** when that affordance exists; without an `action` it is a
`SectionRule` that forgot its rule.

`.shelfhd` and `BentoStrip`'s own `.strip .sh` look alike and mean different things — one
ends in a tappable icon, the other in an inert mono fact. Kept as separate components on
purpose; see [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) § "`BentoStrip` vs `ShelfHeader`".

**Added 2026-08-24 (entry 8):** `SectionHeader` grew an optional `meta` slot — a mono fact
at the right end ("last 7 days", "25 players"), which is what `.shelfhd` carries on
artboard 8. Same slot and same meaning as `BentoStrip`'s `meta`: a statement about the set
that follows, never a control. A bare string is wrapped in a `Label`; a node is left alone.

**Added 2026-08-24 (entry 18):** `SectionRule` grew an optional `right` slot — an
arbitrary node at the far end of the hairline, which is artboard 18's `.sec2` with a
`.trkseg` in it. Deliberately different from `SectionHeader`'s `action`: that one is a
single glyph on a header with no rule, this one is a control at the end of one. A control
at the far end of a hairline reads as SCOPING what follows; a glyph on a bare header row
reads as ACTING on it.

**`src/components/primitives/Segmented.tsx`** → `Segmented` (`.trkseg`). Added 2026-08-24.

A hairline-outlined pill split into 2–4 mono-uppercase choices, exactly one active. It is
the third of the design's three "pick one of a few" shapes and they mean different things,
which is why they stay different components:

| shape | what a pick changes |
|---|---|
| `Segmented` (`.trkseg`) | which SLICE of the same data you are looking at — the content below does not change kind, only which track/period/lens it reports. Small and quiet: a lens control, not a destination |
| `.tabs2` (the eip tab strip) | which KIND of content. Full width, sentence case, underlined |
| `.chip` / `.mode` (MUI theme overrides) | a filter or a mode that changes what an ACTION will do |

Not a MUI `ToggleButtonGroup`: the group ships 44px touch targets, a ripple and a
border-collapse scheme that all have to be overridden away to reach an 8.5px mono pill,
and what survived the overrides was a `Box` with extra steps.

**`src/components/primitives/Row.tsx`** → `Row` (`.rw`), `RowList` (`.rows`).

One entity in a list, where the list is neither a collection the user owns (Shelf) nor a
menu of destinations (Bento). Slots: `icon`/`initials`/`avatar` + `hue`, `title`,
`subtitle`, `meta`, `value`, `chevron`, `trailing`. A row that needs one more slot than
these is not a `Row`. Like `BentoTile`, it becomes a real `<a>` with `to`, a real
`<button>` with only `onClick`, and a plain div otherwise.

The 36px avatar is a **pastel fill and carries `markOutline`** — the "large and occupied"
exception (D2a) does not reach something this small, and without the inset ring it sits at
~1.15:1 on white and disappears.

Two slots were settled by entry 5 (Account) rather than by this section, because Account's
profile row is the only row in the artboards that needs either:

- **`avatar` REPLACES the styled box**, it does not fill it. The prop's doc always said
  "a fully custom avatar" while the code nested the node *inside* the 36px pastel box, so
  a caller could change the contents and nothing else. Account needs a 48px, radius-15,
  *tappable* avatar (it opens the icon picker), and a focusable control cannot be built by
  handing children to a div. There were no other callers, so the code moved to match the
  doc. `icon` / `initials` still render in the styled box.
- **`meta` is a THIRD text line, set in mono** — the design's second `.s` inside `.tx`.
  Exactly one row in the whole artboard set has it (Account's, carrying the copyable user
  ID), so it is an exception rather than a general slot: reach for it when a row's identity
  needs a machine-readable line, not to fit one more sentence in. It renders as a `<span>`,
  not a `<p>`, because Account puts an inline copy **button** in it.

**`src/components/primitives/StatCard.tsx`** → `StatCard` (`.card`).

The *one* number a screen is about. Deliberately singular: three stacked is a data table
in costume, and several equally-important figures belong in a `RowList` with mono
`value`s. The 38px numeral is copied verbatim rather than snapped to `SIZE.display`
(40px), because the design pairs it with `-0.035em` tracking and the tracking is what
makes a long figure read as one shape. Its `action` slot takes a plain MUI
`<Button variant="contained">` — the theme already skins that as `.btn2`.

The design's `.card .k` tracks at `.13em` where `.lab` tracks at `.14em`; `StatCard`
normalizes onto `Label`. Two overline recipes guarantee drift and nobody can see 0.01em.

**`src/components/primitives/SectionCard.tsx`** → `SectionCard` (`.card`, the SHELL).
Added 2026-08-24 (entry 8).

`StatCard` is this plus a fixed three-slot content layout, and that layout is right for
one big figure and wrong for everything else — the arena's countdown is a time and a rank
on one baseline, the friends page's ID card is a mono string and a copy chip. Until this
existed, each such screen kept a private `sectionCardSx`: **three copies in three
features, and all three had drifted from the design** — a `borderRadius: 3` (24px) where
it says 18px, `p: 1.5` (12px) where it says 14/16. So the shell is its own component,
`StatCard` renders into it, and a screen wanting a `.card` around its own content reaches
for the shell directly.

Its one prop beyond `children` is `background`, for the single case where a card's FILL is
the message (the arena's results card going green on a promotion) — not for decoration.
The `14px 18px 0` margin is the component's own, matching `.card`; pass `sx={{ margin: 0 }}`
where a page column already insets it.

### The theme overrides, and their one scoping rule

**SHAPE is overridden for every colour; GROUND AND INK only on the `*Primary` slots.**

A pill is a pill whether it is destructive or not, so radius/padding/type apply to
`contained` and `outlined` across the board. But repainting a `color="error"` button
ink-black would erase the only thing it is saying, so the ink lands on
`containedPrimary` / `outlinedPrimary` / `Mui-selected`. Anything with no explicit
`color` prop defaults to primary and picks up the design automatically.

**Chip needs that rule spelled out by hand.** MUI's button slots are colour-scoped
(`containedPrimary`), but its chip variant slots are not — `outlined` and `filled` apply
to every colour. Writing the ink there directly flattened the reader's `color="error"`
"Vocab processing failed" chip and the dictionary's info chips. The overrides are nested
under `&.MuiChip-colorDefault, &.MuiChip-filledPrimary` (resp. `-outlinedPrimary`), which
is the exact set meaning "no semantic colour was asked for".

Two inversions worth knowing before writing a call site:

- **A selected chip is `variant="filled"`, a resting one is `variant="outlined"`** —
  which reverses MUI's usual reading of those two variants. That inversion is the
  design's (`.chip` vs `.chip.on`); do not reach for a class.
- **`.btn3` is radius 14, not a pill**, unlike `.btn2`. The design uses it as a
  full-width block action, and a 999px block reads as a stretched pill.

`.field`'s leading icon is **not** in the theme — it is per-call-site
(`InputProps.startAdornment`), because forcing one would put a search glyph on every
text field in the app.

⚠️ **The overrides live on the SHARED base theme**, so Dark / Ocean / Nature inherit an
ink-black button on their own grounds. Knowingly wrong, knowingly deferred: D4 runs the
app on one light palette for the duration of the redesign and the other three are not
re-derived yet.

### Consumers converted

`src/features/friends/FriendPersonRow.tsx` wears the `.rw` **skin** (white ground, radius
16, 36px rounded avatar with its ring, 14.5/11.5 type) but keeps its own structure and is
**not** a `Row`. A `Row` has one tap target; this has two nesting models
(`onPersonPress` leaves the actions outside the tappable half, `onRowPress` swallows the
whole row). Folding that in would push a friends-only concern into every list in the app.

`DictionaryEntryRow` was deliberately left out of this pass: the design gives dictionary
hits their **own** class (`.dr` — headword, pinyin row, gloss, no avatar), so it is not a
`.rw`. It was converted on 2026-08-24 as part of **entry 7**, where it belongs — `.dr` is
used on exactly one screen, so it stayed a page component rather than becoming a shared
A7 widget.

**Code:** `src/components/primitives/*`; `src/contexts/ThemeContext.tsx`;
`src/features/friends/FriendPersonRow.tsx`. Verified unchanged: `src/components/TipBox.tsx`,
`src/components/FrequencyScoreDots.tsx`.
**Size: M.**

## A6 · Game surface chrome

**Status: DONE (2026-08-21).** Depends on A1, A2b. Shared by entries **12–16** and the
undesigned Memory Map.

Every game artboard is the same frame: the `.lhd` leaf header (A2b, already shipped) over
`.play` — an inset rounded panel containing `.hud` (a bordered strip of mono `.lab`s) and
optionally `.timer` (28px tabular numerals over a `.trk` track).

### The scope line, and where it falls

A6 is **the frame, and the frame only.** `GameFrame` / `GameHud` / `GameTimer` are built
and every game now plays inside the panel. What goes *in* the HUD is per-game and belongs
to entries 12–16 — "Board 4 · endless, cleared count, fill bar" (16) and "Pinyin ·
production" (13) are content decisions about specific games, not shared chrome. Drawing
that line is what kept this pass from becoming five game redesigns.

### `src/games/shared/GameFrame.tsx`

| Export | Class | Notes |
|---|---|---|
| `GameFrame` | `.play` | The inset panel. Also `position: relative`, so a game's own overlays (a countdown, a pause veil) anchor to the PANEL and stop at its rounded edge instead of covering its margin. |
| `GameHud` | `.hud` | `space-between`, so the number of children is load-bearing: two pin to the edges, three put one in the middle. A HUD wanting four facts is a HUD showing too much. |
| `GameHudLabel` | `.hud .lab` | A `Label` that refuses to wrap. The strip is one line. |
| `GameHudBar` | `.hud` bar | The HUD's third slot, `flex: 1`. Always restates a number a label beside it already gives — the count is what you read when you look, the bar is what you see when you don't. Added by entries 12/16. |
| `GameHint` | `.lab` at the panel foot | The one-line instruction three artboards (12, 14, 15) draw in the same place. Mono/uppercase/faint on purpose: a rule you need once and never again should be legible on request and invisible otherwise. Added by entry 14. |
| `GameTimer` | `.timer` + `.trk` | Takes an already-formatted `value` — the frame does no clock math. |

`GameHud` also takes `divider={false}`, for a HUD sitting directly under a `GameTimer`
(Match Speed) — the timer already draws the hairline, and two of them a row apart read as
an empty table row. Artboard 14 sets `border-bottom:none` on that exact HUD.

**Why the panel is not decoration.** Before this, every game drew its board edge to edge,
so the board's boundary and the phone's were the same line and a bubble drifting to the
edge looked like it had left the app. The panel gives the play area its own visible
boundary — inside is the game, outside is the app — and gives a physics surface ONE
element to measure instead of reasoning about page padding.

**The artboard's absolute positioning was not copied.** `.play` is
`left/right:14, top:64, bottom:14` because an artboard is a fixed 402×874 rectangle. Here
it is a flex child of `LeafPage`'s body, so the header can be whatever height its title and
slots make it. The 64 in the CSS is the artboard's header height plus its gap, not a number
the app should hardcode.

**One deliberate departure: `GameTimer` keeps a `pulse` prop.** The design draws no pulse.
But a colour change plus a nearly-drained track is easy to miss in peripheral vision, which
is exactly where a clock gets read mid-game, so Match Speed's ten-second pulse survived the
port as an opt-in rather than being dropped silently.

**What the frame deliberately does NOT do:** `useBlockEdgeSwipe(true)` and
`touchAction: "none"` stay the page's job. The edge-swipe block is a document-level touch
handler with a lifecycle, and burying it in a layout wrapper would make "why can I still
swipe out of this game" invisible to whoever reads the page.

### Adoption

| Game | State |
|---|---|
| Match Speed | Framed. `MatchSpeedTimerBar` now **delegates to `GameTimer`** and keeps only what is Match-Speed-specific: `RUN_DURATION_MS`, the 10s urgency threshold, its colours. ~60 lines of duplicated clock styling gone. |
| Bubble Match | Framed. `BubbleStage` measures its own container, so this just re-bounds the field — no constant changed. |
| Hydra Bubbles | Framed, same as Bubble Match. |
| Word Search | Framed, and its HUD **is** `GameHud` as of entry 13. The reconciliation was a re-ordering, not a new primitive: the clock is now the MIDDLE child, so the one element that can vanish is the one whose absence moves nothing under `space-between`. It used to be first, which is why the hint meter beside it had to be absolutely positioned. |
| Memory Map | Framed. No artboard, but the design anticipated it — `.mapw` is in the stylesheet. |
| Speed Reading | Framed, and the one to **eyeball first**: it is the only game whose panel sits inside a ROTATED stage that draws its own header. The frame took the place of the play box that was already there, so the change is small, but the geometry is bespoke. |

In every case the popups (`GameEndPopup`, `ProvisionalSortOffer`, `GamePausedOverlay`, the
lend notice) stay **outside** the panel: each covers the whole content area and must not be
clipped by the panel's radius.

**Code:** new `src/games/shared/GameFrame.tsx`; all six game pages;
`src/games/match-speed/MatchSpeedTimerBar.tsx`.
**Docs:** `docs/GAMES_FEATURE.md`. **Size: M.**

## A6b · Game surface COLOUR — the 60/30/10 accent ground

**Status: DONE (2026-08-23).** Depends on A6, A1, A2b. Shared by entries **12–16** and
Memory Map.

A6 shipped the frame on the app's ordinary paper ground and stopped there. The artboards
do something else with it, in a per-screen CSS block the first pass skipped entirely
(`#bm{background:var(--redA)}` and its four siblings): **each game screen is flooded with
one saturated accent**, the play panel sits on it as a white island, and the header's ink
flips to white to survive it. 60% accent ground, 30% white panel, 10% the hue's near-white
tint on the HUD strip.

**Why it earns the trouble.** A game is the one place in this app where the player is
inside a single activity for minutes with no navigation on screen. Flooding the ground is
what makes "I am in Word Search" a fact you cannot lose track of, and it is also what turns
the panel from a card on a page into a board.

### The hue comes from the hub row, not from the artboard

| Game | Hub row (`GameDef.hue`) | Artboard | Ground shipped |
|---|---|---|---|
| Bubble Match | red | red | **red** |
| Word Search | pur | purple | **pur** |
| Match Speed | grn | blue | **grn** |
| Speed Reading | blu | yellow | **blu** |
| Hydra Bubbles | tea | green | **tea** |
| Memory Map | org | — | **org** |

Three of five artboard hues disagree with the shipped hub, whose mapping is already
visible and already documented as deliberate ("a persistent per-game color, not a random
one" — the `tealAccent` comment in `theme/colors.ts`). Copying the artboard would mean a
green hub row opening a blue screen, so the ground is DERIVED from the hub hue and the
artboards are treated as five screens drawn before the hub had settled. The design's yellow
is not in the app's ramp at all, which settles Speed Reading on its own.

Each game owns its hue as `GAME_HUE` in its own `constants.ts`. `GAME_REGISTRY` imports it
(the same trick it already used for `MARK_TYPE`, which keeps the registry cycle-free), so
the hub row and the ground read one constant.

### The two mechanisms, and why there are two

| | Mechanism | Why |
|---|---|---|
| The header (title, chevron, right-slot icons, `HeaderMetaLabel`, streak badge, both chip states) | CSS descendant selectors in `gameSurfaceSx`, applied to `LeafPage`'s surface | It is the design's own mechanism (`#bm .lhd h1{color:#fff}`), and the alternative is threading an `onAccent` flag through four shared components that only games would ever set. The selectors win on specificity: a 2–3 class descendant rule beats the single-class rule MUI generates for an `sx` colour. |
| The panel (`GameFrame` border, `GameHud`/`GameTimer` ground + hairline, `GameCentered` ink) | React context — `GameSurfaceProvider` / `useGameSurfaceHue()` | A HUD label's colour is overridable per call site (a lives counter turning red); a blanket descendant rule would silently clobber it. The context is also null-by-default, so every one of these components still draws its pre-A6b self with no provider — which is what keeps them mountable bare in a test. |

`GameLeafPage` (`src/games/shared/GameSurface.tsx`) is what a page actually uses: it takes
one `hue` and does the ground, the flips and the provider together, so "this game is teal"
is stated once per page and cannot be stated inconsistently.

There is a THIRD surface the ground has to reach: the phone's status-bar strip. In the iOS
home-screen app it is page pixels and the ground simply covers it (`viewport-fit=cover` —
see [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § Safe areas and the iOS status bar). In
a browser TAB it is chrome the page cannot paint, drawn from `<meta name="theme-color">`, so
`GameSurfaceProvider` also calls `useThemeColor(RAMP[hue].ink)`
(`src/hooks/useThemeColor.ts`) — a LIFO stack of claims, because a `usePageSlide` exit keeps
the outgoing page mounted while the incoming one mounts beneath it and a plain set/reset
would let the departing page clear the arriving page's colour. Non-game screens hold no
claim and get the paper default declared in `index.html`.

### The decisions inside it

- **The HUD strip takes the hue's `tint` (97.5%), not its `fill` (93%).** The artboards are
  split — Bubble Match and Speed Reading were revised from the pastel to a ~97% tint, the
  other three were not touched. Nothing moved the other way, so the tint is the direction
  of travel, and it is also the only one of the two that leaves the strip legibly lighter
  than a pastel-filled widget sitting inside it. Shipping the artboards literally would
  have imported a 2-vs-3 inconsistency.
- **The strip's hairline is the hue's `ink`, not `COLORS.rowBorder`.** On a tinted ground a
  10% ink alpha is too faint to close the shape. Same reason the panel's own border becomes
  a 50% WHITE alpha (`ON_ACCENT_LINE`) on the accent ground.
- **HUD labels default to full ink.** `GameHudLabel`'s default is `COLORS.onSurface`, not
  `Label`'s faint grey — the design sets these to `#000` on all five game artboards, and a
  faint grey on a 97.5% tint is not a label, it is a smudge.
- **The toggle chip's outline is an inset `box-shadow`, not a `border`.** A border adds 2px
  per chip and the leaf header is already tight enough that "Hydra Bubbles" ellipsises
  beside two chips, a restart button and the streak badge. An accent ground must not change
  the header's metrics.
- **The chip's ON state takes BLACK text**, per the design's latest revision (it was the
  accent ink). An accent-on-white chip and the accent ground are the same colour, so the
  chip's label was competing with the thing it sits on.
- **Text on the ground is white, and `GameCentered` owns that rule.** The four identical
  `renderCentered` helpers became one component, which was the opportunity: a blocked
  message that sets its own `color: onSurface` would ship black on a saturated ground, and
  now it inherits instead. Speed Reading's clock takes the same treatment, except that its
  "cannot medal any more" state goes to the PASTEL red — `dangerInk` is a dark red, and a
  dark saturated ground is the one place it cannot be read.
- **Match Speed's clock track changed hue.** It was `infoInk` (the palette's neutral blue);
  it is now `RAMP[GAME_HUE].ink`, because a blue bar on a green strip read as a widget
  borrowed from another screen.

### Two inconsistencies this pass found and fixed at the source

- **Memory Map's header was the last one still styling its own text**: a raw `Typography`
  for `0/25` and a `@mui/icons-material` `IconButton` for restart, both predating A2b/D3.
  They are `HeaderMetaLabel` + `HeaderIconButton` now — which is also the only reason the
  accent ground can repaint them.
- **Word Search's hint bar was gold.** The lightbulb is black now (the arm state is already
  carried by the glyph's FILL axis and the button's opacity; a third channel on one 16px
  icon just made the button look like a warning) and a banked charge dot is the game's
  accent ink, per `#ws .hintbar .chg i{background:var(--purA)}`.

**Not adopted: artboard 16's Hydra bubble ink** (`.bub.zh` muted, `.py` at full ink). That
artboard's bubble colours are already recorded as stale in entry 16, its Chinese/English
assignment is inverted from what ships, and `Bubble`'s ink is DERIVED from the fill
(`inkOnFill`) precisely so a palette change cannot strand dark text on a dark bubble. A
hand-set gloss colour would be a per-game knob reintroduced into the one place the app made
it a rule.

**Also not this pass:** the design's revised `.duo` treatment (a spine bar and a lit inner
edge on the two stat cards) is on artboard **2 · Decks**, not a game — it belongs to
entry 2.

**Code:** new `src/games/shared/gameSurface.ts` + `GameSurface.tsx`;
`src/games/shared/GameFrame.tsx`; all six game pages and their `constants.ts`;
`src/games/registry.ts`; `src/games/word-search/WordSearchHintBar.tsx`;
`src/games/match-speed/MatchSpeedTimerBar.tsx`; `src/components/LeafPage.tsx`
(new `surfaceSx`); `src/components/PageHeader.tsx` (the `--active` chip class).
**Docs:** `docs/GAMES_FEATURE.md`, `docs/LEAF_NODE_PAGES.md`, and the per-game docs.
**Size: M.**

## A7 · Data-display widgets

**Status: PARTIALLY DONE — `.bd` shipped 2026-08-21, `.msb` shipped 2026-08-24, `.banner`
shipped 2026-08-24 (inside entry 9), `.ladder` closed as superseded, `.cpcd` not started
and now the only item left.** Depends on A1. Each widget here should be used by 2+
FEATURES; `.banner` and `.ladder` were listed on the weaker test of "drawn more than once
in the artboards", which is what sent them back to Arena.

### ✅ `.bd` — the board (DONE)

`src/components/leaderboard/Board.tsx` → `Board` (`.bd`), `BoardRow` (`.bd .r`),
`BoardZone` (`.bd .zone`). Row slots: `rank`, `name`, `sublabel`, `meter`, `score`,
plus `highlighted` (this row is you) and `zone` (promotion band).

**A board is ONE card, not a stack of cards.** That is the whole shape decision.
Separate rounded rows with gaps say "these are N things"; a single outlined card with
hairlines between its rows says "this is one table and the rows are ranked against each
other", which is the only thing a leaderboard is for. It is also what makes a `BoardZone`
legible — a divider can only cut across something continuous.

**A zone divider carries real up/down arrows flanking its caption.** The caption says
WHAT the line is; the arrows say WHICH WAY IT MOVES YOU, which is the fact a competitor is
actually reading the board for — a green rule with arrows pointing up and a red rule with
arrows pointing down are legible before anyone has read a character. Both sides are
flanked so the pair reads as a direction the whole row carries rather than a bullet stuck
to the word, and they are Material Symbols glyphs rather than literal `^` / `v`, which
would read as text beside the caption instead of as an indicator. The neutral `hold` rule
gets no arrow: it is the absence of a direction.

Arena names each line for **what crossing it does to you**, not for the band underneath
it — `Promotion` at the top of the table, `Demotion` at the bottom (`renderZoneDivider`,
`ArenaPage.tsx`). ⚠️ The user-facing word is *Demotion* while the wire value stays
`zone: 'relegate'`; do not "fix" either to match the other.

**The sub-line has two settings, `sublabelVariant`.** `"meta"` (mono 9.5, faint) is a
machine fact next to a name — a language code, a division, a timestamp. `"prose"` (sans
11.5, secondary) is a sentence a PERSON wrote. Arena's message row uses `"prose"`: mono at
9.5 is a caption face, and running someone's own words through it makes them read as a
data field — at that size, barely read at all. Either way the line is `nowrap` +
ellipsis, because the board's legibility rests on every row being the same height and this
slot now carries text the user types.

**`scoreIcon` is a unit, not a sixth slot.** A Material Symbols glyph immediately before
the figure, saying what the number IS rather than anything about the competitor. It earns
its 13px only when the board's currency is something the app already draws elsewhere:
Arena's minutes take `local_fire_department` in `COLORS.fireActive` — the same flame
`MinutePointsFireBadge` burns in every header — so the column reads as "the points I watch
tick up" with no caption and no legend.

**Arena dropped its meter, and that is the general lesson.** The row used to draw the
score against the leader's as a 74px bar. The ranks are already sorted by that number and
the number is on the row, so the bar restated twice-known information in a third form —
and on a runaway board every bar below the top was the same stub. `meter` survives on the
primitive (the tester dashboard still uses it) but it is opt-in for a reason: a meter earns
its width only where rows are genuinely compared at a glance, not wherever a score exists.

**The five row slots are the whole vocabulary, deliberately.** Arena in particular puts a
learner in front of 24 strangers they did not choose and cannot leave, so adding a field
to this component means reopening [ARENA_FEATURE.md](./ARENA_FEATURE.md) Q20, not
adjusting a layout. Note there is no avatar slot at all — that is the privacy decision
made structural rather than left to a comment.

**⚠️ This section previously named the wrong consumers.** It claimed Arena (9), Community
(10) and Friends (8). In the code:
- **Arena** ✅ — migrated. `ArenaEntryRow` is now a thin binding of `BoardRow`; zone
  dividers are derived from the server's per-row `zone` at each band CHANGE, so the line
  can never disagree with the tints either side of it. `arenaStyles.ts` lost `zoneRowSx`
  and `rankChipSx` (41 dead lines).
- **The tester dashboard** ✅ — migrated, and it was the third bespoke ranked list all
  along; `LeaderboardPlaceholder` shed ~150 lines of row markup inside a pink-gradient
  card that predated the palette entirely. Not Community.
- **Community (10)** ❌ is not a leaderboard in code at all — it is a design FEED
  (`CommunityFeedRow`), ranked by upvotes but rendered as cards. Nothing to migrate.
- **Friends (8)** ❌ correctly stays off `.bd`: entry 8's own artboard draws that
  leaderboard as **`.rw` rows with podium tints**, not as a board. It already gets the
  right skin via `FriendPersonRow` (A5).

Two departures from the artboard, both recorded in the component:
1. **Zone captions use `RAMP.grn.ink` / `RAMP.red.ink`, not the artboard's `#0B5C46` /
   `#7A1024`.** Those two hexes belong to no ramp entry and appear nowhere else in the
   stylesheet; minting off-ramp colours for two words of caption is how a palette starts
   leaking. The result is a step lighter and still clears 4.5:1.
2. **`.sc` is `minWidth: 34`, not `width: 34`.** Fixed is right for a figure that stays
   small (arena minutes reset weekly) and clips one that does not (a lifetime points
   total is five or six digits).

One trap worth keeping: the row separator is drawn **by the parent** as
`& .board__row + .board__row::before`, not as `& + &` inside the row's own `sx`. The
latter silently half-works — `&` compiles to that row's generated class, so it only ever
matches two adjacent rows whose `sx` is byte-identical, and the viewer's row and any
zone-tinted row get different classes. Exactly the separators around the most important
rows would go missing.

### ✅ `.msb` — the mastery window (DONE 2026-08-24)

`src/components/mastery/MasteryWindow.tsx` → the eight-cell window, its `.tick` cut-point
markers, the `.hd4` heading (track name + band pill + figure) and the `.cd3` cooldown
legend, plus the `.sec2` rule and `Segmented` track switch above it. **This is the app's
only mastery visualization (D7)**; scale it down for inline/list contexts rather than
substituting a different shape. `.trk2` and `.mst` are deliberately **not built**, and
`MasteryProgressBar` — which WAS a `.mst` — is deleted.

Three things the build settled:

1. **A cell is a pbh unit, and the last one can be PARTIAL.** The core bar's pbh is a
   blend (the stronger track capped at 6 plus a third of the weaker), so it is fractional.
   Rounding it would make two genuinely different cards read the same, so the cell fills
   to its fraction instead.
2. **The core bar's filled cells are painted in its SEGMENT ratio**, recognition then
   production, on the SATURATED mark hexes (D2b). The band pill beside them is the
   PASTEL — it is a surface, the cells are marks.
3. **Which track is on screen is now the learner's choice** — see the D6 amendment.

- ~~It still renders one bar — the surface's lens (D6)~~ — superseded by the D6
  amendment: one track at a time, defaulting to the lens, switchable by the learner.

### Not started
- **`.cpcd`** — character-over-pinyin, with a `.sm` size. The app already owns this
  as `CPCDRow` / `CPCDBlock`, reached **only** through `ForeignText`. Restyle
  inside those files; do not introduce a new component. **This is now the whole of A7's
  remaining work.**

### Closed 2026-08-24 with entry 9
- ~~**`.banner`**~~ — the notched division banner. **Built as
  `src/features/arena/DivisionBanner.tsx`**, inside entry 9 rather than as shared work,
  because only Arena has divisions.
- ~~**`.ladder`**~~ — **SUPERSEDED, not deferred.** It is defined in `shelf-system.css`
  but drawn in **none of the 27 spec artboards**; the shipped design folds the same
  information into the banner's twelve ticks. A separate ladder would be a second place
  the app states which rung you hold, and two of those can disagree. Do not build it.
- ~~**`.hero`**~~ — the flashcard face itself, 295/426 aspect. **Done inside entries 18
  and 19–25**, where it belongs: `CARD_BASE_WIDTH`/`CARD_BASE_HEIGHT` + `CardFaceSide`
  already were the hero, and what the artboards actually changed about it was its
  FURNITURE (`.wtl` above it, `.crail` on it, `.peek` below it), not the face.

The `.ladder` / `.banner` question is settled: both were Arena-only, listed in A7 because
they are drawn more than once in the artboards rather than because two features share them.
Entry 9 built the banner in `src/features/arena/` and closed the ladder as superseded — the
general lesson being that **"drawn twice" is not the same as "shared"**, and A7 should hold
only widgets two different FEATURES consume.

**Work remaining**
1. Restyle `CPCDRow` / `CPCDBlock` in place. (The only item left in A7.)

**Code:** `src/components/leaderboard/Board.tsx` (done);
`src/components/mastery/MasteryWindow.tsx` (done); `src/components/CPCDRow.tsx`;
`src/components/CPCDBlock.tsx`; `src/components/ForeignText.tsx` (the `.cpcd` restyle,
still to do). **Deleted:** `src/features/flashcards/MasteryProgressBar.tsx`.
**Docs:** `docs/MASTERY_REWORK.md`, `docs/ARENA_FEATURE.md`,
`docs/CPCD_PINYIN_SHIFT.md`. **Size: L (was L; `.bd` and `.msb` are out of it).**

---

# Part B · Page by page

## 1 · Home — `/` — **Size: M**

**Status: DONE (2026-08-21).** `HomePage` is now a `Bento` mosaic: Night Market as
the `hero`, Games / Arena / Reader / Dictionary as base tiles, Community / Friends /
Compare Words as `low` tiles, `TipBox` + `FooterSpacer` below the grid. Hues and
glyphs are the artboard's verbatim. The role-gated rows append as further `low`
tiles, and the file says why an odd tile count is left half-empty rather than
stretched. `MobileTabScreen` is unchanged.

**Today.** `HomePage` renders a vertical `HubMenu` of 8 rows plus up to 3
role-gated ones, inside `MobileTabScreen`, with a `TipBox` header and
`FooterSpacer` footer. Every row is the same size.

**Design.** A bento mosaic. Night Market is the full-width hero (`.bt.w2`) with an
"open now" pin; Games / Arena / Reader / Dictionary are normal tiles; Community /
Friends / Compare Words are `.lo` tiles. Friends carries a badge count. Tip box
stays below the grid.

**Watch out.** The role-gated rows (`user.isValidator` → Tester Dashboard,
`user.isTemplateAuthor` → Template Editor + Sandbox) are **not drawn**. They append
as further `.lo` tiles — the mosaic must not assume a fixed tile count.

**Code:** `src/pages/HomePage.tsx`; `src/components/TipBox.tsx`;
`src/AuthContext.tsx` → `useAuth`.
**Docs:** `docs/BENTO_SYSTEM.md`, `docs/UX_AND_NAVIGATION.md`.

## 2 · Decks & Cards — `/flashcards/decks` — **Size: L**

**Status: DONE (2026-08-24).** Typecheck, lint, build and the 557-test suite clean.

**What landed.** The SHEET was already converted by A3, so this entry was the STUDY
AREA behind it plus one change inside the sheet.

- **`StudyHand` (`.fanw`) replaces the three study buttons.** Review / Challenge on one
  row above a 3:4 Study Mix slab became a fanned HAND of three cards with one played
  forward. Bringing a card forward is deliberately NOT starting the session — the front
  card carries the figure and its own `Study now`, so choosing a mode and committing are
  two taps. The fan is an ordered stack (`HandOrder`, bottom → top), seeded from
  `FAN_ORDER`; a card is brought forward by TAPPING it, or by THROWING the front card to the
  back of the stack in any direction (`useHandSwipe`, added later — see
  DECKS_FEATURE.md § "The card hand"). Throw and tap together reach all six arrangements.
- **The Centers rail (`.ctr2`) moved ABOVE the hand.** This resolves the entry's old
  conflict (a): the artboard has a slot for Reading/Writing Center now. They are a
  different KIND of destination — a place to look at your library by skill, not a session
  — so they sit apart from the hand rather than joining it. Pastel fills (D2b), reading on
  `red` and writing on the new `yel`.
- **`LibraryDuo` (`.duo`) replaces the Collections spine row.** This resolves conflict
  (b): the sheet now opens on the learner's two CONSTANTS — Learn Now and Mastered — as
  two wide tiles carrying their figures. **This narrows D9** (see the amendment there).
  No per-skill Mastered spine returns; the header comment's rule is intact.
- **The `.duebar`** prints the library size and the scope. ⚠️ Its artboard reads
  "24 due today", which the app cannot answer — see DEFERRED_WORK.md item 9.

**Figures.** Each mode's number is how many cards it could deal RIGHT NOW — its bands
minus everything on cooldown: Challenge = Unfamiliar + Target, Review = Comfortable +
Mastered, Mix = all four. The two halves partition the bands, so Challenge + Review ==
Mix. `undefined` until the library lands, so the cards print an em dash rather than a
provisional `0` — `0` is a real answer every one of these figures can give, and a common
one on a cooldown count. Review's gate reads that ready count and its toast branches on
whether cards are merely resting; an ineligible card still fires `onStudy` so the host
can explain rather than leaving a dead card. An ineligible or zeroed card **keeps its
ramp fill** (only the commit button dims) and swaps its corner tag for a `zeroMessage` —
"All caught up!" on Review, "Ready for more cards!" on Challenge/Mix.

⚠️ This entry originally shipped **band totals** with per-card captions (`in rotation` /
`ready` / `waiting`), and Mix's total omitted Mastered even though its loop deals one
Mastered card in ten. Both were corrected when the figures became cooldown-aware — see
DECKS_FEATURE.md § "The card hand" for the current rule.

**Artboard 2b** (sheet minimized) needed no work: it is the same page with the sheet at
its resting lip, which is the sheet's default state.

**Code:** `src/features/flashcards/StudyHand.tsx` (new);
`src/features/flashcards/LibraryDuo.tsx` (new);
`src/features/flashcards/FlashcardsDecksPage.tsx`;
`src/features/flashcards/DecksPanelBody.tsx`;
`src/theme/colors.ts` (`yel`/`yelA`/`yelTint` + the `RAMP` entry).
**Deleted:** the page's `MixButton` / `ReviewButton` / `ChallengeButton` / `CenterButton`
styled components and `studyButtonBase`.
**Docs:** `docs/DECKS_FEATURE.md`, `docs/MASTERY_REWORK.md`, `docs/DEFERRED_WORK.md` § 9.

## 3 · Discover — `/discover` — **Size: TBD**

**Status: DONE (2026-08-21) — the MENU only.** Converted at the user's explicit
instruction, overriding the D11 block. Sort Cards is the `hero`, Quick Mark and
Skipped Cards are base tiles; hues and glyphs are artboard 3's.

**⚠️ Two pieces of artboard 3 are NOT built, because the data does not exist
client-side:**

1. **The tile pins** — `184 waiting` on Sort Cards, `31` on Skipped Cards.
2. **The "Waiting to be sorted" shelf** beneath the grid — four spines whose heights
   encode the unsorted queue by band.

Nothing exposes a count of unsorted or skipped cards; `useCategoryCounts` counts the
user's LIBRARY by band, which is a different number. Both want one endpoint returning
the unsorted queue counted by band. **This is the outstanding item for entry 3** —
the bento itself is complete. The sort flow (scp) remains separate and out of scope,
though the design project now has a `Sort Flow - Shelf System.html` not yet read.

**Superseded note:** this entry previously read "BLOCKED — awaiting a new artboard".
The user is redoing the Discover
design (D11). Artboard 3 as it stands is **superseded**; do not build from it.
The sort flow (`/discover/sort/:language`, scp) is explicitly left as an
**outstanding item** and is not in scope for this pass.

**Today.** `DiscoverPage` is 62 lines: a `HubMenu` of exactly three equal rows —
Sort Cards, Quick Mark, Skipped Cards — with a `TipBox` header. Paths come from
`useDiscoverNavigation`.

**Design.** Sort Cards becomes the hero tile with a "184 waiting" pin; Quick Mark
and Skipped Cards are normal tiles (Skipped carries its own count). **Below the
bento, a new shelf** breaks the unsorted queue down by progress bucket —
Unfamiliar / Target / Comfortable / Mastered — with spine heights encoding counts.

**Watch out.** The description above records what the *superseded* artboard asked
for; keep it only as context for the new design. The queue breakdown is **new data
on this screen** — if the discover endpoints don't already return per-bucket counts
for the unsorted queue, any version of this page carrying that shelf is gated on a
server change. Worth confirming before the new design is finalized, so the design
isn't drawn around data that doesn't exist.

**Code:** `src/features/discover/DiscoverPage.tsx`;
`src/hooks/useDiscoverNavigation.ts`; `src/hooks/useCategoryCounts.ts`.
**Docs:** `docs/DISCOVER_FLOW.md`, `docs/QUICK_MARK.md`, `docs/SORT_CARDS_REQUIREMENTS.md`.

## 4 · Games — `/games` — **Size: L**

**Status: DONE (2026-08-21).** Bubble Match and Word Search are `BentoStrip`s, the
other four are tiles, and `GamesCollectionSelector` renders a `CollectionChip`.
`WordSearchHubItem` was rewritten on the bento primitive (390 → ~300 lines) with its
confirm-before-clobber, resume tile, in-place erase confirmation and leave animation
all preserved.

**Decisions taken while converting — three are behaviour changes, not restyles:**

- **⚠️ `MarkTypeChip` is gone from this page.** Every hub card used to name the
  mastery track its game feeds. A bento tile has no edge slot, and its subtitle is
  where the design puts the game's blurb, so the label had nowhere to go. **A player
  can no longer see which track a game trains without opening it.** `GameDef.markType`
  is untouched and still drives the mark call — only the label is gone. Word Search is
  the exception: its two modes feed different tracks, so its sub-tiles spend their
  subtitle on the track name instead of a blurb. If the chip should return, the honest
  slot is the tile `pin`. **Open question — see "Still open".**
- **Registry subtitles were rewritten short.** "Pop word & meaning pairs before the
  screen fills up" → "Pop matching pairs". A tile subtitle renders at 11.5px in a
  half-width 112px tile; the old sentences were written for a full-width row and wrap
  to three lines in a tile. `GameDef.subtitle` now documents the length budget.
- **`GameDef.bgColor` → `GameDef.hue`,** a `RampHue` key rather than a hex, so a
  tile's pastel body and its ghost glyph's ink cannot drift apart.
- **`GameDef.iconAsset` deleted, `GameDef.glyph` added.** `iconAsset` was an optional
  image URL that **no game ever set** — every game fell through to one generic
  controller icon, so the hub had six identical glyphs and a dead code path. `glyph`
  carries the artboard's per-game Material Symbol.
- **The collection chip keeps its colour dot** (in a new `trailing` slot), which the
  artboard does not draw. The dot is the only thing tying the chip to the same set's
  tile on the decks page; without it the hub is the one surface where a collection has
  no colour. The chip does NOT show a card count — the artboard's "1,284" has no
  source in the current data flow, and inventing one would be worse than omitting it.
- **The TipBox was KEPT**, though the artboard omits it. An artboard leaving out a
  feature is a layout omission, not a decision to delete a feature; that call is the
  user's, and it is cheap to reverse either way.
- **Word Search's strip no longer scrolls.** Two or three sub-tiles share the row
  instead of overflowing it, so `useDragScroll` came out. Its resume tile cancels the
  row's 9px flex gap with `marginRight: -9` on leave — a gap survives its item
  shrinking to zero width, which would otherwise leave a stump.

**Today.** `GamesPage` renders `GamesCollectionSelector` in `HubMenu`'s `header`
slot, then: Bubble Match as a `HubMenuArrayItem` (one sub-card per level),
`WordSearchHubItem` as a **bespoke ~390-line component** that assembles its own
strip out of six `HubMenu` exports, and Match Speed / Speed Reading / Hydra
Bubbles / Memory Map as single rows. Every card carries a `MarkTypeChip` naming
the mastery track that game feeds.

**Design.** Collection selector chip stays at the top (`.chipsel`). Bubble Match
(3 levels) and Word Search (2 modes) become `.strip`s; the other four become plain
tiles.

**Watch out.** Converting this page means **rewriting `WordSearchHubItem`** as a
Bento strip — it is the single largest piece of hub work, and it is why D8
(deleting `HubMenu`) is not free. Also: the artboard does not draw the
`MarkTypeChip`; decide whether it survives the conversion.

**Code:** `src/games/GamesPage.tsx`; `src/games/GamesCollectionSelector.tsx`;
`src/games/word-search/WordSearchHubItem.tsx`; `src/games/registry.ts` →
`GAME_REGISTRY`; `src/games/bubble-match/constants.ts` → `LEVEL_CONFIGS`;
`src/components/MarkTypeChip.tsx`; `src/hooks/useGameWins.ts`;
`src/features/flashcards/selectedCollection.ts`.
**Docs:** `docs/GAMES_FEATURE.md`, `docs/BENTO_SYSTEM.md`.

## 5 · Account — `/account` — **Size: M**

**Status: DONE (2026-08-23).** Typecheck, lint, `vite build` and the unit suite all
clean; verified in a browser at 420px.

**What landed.** The page is now assembled entirely from shelf-system primitives, in
the artboard's order:

| Artboard shape | Component | Was |
|---|---|---|
| `.hd` right slot | the outlined settings `HeaderIconButton` + `MinutePointsFireBadge` | gear only — the flame was missing on this page; since 2026-08-24 `PageHeader` renders it on every header, flush right of the gear (the artboard draws it left of the gear; a fixed screen position won) |
| `.rw` profile | `Row` (`avatar` / `title` / `subtitle` / `meta`) | bespoke `UserInfoSection` — 56px circular MUI `Avatar`, a hairline divider, three loose `Typography`s |
| `.shelfhd` "Your library" + total | `SectionHeader` with two `Label`s | absent |
| `.shelf` | `DeckBuckets` (unchanged) | already converted with A3 |
| `.card` Velocity | `StatCard`, centred | bespoke `VelocityCard` on the `sectionCard` fill |
| `.shelfhd` "Goals" | `SectionHeader` | a bold sentence-case `Typography` + a 5-line paragraph |
| two goal rows | `Row` + MUI `Switch` | `FormGroup` of `Checkbox` / `FormControlLabel` |
| `.btn3` Log Out | outlined MUI `Button` (theme-skinned) | same, but `size="small"`, which overrode `.btn3`'s 13px padding |

**The page has NO padding of its own, and that is what made the conversion work.**
Every primitive carries its own page gutter — `RowList` 16px, `SectionHeader` and
`Shelf` 22px, `StatCard` 18px — plus its own top margin, because in the design those
gutters differ per shape. The old page wrapped everything in a 20px-padded, 350px-wide
centred column, which would have doubled every one of them. `DeckBuckets` had zeroed
`Shelf`'s 22px gutter for exactly that reason; that override is now **removed**, and
leaving it would have put the spines 22px left of the header above them.

**Decisions taken while building.**

- **The goal toggles are `Switch`es, not the artboard's `toggle_on`/`toggle_off`
  glyphs** — this entry's own "watch out", and it held. A glyph is not focusable,
  checkable or announced. The skin (`GOAL_SWITCH_SX`, `COLORS.grnA` when on) is
  page-local **only** because ten other files still render an unconverted `Switch`; it
  belongs in `MuiSwitch.styleOverrides` beside the `.btn2`/`.btn3`/`.chip` skins the
  moment those are converted.
- **The goals paragraph is gone**, replaced by a one-line `subtitle` per row ("Adds a
  reading bar to every card"). Same fact, said once per control instead of once per
  section — the artboard's own change, and it is why the rows have room for a hue and a
  glyph (`menu_book`/`red`, `edit`/`org`).
- **Velocity's window sentence is printed again.** It was a caption, then moved into
  the ⓘ, and the artboard draws it as visible body copy under the figure. The ⓘ was
  **kept** rather than deleted, and re-pointed: it now defines what a level-up *is*
  instead of restating the sentence beneath it. If those two ever agree again, delete
  the ⓘ.
- **The library total is summed client-side** from the four band counts, not fetched.
  A fifth number from the server could disagree with the spines under it.
- **The avatar became a real `<button>`.** It was a div with `role="button"`, so the
  icon picker was unreachable by keyboard.
- **The profile row's two `Label`s** sit at either end of `SectionHeader`'s
  `space-between` — the `action` slot is unused, which its own docstring warns against
  ("a `SectionHeader` with no `action` is a `SectionRule` that forgot its rule"). The
  artboard's `.shelfhd` genuinely has no hairline and no affordance here, so the
  docstring is the thing that is too strict, not the call site.

**Known cost.** The `meta` line renders the **full 36-character UUID**, which measures
300px of the 388px row at 420px wide — it fits, but on a 360px viewport it wraps to a
second line and the row grows ~16px. The artboard drew a short display ID (`ID 4821`).
Not a regression (the old caption carried the same UUID at a larger size), and the copy
button means nobody has to read it, so it is left alone rather than truncated.

**Not in scope, still true.** The `ShelfHeader` (components/shelf) / `SectionHeader`
(components/primitives) duplication is real — both render `.shelfhd` with identical
`19px 22px 0` padding, and this page could have used either. Collapsing them is a
cleanup for whoever touches A3 or A5 next; it is listed in
[DEFERRED_WORK.md](./DEFERRED_WORK.md).

**Code:** `src/pages/AccountPage.tsx`; `src/components/DeckBuckets.tsx`;
`src/components/primitives/Row.tsx` (gained `meta`; `avatar` now replaces the box);
`src/hooks/useCategoryCounts.ts`; `src/hooks/useVelocity.ts`;
`src/components/InfoTip.tsx`; `src/utils/categoryColors.ts`;
`src/minutePoints/MinutePointsFireBadge.tsx`.
**Docs:** `docs/VELOCITY.md`, `docs/MASTERY_REWORK.md`, `docs/UX_AND_NAVIGATION.md`.

## 6 · Reader — `/reader` — **Size: M**

**Status: not started.**

**Today.** `ReaderPage` is a `NodePage` with a fixed non-scrolling shell;
`TextSidebar` owns the list and renders **one flat MUI `List`** of every `Text`,
with edit/delete icon buttons per row and a `drawerWidth` prop left over from the
retired drawer layout.

**Design.** Three shelves of `.sp.vol` volumes — your documents (ending in an
add-spine), the shared library, and validation downloads (dashed border) — over a
`.shnote` explaining tap-to-read / long-press-to-edit.

**Good news: the grouping needs no server change.** `TextBase`
(`server/contracts/wire.ts`) already carries `isUserCreated` (yours vs library),
`validationEntryId` (to-validate), `characterCount` and `createdAt` — exactly the
three groups and the caption the design wants.

**Watch out.** Reader is the one place the shelf's **height rule is switched off**:
every volume is the same height and character count is a caption. That is
deliberate — a document's length is not its importance. Keep it.

Also: per-row edit/delete buttons become a long-press, which is a real interaction
change on a page whose shell doesn't scroll. Check the touch rules before wiring it.

**Code:** `src/features/reader/ReaderPage.tsx`;
`src/features/reader/TextSidebar.tsx`; `src/features/reader/validationApi.ts` →
`downloadValidationDoc`; `server/contracts/wire.ts` → `TextBase`;
`src/types.ts` → `Text`.
**Docs:** `docs/USER_DOCUMENT_FEATURE_SUMMARY.md`, `docs/DATA_VALIDATION_SYSTEM.md`,
`docs/LEAF_NODE_PAGES.md`.

## 7 · Dictionary — `/dictionary` — **Size: S**

**Status: DONE.** The keypad landed 2026-08-22, the rows on 2026-08-24. Typecheck, lint,
`vite build` and the 576-test suite all clean. Smaller than the artboard suggests.

**Today.** `DictionaryPage` is a `NodePage` with `PinyinKeypad`, a search
`TextField`, result count + AI chip, `DictionaryEntryRow` results, and MUI
`Pagination`.

**The keypad landed as `.kp` KEYCAPS.** The vowel grouping was already right — the
restyle was the key itself. It was a MUI contained `Button`, so it rendered as an
elevated pill with a ripple: three separate "this submits something" signals on a
control that only types a letter. It is now a flat 30×30 square at radius 8 with a
ramp pastel ground and an ink glyph, `:active` darkening in place of the ripple —
`.kp b` exactly. Groups are the spacing unit (5px within a group, 14px between), which
is the only thing telling a learner that ā á ǎ à are one vowel and not four letters.
The old Material 50-level hexes (`ZH_VOWEL_COLORS`) are gone; the six fills are ramp
members, except the i-row, which is the artboard's own inline `oklch(95% 0.055 100)`
(`#F7F0C6`) — the ramp has no yellow between `--org` at hue 70 and `--grn` at hue 145,
and six vowels need six distinguishable hues. `es` keeps the same keycap but unfilled:
it has no tone system, so a hue would imply a distinction that does not exist.

**The rows landed as `.dr`.** They were an MUI `Card` each, laid out in a 1–3 column
`grid` with a 16px gap: a stacked-word/pinyin/two-line-gloss block inside an elevated,
hover-lifting box. Three separate signals that a search hit is an object you might pick
up, on a list whose only job is to be scanned. They are now the artboard's flat
typographic row — headword, tone-coloured pinyin beneath it, one ellipsized gloss line,
chevron — separated by a hairline rather than by whitespace, and full-bleed to the page
edge. The grids are gone in all three places (exact-segment, "starts with", and regular
results); a `SectionRule` announces the groups where a centred `Divider` used to.

**The headword goes through `ForeignText`, and the row has two shapes because of it.**
For Chinese it is the artboard's layout exactly: the headword is a fixed narrow anchor,
so it takes a shrink-proof left column and the gloss takes the rest of the line. For
Spanish the headword moves ONTO the flexible column, above the gloss — a Latin headword
is variable-width (`extraordinariamente` is 19 glyphs where 时间 is two) and pinning it to
a shrink-proof column squeezes the gloss off the row. It also has no pronunciation line to
sit under, which is the thing that made the two-column split worth having. Tone colours
come from `getToneColor` inside cpcd, never the artboard's inlined hexes.

**Two deviations from the artboard, both deliberate:**
- **The headword is `sm` cpcd (26px glyph / 13px pinyin), not the artboard's 21/12.5.**
  `CPCDSize` is a fixed five-step scale shared by every foreign-text surface in the app;
  adding a sixth step for one row would be a worse trade than 5px. `sm`'s pinyin (13px)
  is within half a pixel of the artboard's anyway.
- **The gloss carries every sense, joined with `; `, not just the first.** The artboard
  shows "time; period" for 时间. The line is ellipsized and the row height is fixed either
  way, so the extra senses are free information.

**The duplicate page title is gone.** `NodePage`'s back-arrow header said "Dictionary"
and an `h1` a few millimetres below said it again; the artboard has only the header. This
entry previously deferred it as "a `NodePage` question, not a keypad one" — it is neither,
it was just a stray heading, and it was removed with the rows.

**Still on the old look, deliberately out of scope:** the pager. The artboard draws it as
a row of `.chip` pills (`1 2 3 ›`); it is still an MUI `Pagination`. A5 themed `Chip` and
`Button` but not `Pagination`, so converting it is a theme-override question rather than a
row question.

**`CompareWorkspace` inherits the new row.** Its slot-B mini search renders the same
component, so it changed too: its 8px inter-row gap was removed (a `.dr` separates with
its own hairline, and a gap leaves those hairlines floating) and it passes `inset={4}`,
the row's one styling prop, so text inside an already-inset panel is not twice-indented.

**Code:** `src/features/dictionary/DictionaryPage.tsx` → `FULL_BLEED_LIST_SX`;
`src/components/DictionaryEntryRow.tsx`; `src/components/PinyinKeypad.tsx` →
`ZH_ROWS`, `ES_ROWS`, `KeyGroup`; `src/components/ForeignText.tsx` →
`isLatinScriptLang`; `src/components/primitives/Label.tsx` → `SectionRule`;
`src/components/CompareWorkspace.tsx`; `src/hooks/useDictionarySearch.ts`.
**Docs:** `docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md`,
`docs/DICTIONARY_AI_FALLBACK_SEARCH.md`, `docs/WORD_COMPARE_FEATURE.md`.

## 8 · Friends — `/friends` — **Size: M**

**Status: DONE (2026-08-24).** Typecheck, lint, build and the 576-test suite clean.

**What it was.** `FriendsPage` was a `NodePage` with three MUI `Button`s to the mutating
pages, a fourth for challenges, a hand-rolled `sectionCardSx` box for the friend ID, and a
velocity leaderboard of `FriendPersonRow`s.

**What landed.** The artboard's shape: a 3-up `Bento` of `compact` tiles (Send / Accept /
Remove) carrying their counts as tile `pin`s, a full-width Challenges tile, the friend-ID
`SectionCard`, a `SectionHeader` and the leaderboard rows.

### The conversion needed four additions to the shared primitives

None of them is friends-specific, and each closes a gap the artboards had already drawn
elsewhere:

| Addition | Why |
|---|---|
| `Bento` `columns={2\|3}` | Artboard 8 is the only 3-column bento in the set. Two stays the default and the norm. |
| `BentoTile` `variant="compact"` | The 3-up tile: 74px tall, 14px title, and a **66px** ghost glyph rather than 92px — at a third of a phone's width the `low` glyph fills the tile corner to corner and stops reading as a wash. |
| `BentoTile` `fullWidth` | Width and height were the same enum. Challenges is a SHORT tile that owns its row, which `hero` (150px) could not express. `hero` now means `1 / -1` instead of `span 2`, so a hero in a 3-column grid is full width rather than two thirds. |
| `BentoTile` `pinTone="alert"` | The count pins here are things WAITING FOR THE USER, not facts about a destination. Danger pink on white vs. the default translucent white. |
| `SectionHeader` `meta` | The `.shelfhd` right-hand slot ("last 7 days"). Same slot, same meaning, as `BentoStrip`'s `meta` — a fact about the set, never a control. |

### Two fragments deleted, and one primitive extracted

`navButtonSx` and `cornerBadgeSx` are **gone**. The badge in particular was a friends-only
recipe for a thing the app does everywhere; it is the tile `pin` now.

`sectionCardSx` is gone from **both** `friendStyles.ts` and `arenaStyles.ts`, along with a
third inline copy — three hand-written spellings of the design's `.card`, and **all three
had drifted from it**: a `borderRadius: 3` (24px) where the design says 18px, and `p: 1.5`
(12px) where it says 14/16. They are now `SectionCard` (§ A5), which `StatCard` also
renders into — `StatCard` is that shell plus its three text slots, and a screen that wants
a `.card` around content that is not one big figure reaches for the shell directly.

### Two deliberate deviations

**The Copy control is a `Chip`, not a `Button`.** The artboard writes `.chip`, and in this
codebase the theme maps outlined **Chip** to that pill. An outlined `Button` maps to
`.btn3` — a 13px-padded, radius-14 BLOCK action, three times the height of the ID line it
sits beside.

**The leaderboard's "this is you" row changed treatment**, from a 2px blue ring to the org
pastel fill the artboard draws — which is also what `BoardRow.highlighted` already used on
the arena board. The app was answering "which row is me" two different ways on its two
leaderboards. A fill also survives what a ring cannot: on a board whose rows are already
tinted by something else (the arena's zones) an outline competes with the tint while a
fill replaces it. The border stays at 1px transparent so the row keeps its exact height.

**Bug fixed on the way past:** `RankBadge` was a 28px pastel chip with **no inset ring**,
so at ~1.15:1 it was barely a shape on white (D2). It matters more now than it did — the
viewer's own row is filled with the same org pastel that rank 1's chip wears, so a rank-1
viewer would have watched their chip dissolve into their row.

**Code:** `src/features/friends/FriendsPage.tsx` → `RankBadge`, `VelocityStat`, `slideTo`;
`src/features/friends/FriendPersonRow.tsx`; `src/features/friends/friendStyles.ts`;
`src/features/friends/SentRequestsPage.tsx`;
`src/components/bento/Bento.tsx` → `TILE_VARIANTS`, `BentoTile`;
`src/components/primitives/SectionCard.tsx`; `src/components/primitives/StatCard.tsx`;
`src/components/primitives/Label.tsx` → `SectionHeader`.
**Docs:** `docs/FRIENDS_FEATURE.md`, `docs/BENTO_SYSTEM.md`, `docs/VELOCITY.md`,
`docs/STUDY_CHALLENGE.md`.

## 9 · Arena — `/arena` — **Size: M** *(L if all four states are drawn)*

**Status: DONE (2026-08-24), all four states.** Typecheck, lint, build and the 576-test
suite clean. The board itself (`.bd`) had already landed with A7; what this entry added is
the banner, the state chrome around it, and the twelve-rung material ladder.

Arena is **built on dev, not on prod** — check `docs/ARENA_FEATURE.md` before assuming a
field exists on prod.

### The division banner replaced a tinted card — and `.ladder` with it

`DivisionHeader` was a `sectionCardSx` box tinted from a 12-step walk over the app's UI
tokens. It is `DivisionBanner` now: the artboard's hanging pennant — the name at 27px, the
ladder position beside it, the next rung under it, twelve ticks along the bottom, and a
**notch** cut into the foot by `clip-path`. The notch is the load-bearing part; it is what
makes the shape read as a pennant rather than as a card someone tinted, and it is the one
element on the page allowed to break the white-card material because it states STANDING
rather than containing information.

> **§ A7's `.ladder` is closed as SUPERSEDED, not deferred.** It is defined in
> `shelf-system.css` but appears in **none of the 27 spec artboards** — the shipped design
> folds the same information into this banner's twelve ticks. That is strictly better: a
> separate ladder would be a second place the app says which rung you hold, and two of
> those can disagree. Nothing should build it.

### ⚠️ The plate is an UNSTYLED PLACEHOLDER, and D2 is NOT excepted

`DIVISION_COLORS` carried a standing note asking for a re-derivation "when Arena is
converted (entry 9)". **That re-derivation did not happen, and the old ladder is gone
anyway** — so between shipping this entry and settling the question, every rung wears the
same neutral grey.

The history matters, because it is the thing most likely to be re-litigated:

1. The design project's `Arena Division Banners.html` draws all twelve rungs as
   **materials** — quarried stone, struck medals, machined alloys, cut gems. It is a
   sibling exploration, not a spec artboard, and it is the only place the other eleven
   rungs are drawn at all (artboard 9 draws Jade and nothing else).
2. Those plates were ported, first in full and then flattened to their base gradients.
3. **Both were withdrawn on the user's ruling (2026-08-24).** Twelve hand-authored
   gradients meant ~30 hex values living outside the ramp, and that palette decision is
   not being taken yet.

So **D2 stands unbroken**: there is no arena palette, and there is no exception to point
at the next time something wants one.

**What the placeholder costs, stated plainly so nobody mistakes it for a design:** a ladder
whose rungs all look alike is not a finished ladder. The entire point of twelve named rungs
is that climbing one should look like something. What still differentiates rungs is the
name, the "N of 12" line, and the tick row — which is doing more work than it was drawn to
do. Tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md).

**Everything needed to finish it is in one component.** `DivisionBanner` is the only thing
on the page that decides what a rung looks like: give it a per-rung fill and, if any fill
is dark, a per-rung ink. `arenaStyles.ts` keeps only the NAMES.

One decision from the withdrawn version was kept deliberately, because it should outlive
the placeholder: everything on the banner that is not full-strength ink is an **opacity**
of that ink, never a second colour token. Whatever the twelve grounds turn out to be, a
fixed "muted" colour will fail on some of them; a transparency of a working ink cannot.

### The three undrawn states, and the rule used to extrapolate them

This entry was flagged as the redesign's biggest gap — the artboard draws only `live`.
All four states ship redesigned. The rule applied was **use the page's own vocabulary
rather than inventing a third one**:

- **The banner is drawn in EVERY state.** The rung you hold does not stop existing between
  weeks, and without it the opt-in and closed states are a bare card on an empty page with
  nothing saying which arena you are about to join.
- **`results`** is a `SectionCard` filled with the ramp pastel the **board already uses for
  the same idea** — `RAMP.grn` for promotion, `RAMP.red` for demotion — carrying the
  matching arrow from `BoardZone`. A competitor who watched the green line all week meets
  the same green when they cross it. `hold` is untinted, for the same reason `BoardZone`'s
  hold band is.
- **`opt-in` / `closed`** are a `SectionCard` with the theme's own `.btn2` and `.btn3`.

**Join stopped being green.** It was a green fill, which spent the page's PROMOTION colour
on a button and made the one semantic colour on the screen ambiguous. It is the design's
ink pill now; Withdraw is the outlined block.

**Two small gains from the artboard:** the countdown card puts the time and the viewer's
rank on **one baseline** (the two facts checked in the same glance), and the board's
section rule carries the field size on the left and the unit on the right
(`Board · 25` … `minutes`).

**Code:** `src/features/arena/ArenaPage.tsx` → `CountdownCard`, `ResultsCard`,
`OptInCard`, `renderZoneDivider`; `src/features/arena/DivisionBanner.tsx`;
`src/features/arena/ArenaEntryRow.tsx`;
`src/features/arena/arenaStyles.ts` → `divisionName`, `formatRemaining`,
`dialogQuietButtonSx`; `src/features/arena/ArenaMessageDialog.tsx`;
`src/components/primitives/SectionCard.tsx`;
`src/api/arena.ts` → `fetchArenaBoard`, `optInToArena`, `withdrawFromArena`,
`shareArenaLocation`.
**Docs:** `docs/ARENA_FEATURE.md`.

## 10 · Community — `/community` — **Size: S**

**Status: not started — and the tile conversion is REJECTED, not pending.** It was built on
2026-08-24 and reverted the same day on the user's ruling: **the mini preview cards stay as the
app renders them.** Do not re-attempt the tile. What is left of this entry, if anything, is the
page chrome around the feeds — not the card.

> **What was tried and undone.** The build wrapped each thumbnail in the artboard's 138px tile
> (white, radius 16, hairline outline) and scaled the `MiniVocabCard` up 1.5× to fill it, moved
> the vote to an inline mono caret, and made the row headers `.shelfhd`. The revert took all of
> it. The lesson to carry forward is the general one: **the app's mini card is already the
> design's mini card.** Frame 17 is explicit that "the preview is literally the card" — so a
> community thumbnail does not need new chrome to belong to the system, it needs the same fill
> and geometry the rest of the app's cards use. That fill landed instead; see the **Decisions**
> section, D12.

**Today.** `CommunityPage` already is a `NodePage` with `CommunitySearchBar` over
two horizontally-scrolling, infinitely-paginated `CommunityFeedRow`s — "For words
you're learning" and "Top this week" — with a search-active mode that replaces both.

**Design.** Same structure. Only the card chrome changes — and that chrome is the part that
was rejected.

**Watch out.** The design notes these tiles are "the one place real artwork
belongs" — each slot is an actual user-made card icon layout. The pastel blocks in
the artboard are **placeholders for real designs**. Do not implement them as
pastels.

**Two loose ends the reverted build surfaced, both still true and neither fixed:**
- `CommunitySearchBar`'s per-entry heading interpolates `word1 · pronunciation` into a plain
  `<Typography>` — a Chinese headword on the UI sans face with its pinyin inlined as ASCII
  beside it. It should go through `ForeignText`, the only public way to draw a foreign word.
- Community thumbnails draw `MiniVocabCard`'s **mastery strip**, but their `VocabEntry` is
  synthesized from somebody else's design and carries no mark history — so the strip renders an
  empty bar, a readout of the VIEWER's standing on a surface not asking about it. It wants
  `showMasteryStrip={false}`.

**Code:** `src/features/community/CommunityPage.tsx`;
`src/features/community/CommunityFeedRow.tsx`;
`src/features/community/CommunitySearchBar.tsx`;
`src/features/community/communityApi.ts`; `server/contracts/wire.ts` →
`CommunityDesign`.
**Docs:** `docs/COMMUNITY_PAGE.md`, `docs/CARD_ICON_LAYOUT.md`.

## 11 + 11b · Settings — `/settings` **and a new route** — **Size: L**

**Status: not started.** The only entry that adds a route.

**Today.** One 674-line `SettingsPage` inside `LeafPage`, built from stacked MUI
`Paper`/`Card` blocks: theme (four full `Radio` option cards), learning language,
narration, display, the password-change form, and the delete-account danger zone
with its confirm `Dialog`.

**Design.** Split in two.
- **11 · preferences** — theme collapses to a **four-swatch row** (the artboard's
  argument: four full option cards cost a third of the screen for a choice made
  once), then language, narration, display, and a chevron row to the new page.
- **11b · account & security** — the three-field password form, then the danger
  zone red-boxed, with the password-confirm dialog.

**Watch out.** Adding a page needs **one row in `src/routes/routeMeta.ts` and one
binding in `src/routes/registry.ts`** (which throws at boot if the binding is
missing) — nothing else. `routeMeta` is also what tells `pageTransition` and
`FooterPresenter` how the route behaves, so the new page must be declared a **Leaf**
(down-arrow, no footer) there, not in the page.

**Code:** `src/pages/SettingsPage.tsx`; `src/routes/routeMeta.ts` → `ROUTE_META`;
`src/routes/registry.ts` → `PAGE_COMPONENTS`; `src/components/LeafPage.tsx`;
`src/components/LeafPageHeader.tsx`; `src/contexts/ThemeContext.tsx` → `useTheme`,
`ThemeMode`; `src/hooks/useTTSSettings.ts`; `src/types.ts` → `LANGUAGE_FLAGS`,
`LANGUAGE_NAMES`.
**Docs:** `docs/UX_AND_NAVIGATION.md`, `docs/LEAF_NODE_PAGES.md`.

> ## ▶️ Entries 12–16 were UNPARKED (2026-08-21)
>
> They were held while the user finished the artboards. **12, 13, 14 and 16 shipped that
> same day** against the final designs, pulled fresh from the Cow design project. **15
> (Speed Reading) has an artboard and is still not started** — it was not part of the
> request, and its panel geometry is bespoke (it is the only game whose `.play` sits
> inside a ROTATED stage that draws its own header), so it wants its own pass.
>
> The four that shipped added three things to A6 that the frame did not have: `GameHudBar`,
> `GameHint`, and `GameHud`'s `divider` prop. If entry 15 needs a fourth, that is a signal
> the line between "frame" and "per-game surface" is in the wrong place.

## 12 · Bubble Match — `/games/bubble-match` — **Size: M**

**Status: DONE (2026-08-21).**

**What landed.**
- **Two colours, one bit.** `WORD_BUBBLE_BG` is the ramp's `red`, `DEFINITION_BUBBLE_BG`
  is inert `grey`. Colour now encodes *which side of a pair a bubble is* and nothing
  else — which is what makes the status fills (correct / wrong / nomatch, in
  `src/games/bubbles/constants.ts`) unambiguous: they are the only other colours a
  bubble can ever take.
- **The HUD left the playfield.** It used to float at `top: 8` *inside* the stage, so
  bubbles drifted under the level name and the field's measured bounds were bigger than
  the area a bubble could be read in. `BubbleStage` now returns a fragment: a real
  `GameHud` row, then the measured field. The strip reads
  `Level 2 · Brisk` — `7 left` — a `GameHudBar`.
- **`7 left`, not `4/11`.** Work REMAINING is the number a player acts on mid-run.
- **`.bub` gloss.** The shared `Bubble` swapped its flat drop shadow for the design's
  three: a white inset along the top and a dark inset along the bottom make the disc
  read as convex, and a tight offset drop shadow lifts it without the soft halo that
  used to blur the boundary between two touching bubbles. That convexity is what lets
  Bubble Match drop the ring entirely.
- The stage's paper ground went transparent; `.play` is the field's ground now.

- **The bubble is a KEYCAP, not a disc (2026-08-22).** `.bub` is `border-radius: 40%`,
  and `Bubble`'s inner now matches it, along with the held-cue overlay (`.bubble__dim`)
  — a circular veil inside a soft square leaves four unlit corners.
  This reverses an earlier deviation which argued that a 40% corner reaches past the
  circular collision body, so neighbours would overlap at rest. They do, by ~8% of a
  radius — but the field already tolerates far more than that on purpose: `planSpawn`'s
  `SPAWN_OVERLAP_FRACTION` lets a NEW bubble penetrate an existing one by 20% of its
  *diameter*. The shape was never load-bearing for the simulation, and the squircle both
  matches the design and packs the field with less dead space between neighbours.

**Deviations, and why.**
> **No `GameHint` line.** The artboard's "tap a pair · they float upward" describes a
> mechanic this game does not have — you DRAG a word onto its meaning. The bottom of the
> field already carries an accurate instruction (the cancel strip's
> "drop here to cancel match"), so a second line would be redundant as well as wrong.

**Watch out (unchanged).** The level is chosen on the hub and arrives via nav `state`;
there is no in-game picker to fall back to.

- **This entry is the reference for BOTH bubble games (2026-08-22).** Hydra Bubbles was
  unified onto it: same squircle, same 2px ring, same gloss, same grey held wash, and
  colour is the only thing either game varies (`BubbleFill` is now just `bg` + `border`).
  See entry 16 for the two Hydra treatments that were retired and what they cost.

- **The screen is RED (2026-08-23, A6b).** The ground, the panel's white-alpha border and
  the `redTint` HUD strip all come from `GAME_HUE`, which is also the hub row's colour. The
  header's restart glyph went white with the rest of the header ink.

**Code:** `src/games/bubble-match/BubbleStage.tsx`;
`src/games/bubble-match/constants.ts` → the base bubble palette and `GAME_HUE`;
`src/games/bubbles/Bubble.tsx`. **Docs:** `docs/GAMES_FEATURE.md`.

## 13 · Word Search — `/games/word-search` — **Size: M**

**Status: DONE (2026-08-21).**

**What landed.**
- **The hint mechanic is one row.** `.hintbar` at the top of the panel: the button, its
  charges, and the current reveal, left to right. Those three used to live in three
  places — the button in the page header, the meter absolutely centred in the HUD, the
  reveal on a line of its own under the gloss list — so the player had to assemble one
  mechanic out of three unrelated-looking widgets. `WordSearchHintBar` is now the whole
  row and takes `WordSearchHintRow` as its `children`.
- **Charges, not a meter.** With `HINT_COST` at 1 the eight-segment gauge with its
  threshold line was already just "how many hints you have", drawn as a gauge. `.chg`
  dots say it directly.
- **The gloss list is `.chips`** — ⚠️ **reversed 2026-08-24, see below.** **Two** states:
  pending is `.chip.on`, the solid ink pill — the loud state, because a pending chip is
  the game's actual instruction — and found is struck through and faded to the resting
  outline, still present, because the list is also the record of what the run has
  covered. The hinted word gets no chip state: the `.hintbar` reveal one row above
  already names it, and a third treatment would have to out-shout black-pill-pending.

- **⚠️ THE CHIPS ARE GONE (2026-08-24).** The list is one **inline run at 11px separated
  by faint middots**, out of the pills entirely; the two states survive as full ink vs
  struck-through-and-faded. Ten black pills are the loudest thing on the screen, and the
  screen's subject is the BOARD — the list is what you glance at between traces, so set
  small and inline it reads as a caption under the section header rather than as a second
  board. This reinstates the very shape `.chips` replaced, and the reason for that
  replacement is still live: a middot run makes a two-word gloss ("job interview") hard to
  tell from two adjacent one-word ones. Two things answer it — the middot is `textFaint`
  with a 7px gap on each side against a ~4px word space, and each gloss is `nowrap`, so it
  never breaks across rows and a found one strikes through exactly its own words. If it
  still reads ambiguously the next lever is trimming to a single word, not boxes.

- **⚠️ THE GREY BOARD IS GONE (2026-08-24), and the edge moved onto the tiles.** The grid
  box now draws nothing — the cells sit directly on `GameFrame`'s white panel, with 4px of
  padding only so the outer tiles' shadows clear the scaler's `overflow: hidden`. The
  problem the grey board solved has not gone away (a paper cell on white is ~1.03:1 and
  the tiles dissolve), so every cell took on the palette's `markOutline` inset ring
  instead — which is the app's own rule for making a ~1.15:1 fill read as a shape, so the
  board became one more caller of it rather than a special case with a container. It also
  **helps the lit states**: a pastel on a paper tile is a value step, where a pastel on the
  grey board was the same value as its ground. The reviewing state swaps the ring for
  `grnA` at 1.5px rather than stacking a second one. Whatever comes next, a board ground
  must stay ACHROMATIC — all four lit fills are ramp pastels at one lightness, so a hued
  ground sits in the same band as whichever state shares its hue.
- **`GameHud`, with the clock in the MIDDLE.** `Pinyin · production` — clock —
  `4 of 7 found`. See the A6 adoption table for why the ordering is load-bearing.
- **`.shelfhd`** above the chips: "Find these words" / "trace to select". The gesture line
  is the only place the app says *trace*.
- **Paper tiles on a GREY BOARD (revised 2026-08-22).** The grid's 2px black edge is
  gone — `.play` is the boundary now, and a second heavy border a few px inside it read
  as two frames. The ground moved to the CELLS (`.wsg span`). The design then puts those
  paper cells straight onto the white panel, which measures ~1.03:1 on a real screen: the
  tiles dissolve into the panel and the board stops reading as a board. So the grid box
  itself carries `COLORS.card` (`--grey`) at radius 16 — one full step darker than a
  paper cell, so every resting tile has an edge without anything drawing one. Grey and
  not a hue on purpose: all four LIT states are ramp pastels at the same lightness, so a
  hued ground would sit in the same band as whichever state shared its hue.
- **Square cells, and the selection is painted ON them.** Every cell is
  `aspect-ratio: 1`, spaced 4px on both axes. Every highlight is a cell fill: `.now`
  orange while tracing (and for a hint reveal — same meaning), `.hit` green once found,
  `COLORS.red` for a miss, `COLORS.blu` for a bonus word, plus a `grnA` inset ring on the
  word being reviewed. A lit cell darkens its glyph to full ink — reached through a
  descendant selector, because cpcd sets its own color and an inherited value would be
  silently overridden. It does **not** bold, though `.wsg span.hit` does: at this cell
  size a weight change reflows the glyph inside its tile, so a traced word twitches as
  the path grows, and the fill has already said what the weight would.

  This replaced a "stadium" overlay that drew each highlight as one continuous tube on a
  layer BENEATH the cells, with the cells going transparent to let it through. The tube
  was the better shape, but it cost a measured row pitch, a measured glyph-center offset
  and two hand-tuned nudge constants, all so a shape drawn between character CENTERS
  would line up with cells whose height depended on whether pinyin was showing. The
  square is what carries the reading now: on a board of squares a run of lit cells weighs
  the same going down as going across, so a word that turns a corner still looks like one
  word.

**The two flagged decisions, settled.**
> **The hint button is real and it stayed** — the artboard omits it, but the artboard
> also draws `.hintbar` with a lightbulb and charge dots, so it was describing the
> mechanic, not proposing its removal.
>
> **The header's `pinyin` chip was NOT restored.** Pinyin display is fixed by which hub
> entry (Pinyin / No Pinyin) launched the run; there is nothing to toggle. The HUD states
> the mode instead. A chip that looks like a switch and is not is worse than no chip, and
> the HUD line would make it a second statement of the same fact.

- **The screen is PURPLE (2026-08-23, A6b)**, and the hint bar came with it: the lightbulb
  is black (its arm state is the glyph's FILL axis plus the button's opacity — a third
  channel on one 16px icon made the button look like a warning) and a banked charge dot is
  the game's accent ink rather than the app's warning gold.

**Code:** `src/games/word-search/WordSearchPage.tsx`, `WordSearchHintBar.tsx`,
`WordSearchHintRow.tsx`, `WordSearchWordList.tsx`, `WordSearchHeader.tsx`,
`WordSearchGrid.tsx`. **Docs:** `docs/WORD_SEARCH_GAME.md`.

## 14 · Match Speed — `/games/match-speed` — **Size: S**

**Status: DONE (2026-08-21).** The clock had already moved into the panel with A6; this
entry was the board and the strip around it.

**What landed.**
- **The columns lost their colours.** They used to be blue for the foreign word and cream
  for its meaning — which spent the board's strongest signal on a distinction the player
  can already see (one column is Chinese, the other is English). The design separates them
  TYPOGRAPHICALLY instead (`.msc.zh` is cjk 19/700 on the paper ground, `.msc` is sans
  13/500 on white), which frees every fill to mean state and only state: `blu` = selected,
  `grn` = matched or partner hint, `red` = wrong.
- **Selection fills rather than outlines** (`.msc.pick`). The border width is still
  constant across every state — that was never a style choice, it is what stops selecting
  a card from re-wrapping a three-line gloss under the finger — so a filled state blends
  its border into the fill instead of removing it. The blue glow shadow went with the
  outline; a fill does not need help being noticed.
- **The wrong-attempt flash is ink on pastel** like everything else, instead of white on
  saturated `#F44336`. It now reads as part of the same system rather than as an error
  dialog dropped onto the board.
- **A `GameHud` under the timer**, `divider={false}`: `Study Mix · All cards` and
  `9 matched`. Both facts are otherwise invisible once a run starts — the mode is chosen
  on the hub, the collection on `/decks` — so a player who launched the wrong one only
  found out from the cards.
- **`GameHint`** at the foot: "tap a word, then its meaning".
- `COL_GAP_PX` 10 → 8, matching `ROW_GAP_PX`. `.msg2` uses one gap on both axes; an
  uneven pair reads as a measurement mistake at this size.

- **The screen is GREEN (2026-08-23, A6b)** — the hub row's hue, not the artboard's blue.
  The clock's resting track moved with it, from the palette's neutral `infoInk` to
  `RAMP[GAME_HUE].ink`: a blue bar on a green strip read as a widget borrowed from another
  screen. It cannot be confused with the board's green "matched" fill — that is a card
  body, this is a 4px rule in the chrome.

**Code:** `src/games/match-speed/MatchSpeedCard.tsx`, `constants.ts` (the palette block and
`GAME_HUE`), `MatchSpeedPage.tsx`, `MatchSpeedTimerBar.tsx`.
**Docs:** `docs/MATCH_SPEED_GAME.md`.

## 15 · Speed Reading — `/games/speed-reading` — **Size: S**

**Status: DONE (2026-08-24).** The HUD landed with A6b on 2026-08-23; the board is
**deliberately not converted** — see "The board stays as it is" below. Nothing outstanding.

**Design.** `.play` panel with the timer at the top, per-round result ticks in the
HUD, the clue as large centred text, and four options that differ by a single
glyph. Chinese only, by design.

**What landed (the HUD half).**
- **`SpeedReadingRoundTicks`** — one pip per round, in the HUD strip. The design's
  revision split them from one row of 4px pips into **two rows of ten at 8px**, and the
  height is the point: a colour has to be seen peripherally, because that is the only way
  it will be seen at all with the player's eyes on the words.
- **Why the run needed them.** This game's score is a TIME and a wrong answer is paid for
  in seconds rather than in a lost round, so mid-run there was nothing on screen saying how
  the run was going — a slow clean run and a fast sloppy one read identically. The pips are
  the run's shape, and because they hold their position they also say WHERE it went wrong.
- **The colours are the app's, not the artboard's.** `#22C55E` / `#EF4444` are outside the
  ramp; the pips are `successInk` / `dangerInk` / `COLORS.card`, the app's one green, one
  red and its inert track fill. A second success/failure pair would have made these pips
  disagree with the tap-zone flash that produced them.
- **The header's `n/20` counter is GONE.** The HUD carries the round number now, and
  stating it twice a few millimetres apart made the header read as two clocks. The clock
  keeps the header slot on its own — it IS the score in this game.
- **A `.speed-reading__board` box now sits between the panel and the tap zones.** The zones
  are `position: absolute; inset: 0`, so before this a HUD added to the panel would have
  been UNDER them and every tap on it would have answered the round. The centring that used
  to be on the panel moved onto the board box with them.

**The board stays as it is — closed on the user's ruling (2026-08-24).** The board is the
shipped two-half tap surface inside a ROTATED stage, and it is staying that way. The
artboard's upright 2×2 grid of four options with an in-panel countdown is **superseded, not
pending**: converting it would have been a game-mechanics change (two options vs four) as
much as a layout one, and the game plays well on two. Do not re-open this as leftover work
— an agent reading the artboard set will find 15 drawn one way and built another, and this
paragraph is the reason.

**Code:** `src/games/speed-reading/SpeedReadingPage.tsx`;
`src/games/speed-reading/SpeedReadingPrompt.tsx`;
`src/games/speed-reading/SpeedReadingOptionText.tsx`;
`src/games/speed-reading/SpeedReadingTapZone.tsx`.
**Docs:** `docs/SPEED_READING_GAME.md`.

## 16 · Hydra Bubbles — `/games/hydra-bubbles` — **Size: S**

**Status: DONE (2026-08-21).** Restyle only, as scoped.

**What landed.**
- **HUD out of the playfield**, same fragment shape as Bubble Match (entry 12).
- **The mode slot doubles as the squeeze warning.** There is one mode, so a constant
  "endless" would be dead pixels — but the moment the table goes drain-only that slot has
  something urgent to say, and saying it where the mode was keeps the strip at three
  facts instead of four.
- **The bar is the FILL RATIO, not progress.** An endless run has no denominator, and
  fill is both the number that ends the run (`LOSE_FILL_RATIO`) and the one the spawn
  table is keyed on. It goes `dangerInk` on the danger band, so the bar and the vignette
  raise the alarm together. It is **quantized to 5% steps** (`fillBucket`): the raw ratio
  changes every frame because bubbles are always settling, and storing it as-is would
  re-render the stage 60×/s for a 4px bar.
- **`.modal` for the lend notice** — scrim to the ink token at 45% (black over a warm
  paper ground reads as a hole rather than a veil), `.go` to ink rather than the theme
  primary (a dismissal that takes the accent colour reads as the recommended one of
  several choices; there is only one).
- Stage ground transparent, `.bub` gloss via the shared `Bubble` (entry 12).

**The artboard's bubble colours are STALE and were not adopted.** Artboard 16 draws six
hues. The shipped ladder is **yellow / blue** (2026-08-24): `COLORS.yel` `#F5E7B4` for
drain (harder) and `COLORS.blu` `#D2EBFF` for bloom (easier), with the inert English
bubble on `COLORS.grey`.

It was **two shades of one blue** from 2026-08-22 — `#79B3EE` for drain, where hue encoded
nothing and value was the whole message. That was the best-separated and only monotonic
ladder the game has had (1.80:1 between tiers, against 1.16:1 now); the yellow replaced it
by request. What the swap buys is real and worth recording: **tone-3 pinyin**, which
`docs/HYDRA_BUBBLES.md` called "the real constraint on this whole file", was nearly
invisible on a hue-250 body (1.25:1) and separates by hue on a yellow one — and drain no
longer wears the saturated end of the hue the app trains as "mastered". What it costs is
the value read, which is now flat across all three bubbles. The lever if that matters is
**bloom**, not drain: with drain off hue 250, moving bloom to `bluTint` is a free move that
opens a value gap AND lifts bloom off the scenery grey. § 2.2 of the Hydra doc has the full
table.

The squeeze warning in the HUD names the drain tier, so it moved with it — to `COLORS.yelA`,
drain's INK rather than its body. A 94% pastel is a fill; as text on the HUD's own tint it
is a smudge. The old `BLUE_DARK` was a mid-value blue, the one lightness where a body colour
could double as ink.

**Both rungs take black text, and that is the rule that sets the palette.** A first cut
put drain on `COLORS.bluA` `#1F6CB0` and separated 2.5× better (4.46:1 vs 1.80:1), but it
needs white glyphs — and two rungs of one hue only read as *one scale* if the ink is the
same on both, so it was given up. Two costs are recorded rather than hidden: the ladder
sits on the hue the app trains as "mastered" (`COLORS.blu` IS `CATEGORY_COLORS.Mastered`),
and a mid-value blue is the worst possible ground for tone-3 pinyin (`#779BE7`, 1.25:1).
The exit from both is the same one-token move — a ladder on **purple**, which no tone
colour or mastery band claims. `docs/HYDRA_BUBBLES.md` § 2.2 carries the full palette log
and every measurement.

**ONE BUBBLE, TWO PALETTES (2026-08-22).** Hydra and Bubble Match now render the *same*
bubble and differ only in colour, with **Bubble Match as the source of truth**. Two
Hydra-local treatments were retired to get there, and both had a real reason at the time:
- **The saturated 3px ring.** Ring weight was a third separation channel (`BubbleFill.ringWidth`)
  on top of value and temperature — a payout bubble wore a heavy ochre/near-ink ring, the
  inert English bubble a hairline. It is also what made a Hydra bubble a visibly different
  object from a Bubble Match one, which has none. Border colour is now the body colour, the
  knob is deleted from `BubbleFill`, and the tier read rests on value + temperature.
  ⚠️ This was weaker at a glance, and weakest for a colour-blind player — which is what
  the blue ladder above then fixed, by widening the value gap rather than restoring the ring.
- **The outline held cue.** Hydra drew a contrast ring where Bubble Match washes the bubble
  grey, because grey was Hydra's English-bubble colour. That premise expired on 2026-08-21
  when the English bubble went pure white; the ring outlived its reason by a day. Both games
  now use the wash (`.bubble__dim`), and `Bubble`'s `heldCue` prop is gone.
- **The white English bubble.** Hydra's definition bubble now takes the SAME inert
  `COLORS.grey` Bubble Match uses, so the only colours that differ between the two games are
  the ones that mean something — Bubble Match's red word bubble, Hydra's drain/bloom tiers.
  Scenery is scenery in both.
  ⚠️ It re-opens the Q5 tension, since grey again means both "English" and "held"
  (accepted — the wash lands ~1.5:1 off the resting body and the bubble also scales up).
  It also cost value gap against the tiers, which the blue ladder above then more than
  repaid. See `docs/HYDRA_BUBBLES.md` § 2.2.

- **Text ink is DERIVED, not declared (`inkOnFill`, `src/games/bubbles/Bubble.tsx`).** A
  dark body flips its glyph and gloss to white automatically. This is what makes a
  properly dark tier possible at all, and it is a rule rather than a per-game knob so a
  future palette change cannot strand dark text on a dark bubble.

**The lend notice was already right.** `HydraLendNotice` is full-screen, input-blocking,
and has a single "Got it" with deliberately no table of words. The artboard was
describing what ships.

**The header keeps its `pinyin` chip**, matching the artboard — unlike Word Search (13),
Hydra's pinyin display genuinely is a live toggle.

- **The screen is TEAL (2026-08-23, A6b)** — the hub row's hue, not the artboard's green.
  Artboard 16's revised bubble ink (`.bub.zh` muted with `.py` at full ink) was **not**
  adopted: that artboard's bubble colours were already stale, its Chinese/English
  assignment is inverted from what ships, and `Bubble` DERIVES its ink from the fill
  (`inkOnFill`) so that a palette change cannot strand dark text on a dark bubble. A
  hand-set gloss colour would put back the per-game knob that rule replaced.

**Code:** `src/games/hydra-bubbles/HydraStage.tsx`, `HydraLendNotice.tsx`.
**Docs:** `docs/HYDRA_BUBBLES.md`, `docs/PROVISIONAL_CARDS.md`.

## 18 · Card Detail — `/flashcards/card/:id` — **Size: L**

**Status: DONE (2026-08-24).** Typecheck, lint, build and the 557-test suite clean.

**What landed.**

- **The card is the masthead — ONE presentation of the word.** The page used to print
  the headword TWICE: a large standalone cpcd block, then the hero card carrying it
  again. The standalone block is gone. So is `VocabCardBadges` (a lone category chip):
  the band now reads off the mastery window's own band pill, which is the band of the
  track being looked at rather than only the core one — strictly more information in one
  fewer place.
- **`MasteryWindow` (`.msb`) replaces `MasteryProgressBar`.** The vertical thermometer
  (the design's `.mst`) is deleted per **D7**. pbh is a position in an eight-mark window,
  not a percentage, so it is drawn as eight discrete cells with the Target and
  Comfortable cut points ticked between them. The core bar's fractional pbh renders as a
  PARTIAL last cell rather than rounding, because rounding makes two genuinely different
  cards read the same. Per-track cooldowns survive as the `.cd3` legend.
- **A `Know / Read / Write` switcher.** See the **D6 amendment** below.
- **`WordToolsRail` (`.wtl.top`)** above the card — Write it / Compare. Compare raises the
  compare SHEET over the page (the cdp has no tab strip to host a Compare tab in).
  **Amended 2026-09-04:** it used to navigate to a standalone `/compare` page through route
  state; that page is deleted — see WORD_COMPARE_FEATURE.md.
- **A "More Info" pill + a pull-up sheet.** The definition / breakdown / examples boxes
  no longer run down the page under the card; they are raised from a capsule floating over
  the bottom of the page, so the cdp and the flp now handle "more about this word"
  identically. What stays on the page is what the page is for: the card, and how well it is
  known.
  **Amended 2026-08-24 (third pass):** the affordance was briefly `InfoPeek` — a resting
  sheet LIP spanning the page width. That component is **deleted**; the cdp now raises the
  sheet from the shared `SheetPill` capsule, which the fdp also uses and which reproduces
  the flp's `MoreInfoPill` spec. All three surfaces show the same `↑ <label>` pill again.
  **Amended 2026-08-24 (second pass):** the sheet body was `VocabCardSections` in a
  `SheetBody`; it is now **the eip proper** — `InfoCardSection` — so the two surfaces share
  the component, not just the idea. The cdp gains the entry header, the underline tab
  strip, swipe-between-tabs and the in-panel sense picker; it mounts the panel with **no
  `tabStrip`** (drill-in navigates instead of opening a nested entry tab) and with
  **`showSynonymsRelated`**, which appends Synonyms + Related Words under the definition
  tab — the one thing the old stacked-`SectionCard` body showed that the eip has no tab
  for. Tab state lives on the page (`infoTab`) and survives closing the sheet; the lip
  names whichever tab it will reopen on. `SheetBody` is left with no callers.

**Preserved, as the entry required:** the whole card-icon editor overlay
(`useCardIconEditor` / `CardIconCanvas` / `CardEditToolbar`) is untouched — the peek
greys out while it is open, because the sheet would cover the canvas being edited.

**Code:** `src/components/mastery/MasteryWindow.tsx` (new);
`src/components/primitives/Segmented.tsx` (new, `.trkseg`);
`src/components/WordToolsRail.tsx` (new); `src/components/wordToolPill.ts` (new);
`src/components/SheetPill.tsx` (new — the shared pill; superseded `InfoPeek.tsx`, deleted
2026-08-24);
`src/features/flashcards/FlashcardsLearnPage/SheetBody.tsx` (new);
`src/features/flashcards/VocabCardDetailPage.tsx`;
`src/features/flashcards/VocabCardDetailBody.tsx`;
`src/components/NodePage.tsx` (the `overlay` slot);
`src/components/primitives/Label.tsx` (`SectionRule`'s `right` slot);
`src/components/CompareSheet.tsx` (seeds slot A from the calling word; replaced
`src/features/dictionary/ComparePage.tsx`, deleted 2026-09-04).
**Deleted:** `src/features/flashcards/MasteryProgressBar.tsx` (368 lines).
**Docs:** `docs/MASTERY_REWORK.md`, `docs/CARD_ICON_LAYOUT.md`,
`docs/WORD_COMPARE_FEATURE.md`.

---

## 19–25 · Flashcard Learn + the Extra Info Panel — `/flashcards/learn` — **Size: L**

**Status: DONE (2026-08-24).** The seven artboards this file previously had no entry for.
Typecheck, lint, build and the 557-test suite clean.

### The rule the whole slice turns on

A flashcard surface carries two kinds of action and they had been mixed together in one
place (the eip definition tab's `InfoCardActionBar`):

| | |
|---|---|
| **CARD operations** — customize, file into a deck, write a note on it | belong to the card object, so they live ON the card, behind its `•••` (`CardOpsRail`, `.crail`) |
| **WORD tools** — practise writing, load into Compare | would still make sense if the card did not exist, so they live on the PAGE above it (`WordToolsRail`, `.wtl.top`) |

Everything else follows: the eip becomes information-only, `InfoCardActionBar` is
deleted, and the header sheds its `edit` toggle (it decorates one card, so it went to
that card's rail).

### What landed, artboard by artboard

- **19 · the drill card.** `WordToolsRail` above the card. `InfoPeek` (`.peek`) replaced
  `MoreInfoPill` here — but that was **REVERTED on 2026-08-24 at the owner's
  request**: the flp is back on the centred `MoreInfoPill` capsule
  (`FlashcardsLearnPage/styled.ts` → `MoreInfoPill`), and later the same day the **cdp**
  was moved onto the pill too (shared `src/components/SheetPill.tsx`), so `InfoPeek` was
  deleted and the peek/lip shape ships nowhere. The eip it opens, and everything inside it,
  is unchanged — only the affordance that raises it. One behaviour was
  kept from the peek: the pill is **tappable while ghosted** (pre-flip), because that tap
  is what raises the "flip the card first" tooltip; only the icon-editor `isDisabled`
  state swallows taps. Marking is still swiping and the two marks are still the loop's
  vocabulary — unchanged, and already what the app did.
- **21 · card menu.** `CardOpsRail`. The `•••` expands SIDEWAYS along the card's top edge
  into one row of LABELLED glyphs — no scrim, no dropdown, no fan — so the card stays
  readable underneath (you can still see which card you are acting on) and it closes on
  its own `×` rather than on an outside tap (an outside tap here is a flip or a swipe).
  The rail shipped as customize / add to deck / **delete**, where delete was new behaviour
  on the flp: confirmed, hard-deleting the vet row and dropping the card from the loop via
  `useWorkingLoop.dropCurrentCard` — no mark, no undo snapshot, no fly-out.

  **Superseded 2026-08-28**: the third cell is now **`note`** (the learner's own note on
  the card — [CARD_NOTES.md](./CARD_NOTES.md)), and delete is gone from the flp entirely.
  Deleting is rare, irreversible and takes the review history with it, so it belongs on a
  surface the learner navigated TO (the cdp header, the shelf's multi-select) rather than
  one tap from the card they are drilling. `useWorkingLoop.dropCurrentCard`, which existed
  only for that flow, was deleted with it.

  **Also 2026-08-28**: the rail is no longer flp-only — the **cdp** mounts it on its hero
  card's `topRail` as well, because its `note` cell is the only affordance that opens the
  note editor and the note now shows on both card surfaces. Its `customize` and
  `add to deck` cells therefore duplicate two of that page's header actions (artboard 18's
  header row); the header alone keeps `delete`.
- **22 · swipe coaching.** Already shipped (`SwipeHintLabel`); untouched.
- **23 · sense sheet.** `SensePicker` gets its two designed states: RESTING `.ssel` (a
  `1/9` counter and a triangle in a small pill) and OPEN `.ssheet` (every sense at once,
  grouped by reading, starred default first, commonality beside each). Still a MUI `Menu`
  underneath — the portal, anchor tracking, outside-tap dismiss and focus trap are
  exactly what a sheet lifted off a chip inside a draggable card needs.
- **20 / 20b · the definition tab.** `DefinitionFacts` (`.dfx`) replaces the centred chip
  strip, and replaces the VERBATIM DUPLICATE of it in `VocabCardDetailBody` — ~90 lines
  each, down to the comments. Parts of speech split into terms with per-POS sense counts;
  commonality and difficulty share a two-column row, since those are the two measures
  words get compared by. **20b's grouped AI treatment is a RULE, not a prop**: when every
  provenance-bearing value present (including the paragraph) is unapproved, the block
  takes ONE orange border, ONE tint and ONE badge; if ANY value is human-approved it
  falls back to per-field boxes, because losing the approved/unapproved distinction is
  the one thing the grouped treatment must never do.
- **24 · examples.** `.esl` numbers, a `.shelfhd` caption naming WHICH SENSE the
  sentences illustrate, and a transparent border on approved cards so the list does not
  reflow as sentences are approved. The AI treatment and the underlines already shipped.
- **25 · breakdown.** `BreakdownRow` (`.bkr`) replaces the wrapping grid of 1:1 block
  buttons — a square sized to the character clips the GLOSS, which is the part being
  read, and a grid destroys the word's own order the moment it wraps. Used by BOTH
  breakdown surfaces; `InfoCardBlockButton` is deleted.
- **The word trail (`.wtrail`).** The eip tab strip becomes filled pills — and **loses its
  tone colours**. Tone colour means ONE thing in this app (D2b); a pill tinted by a hue
  picked at random from the tone palette was borrowing that vocabulary to say "tab 3", on
  a strip sitting directly above cpcd rows where the same five colours mean their real
  thing. `toneColor` survives on the tab MODEL and is simply no longer painted.

### Consequences worth knowing about

- A word DRILLED INTO inside the panel lost its Add-to-Deck and Compare — deliberate, and
  tracked with its fix in [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 11.
- `CardFaceSide` gained a `topRail` slot (outer face box, last in DOM so it paints over
  the icon layer without a z-index war). It is threaded page → `FlashCardSection` →
  `CardFace` → face exactly as `editCanvas` already is, as a NODE rather than three
  callbacks, so the four surfaces that share `CardFace` never learn what a card operation
  is.
- `PracticeWritingButton` and `AddToDeckMenu` each grew one more `appearance` rather than
  being forked: both own real behaviour (star fetch + popup + Writing mark; deck fetch +
  tick state + save-on-close) that every host wants behind a differently-shaped trigger.
- The flp header is down to four controls from five.

**Code (new):** `src/components/WordToolsRail.tsx`, `src/components/wordToolPill.ts`,
`src/components/SheetPill.tsx` (replaced the short-lived `InfoPeek.tsx`),
`src/features/flashcards/FlashcardsLearnPage/CardOpsRail.tsx`,
`src/features/flashcards/cardOpsCell.ts`,
`src/features/flashcards/DefinitionFacts.tsx`,
`src/features/flashcards/BreakdownRow.tsx`,
`src/features/flashcards/FlashcardsLearnPage/SheetBody.tsx`.
**Code (changed):** `FlashcardsLearnPage.tsx`, `FlashcardsLearnHeader.tsx`,
`FlashCardSection.tsx`, `card/CardFace.tsx`, `card/SensePicker.tsx`,
`InfoCardPanelBody.tsx`, `InfoCardTabContent.tsx`, `InfoCardSection.tsx`,
`EipTabStrip.tsx`, `styled.ts`, `useWorkingLoop.ts`, `ExampleSentenceList.tsx`,
`AddToDeckMenu.tsx`, `VocabCardDetailBody.tsx`,
`src/components/handwriting/PracticeWritingButton.tsx`,
`src/features/discover/SortCardsPage.tsx` (drops the removed `onOpenCompare`).
**Deleted:** `FlashcardsLearnPage/InfoCardActionBar.tsx`,
`FlashcardsLearnPage/InfoCardBlockButton.tsx`.
**Docs:** `docs/DEFINITION_CLUSTERS.md`, `docs/DATA_VALIDATION_SYSTEM.md`,
`docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md`, `docs/EXAMPLE_SENTENCES.md`,
`docs/CARD_ICON_LAYOUT.md`, `docs/PRACTICE_WRITING.md`,
`docs/HANDWRITING_RECOGNITION.md`, `docs/WORD_COMPARE_FEATURE.md`,
`docs/DECKS_FEATURE.md`, `docs/DEFERRED_WORK.md` §§ 9–11.

## Not designed

**These are still converted — see D10.** They have no artboard, so their layouts are
extrapolated from the primitives rather than drawn. The mapping table lives in D10;
this list is the inventory.

- **Memory Map** (`/games/memory-map`) appears as a tile on the Games hub (4) but
  has **no play-surface artboard**. The CSS anticipates it (`.mapw`, `.isl`, `.wd`)
  without an artboard using it. **A2/A6 chrome only** — leave the play surface alone.
- **Night Market** is the Home hero but has no artboard — a Pixi engine surface that
  sits outside this system. **A2 chrome only**; flag before touching anything inside.
- ~~**flp** (`/flashcards/learn`)~~ — **REMOVED from this list 2026-08-24.** It has an
  entry (19–25) and it is built. It was never undesigned; this bullet predated the
  artboards.
- **The Mastery Centers, Collection View, Sort Cards, Quick Mark, Skipped Cards, the
  Reader document page, Login/Register and the Study Challenge pages**: extrapolated
  per D10.
- **The sort flow** (scp, `/discover/sort/:language`) is an explicit **outstanding
  item** (D11) — out of scope for this pass even though D10 would otherwise cover it.
  ⚠️ The project now also holds `Sort Flow - Shelf System.html`, so a design exists;
  it is a sibling file rather than part of the spec artboard set.

---

# Rules the redesign must not break

These hold regardless of which entry is being worked:

- **Touch & scroll** — components default to `touchAction: "none"`; the app shell
  never scrolls; scrolling is opt-in per page via an inner container; text is
  app-wide `user-select: none` (cpcd is the desktop-only exception); every game
  page calls `useBlockEdgeSwipe(true)`. → `docs/UX_AND_NAVIGATION.md`.
- **Foreign text** renders only through `ForeignText`. `CPCDRow`/cpcd are private
  and `'es'` is plain text.
- **No API function takes a `token`**; all server calls go through
  `src/api/http.ts`. → `docs/FRONTEND_LAYERING.md`.
- **Never key a load/reset effect on `token`** — key on `user?.id` or
  `isAuthenticated`. A silent refresh must not reset a screen.
  → `docs/TOKEN_EXPIRATION_IMPLEMENTATION.md`.
- **Leaf vs Node** archetypes and every route's footer/transition behaviour come
  from the single row in `src/routes/routeMeta.ts` — not from the page.
- `features/` is exclusive; a component shared by two features belongs in
  `src/components/`. Check importers before placing a file.
  → `docs/FRONTEND_LAYERING.md`.

# Decisions

Answered 2026-08-20. **Do not re-open these inside an entry's implementation.**
Two remain open at the bottom.

### D1 · Tokens land in place — no parallel palette
`src/theme/colors.ts` → `COLORS` and `src/theme/fonts.ts` → `FONTS` are **rewritten**
to the OKLCH ramp and Instrument Sans/Serif + JetBrains Mono. There is no
`src/theme/shelf.ts` and no opt-in period. Every page — including the ~dozen with no
artboard — changes colour and type on day one, under its existing layout. Expect a
visually mixed app during Part B and do not treat that as a regression.

### D2 · The pastel ramp replaces `CATEGORY_COLORS` — as PASTELS
**Revised 2026-08-20 after a first pass got this wrong.** The first implementation
mapped the four categories onto the ramp's *saturated* `*A` members. That read too
dark, and the design's own CSS contradicts it — see "Evidence" below. The categories
are the **93% pastels**, and the ramp turned out to have **three** roles, not two:

| Role | Value | Where |
|---|---|---|
| **Fill** — something sits on top of it | pastel `--grn` `#D9F4D9` | spine, bento tile, band tile, category chip |
| **Inner fill** — the second tone of a two-tone tile | tint `--grnTint` `#F0FAF0` | `BAND_COLORS.accent`, bucket inner |
| **Ink** — text, icon, border, solid button ground | `--grnA` `#387D3D` | anything read against paper |

**Evidence the pastels are the fills.** `.msb .cells i` fills at 6% ink and *still*
draws `inset 0 0 0 1px rgba(23,22,26,.12)` — an outline is what you add so a pale
fill reads as a shape. And `--redA`/`--grnA` barely appear in the shared CSS; the one
visible use is `.tip .ms { color: var(--orgA) }`, an icon **on** a pastel ground.

**A pastel fill is not self-sufficient.** All four sit at ~1.15:1 against the paper
ground. Every pastel-filled mark must carry `COLORS.markOutline`, and text over one
must be `COLORS.onSurface` — never white (~1.1:1).

**This forced a new token family: semantic ink.** `COLORS.redMain` had been doing two
unrelated jobs — "the Unfamiliar band's fill" *and* "the app's semantic red for danger
text and buttons". One hex served both because the palette had only one red, so
nothing forced them apart. The pastel ramp forces them apart. **51 call sites across
40 files** were relying on the overload and would have shipped invisible text or
white-on-pastel. Added `COLORS.dangerInk` / `successInk` / `infoInk` / `warnInk` (the
`*A` members) and re-pointed every text/icon/border/solid-button use at them, leaving
`*Main` as the pastel fill.

**The rule, for every future call site:**
> Is it a **fill** that something else sits on top of? → `*Main` (pastel) + `markOutline`.
> Is it **text, an icon, a border, or a button's ground**? → the ink token.

### D2a · Where the pastels apply — and where they do not
The pastel ramp owns **fills**: band spines, bento tiles, deck tiles, band chips,
category badges. `CATEGORY_COLORS` / `BAND_COLORS` / `LEARN_NOW_COLORS` /
`MASTERY_BAR_COLORS` are all pastel pairs, keeping their names and shapes so every
consumer compiles:

| Category | Was | Now (fill) | Ink on it |
|---|---|---|---|
| Unfamiliar | `#EF476F` | `--red` `#FFDDDB` | `--redA` `#B54249` |
| Target | `#FF9E5A` | `--org` `#FFE6C8` | `--orgA` `#A46400` |
| Comfortable | `#05C793` | `--grn` `#D9F4D9` | `--grnA` `#387D3D` |
| Mastered | `#779BE7` | `--blu` `#D2EBFF` | `--bluA` `#1F6CB0` |

`MASTERY_BAR_COLORS.reading` / `.writing` read their pair from `BAND_COLORS`, **not**
from `MARK_TYPE_COLORS` — artboard 2's "Mastered Reading" spine is
`background: var(--red)`, a pastel spine sitting on the same shelf as the pastel band
spines. `core` keeps Mastered blue; it blends recognition and production and has no
single mark hue to borrow.

### D2b · Tone colors and mark colors did NOT move
**Added 2026-08-20, correcting a pass that moved them.** The redesign changed
*surfaces*. It did not change the two saturated sets the design draws directly on the
paper ground, and both are now marked LITERAL ON PURPOSE in code:

| Set | Values | Design evidence |
|---|---|---|
| `TONE_COLORS` (`src/utils/toneColors.ts`) | 1 `#EF476F` · 2 `#05C793` · 3 `#779BE7` · 4 `#FF8E47` · neutral `#9E9E9E` | `Tone Color Explorations.html` lists exactly this array as the `current` set, and no exploration was adopted; the dictionary rows, card faces, cpcd and flp sense rail in the spec all spell these inline. |
| `MARK_TYPE_COLORS` (`src/utils/masteryCompute.ts`) | recognition `#779BE7` · production `#05C793` · reading `#EF476F` · writing `#FF8E47` | Artboard 18's `.msb` mark cells and cooldown legend, and artboard 17's mini-card two-mark strip, spell blue/green/red inline. |
| `MASTERY_READY_COLOR`, `CORRECT_COLOR` / `INCORRECT_COLOR` | `#05C793` · `#05C793` / `#EF476F` | `shelf-system.css` → `.msb .cd3 .ms`, `.mst .cdr .ms`, `.shint.r`, `.shint.l`. |

**The distinction that decides it:** a band chip or a spine is a FILL with a name and
a count printed on top of it, so it must be pale — pastel plus `COLORS.markOutline`.
A mark cell, a tone-coloured pinyin syllable, a swipe label and a ready check are read
*directly* against paper with nothing on top, so they must be saturated. Aliasing the
second group to the ramp's pastels made them vanish; aliasing them to the ramp's `*A`
inks changed their hue. Both were wrong. Leave the literals alone.

*Note:* a handful of artboards use off-palette one-offs for pinyin (`#0B8AD9`,
`#F4A700`) and one mini-card swaps tone 1 and tone 2. Those are inconsistencies inside
the spec, not a fifth palette — the `current` set above is what the design means.

### D3 · Adopt the Material Symbols Rounded font
`@mui/icons-material` per-icon imports are replaced by the `.ms` ligature span the
artboards use. Consequences: a new webfont in `index.html`, a possible flash of
unstyled ligature text on cold load (mitigate with `font-display`), and a mechanical
rename pass across every icon call site. The design's names are mostly 1:1 with MUI's
(`nights_stay` ← `NightsStayIcon`), so the mapping is grep-able rather than a
redesign. Add an `<Icon name="..."/>` wrapper so no page writes a bare ligature span.

### D4 · Light theme only, for now
`ThemeContext` stays in place, but the shelf system ships **one** palette and the
app effectively runs light during the migration. Dark / Ocean / Nature are not
derived yet — revisit once the system is proven on real pages. Do not spend effort
keeping the other three working mid-Part-B.

### D5 · Footer: text labels only, no icons
`.fbar` is followed exactly — four text labels, active one in ink at weight 600 with
a 14×2 underline. `HomeIcon` / `StyleIcon` / `LanguageIcon` / `AccountCircleIcon`
come out of `MobileFooter`. See A2a for the clearance-constant rework this forces.

*Separately:* the **Bento menu items** get a fresh set of Material Symbols glyphs
chosen to match the design's icon vocabulary (D3) — the ghost `.bg` icon on each
tile. That is a new icon selection pass, tracked in A4, not a port of the old ones.

### D6 · Card Detail shows ONE mastery bar at a time — AMENDED 2026-08-24

**As decided (2026-08-20):** the code won over artboard 18. `MasteryProgressBar` rendered
the single bar for the surface's lens and the artboard's two bars were read as two
*examples* of a one-bar component. The rule: showing every track at once makes the page
answer a question the learner did not ask.

**Amendment (2026-08-24), on the user's ruling.** Artboard 18 has since gained a
`Know / Read / Write` segmented control (`.trkseg`) over a single `.msb` window, and that
control satisfies D6's own rationale rather than breaking it: **exactly one track is ever
on screen**, the default is still the surface's lens, and the learner is the one who says
otherwise. An untouched page reports precisely what D6 said it should.

Two consequences worth stating, because they are where this could go wrong:

- **All three tracks are always offered**, whatever the account's goals say. Reading and
  writing marks accrue whether or not their goal is set (migration 143), so a track hidden
  behind a goal switch would hide marks the learner has actually earned. The GOAL decides
  what gets surfaced, sorted and counted elsewhere; it does not decide whether this card's
  history exists.
- **The switch does not follow the card.** It re-seeds when the LENS changes (a card
  re-opened from a different Center), not when the entry does, so paging between cards
  keeps the track the learner chose.

Built as `MasteryWindow` + the `Segmented` primitive. The rule in
`docs/MASTERY_REWORK.md` is amended to match.

### D7 · One mastery rendering: `.msb` — **HONOURED 2026-08-24**

Of the design's three (`.trk2` bar, `.msb` segmented cells, `.mst` thermometer), **only
`.msb` is built.** Use it everywhere a mastery value appears, scaled down for
inline/list contexts rather than swapped for a different shape. `.trk2` and `.mst` are
not implemented. Three renderings of one number is what stops a design system from being
one.

**Closed out with entry 18.** `MasteryProgressBar` — which WAS a `.mst` thermometer,
vertical track and all — is deleted and `MasteryWindow` (`.msb`) is the app's single
rendering. Its header comment carries the argument for the shape: pbh is a position in an
eight-mark window, not a percentage, and a liquid level invites "89% of the way to
mastered", which is the wrong mental model — one bad mark does not evaporate a fraction
of a tank, it turns one cell off.

### D8 · `HubMenu` is deleted
`HubMenu.tsx` (439 lines) and `hubMenuCardBase.ts` are removed, all **10** importers
are converted to Bento, and `docs/BENTO_SYSTEM.md` is retired. The heavy part is
`src/games/word-search/WordSearchHubItem.tsx` (~390 lines, imports six named
exports) plus `GamesCollectionSelector`, which renders into `HubMenu`'s `header`
slot — both budgeted into **entry 4**.

### D9 · `DeckTile` is deleted — NARROWED 2026-08-24

> **Narrowing (2026-08-24), on the user's ruling.** The spine remains the single visual
> for a set of cards, and still governs decks, challenges and bands. **The decks sheet's
> two LIBRARY CONSTANTS — Learn Now and Mastered — are the one exception** (artboard 2's
> `.duo`, built as `LibraryDuo`), and the reason is what the surface is for rather than a
> change of mind:
>
> Those two are the only sets whose SIZE is the thing the learner came to read. Every
> other shelf answers "which set?" and encodes its count as the spine's height — a
> comparison between neighbours, exactly right for a row of six decks. These two have no
> neighbours to be compared against; "612" and "208" are the figures, and a 74px spine
> cannot print a figure at a size worth reading.
>
> They now take the **fdp Centers rail's material** rather than the shelf's: the hand's
> hairline border and resting elevation, a 15px radius, `13px 13px 14px` padding, a 19px
> glyph on its own line, 9px between the pair — the same object as
> `flashcards-decks__center-tile`, because a Center tile and a library tile are the same
> KIND of destination (a place to go look at a set of cards) and sat a thumb's width apart
> in two different idioms. Each keeps its own pastel, and the FIGURE is **right-adjusted**
> on the label's line so both tiles' counts land on one vertical rule. (Superseded: the
> earlier "spine laid on its side" treatment — single pastel, inset white highlight, dark
> left strap, bottom-heavy radius.) Do not read this as licence to bring tiles back
> anywhere else.

### D9 · `DeckTile` is deleted
The app switches to the new design entirely: the **spine replaces the stacked-card
tile** as the single visual for a set of cards. `DeckTile.tsx` (413 lines) and its
callers `DecksPanelBody` (3 uses) and `DeckBuckets` → Account are converted to
`Spine`. No coexistence period.

> **Correction to an earlier draft of this file:** `DeckTile` has **no** selection or
> long-press behaviour. Its header states it is *"purely presentational"* — the prop
> surface is `label` / `count` / `icon` / `mainColor` / `accentColor` / `onClick` /
> `animationDelay`. The app's only long-press lives in
> `src/features/reader/ReaderTapOverlay.tsx` and is unrelated. So this is a
> presentation-for-presentation swap, not a behaviour port.

**Carry forward into `Spine` (A3) — the one genuinely good idea in `DeckTile`:**
every interior dimension is authored at a `REFERENCE_WIDTH` and rendered in **`cqw`,
not px**, so the tile scales as a single unit. That is what lets the fdp render it at
100px and Account at ~71.5px and have both be the same object rather than two
designs. `Spine` must do the same, or the Reader's `.sp.vol` (86×134) and the decks
sheet's 74px override become two components.

**Also carry forward:** the count is currently a corner numeral. On a spine it is
encoded **twice** — as `.k` mono text *and* as the spine's height. Decide per shelf
whether the numeral is redundant; do not render both by reflex.

### D10 · Undesigned pages are extrapolated from the primitives
The ~dozen surfaces with no artboard are **not** left on their old layouts. Apply
the system's own rules to them — **Shelf for collections the user owns, Bento for
menus of destinations** — plus A2 chrome, A5 atoms and the `.msb` bar (D7). Starting
reads, to be confirmed as each is built:

| Surface | Primitive |
|---|---|
| flp (`/flashcards/learn`) | `.hero` card face (295/426), `.msb` for the lens bar |
| Mastery Centers | `.msb` over a Bento of entry points |
| Collection View | Shelf |
| Skipped Cards | Shelf, or `.rw` rows if there is no count to encode |
| Quick Mark | leaf `.lhd` + `.hero` |
| Reader document page | leaf `.lhd` + body type from A1 |
| Login / Register | `.field` + `.btn2` |
| Study Challenge pages | Bento + `.bd` board |
| Night Market · Memory Map | canvas surfaces — **A2 chrome only**, interiors untouched |

Where a surface has real design weight and the primitives don't obviously answer it
(Night Market especially), stop and flag rather than inventing. Record whatever is
chosen back into this entry so the next agent inherits the decision instead of
re-deriving it.

### D14 · "A card lying on the page" is ONE recipe — `CARD_SURFACE`
**Decided 2026-09-04, on the user's ruling:** the cdp and flp cards should be styled the
same way as the fdp's menu card items, with the same border.

Three surfaces were drawing the same physical object three ways: the fdp's Mastery Center
tiles had a `COLORS.border` hairline + a resting shadow at 15px, the flp flashcard had a
shadow and **no border** at 12px, and the cdp hero card had **neither** — a pale cream face
on the warm paper ground with nothing marking its edge. `src/theme/surfaces.ts` now holds
the recipe:

```ts
CARD_SURFACE = { border: `1px solid ${COLORS.border}`, borderRadius: "15px", boxShadow: SHADOW.cardRest }
CARD_SURFACE_RADIUS = 15
```

**It is a recipe, not three tokens, because the three only work as a set** — the hairline
gives the card an EDGE, the shadow a height, the radius a size class. Drop the hairline and
a cream card on cream paper has no boundary at all; that was the cdp hero's bug.

**`HAND_CARD_RESTING_SHADOW` is gone.** It was a hand-authored constant in `StudyHand.tsx`
whose own comment asked to be folded into the token set "the next time the elevation scale
is revisited"; it is now `SHADOW.cardRest` (`0 5px 16px` @ .14 — between `raised` and
`float`), and `LibraryDuo` / `FlashcardsDecksPage` read it from there.

**Who draws which half.** A flashcard FLIPS, so the hairline and radius live on each FACE
(`CardFaceSide`, `card/CardFace.tsx`) — a border on the transparent flip wrapper would stay
put while the faces rotate. The shadow lives on the WRAPPER (`FlashCardSection`'s `Card`,
the cdp's `*__hero-card` box), which is what the page lays out; those wrappers repeat
`borderRadius` so the cast shadow takes the card's shape. Applying both halves in both
places would double the shadow.

**The held card is still higher.** `isProminent` (the flp's front + flying-out card) keeps
`fc.cardShadow` (`SHADOW.lifted`); only the card behind it rests. This is the same two-tier
reading the hand already has, and the reason `CARD_SURFACE` carries the RESTING elevation
only.

**Radius fanout.** 15px is the face's outer curve; everything that clips content to the
card uses `CARD_SURFACE_RADIUS - 1` so nothing shows a sliver of square corner outside the
hairline — the face's inner clip box, `CardIconLayer`, and the fie's two canvas layers
(`CardIconCanvas`). Surfaces that are NOT cards keep their own radii: the hand's cards stay
22px (twice the size), the eip `InfoCard` and the cdp's `SectionCard` stay 12/16px.

### D13 · Elevation is the design's shadow system, and it lives in one token file
**Decided 2026-08-24, on the user's ruling.** The design has a shadow system; the app had
a habit. `src/theme/shadows.ts` (`SHADOW`) is now the only place a shadow is authored.

Every shadow in `shelf-system.css` obeys three rules, and the app's old ones obeyed none:

| | The design | The app before |
|---|---|---|
| **Hue** | ink — `rgba(20,18,26,α)` | pure black — `rgba(0,0,0,α)` |
| **Direction** | straight down, `0 Ypx` | diagonal, `2px 4px` (lit from upper-left) |
| **Blur vs alpha** | wide and faint — `0 3px 10px @ .10` | tight and dark — `2px 4px 4px @ .25` |

The hue matters because the ground is warm (`--paper` #FBFAF8): a pure-black shadow on a
warm ground reads as a grey smudge rather than as absence of light — the same reasoning the
border tokens already followed. The direction matters because a diagonal offset on every
surface implies a light source the design does not have; the ONE exception is the spine (and
its 26×34 swatch), which keeps a sideways cast because it is a physical object standing on a
board rather than a plane floating over one.

**The tokens are ROLES, not a numeric ladder.** `lifted` (the full card face) has a bigger
offset than `float` (a small rail) but a LOWER alpha, because at card size a `float` alpha
reads as dirt under the card. Pick by what the thing is: `rest` · `raised` · `chip` ·
`float` · `lifted` · `menu` · `popover` · `board` · `spine`/`spineSwatch`, plus the three
upward ones for bottom-anchored surfaces (`peekUp` · `sheetUp` · `panelUp`).

**Where it is wired.** The light theme's `flashcard.cardShadow` / `.cardShadowSubtle` /
`.sheetShadow` now resolve to `SHADOW.lifted` / `.raised` / `.panelUp`, so every call site
already reading the theme moved for free. Dark / Ocean / Nature keep their own and are not
re-derived (D4).

**Converted directly:** `MiniVocabCard`, `QuickMarkCard`, `ChallengeWordCard`, the scp's
`CardShell` + bucket tile + platform, `CollectionViewPage`, `CommunityCardView`, `Shelf`,
`Spine`, `SensePicker`, `CardOpsRail`, `Bento`, `MinimizablePopup`, `HydraLendNotice`,
`ProvisionalCardsNotice`, `CommunityDesignZoom`, `CardIconOrderList`,
`PracticeWritingPopup`.

**Deliberately NOT converted, and why:**
- **`StudyHand`'s front card** — a two-shadow stack (one ABOVE it, one below) so it reads as
  lifted off the two cards behind. No single token expresses that, and its ink is already
  the design's.
- **`LibraryDuo`** — no longer shelf material at all: it shares `SHADOW.cardRest` with the
  fdp's Centers rail and the hand's resting cards (see D9's narrowing), so `SHADOW.spine`
  would break that pairing rather than tidy it.
- **The scp's LOCKED card** — the artboards never draw a pressed-in card, so there is no
  design value for "recessed". Left hand-authored, but re-inked to the shadow hue so it is
  not the one pure-black shadow left on the page.
- **Game internals** (`BubbleStage`, `Bubble`, `WordSearchGrid`) and the icon editor's
  canvas handles (`CardIconCanvas`) — these are rendering surfaces with their own physical
  look, not app chrome.
- **`MinutePointsBadge`** — its active state is a coloured GLOW, not a shadow, and the whole
  component is still on pre-redesign MUI palette colours. It wants its own pass.
- **MUI numeric elevations** (`boxShadow: 2 | 3 | 4 | 6`, ~10 sites: `FlashCard`,
  `VocabDisplayCard`, `FlashcardsPage`, `SegmentedSentenceDisplay`, `VocabEntryCards`,
  `WordSearchGrid`) — these resolve to MUI's own black ladder and are invisible to a grep
  for `rgba`. Converting them is a separate sweep; **tracked in DEFERRED_WORK.md.**

### D12 · The card face is the design's cream, and every card reads it from the theme
**Decided 2026-08-24, on the user's ruling, taken from artboard 17.**

The app's default card face was `COLORS.card` — `#E7E7EA`, the ramp's neutral grey, the same
token every inert track and empty cell uses. The design's card face is **`#FBF7EC`**, a warm
cream: the artboards paint `.hero` (the full flashcard face) AND `.mgrid .mcd` (frame 17's
mini card previews) with that one value, which is what frame 17's caption means by "the
preview is literally the card". The app now uses it as the default face.

Three consequences worth stating, because each was a latent inconsistency this change forced
into the open rather than a new decision:

1. **It is one token, `COLORS.cardFace`, reached through the theme.** The light theme's
   `flashcard.flashCard` points at it, and every card surface reads `fc.flashCard`. Dark /
   Ocean / Nature keep their own faces and are not re-derived (D4).
2. **Four surfaces were not reading the theme at all** and had to be converted, or they would
   have stayed grey while the flashcard went cream: `MiniVocabCard`, `QuickMarkCard`,
   `ChallengeWordCard` and the scp's `CardShell`. All four are card faces; all four hard-coded
   `COLORS.card`. They looked correct only because the light theme's face happened to be that
   same token — which also meant a mini card silently ignored Dark / Ocean / Nature.
3. **The fie's `auto` and `grey` swatches are now actually different.** `cardColor.ts` has
   always documented `auto` (follow the theme) as a distinct chip from `grey` (pin the
   light-theme grey), and in the light theme they rendered identically. They no longer do.

**`COLORS.cardBeige` (`#F5EBE0`) is NOT the card face** and its comment used to claim it was.
It is the artboards' bare `.mcd` fill — the value `.mgrid` overrides — and the app uses it for
eip/info panels and two hub tiles. `cardFace` is the one with a role; `cardBeige` is named for
its colour because it has no single role. No stored `vet."cardColor"` changed, so this needs no
migration: `null` means "follow the theme", and the theme is what moved.

### D11 · Discover is being redesigned — artboard 3 is superseded
The user is producing a new Discover design. Entry 3 is **blocked** on it; do not
build from the existing artboard. The **sort flow** (scp, `/discover/sort/:language`)
is deliberately left as an **outstanding item** and is out of scope for this pass —
which also parks the open question about per-bucket queue counts, since the new
design decides whether that shelf exists at all.

---

## Still open

Nothing blocking. Two things to confirm *while building*, not before:

- **Per-bucket queue counts** — whether the discover endpoints return the unsorted
  queue split by progress bucket. Parked under D11 until the new Discover design
  lands; worth answering before that design is finalized so it isn't drawn around
  data that doesn't exist.
- **The D10 primitive assignments** — each is a starting read, not a ruling.

# Suggested order

**A1 → A2 → A4 → A5 → 1 → 4**, then **stop for review.** — **this slice is complete
as of 2026-08-21**, and entry 3 (Discover) came along with it after all: D11 blocked it
on a new design, and the user overrode that, so its hub is converted while its two
data-bearing pieces stay unbuilt (see entry 3). Both hubs converting end to end was the
smallest slice that shows the shelf system working on real data, and entry 4 carried the
`HubMenu` deletion (D8) early rather than leaving it to rot.

**Next**: the review this order stops for. After it, the entries are independent.

After that the entries are independent. **5** (Account) shipped 2026-08-23 out of this
order, as a targeted follow-up. **2** (Decks), **18** (Card Detail) and **19–25** (flp +
eip) — the three highest-value entries and the last of the big ones — shipped together on
2026-08-24, likewise out of order.
**7** (Dictionary) shipped 2026-08-24, and 12–16 are closed — 15 by ruling that its board
stays as shipped, and **10** by ruling that its CARD stays as shipped (both are rejections,
not conversions; two of the three "cheapest wins" turned out to be things the app had already
got right). **8** (Friends) and **9** (Arena) shipped together on 2026-08-24, which also
emptied A7 of everything but `.cpcd`: entry 9 built `.banner` in `src/features/arena/` and
closed `.ladder` as superseded by the banner's own ticks.

Entry 9 also settled the thing that had been blocking it — the three states the artboard
never drew. They were extrapolated rather than commissioned, under the rule **"use the
page's own vocabulary rather than inventing a third one"**, which is the pattern to reuse
on any future entry with an incomplete artboard: the results card is filled with the same
`RAMP.grn` / `RAMP.red` the board's own promotion and demotion zones already use, so a
competitor meets the colour they have been watching all week.

What is left is **6** (Reader — a real interaction change, per-row buttons becoming a
long-press on a non-scrolling shell), **11/11b** (Settings, which needs design work and is
the only entry that adds a route), and A7's **`.cpcd`** restyle.

# Docs that depend on this one

`docs/BENTO_SYSTEM.md`, `docs/UX_AND_NAVIGATION.md`,
`docs/MOBILE_TAB_SCREEN_LAYOUT.md`, `docs/LEAF_NODE_PAGES.md`,
`docs/DECKS_FEATURE.md`, `docs/DISCOVER_FLOW.md`, `docs/GAMES_FEATURE.md`,
`docs/MASTERY_REWORK.md`, `docs/COMMUNITY_PAGE.md`, `docs/FRIENDS_FEATURE.md`,
`docs/ARENA_FEATURE.md`, `docs/VELOCITY.md`, `docs/WORD_SEARCH_GAME.md`,
`docs/MATCH_SPEED_GAME.md`, `docs/SPEED_READING_GAME.md`, `docs/HYDRA_BUBBLES.md`,
`docs/USER_DOCUMENT_FEATURE_SUMMARY.md`, `docs/designGuidelines.md`.
