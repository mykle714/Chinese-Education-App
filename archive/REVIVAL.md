# Home Screen — revival guide

**Archived 2026-11-11.** Base commit: `f276eb7` (the last `main` commit that contained the
home screen). This branch is that commit plus this file. On `main` the home screen was
replaced by the **launch screen** (`src/features/deckTower/launch/`, docs/LAUNCH_SCREEN.md):
a full-screen solid sky colour with a pawn dropping onto a mini platform, then a circle
transition into td.

## What it was

A stage of the Deck Tower page (not a route) that the app opened on once per launch: td's
own platform and pawn standing ABOVE the tower on td's sky, a placeholder title, a
Dictionary keycap (circle transition to `/dictionary`, whose back arrow returned to td), and
"Swipe down to enter", which shifted the camera down to the deck's top and scrolled down to
the platform. A fresh pull past the deck's top went back up to it. Full design:
`docs/HOME_SCREEN.md` on this branch.

## Files deleted from main

- `src/features/deckTower/home/` — `HomeStage.tsx`, `HomeScene.tsx`, `HomeButtons.tsx`,
  `HomeTitle.tsx`, `HomeEnterHint.tsx`, `homeLaunch.ts`, `useHomeEntrance.ts`, `useHomePull.ts`
- `src/__tests__/homeEntranceTimeline.test.ts`
- `docs/HOME_SCREEN.md`

## Wiring points in shared files (re-add on revival)

| File | What it held |
|---|---|
| `src/features/deckTower/DeckTowerPage.tsx` | `homeOnLaunch`/`markHomeTaken`, `useHomeEntrance` (`onCruise`, `descentTarget`, `onLanded`, `onHome`), `homeUp`/`homeShifting`/`homeStageShown`, `homeAltitudeY` → SpaceBackdrop `altitudeY`, `bankingHeld`, `openDictionaryFromHome`, `useHomePull` + `pullHome` + `pinnedPull`, the scroller's `visibility`/`transform` during the shift, vertical `SpeedLines`, `<HomeStage>`, `homeWorld` |
| `src/features/dictionary/DictionaryPage.tsx` | `readHomeBack` + `backToTower`: the back arrow shown only when opened from home with `{ homeBack, circleFrom }` |
| `src/minutePoints/dailyBanking/DailyBankingContext.tsx` | `held` — now driven by the launch screen instead |
| Docs | `docs/DECK_TOWER.md` sub-document paragraph, `docs/UX_AND_NAVIGATION.md` Deck Tower row, `docs/DAILY_MINUTE_BANKING.md` client-state row |

Kept on main because they are shared: `useWorldPan.ts` → `carriedOutPlan` / `outDistanceAt`,
`SpeedLines` `axis="y"`, `towerKeycap.ts` → `towerKeyShadow`, `tapToStartGeometry.ts`,
`skyCueFloat.ts`.

## Revival checklist

1. `git checkout origin/archive/home-screen -- src/features/deckTower/home src/__tests__/homeEntranceTimeline.test.ts docs/HOME_SCREEN.md`
2. Re-wire the table above against current `DeckTowerPage` (diff against `f276eb7`).
3. Decide how it coexists with the launch screen (launch → home → td, or replace).
