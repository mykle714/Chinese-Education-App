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
| Hook | `src/softIntro/useSoftIntro.ts` → `useSoftIntro` | What a component calls: returns `"intro"` or `"graduated"` |
| Feature-tester UI | `src/softIntro/SoftIntroToggle.tsx` | Header button: Auto → Intro → Graduated |
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
| `handCardCount` | fdp card hand (full variant) — `StudyHand` `figureMark`, chosen in `FlpStudyHand` | small "cards" under the big numeral | the design's 34×2px ink hairline (`.bignum:after`) | 15 visits + 7 days |

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
  the si's element is not actually shown. `FlpStudyHand` passes
  `enabled: variant === "full"` so the Reading/Writing Centers' compact hands, which have
  no numeral, cannot graduate the fdp's si unseen.

## 5. Feature-tester viewing toggle

`SoftIntroToggle` renders only for `users.isFeatureTester` (migration 178; it rode
`isValidator` before that flag was split into data validation vs feature testing). Each tap cycles one app-wide
override:

| Override | Icon | Effect |
|---|---|---|
| `auto` | `hdr_auto` | Every si shows this device's real state |
| `intro` | `school` | Every si is forced to its intro style |
| `graduated` | `workspace_premium` | Every si is forced to its graduated style |

- The override is **live**: `useSyncExternalStore` on a window event, plus `storage` for
  other tabs. It re-renders immediately so the two styles can be compared in place.
- It **never touches the visit records**.
- `useSoftIntro` ignores it for non-testers, so a stale key on a shared device cannot
  change a learner's experience.
- It belongs in the header of any page hosting an si. Today that is the hp
  (`src/pages/HomePage.tsx`, `headerExtraActions`, left of the banking always-play toggle).

## 6. Adding a soft introduction

1. Add an entry to `SOFT_INTROS` with thresholds and a one-line description.
2. In the component, `const state = useSoftIntro("<id>")` and render either style. If
   the swap changes layout that something measures, re-measure on the state (see
   `StudyHand` → `useCrampedFigure`'s `figureMark` dep).
3. Make sure `SoftIntroToggle` is in that page's header.
4. Add a row to the table in § 2.
