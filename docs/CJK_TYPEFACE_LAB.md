# Chinese Typeface — the setting, and the lab behind it

**Status: SHIPPED (migration 157, not yet on prod as of 2026-09-04).** Accounts choose
their own Chinese face in Settings → Display. `/font-lab` is the dev tool the shortlist
was chosen with, and remains the place new candidates are evaluated.

Referenced by [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) (§ "Notes for whoever picks up
A2", where the app's typography decisions live).
Deploy: [CHINESE_FONT_DEPLOY_RUNBOOK.md](./CHINESE_FONT_DEPLOY_RUNBOOK.md) — **157 must
be applied BEFORE the container rebuild**.

---

## 0 · The account setting

`users."chineseFont"` (migration 157) — a **catalog id**, not a CSS family name, so a
face can be renamed or re-sourced without stranding rows. `text NOT NULL DEFAULT
'975-maru'`.

* **New accounts** get `975-maru` (975 Maru SC).
* **Accounts predating the migration** were explicitly backfilled to `noto-sans-sc`, so
  nobody's app changed typeface under them. They opt in from Settings.

### Path, layer by layer

| Layer | Code |
|---|---|
| Column | `database/migrations/157-add-chinese-font-to-users.sql` |
| Allow-list (shared contract) | `server/contracts/wire.ts` → `CHINESE_FONT_IDS`, `DEFAULT_CHINESE_FONT_ID`, `UserProfile.chineseFont` |
| DAL | `server/dal/implementations/UserDAL.ts` → `findById` select list |
| Service | `server/services/UserService.ts` → `updateDisplaySettings` |
| Controller | `server/controllers/UserController.ts` → `updateDisplaySettings` (`PUT /api/users/displaySettings`) |
| Client context | `src/AuthContext.tsx` → `updateDisplaySettings` |
| Client catalog | `src/theme/cjkFontOptions.ts` → `CJK_FONT_CATALOG` / `CJK_FONT_OPTIONS` |
| Applied | `src/hooks/useChineseFont.ts`, mounted by `ChineseFontApplier` in `src/App.tsx` |
| UI | `src/pages/SettingsPage.tsx` → the Display section's typeface picker |
| Drift guard | `src/__tests__/chineseFont.test.ts` |

This is the same shape as `showSegmentSpaces` (migration 129), which it sits beside.

### Why account-level and not device-local

A learner who picks a kai face is choosing which **stroke forms they study against**
(see § 4), not just a look. That must not differ between their phone and their laptop.

### The allow-list is duplicated on purpose, and guarded

`CHINESE_FONT_IDS` (server) is bare ids; `CJK_FONT_OPTIONS` (client) carries labels,
native names, stylesheet URLs and blurbs the server has no business knowing. They
cannot simply be one list. `src/__tests__/chineseFont.test.ts` asserts the selectable
ids are exactly the allow-list — the same guard `cardColor.test.ts` gives
`CARD_COLOR_VALUES`. Without it, a face a user can tap would 400 silently.

The same test also asserts **no `license: "restricted"` face is ever `selectable`**.
That guard is currently vacuous — no `restricted` face remains — but it is the reason
the `license` field exists. `FZKai-Z03` (方正楷体) was the one that motivated it: a
Founder face whose grant is non-commercial only. It was **removed from the catalog
outright on 2026-09-04** rather than kept as a non-selectable benchmark, because a face
nobody may ship is a standing temptation with no payoff. `lxgw-wenkai` is the free kai
to compare against instead. The guard stays live for the next non-OFL candidate.

### Fonts are loaded on demand

`ensureCjkFontLoaded()` injects a face's stylesheet the first time it is needed, once.
Only Noto Sans SC / Noto Serif SC are in `index.html`; the rest are fetched when a user
selects one, or when the Settings picker renders its previews. Five of the six
selectable faces come from `cdn.jsdelivr.net` — a third-party origin on the critical
path, permitted by the existing nginx CSP. `cjkFontStack()` keeps the default stack as
a **tail fallback**, so a CDN failure or a missing glyph degrades per-glyph to Noto
Sans SC rather than to tofu.

---

## 1 · The mechanism: `--cjk-font`

`FONTS.cjk` (`src/theme/fonts.ts`) resolves to:

```
var(--cjk-font, "Noto Sans SC", "Noto Sans JP", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)
```

The `var()` **fallback is the real default stack**, so with `--cjk-font` undefined this
resolves to exactly the string it was before. An undefined custom property cannot blank
the family — which is what makes it safe for signed-out screens and for any render
before the preference has loaded.

Setting `--cjk-font` on any element re-faces every Chinese glyph beneath it, because
all 11 `FONTS.cjk` call sites read the same token. No component takes a font prop.

**One writer, and one fallback:**

1. `src/hooks/useChineseFont.ts` — the signed-in account's preference. The only code
   anywhere that sets `--cjk-font` on `:root`.
2. Nothing — the `var()` fallback. Signed out, or before the user loads.

> ⚠️ **There used to be a second writer, and it was a bug.** `src/theme/cjkFontOverride.ts`
> backed the lab's dev-only "Use app-wide" control and **outranked** the account
> preference: `useChineseFont` called `hasCjkFontOverride()` and stood down whenever the
> `cjkFontOverride` localStorage key was set. One forgotten override therefore pinned the
> app's face forever, and the settings picker saved correctly while appearing to do
> nothing — with no signal at either end. Both the module and the control were **deleted
> on 2026-09-05**. Any stale `cjkFontOverride` / `labelFontOverride` key is now inert:
> nothing reads it, and it clears itself on the next reload because the property was only
> ever an inline style. **Do not reintroduce a second writer of `--cjk-font`.** A future
> preview mechanism should either go through the account setting or announce itself in
> settings, rather than winning silently.

**Code:** `src/theme/fonts.ts` → `FONTS.cjk`.

### What a scoped `--cjk-font` does and does not reach

Still relevant: the lab sets `--cjk-font` per COLUMN, and the account preference sets it
at `:root`. This is what each reaches.

| Path | Reached by a scoped override? | Why |
|---|---|---|
| Every `FONTS.cjk` call site under the container | ✅ | Custom properties inherit. |
| `CPCDRow`'s pinyin-shift measurement | ✅ | It measures a `Range` over its own **in-DOM** nodes, so it measures the candidate. |
| `measureTabWidth` (`features/flashcards/FlashcardsLearnPage/useEipTabs.ts`) | ❌ scoped / ✅ `:root` | It appends a probe span to `document.body`, outside any scoped container. |
| `FONTS.hanziComponents` | ❌ by design | The self-hosted `HanziComponents` subset is keyed to Noto Sans SC's metrics; the seamless per-glyph fallback breaks if either half moves. **Left pinned regardless of what `FONTS.cjk` becomes** — see `src/index.css`. |

---

## 2 · The lab page

Route **`/font-lab`** (`src/routes/routeMeta.ts`, `src/routes/registry.ts`).
Not linked from any menu; reach it by typing the URL. `shell: "plain"`, `chrome: "none"`
— it owns its own scroll container and uses the **full desktop page width** rather than
the phone frame, because it is an authoring tool, not an app screen.

⚠️ **The route now hosts TWO labs.** Since 2026-09-04 `/font-lab` is a shell
(`src/pages/fontLab/FontLabPage.tsx`) with a mode switch, persisted in
`localStorage.fontLabMode`:

| Mode | File | Chooses |
|---|---|---|
| **Chinese** (this document) | `src/pages/fontLab/CjkLab.tsx` | `FONTS.cjk` |
| **Info type** | `src/pages/fontLab/InfoTypeLab.tsx` | `FONTS.label`, the overline/caption voice — see [INFO_TYPE_LAB.md](./INFO_TYPE_LAB.md) |

They share the route, the shell and the compare-grid idea, and nothing else. Each lab owns
its own `100dvh` scroll container, and the tab strip is passed **down** into it as a node
rather than floated above — a shell wrapper would become the scrolling ancestor and break
both grids' sticky headers.

**Code:** `src/pages/fontLab/CjkLab.tsx` (state, picker, compare grid) — **renamed from
`FontLabPage.tsx`, which is now the shell** — `src/pages/fontLab/specimens.tsx` (the
surfaces), `src/pages/fontLab/candidates.ts` (the shortlist + loader + metric probe).

### The compare grid

**One row per specimen surface, one column per selected face.** Grid rows give every
column a shared baseline for the same surface, which is the only way the differences
that matter — stroke weight, counter size, the pinyin's register over its character —
are visible at all.

* **No cap on the column count.** Columns have a floor (`MIN_COL`, 300px) but no
  ceiling: `minmax(MIN_COL, 1fr)` only ever *grows* a track, so once the columns stop
  fitting, the grid overflows and the page scrolls horizontally rather than squeezing
  them. Every column stays honestly comparable however many are open.
* The picker is multi-select; **Show all** opens every candidate at once.
* The header row is `position: sticky; top: 0`, the row-label column is
  `sticky; left: 0`, and the corner cell sticks on **both** axes at a higher layer —
  it is their intersection, and without it one visibly slides over the other. Layers:
  3 = corner, 2 = header row, 1 = label column.
* **Both axes scroll on the page root, on one element.** A separate inner
  `overflow-x` wrapper would become its own scrolling ancestor and break the sticky
  header — see the height note at the end of this section.
* Each column cell carries `--cjk-font` for its face. **No specimen names a font
  family**; every one reads `FONTS.cjk`, so what you see is what the app would render.

### Specimens

Each mirrors a real app surface **at its real size**, because the common failure is a
face that reads beautifully at hero size and turns to mud at `SIZE.caption`:
hero headword (xl), card front (md, on `COLORS.cardFace`), word list (sm), reader
paragraph (`SIZE.bodyLg`), small scale (caption + micro), stroke-form check, density
check, and a weight pair.

These render the **real** `ForeignText` → `CPCDRow` components, not mock markup — so
CPCDRow's pinyin-shift solver measures each candidate's own metrics.

Adding a surface: append to `SPECIMENS` in `specimens.tsx`. Each entry is
`{ id, title, hint, Render }` and draws exactly one cell; the grid owns the frame, so a
specimen sets no vertical rhythm and wraps itself in no card.

### Per-column readout

In each column head: the face's typographic class, source, licence, and a measured
**han advance in em**.

> ⚠️ **The advance number is the load-bearing check.** cpcd stacks a pinyin syllable
> over each character assuming han glyphs occupy a full 1em square, and
> [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md)'s nudging works from that baseline. A
> face whose advance is not ~1.00 — any condensed design, e.g. 得意黑 / Smiley Sans —
> puts every pinyin column out of register. Smiley Sans is in the shortlist **as the
> demonstration of this**, not as a candidate.
>
> The number is advisory: canvas `measureText` silently falls back to another family
> when the requested one has not loaded, which shows up as a suspiciously exact 1.000.

### Pin — the lab's only persisted state

| | **Pin** (many) |
|---|---|
| What it does | Marks a face as still in the running |
| Scope | `/font-lab` only — pure bookkeeping |
| How many | Any number |
| Storage | `fontLabPinned` (a JSON id array) |
| Code | `src/pages/fontLab/pinned.ts` |

This section used to describe a second control, **Use app-wide**, which set `--cjk-font`
on `:root` and re-faced the whole app. The two shared the word "pin" and were a standing
source of misunderstanding; the app-wide half was deleted on 2026-09-05 (see the callout
in § "the `--cjk-font` token" above). **The lab can no longer change what the app renders
in** — the face is chosen only in account settings. The practical consequence is that a
`selectable: false` face can be judged only on these specimens, never on flp or a game,
which is an acceptable trade for a control that could silently break the real setting.

**Pin** persists a shortlist. The toolbar's **📌 Show pinned (n)** opens every pinned
face as a column in the shortlist's own order, and the page seeds its columns from the
shortlist on mount — so reopening `/font-lab` recalls what you were considering. After
that the two diverge freely: opening a column does not pin it, and unpinning does not
close it; "Show pinned" is the explicit way to re-sync them. Pinned ids, not family
names, are stored, so a renamed or re-sourced face in `candidates.ts` invalidates
cleanly rather than pinning a family that no longer loads.

### Height note (why `100dvh`, not `100%`)

`Layout`'s plain branch is a column flex box with `minHeight: 100dvh` and an **auto**
height, so a percentage height on the page root has no definite parent to resolve
against — the box grows to its content and the pinned `html`/`body` clip it instead of
scrolling. See the callout in
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § app shell.

## 3 · Candidate sources

| Source | Origin | Notes |
|---|---|---|
| `google` | `fonts.googleapis.com` | Already a trusted origin — `index.html` loads five families from it. Costs no new connection. |
| `jsdelivr` | `cdn.jsdelivr.net/npm/cn-fontsource-*` ([wc-ex/cn-fontsource](https://github.com/wc-ex/cn-fontsource)) | Republishes Chinese webfonts as unicode-range-sliced `@font-face` sets (80–620 slices per face). The browser fetches only the slices a page uses, so cost scales with glyph coverage, not font size. **Shipping one adds a new third-party origin to the critical path** — that is a deploy decision, not a design one. |

Licences are recorded per face, and **every face in the catalog is now OFL**. The
`restricted` value exists for candidates worth *looking* at that can never ship; see
§ 0 for why the only one that ever used it (方正楷体) was deleted rather than kept.
Using a Founder face for real would mean buying a webfont licence from 方正字库 — their
free grant covers non-commercial use only, and they enforce it.

---

## 4 · The pedagogical axis

Worth stating because it is not an aesthetic question. The app teaches handwriting
([PRACTICE_WRITING.md](./PRACTICE_WRITING.md)), and **hei (黑体) and song (宋体) print
forms differ from the kai (楷体) model form a learner is graded on** — the top of 令,
the direction of the top stroke in 骨, the counter in 直, the crossing order in 女. A
kai face (LXGW WenKai, Xiaolai, Yozai) shows the shapes the writing drill teaches; the
current Noto Sans SC does not. The "Stroke forms" specimen exists to make that
comparison directly.

This is a real trade-off, not a free win: kai faces are lower-contrast and less even
than a gothic, which costs legibility in dense running text and at `SIZE.micro`.

---

## 5 · Adding a face

Append one entry to `CJK_FONT_CATALOG` in **`src/theme/cjkFontOptions.ts`** — the single
source of truth for both the lab and the setting. The `family` string must match the
stylesheet's declared `font-family` exactly (case and spaces), or the face silently
falls back. Nothing else needs touching for a **lab-only** face: the picker, loader and
metric probe all derive from that array.

To make a face **user-selectable**, three more things, all required together:

1. Set `selectable: true`, and confirm its `license` is `ofl`/`apache`. A `restricted`
   face may never be selectable — `chineseFont.test.ts` fails the build if it is.
2. Add its id to `CHINESE_FONT_IDS` in `server/contracts/wire.ts`. `chineseFont.test.ts`
   fails the build if these two disagree.
3. Check its **han advance is ~1.00em** in `/font-lab` (§ 2). A condensed face
   breaks every cpcd pinyin column and must not ship.

No migration is needed to add or remove a selectable face: the column is bare `text`,
and `resolveCjkFont()` falls back to the default for any id it no longer recognises —
so retiring a face degrades gracefully for accounts still holding it.
