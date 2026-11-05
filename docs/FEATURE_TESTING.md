# Feature Testing — the "Enable testing features" switch

A `users."isFeatureTester"` account (migration 178) is a **grant**. It does not by itself
change what the app shows. Tester surfaces appear only when the tester also turns on
**Settings → Testing → Enable testing features** on that device. With the switch off, a
tester account looks and behaves like a learner account, which is useful for demos and for
checking the real learner experience without losing the grant.

Linked from: [FEATURE_FLAGS.md](./FEATURE_FLAGS.md) § 1 (per-user gating vs flags).

## 1. The gate

**Code:** `src/hooks/useTestingFeatures.ts` → `useTestingFeatures`,
`useTestingFeaturesSwitch`, `readTestingFeaturesSwitch`, `writeTestingFeaturesSwitch`.

```
testing features live  =  user.isFeatureTester  AND  localStorage["cow.testingFeatures"] === "1"
```

- **Device-local, default OFF.** An unset key, or storage that is blocked or throws, reads
  as off. A fresh install or a second phone shows the learner app until the switch is set
  there.
- **Live.** The store is a module singleton read through `useSyncExternalStore`. Flipping
  it re-renders every subscriber in the tab immediately, and a `storage` listener picks
  up flips from other tabs.
- **Client-only.** The server does not know about the switch. Server-side tester gates
  (`StudyChallengeService` → `resolveAnytime`, the Arena manual tick) still check
  `isFeatureTester` alone. The client stops sending such requests while the switch is off
  (the challenge-anytime latch is fed from `useTestingFeatures`).
- **Admins.** `isAdmin` reaches the Tester Dashboard on its own, so an admin sees it
  regardless of the switch. The switch gates only the `isFeatureTester` half of that check.

**Rule for new code:** gate a client tester surface on `useTestingFeatures()`, never on
`user.isFeatureTester` directly. The account flag is read directly in only two places:
`SettingsBody` (whether to show the switch row at all) and `challengeAnytime.ts`
(`useChallengeAnytime` clears a stored anytime request only when the ACCOUNT loses the
grant, so switching testing off suspends the request without discarding it).

## 2. The Settings row

**Code:** `src/pages/settings/SettingsBody.tsx` → the `settings-page__testing-section`
`SettingsSection`.

The row is the first section on the page, above Color Theme. It renders only for an
`isFeatureTester` account. It is a single `SwitchRow` titled "Enable testing features",
with a subtitle that says the setting is saved on this device only.

## 3. What it gates

Every surface below reads `useTestingFeatures()`:

| Surface | Code |
|---|---|
| Deck Tower tester chip rows: time of day, weather, lightning, forced break, banking always-play | `src/features/deckTower/DeckTowerPage.tsx` → `testingFeatures` |
| Time-of-day pin honoured app-wide | `src/timeOfDay/useTier2Look.ts`, `src/features/flashcards/FlashcardsLearnPage/useEipPalette.ts`, `src/features/discover/AddNewCardsPage.tsx` |
| Weather override on scp | `src/features/discover/AddNewCardsPage.tsx` |
| Forced game break in the flp | `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` → `forcedBreakKey` |
| Banking "always play" honoured | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `useDailyBankingRun` |
| Soft-intro header toggle + its override | `src/softIntro/SoftIntroToggle.tsx`, `src/softIntro/useSoftIntro.ts` |
| Study Challenge "Allow anytime" row, notice and request latch | `src/features/studyChallenge/ChallengesPage.tsx`, `src/features/studyChallenge/challengeAnytime.ts` → `useChallengeAnytime` |
| Tester Dashboard Menu tile + route bounce (or `isAdmin`) | `src/pages/MenuPage.tsx` → `gatedTiles`, `src/pages/TesterDashboardPage.tsx` |

Each surface's own stored overrides (e.g. `deckTower.timeOfDayOverride`,
`dailyBanking.alwaysPlay`, `cow.challengeAnytime`) are kept while testing is off and take
effect again when it is turned back on.
