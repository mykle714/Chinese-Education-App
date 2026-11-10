# Soft Introduction (si)

A **soft introduction** is a minor UI element that is styled one way — the **intro**
style, usually more explicit (a label, a hint) — for a learner's first handful of
encounters, then switches to its **graduated** style, usually quieter, once we believe
the learner understands it.

It is for things not important enough to run through the tutorial. The two styles must
be minor enough that **it does not matter which one a learner sees**. That is what allows
the state to live only on the device (§ 3): clearing site data or switching device just
replays the intro.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) → Sub-documents.

---

## 1. Layers

Client-only. There is no server, API, or database component.

| Layer | File | Role |
|---|---|---|
| Registry | `src/softIntro/softIntroRegistry.ts` → `SOFT_INTROS`, `VISIT_DEDUPE_MS` | Every si id and its thresholds |
| Storage + pure logic | `src/softIntro/softIntroStorage.ts` → `recordVisit`, `hasMetThresholds`, `resolveSoftIntroState`, `recordSoftIntroVisit`, override read/write/subscribe | localStorage records, graduation rule, feature-tester override |
| Hook | `src/softIntro/useSoftIntro.ts` → `useSoftIntro`, `useSoftIntroOverride` | What a component calls: returns `"intro"` or `"graduated"`; the override as React state |
| Feature-tester UI | `src/pages/settings/SettingsBody.tsx` → `SOFT_INTRO_OVERRIDE_OPTIONS` | Settings → "Soft introductions": Auto / Force intro / Force graduated |
| Tests | `src/__tests__/softIntro.test.ts` | Dedupe window and both-thresholds rule |

`src/softIntro/` is a subsystem directory (like `src/minutePoints/`), not a feature
folder: any feature may consume it.

## 2. The registry and the graduation rule

`SOFT_INTROS` in `softIntroRegistry.ts` maps an id to `{ minVisits, minDays, description }`.

- **Graduation needs BOTH** `minVisits` visits **and** `minDays` since the first visit.
  Either alone is too easy to hit by accident: five visits in one sitting, or one visit
  followed by a week away, does not mean the learner gets it.
- **A visit is a mount**, deduped: two mounts less than `VISIT_DEDUPE_MS` (30 min) apart
  count once. This stops footer-tab hopping and React StrictMode's double effect from
  inflating the count.
- **Graduation is sticky.** The first time thresholds are found met, `graduatedAt` is
  stamped. Raising a threshold later never un-graduates anyone.
- **Ids are storage keys.** Renaming one restarts that si for everyone.

| Id | Where | Intro | Graduated | Thresholds |
|---|---|---|---|---|
| `sortDifficultyCaption` | acp toolbar level pill — `AddCardsPage` `difficultyCaption` / `LevelCaption` | "DIFFICULTY →" caption left of the pill, pointing at it | the pill alone (Tower Tier 2 design) | 7 visits + 7 days |
| `towerSortLabel` | td main world's mini sort platform — `DeckTowerPlatform` `fixturePrint` (`FIXTURE_PRINT.sortBin`) | "ADD MORE / CARDS →" printed in white on the floor in front of it, reading toward it (`IsoFloorPrint`) | the slab alone | 70 visits + 14 days |
| `towerNotebookLabel` | td writing world's notebook paper stack — `DeckTowerPlatform` `fixturePrint` (`FIXTURE_PRINT.notebook`) | "WRITING / NOTEBOOK" + a hung "→" printed into the floor in front of it, reading toward it | the stack alone | 70 visits + 14 days |
| `towerSnowCover` | td settled snow — `DeckTowerPage` `snowCoverText` → `DeckTowerPlatform` `snow.coverText` ([TOWER_SNOW.md](./TOWER_SNOW.md) § Covering text) | snow leaves text readable: plate bare, si print + imprint drawn over the floor's snow, top card's snow on its rim only | snow covers the plate, the prints and the top card's print | 4 visits + 1 day |
| `pawnDismissCue` | flp hint pawn's speech bubble — `PawnHintBody` `DismissCue`, resolved by `HintPawn` → `DismissCueSoftIntro` | "Tap / to / dismiss" cue in the bubble's bottom-right corner ([HINT_PAWN.md](./HINT_PAWN.md) § Dismissing) | no cue, and no space reserved for it: the line / cpcd words take its width. The bubble is still one tap target | 49 visits + 14 days |

## 3. Storage

Two localStorage keys, every access in try/catch (a failure reads as "no visits yet", i.e. the intro):

- `softIntro.v1` — `{ [id]: { firstVisitAt, lastVisitAt, visits, graduatedAt? } }` (epoch ms).
- `softIntro.override` — the feature-tester override (§ 5); absent = `auto`.

Writes re-read the map first, so two si mounting together cannot clobber each other.

## 4. The hook: `useSoftIntro(id, { enabled })`

- **Decided once, at mount.** The natural state comes from a `useState` initializer and
  is held for the life of the mount, so an si never changes style under the learner's
  eyes. If earlier visits already met the thresholds, the mount graduates (and stamps
  `graduatedAt`) before anything is drawn. The visit that crosses the thresholds still
  shows the intro; the graduated style arrives on the next mount.
- **The visit is recorded after paint** (`useEffect`).
- **`enabled: false`** records no visit. Use it when the host component mounts somewhere
  the si's element is not actually shown. `DeckTowerPlatform` passes
  `enabled: sortBin !== undefined` / `notebook !== undefined`, so a visit counts only on the
  world, and with the Learning deck, where that fixture stands.
- **A host that outlives the thing it introduces** mounts a tiny keyed child instead of
  calling the hook itself. `HintPawn` stays mounted while its flp is parked under the
  tower, so it wraps its bubbles in `DismissCueSoftIntro key={arrival.id}`: each pawn
  arrival (one study session) is a fresh mount, so one visit, and one style for the whole
  session.

## 5. Feature-tester viewing override (Settings)

One setting controls every si: the **"Soft introductions"** section in Settings
(`src/pages/settings/SettingsBody.tsx`, its own `SettingsSection` directly under
"Testing"). It shows only for `users.isFeatureTester` (migration 178) **while** that
device's "Enable testing features" switch is on ([FEATURE_TESTING.md](./FEATURE_TESTING.md),
`useTestingFeatures`), because `useSoftIntro` ignores the override otherwise. Three
radio rows (`OptionRow`) pick one app-wide override, read and written through
`useSoftIntroOverride`:

| Override | Row | Effect |
|---|---|---|
| `auto` | Auto | Every si shows this device's real state |
| `intro` | Force intro | Every si is forced to its intro style |
| `graduated` | Force graduated | Every si is forced to its graduated style |

Until 2026-11-05 this was a tester-only header button (`SoftIntroToggle`) that cycled
the three states on td and acp. It was removed so that no page header carries tester
controls.

- The override is **live**: `useSyncExternalStore` on a window event, plus `storage` for
  other tabs. It re-renders immediately so the two styles can be compared in place.
- It **never touches the visit records**.
- `useSoftIntro` ignores it for non-testers, so a stale key on a shared device cannot
  change a learner's experience.
- Turning testing features off leaves the stored override in place but inert, so turning
  them back on restores the tester's last choice.

## 6. Adding a soft introduction

1. Add an entry to `SOFT_INTROS` with thresholds and a one-line description.
2. In the component, `const state = useSoftIntro("<id>")` and render either style. If
   the swap changes layout that something measures, re-measure on the state.
3. Add a row to the table in § 2. (Nothing per-page is needed for the tester override:
   the Settings section covers every si.)
