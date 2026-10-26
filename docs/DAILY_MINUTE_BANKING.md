# Daily Minute Banking (hp banking animation + AccountSheet bank banner)

> **Status: BUILT 2026-10-10 (migration 175); deployed to PPE 2026-10-10.** All design questions
> are answered (see the [question log](#question-log)); the numbers in § 4 are first-pass
> values still to be tuned on device. Migration 175 is expand-only and ships with a
> standard `/deploy` — no runbook.

Parent: [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md). Related:
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md) (the `.hd .fire` treatment),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (the hp header and the AccountSheet).

> **"hp" in this doc = the Home tab (`/`)** — the page whose header carries the flame,
> Settings gear and avatar. Since 2026-10-10 that tab's content is the decks page (the
> fdp, `FlashcardsDecksPage`, wrapped by `src/pages/HomePage.tsx`); the hub bento moved
> to Menu (`/menu`), which has no banking run. See [NAVIGATION.md](./NAVIGATION.md).

## 1. What it is

Two surfaces that tell one story: **a day's minutes are banked into a running total.**

1. **The banking animation (hp, once per streak day).** On the learner's first visit to the
   Home tab (`/`) in a new streak day, the header flame opens on **yesterday's** minutes, swells
   to draw the eye, then drains — the number counts down and the flame's fill empties —
   while embers fly from the flame into the profile-picture button, which charges up a glow.
   The count always drains to 0, which brings the flame back to its normal size. The
   avatar's glow then settles, and finally the flame relights while the count climbs from
   0 to today's minutes.
2. **The bank banner (AccountSheet).** A banner directly under the profile row showing
   the **banked** total — NET through the end of yesterday — with a small `+🔥 N` chip in
   its corner for today's not-yet-banked minutes. The real balance is banked + today;
   tomorrow's first hp visit animates today's chip into the bank.

Everything about the animation's magnitude — how far the flame swells, how long the drain
takes, how bright the avatar glows, how many embers fly — is a function of yesterday's
minutes. A big day gets a big ceremony; a 3-minute day gets a quick nod.

## 2. ⚠️ The animation is a re-enactment, not a transaction

The server **already banks every minute the moment it is earned**:
`UserLanguagesDAL.incrementPoints` raises `user_languages."totalMinutePoints"` (NET) and
`"lifetimeMinutesEarned"` (GROSS) on every tick (see MINUTE_POINTS_SYSTEM.md § "Counters
are maintained, never aggregated"). There is no end-of-day settlement and this feature
does **not** add one. Yesterday's minutes are in the bank before the animation plays.

So the animation is purely presentational: it dramatizes a transfer that has already
happened. Consequences for the build:

- **No new write path, no new balance column.** The banner's "banked" figure is a
  display-only subtraction, `max(0, totalMinutePoints − todayMinutes)` (§ 6); the
  animation never mutates any balance. The one new column is the seen-today marker (§ 5).
- The banner must **not** count up as embers arrive — the banked figure already contains
  yesterday the moment the streak day rolls over at 04:00.
- If the animation is skipped (reduced motion, interrupted, another device saw it first),
  nothing is lost — the bank is already correct.

## 3. The sequence

Plays in the hp header, where the flame sits two controls in from the corner:
`[flame] [⚙ gear] [avatar]` (PageHeader `trailingContent`, Home only). Embers therefore
travel right, over the gear, into the avatar.

| # | Phase | Flame badge | Avatar | Notes |
|---|---|---|---|---|
| 0 | **Rest-on-yesterday** | Shows yesterday's count, flame **full** (solid `fireActive`) | Normal | Held briefly so the eye can read the number before it moves. |
| 1 | **Swell / pop** | Scales up to `peakScale` with an overshoot, then settles slightly back | Normal | The "look at me" beat. Spring-like ease-out. |
| 2 | **Drain + flight** | Count ticks down to **0**; flame fill empties in step (bottom-anchored window from `FireCount`'s `fillPct`, top → 0). Scale eases from `peakScale` back to 1 **in proportion to the drained fraction**, reaching exactly 1 when the count lands. | Each arriving ember adds charge: glow radius/opacity ramps toward `peakGlow` | **One ember per minute drained**, launched the instant the count drops by that minute, so the stream literally *is* the minutes. |
| 3 | **Settle** | Empty flame at 0, normal size | Glow holds a beat at peak, then decays to none | Yesterday is in the bank. |
| 4 | **Count up** | Flame relights to solid while the count climbs 0 → **today's minutes** (`countUpMs`, 450–1200 ms, sized by today on the same log curve). With nothing earned today the count stays at 0 and the flame just relights (`relightOnlyMs`, 300 ms). | Normal | End state = exactly what the header would show with no animation. |

**The drain always goes to 0** (Q2, revised 2026-10-10). Yesterday empties completely, and
only then does today's count, if any, climb back up from 0 in phase 4. So "yesterday banked"
and "today so far" read as two separate beats rather than one blended number.

**When it does NOT play:**
- Yesterday's minutes for the selected language are 0 (nothing to bank — including any
  missed day, where the penalty cron, not this feature, is the story).
- Already played this streak day — recorded **server-side, once per account across
  devices**, per language: `user_languages."lastBankingShownDate"` (Q1, Q3, Q10).
- Signed out (the flame and avatar both render null).
- (`prefers-reduced-motion` is deliberately **not** honored for now — Q7. The run plays for
  everyone; tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md).)

"Day" means the **04:00-local streak day** (`streakDateOf`), not midnight — the same
boundary the ledger uses, so "yesterday" always means the previous `userminutepoints` row.

Code: `src/minutePoints/dailyBanking/bankingAnimation.ts` → `sampleBankingRun` (the whole
timeline as a pure function of elapsed ms). Two details the table leaves open, as built:

- **Phase 4 relights the flame.** The drain ends on an empty (ghost-only) flame, but the hp
  is off-study, where the header draws a solid flame. Phase 4 refills it alongside the
  count-up, so the hand-back to the live badge is invisible.
- **A hidden tab pauses the run.** The clock advances by real frame time, and a gap over
  100 ms (rAF stops in a background tab) is not counted (`MAX_FRAME_GAP_MS` in
  `DailyBankingContext.tsx`).

## 4. Magnitude scaling

One normalized intensity drives every parameter, so the four knobs can never disagree
about how big a day was:

```
intensity(m) = clamp( ln(1 + m) / ln(1 + M_CAP), 0, 1 )      m = yesterday's minutes
param        = lerp(param_min, param_max, intensity)
```

Log, not linear: the difference between a 3- and a 30-minute day should feel large, and
between 120 and 150 small. `M_CAP` is the day size that earns the full ceremony.

| Parameter | min (m = 1) | max (m ≥ M_CAP) | Proposed `M_CAP` |
|---|---|---|---|
| `peakScale` (flame swell) | 1.15× | 1.8× | 120 min |
| Total duration (phases 1–3, excluding the settle phase's extra ember-flight time) | ~1.6 s | ~5 s | |
| `peakGlow` (avatar halo spread) | 3 px | 14 px | |

**Ember count = exactly yesterday's minutes**, uncapped (decided 2026-10-10, replacing the
original 3–14 cap). Ember `i` launches when the count ticks from `Y − i` to `Y − i − 1`. The
count is `round(Y · (1 − d))`, where `d` is the eased drain, so that tick is at
`d = (i + 0.5) / Y`, inverted through the drain's easing (`emberLaunchMs`).

- Only embers in the air are mounted, about one flight's worth (0.5 s) of the drain, so a
  200-minute day has a few dozen nodes up at once, not 200.
- All per-frame values (ember transforms, flame scale, fill height, avatar glow) go in
  `style`, never MUI `sx`, because emotion mints a new CSS class for every distinct `sx`
  value.

Constants live together in `BANKING_ANIMATION`
(`src/minutePoints/dailyBanking/bankingAnimation.ts`), so tuning is one edit. Also there:
the phase split (`phaseShare`: swell 20% / drain 58% / settle 22%), the 500 ms phase-0
rest, and the 520 ms ember flight. The last ember launches as the count reaches 0, so the
settle phase begins with one extra flight time for it to land. Only then does the glow hold
and decay.

## 5. Layers and components

| Layer | Piece | Responsibility |
|---|---|---|
| **DB** | `user_languages."lastBankingShownDate" DATE NULL` — `database/migrations/175-add-last-banking-shown-date.sql` | The streak date (04:00-local, as `streakDateOf` computes it) on which this (user, language)'s banking run last **started**. NULL = never. Per language because each language has its own yesterday and its own bank. Yesterday's minutes need nothing new: they are `userminutepoints."minutesEarned"` for `(userId, streakDate − 1, language)`. |
| **DAL** | `IUserLanguagesDAL.getProgress` / `getAllProgress` (`lastBankingShownDate` on `LanguageProgress`), `markBankingShown` | The marker rides the row read the summary already makes. `markBankingShown` is a plain UPDATE, not an upsert: a run is only owed when yesterday has minutes, and earning a minute creates the row. |
| **DAL** | `IUserMinutePointsDAL.getMinutesForDateAndLanguage` (existing) | Reused for `streakDate − 1`. |
| **Service** | `UserMinutePointsService.getLanguageSummary` | Returns `yesterdayMinutes` and `bankingPending` (= yesterday > 0 AND marker ≠ today) beside the existing fields. Three parallel single-row reads. The server decides "owed today?" so the client never compares dates. |
| **Service** | `UserMinutePointsService.markBankingSeen` | Resolves the streak date from the client's (timestamp, tz), clamped to server time like the increment path, then stamps the marker. |
| **Controller / API** | `GET /api/users/minutePoints/summary`, `POST /api/users/minutePoints/bankingSeen` (`UserMinutePointsController.markBankingSeen`) | Summary fields are additive. The POST body is `{ language, timestamp, tz }`. `language` is **required** (400 otherwise), because stamping the wrong language would silently suppress that language's run. Returns 204. The client sends it when the run **starts**. |
| **Client API** | `src/minutePoints/minutePointsSync.ts` → `fetchLanguageSummary`, `markBankingSeen` | `markBankingSeen` goes through `src/api/http.ts` (no token). |
| **Client state** | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider`, `useBankingFrame`, `useBankingAnchorRef`, `useBankingAnchors` | HomePage mounts the provider around the `FlashcardsDecksPage` it renders. On mount it fetches the summary itself and, if a run is owed, fires `markBankingSeen` (fire-and-forget) and drives the timeline with rAF. Frames go into a small external store read through `useSyncExternalStore`, so only the three leaf views re-render at 60 fps, never the Home hub. Outside the provider, `useBankingFrame()` is always null. |
| **Client view-model** | `src/minutePoints/dailyBanking/bankingAnimation.ts` → `BANKING_ANIMATION`, `bankingIntensity`, `planBankingRun`, `sampleBankingRun` | Pure maths for the timeline. Tests: `src/minutePoints/__tests__/bankingAnimation.test.ts`. |
| **Client view** | `MinutePointsFireBadge` | While a frame is live, draws the run's `displayCount`, fill and scale instead of the live readout, and registers itself as the `flame` anchor. |
| **Client view** | `HeaderAvatarButton` (`glowPx`, `buttonRef` props) + `src/minutePoints/dailyBanking/BankingAvatarButton.tsx` | `HeaderAvatarButton` draws a `fireActive` halo of `glowPx`. HomePage renders the `BankingAvatarButton` wrapper, which subscribes to the run and registers the `avatar` anchor, so per-frame updates stay inside that leaf. |
| **Client view** | `src/minutePoints/dailyBanking/BankingEmbers.tsx` | A `position: fixed` layer portaled to `<body>` that flies flame glyphs along a lifted Bézier between the two anchors' live rects. Rects are re-read every frame, so scrolling and the swell are tracked. |
| **Client view** | `src/minutePoints/BankBanner.tsx`, rendered by `AccountSheet` | § 6. |

**Why the provider fetches its own summary.** The original plan was to surface
`yesterdayMinutes` through `useMinutePoints`. But that hook's instance belongs to the badge
inside `PageHeader`, so HomePage could not read it, and a second instance would start a
second 1-second accrual tick. So the hp makes one extra summary GET on mount.

## 6. The AccountSheet bank banner

Sits **directly under the profile row** (Q4 answered), tying it to the avatar the embers
flew into.

```
┌─────────────────────────────────────────┐
│ BANKED                          +🔥 12  │  ← corner chip: today's minutes (unbanked)
│ 🔥 1,284                                │  ← NET through end of yesterday
└─────────────────────────────────────────┘
```

- **Main figure = banked** = `max(0, totalMinutePoints − todayMinutes)`. Clamped because
  the template-author `−N` dev tool debits NET without lowering today's `minutesEarned`,
  so in principle NET < today; nothing a learner can do produces that.
- **Corner chip = `+🔥 today`**, `todayMinutes` from the same summary. **Not rendered** while
  `todayMinutes` is 0 (Q11b); it appears with the first minute of the day.
- Both figures come from one `fetchLanguageSummary` call made when the banner mounts. The
  sheet is mounted only while open, so every open is fresh, like its library counts and
  velocity. It does **not** call `useMinutePoints` (that would add a second accrual tick).
  The figures are a snapshot. The sheet only opens from the hp, which accrues nothing, so
  they cannot go stale while it is open.
- The banked figure only moves at the 04:00 rollover (or on a penalty).
- Caption: "Minutes banked through yesterday. Today's join at 4 AM." The chip sits on
  `COLORS.orgTint` with `fireActive` ink.

Constraints:

- Built from shelf-system primitives like the rest of the sheet — the closest existing
  shape is the `StatCard` that `VelocityStatCard` uses — carrying its own page gutter, since
  the sheet body has no side padding (see `AccountSheet`'s header comment).
- Language-scoped to `user.selectedLanguage`, like every minute figure since migration 130.
- Flame glyph via `FireCount`, `COLORS.fireActive` — the one place the app's flame orange
  is allowed. No new hex.
- Outline rule (CLAUDE.md "Buttons & cards") applies only if it is tappable.

## 7. Color & motion tokens

- Flame and embers: `COLORS.fireActive` (`#E65100`) — already the sole flame color.
- Avatar glow: a `COLORS.fireActive` halo (box-shadow at reduced alpha), decided Q8. It is
  deliberately NOT the `src/theme/lowSupplyGlow.ts` recipe — the glow must read as the
  flame's orange arriving in the avatar.
- The app has no shared motion/easing token module; keyframes are declared inline per
  component (`minutePointsFirePulse` in `MinutePointsFireBadge`). The banking keyframes
  follow that convention unless we decide to start one.

## 8. Feature-tester "always play" toggle (test tool)

Feature-tester accounts (`users.isFeatureTester`, migration 178; `isValidator` before) get a toggle in the hp header: `repeat` when off,
`repeat_on` when on. It sits in the header's `extraActions`, to the left of the flame and
off the embers' path.

While it is **on**, the banking run plays on **every** landing on Home: the provider ignores
the server's once-per-day `bankingPending`. The toggle itself never plays anything. To see
the run as a learner meets it, on page entry, leave Home and come back. A forced run still
POSTs `bankingSeen`, so after turning the toggle off, today counts as seen.

- **Storage:** localStorage key `dailyBanking.alwaysPlay`, per device, with every access
  wrapped in try/catch. It has no server state because nothing about it needs to follow
  the account.
- **Gate:** the provider honors the flag only when `user.isFeatureTester`, so a stale key on a
  shared device cannot change a learner's experience.
- **Still needs yesterday > 0.** With an empty yesterday there is nothing to drain, so
  nothing plays even with the toggle on (Q11a).

Code: `src/minutePoints/dailyBanking/BankingAlwaysPlayToggle.tsx` →
`BankingAlwaysPlayToggle`; `src/minutePoints/dailyBanking/bankingAlwaysPlay.ts` →
`readBankingAlwaysPlay`, `writeBankingAlwaysPlay`; `DailyBankingContext.tsx` →
`useDailyBankingRun` (the `forced` override).

## Question log

Answered 2026-10-10:

| # | Question | Answer |
|---|---|---|
| Q1 | Where is "already seen today" recorded? | **Server-side, once per user across devices.** |
| Q2 | Already earned today before reaching Home — drain to today's count or to 0? | **Revised 2026-10-10: always drain to 0, then count up to today's minutes** as a separate final beat (§ 3 phase 4). The first answer was "today's count". |
| Q4 | Banner placement in AccountSheet? | **Directly under the profile row.** |
| Q5 | Banner content? | **NET through yesterday** as the main figure, plus a small `+🔥 N` corner chip for today's minutes; the real total is the sum. |
| Q3 | Does a language switch replay it for the other language the same day? | **Yes** — one run per (user, language, streak day). |
| Q10 | Seen-today column shape? | **`user_languages."lastBankingShownDate" DATE NULL`** (per language). |
| Q6 | Does anything count up as embers land? | **No — only the avatar glow grows.** |
| Q8 | Avatar glow color? | **Flame orange** (`COLORS.fireActive` halo); not the `lowSupplyGlow` recipe. |
| Q9 | Plays if the learner reaches Home later in the day after other pages? | **Yes** — the first hp visit of the streak day, whenever it happens. |
| Q11a | Yesterday had 0 minutes? | **No animation**; the flame renders as normal. |
| Q7 | Honor `prefers-reduced-motion`? | **Ignored for now** — the run plays regardless; deferred. |
| Q11b | Banner's `+🔥` corner chip when nothing has been earned today? | **Not rendered** — the banner shows the banked figure alone until the first minute of the day lands. |

## Code this doc depends on

- `database/migrations/175-add-last-banking-shown-date.sql`
- `server/dal/interfaces/IUserLanguagesDAL.ts` → `LanguageProgress.lastBankingShownDate`, `markBankingShown`
- `server/dal/implementations/UserLanguagesDAL.ts` → `getProgress`, `getAllProgress`, `markBankingShown`
- `server/services/UserMinutePointsService.ts` → `getLanguageSummary`, `markBankingSeen`
- `server/controllers/UserMinutePointsController.ts` → `getSummary`, `markBankingSeen`
- `server/routes/userRoutes.ts` → `POST /api/users/minutePoints/bankingSeen`
- `server/utils/streakDate.ts` → `streakDateOf`, `addDaysToDateString`
- `src/minutePoints/minutePointsSync.ts` → `LanguageMinuteSummary`, `fetchLanguageSummary`, `markBankingSeen`
- `src/minutePoints/dailyBanking/bankingAnimation.ts` → `BANKING_ANIMATION`, `planBankingRun`, `sampleBankingRun`
- `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider`, `useBankingFrame`, `useBankingAnchorRef`
- `src/minutePoints/dailyBanking/BankingEmbers.tsx` → `BankingEmbers`
- `src/minutePoints/dailyBanking/BankingAvatarButton.tsx` → `BankingAvatarButton`
- `src/minutePoints/BankBanner.tsx` → `BankBanner`
- `src/minutePoints/dailyBanking/BankingAlwaysPlayToggle.tsx` → `BankingAlwaysPlayToggle` (§ 8)
- `src/minutePoints/dailyBanking/bankingAlwaysPlay.ts` → `readBankingAlwaysPlay`, `writeBankingAlwaysPlay` (§ 8)
- `src/minutePoints/MinutePointsFireBadge.tsx` → `MinutePointsFireBadge`
- `src/minutePoints/FireCount.tsx` → `FireCount`, `INK_TOP_PCT`, `INK_BOTTOM_PCT`
- `src/components/PageHeader.tsx` → `PageHeader` (`trailingContent`, right slot)
- `src/components/HeaderAvatarButton.tsx` → `HeaderAvatarButton` (`glowPx`, `buttonRef`)
- `src/pages/HomePage.tsx` → `HomePage`
- `src/pages/AccountSheet.tsx` → `AccountSheet`
