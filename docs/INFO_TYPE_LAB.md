# Info type — the overline voice, and the lab for replacing it

**Status: BOTH FACES CHOSEN (2026-09-04).**

| Token | Face | Job |
|---|---|---|
| `FONTS.label` | **Public Sans** | info type — overlines, captions, section labels |
| `FONTS.mono` | **Azeret Mono** | data — counts, scores, user ids, timers, numbered-tone pinyin |

JetBrains Mono, which used to be both, is **no longer used anywhere in the app** and has
been dropped from `index.html`. The 18 hand-rolled overline sites were migrated in the
same pass. The lab stays up while the size/tracking/weight numbers are still open (§ 6).

---

## 1. What "info type" means

The app announces a section with a **mono uppercase overline**, not a bold heading.
That one typographic decision produces the voice used by:

| Class | Primitive | Where |
|---|---|---|
| `.lab` | `Label` | bare overlines, inline counts, ranks, timestamps |
| `.sec2` | `SectionRule` | the default section divider on a scrolling page |
| `.shelfhd` | `SectionHeader` | a section header ending in a tappable affordance |

All three live in `src/components/primitives/Label.tsx` → `Label` is the atom; the other
two wrap it. Four numbers make it work, and until 2026-09-04 they were re-typed by hand
on every page: **10px / 0.14em tracking / `COLORS.textFaint` / a mono face.**

The trigger for this work was `.mobile-demo-examples-caption` — the eip Examples-tab
caption in `src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx` →
`TabCaption`. It renders strings like `sense 1 · to be located at`, which is the hardest
thing this flavour is asked to do: a **sentence**, set at 10px, uppercased, tracked, in
faint ink.

## 2. The diagnosis

Three things compound, and only one is the typeface:

1. **Tracking a monospace face.** JetBrains Mono already had a uniform, wide advance.
   `0.14em` on top of that is ~1.4px of extra air per glyph at 10px.
2. **10px is below JetBrains Mono's floor.** It is a coding face tuned for 13–15px; its
   large x-height and blunt terminals went mushy small, especially under faint ink.
3. **One token was doing two jobs.** `sense 1 · to be located at` is **prose**; `×12 wins`
   is **data**. Mono is right for the second only. Setting both in one face is what makes
   the caption read like a debug string.

Point 3 is why the fix is a token split rather than a family swap.

## 3. `FONTS.label` — the token (code: `src/theme/fonts.ts`)

```ts
label: 'var(--label-font, "Public Sans", "Instrument Sans", system-ui, -apple-system, sans-serif)',
```

Same indirection trick as `FONTS.cjk` (see [CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md)
§ 1): the `var()`'s **fallback is the real stack**, so an undefined `--label-font` can
never blank the family. The token was introduced holding JetBrains Mono's exact stack, so
the split itself changed nothing visually and the face swap was a separate, reviewable
step. `FONTS.mono` now means **data only**, and took Azeret Mono in the same pass.

`Label` (`src/components/primitives/Label.tsx`) is the only shipped consumer so far.
Because the property inherits, setting `--label-font` on any ancestor re-faces every
`.lab` beneath it — which is exactly what the lab's columns do.

## 4. The lab (route: `/font-lab`, "Info type" mode)

`/font-lab` is now a shell (`src/pages/fontLab/FontLabPage.tsx`) over two independent
labs, with the mode persisted in `localStorage.fontLabMode`:

| Mode | File | Chooses | Ships as |
|---|---|---|---|
| Chinese | `CjkLab.tsx` | `FONTS.cjk` | a per-account setting (`users."chineseFont"`) |
| Info type | `InfoTypeLab.tsx` | `FONTS.label` | **one hardcoded decision** — never a setting |

Each lab owns its own `100dvh` scroll container, and the tab strip is passed **down** into
it as a node rather than floated above — a shell wrapper would become the scrolling
ancestor and break both grids' sticky headers.

**Files**

| File | Role |
|---|---|
| `src/pages/fontLab/InfoTypeLab.tsx` | the compare grid and the tuning controls |
| `src/pages/fontLab/infoTypeCandidates.ts` | the throwaway face catalog + loader |
| `src/pages/fontLab/infoTypeSpecimens.tsx` | 8 specimen surfaces, all real app copy |

> ⚠️ **`labelFontOverride.ts` and the "Use app-wide" control were deleted on 2026-09-05.**
> They set `--label-font` on `:root` so a candidate could be judged on the real pages.
> They went out with their CJK counterpart, which had the same shape but a worse
> consequence — it silently outranked the `users."chineseFont"` account setting and made
> the settings picker look broken (see
> [CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md) § "the `--cjk-font` token"). The info-type
> override had no setting to shadow, so it was only ever a stale-state trap, but the two
> were the same mechanism and were removed together rather than leaving one half standing
> as a template to copy. **To see a candidate app-wide now, change `FONTS.label`'s stack
> in `src/theme/fonts.ts`** — which is the endpoint of this experiment anyway (§ 7), and a
> one-line edit that a dev server hot-reloads.

**Specimens render the real primitives.** `infoTypeSpecimens.tsx` imports `Label`,
`SectionRule` and `SectionHeader` from `src/components/primitives` — nothing is mocked and
no specimen names a family, so what is being judged is the shipped component at its
shipped size.

**The tuning controls are shared across every column, on purpose.** Size, tracking and
weight are as much to blame as the face, so they are controls rather than constants; but
comparing two faces at two settings compares nothing. They apply as a `& .lab` override
on the grid, which needs `!important` because the primitive sets those properties inline
through MUI's `sx`. Dev-only scaffolding; it never ships.

**Verified weight lists.** Google Fonts **silently clamps** a weight a family does not
ship to the nearest one it does, and still answers `200`. So `InfoFaceOption.weights` is a
list read back from the css2 response, not a guess, and a column whose face lacks the
current tuning weight says `⚠ no 600 — clamped` rather than lying.

### Candidates

Every face is on Google Fonts under the OFL, so any of them can ship. The list spans both
answers to the diagnosis — "a mono that survives 10px" and "stop using mono for prose":

**Chosen: Public Sans** for `FONTS.label`, and **Azeret Mono** for the `FONTS.mono` half
of the split. The rest stay in the lab until the numbers are settled.

- **mono** — JetBrains Mono (the benchmark it replaced), Martian Mono, Geist Mono, IBM Plex Mono, Azeret
  Mono, Spline Sans Mono, DM Mono, Space Mono
- **sans** — Instrument Sans (the app's own, zero new bytes), Archivo, Inter Tight,
  Space Grotesk, Public Sans

## 5. The `FONTS.mono` → `FONTS.label` migration (done)

Of the 56 `FONTS.mono` call sites, **18 were hand-rolled copies of the overline flavour**
that never went through the primitive. They were converted in the same pass as the split.

**The test — and it is about MEANING, not casing.** Is the string a *word the UI is
saying*, or a *figure the user reads off*? Words are info type; figures are data.
`textTransform: uppercase` finds most of the first group but is only a proxy: it missed
`MasteryWindow`'s lowercase track names (info type) and would happily have caught an
uppercase serial number (data). Scores, ranks, timestamps, `·` separators, tabular
figures and **user ids** stay on `FONTS.mono`.

> **Why user ids specifically stay mono.** `FriendsPage` renders the account id for
> someone to read out or transcribe by hand, and `SentRequestsPage`'s input takes it back.
> That is the one place in the app where glyph DISAMBIGUATION is load-bearing — `0`/`O`,
> `1`/`l`/`I` — and a fixed advance lets the eye track position in a long string. A
> grotesque would make a mistyped id a support problem. Same reason the `PageHeader` `ch`
> chips stayed.

Converted: `pages/SettingsPage.tsx` · `components/PageHeader.tsx` · `components/bento/Bento.tsx` ·
`components/leaderboard/Board.tsx` · `components/mastery/MasteryWindow.tsx` (2, one of
them lowercase) ·
`components/primitives/Segmented.tsx` · `features/arena/DivisionBanner.tsx` (2) ·
`features/flashcards/cardOpsCell.ts` · `features/studyChallenge/ChallengeDetailPage.tsx` ·
`features/studyChallenge/ChallengeHelpPopup.tsx` · `features/studyChallenge/ChallengePanel.tsx` ·
`features/studyChallenge/ChallengeSheet.tsx` · `features/studyChallenge/ChallengeTestCard.tsx` (2) ·
`games/bubble-match/BubbleMatchTrackToggle.tsx` · `games/runtime/ChallengeRoundScoreboard.tsx`

**Two deliberate exceptions**, both in `PageHeader.tsx` (`HeaderCycleChip` and its
sibling): they size themselves with `calc(${widthCh}ch + …)`, and `ch` is only an exact
character advance against a **fixed-advance** face. Moving them to a proportional sans
would silently mis-size every chip. They are lowercase anyway, so the uppercase test
already excludes them.

**The lab's own chrome is excluded** (`CjkLab.tsx`, `InfoTypeLab.tsx`) — a control that
re-faces along with the thing under test is unreadable.

## 6. Two inconsistencies found while doing this

Both predate the work and are **not** fixed yet:

- `Label` hardcodes `fontSize: 10` and `letterSpacing: "0.14em"`, while the scale tokens
  say `SIZE.micro = 11px` and `TRACKING.caps = 0.12em` (`src/theme/scale.ts`). The
  primitive that exists to stop these numbers drifting is itself off-token.
- `SectionHeader`'s `meta` prop is documented as "a mono FACT", which was true when
  `.lab` was mono. If the info type becomes a sans, that comment and the
  `BentoStrip` comparison in [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) both need rewording.

Fold both into whichever change lands the chosen face.

## 7. When this lab is done

The face is chosen and the § 5 migration is done. What remains before the lab can go:

1. Settle the size/tracking/weight numbers in `Label` (§ 6) — Public Sans at the shipped
   10px / 0.14em / 400 is lighter than the mono it replaced, and probably wants 11px /
   ~0.09em / 500–600. Use the lab's tuning sliders to pick them.
2. Delete `src/pages/fontLab/infoTypeCandidates.ts`, `infoTypeSpecimens.tsx` and
   `InfoTypeLab.tsx`, and drop the mode switch from `FontLabPage.tsx`.
   (`labelFontOverride.ts` is already gone — deleted 2026-09-05, see § 4.)
3. Delete this file.

Keep `--label-font` itself — it costs nothing and is what made the experiment cheap.

---

**Referenced by:** [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5 (the `.lab` primitive),
[CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md) (the sibling lab on the same route).
