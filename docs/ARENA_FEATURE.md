# Arena — the global division leaderboard

A weekly, division-based leaderboard against **25 strangers** instead of against your
friends. Each week you are placed into an **arena** — a cluster of 25 players sharing a
division, a timezone and (where known) a rough geographic neighbourhood — and ranked by
the **minutes you earn while that arena is live**. Top 5 promote, bottom 5 demote.

**Status: LIVE ON PROD** since 2026-08-16 (migration 146; the `cow-arena` hourly timer is
installed and armed). Every design question in § 11 was answered before implementation began.

**The first prod week (2026-08-18) formed wrong; the fix is deployed** (2026-08-18) — see
§ 5.3 for both causes. Formation had no time gate, so it fired ~31 hours early and locked
four real users out of the week; the straggler path that should have caught them was never
wired to a caller. Both were invisible in the logs, which is why `tick()` now returns a
`stranded` count (§ 10).

No prod rows were edited by hand. The first hourly pass after the deploy repaired the week
on its own: the four locked-out users were seated into their bucket's partly-empty batch
arena via the now-wired straggler path (§ 5.3 step 1), taking synthetic seats rather than
opening a second arena, and every opted-in (user, language) pair now holds exactly one live
seat. `stranded 0`, which is the only correct value after 04:00 local.

What is NOT done: the
`src/components/leaderboard/` extraction owed to
[FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) — Arena ships with its own row component and
that shared extraction is still outstanding (§ 12).

Two things changed during implementation and are recorded where they belong rather than
here: the synthetic score curve became **monotonic by construction** (§ 6.2) after the
first implementation could tick a bot's score *downward* at a day boundary, and the cron
pass is now **resolve-then-form** (§ 10) after the original order was found to deadlock the
whole week's formation against an unresolved arena.

One change has already shipped out of this design: `user_language_points` was renamed to
**`user_languages`** (migration 145) once the division landed on it — see § 7.1.

Relationship to the two boards that already exist:

| Board | Scope | Ranked by | Where |
|---|---|---|---|
| Global leaderboard | every user | yesterday's minutes | tdp (`/tester-dashboard`) |
| Friends leaderboard | you + your friends | velocity (band-steps / 7 days) | `/friends` |
| **Arena** (this doc) | you + 24 others in your division | **minutes earned since the arena formed** | `/arena` |

---

## 1. Vocabulary

| Term | Means |
|---|---|
| **arena** | one cluster of exactly 25 members, alive for one week, pinned to one timezone and one division. **Not** pinned to a language — members may be studying different ones |
| **division** | 1–12, a rung on the ladder. Held **per (user, language)**: a learner climbs Chinese and Spanish separately |
| **member** | a **(user, language)** pair, not a user. One person studying two languages can hold two memberships in two different arenas in the same week |
| **week / arena week** | Tuesday 04:00 local → the following Tuesday 04:00 local |
| **active period** | Tuesday 04:00 → **Sunday 16:00** local. Minutes count |
| **break period** | Sunday 16:00 → Tuesday 04:00 local. Minutes do not count; opt-in for the next arena is open |
| **synthetic member** | a padding entry that fills an arena below 25. Not a user account |
| **arena score** | minutes earned by a member during that arena's active period |

---

## 2. Surfaces

One new hub row and one new page, both following the existing Node drill-in archetype
([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md), [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md)).

| Route | Component | What it is |
|---|---|---|
| `/arena` | `src/features/arena/ArenaPage.tsx` | The board. `chrome: "node"`, `footerTab: "home"`, back-arrow → `/` |

The hp gains an **Arena** row beside **Friends** (`src/pages/HomePage.tsx`), with its own
persistent pastel colour and a `MilitaryTechIcon`/`EmojiEventsIcon`. It sits directly
under Friends because the two are the same kind of thing — a ranking of people — and
Arena is the one that changes weekly, so it earns the higher slot of the pair.

### 2.1 The board looks like the friends leaderboard

Deliberately the same visual grammar, because it is the same primitive: ranked rows of
people with one big number each. `FriendPersonRow` and `friendStyles.ts` are **promoted
out of `src/features/friends/` into a shared location** rather than copied — a second
divergent copy of the podium chip and the self-row border is exactly the duplication the
code-quality rules call out. Proposed home: `src/components/leaderboard/`
(`LeaderboardPersonRow.tsx`, `leaderboardStyles.ts`), with `friends/` importing from
there. See § 9 for the layering note.

```
 ┌──────────────────────────────────────────────┐
 │  🇨🇳 CHINESE · IRIDIUM      ends Sun 4:00 PM  │   ← header: language + division (§ 7.0) + countdown
 ├──────────────────────────────────────────────┤
 │ [1] (av)  Priya          🇪🇸 ES        6h 52m │   ← ▲ promotion zone (top 5)
 │ [2] (av)  Wen            🇨🇳 ZH        6h 28m │
 │ ─────────────────────────────────── ▲ ────── │
 │ ...                                          │
 │ [9] (av)  You (you)      🇨🇳 ZH        2h 21m │   ← highlighted self row
 │ ...                                          │
 │ ─────────────────────────────────── ▼ ────── │
 │ [21](av)  Marco          🇪🇸 ES           12m │   ← ▼ relegation zone (bottom 5)
 └──────────────────────────────────────────────┘
```

Differences from `/friends`, all of them additive:

* **The ranked number is a duration, not a count.** Arena score is minutes of study, so
  it renders through the shared `src/utils/formatDuration.ts` (`weeks: false` — an arena
  never spans a week) exactly as the friends subtitle does. "6h 52m" sizes up at a
  glance; "412" does not.
* **Promotion / relegation zones are drawn, not explained.** A divider line after rank 5
  and before rank 21, with a small ▲/▼ label. No legend, no tooltip — the position of
  the line is the explanation.
* **The language badge stays.** An arena is **not** language-scoped (§ 5), so the 25
  members may be studying different languages, each scored in **their own** — exactly the
  friends board's rule and for exactly the same reason. So each row carries the same
  flag + region-code badge ("🇪🇸 ES"), built from `LANGUAGE_FLAGS` +
  `languageRegionCode()` so the letters can never disagree with the flag, and degrading
  to "ES ES" on Windows rather than to nothing.
* **The header carries the division and a countdown** to the next boundary: to Sunday
  16:00 while active, to Tuesday 04:00 while on break.
* **Ranking is the server's.** The client never re-sorts. Same rule as `/friends`.
* **A row shows name, avatar, language badge and score — and nothing else.** Settled as
  **Q20**, and it is a privacy rule rather than a layout preference: `/friends` can show a
  streak because both parties opted into seeing each other, whereas an arena puts you in
  front of 24 strangers you did not choose and cannot leave. A streak in particular would
  expose each player's daily routine — including the day they broke it — to people with no
  relationship to them. Anything added to this row in future is a disclosure decision, not
  a design one, and belongs back in the question log.

### 2.2 The page shows your ACTIVE language's arena

Because divisions and memberships are per-(user, language) (§ 7.1), a learner studying
both Chinese and Spanish holds **two** arena standings. `/arena` shows the one for their
**currently selected language**, and switching language switches the board — the same
per-language partitioning decks, minute points (migration 130) and the whole vet layer
already use, so it is consistent rather than special-cased.

The header therefore leads with the language ("🇨🇳 Chinese · Iridium"), or the user
will read a Spanish division number as their Chinese one. There is no combined
"all my arenas" view — **settled as Q17**: a two-language learner switches language to
check their other race, the same as everywhere else in the app.

### 2.3 The four states of `/arena`

The page is a state machine over "do you have an arena **in this language**, and is it
live":

| State | When | What renders |
|---|---|---|
| **Active** | you are in a live arena | the board, live scores, countdown to Sunday 16:00 |
| **Results** | your arena has closed, break period | the final board frozen, your promotion/demotion banner, **Join next week's arena** button |
| **Waiting** | opted in, arena not yet formed (i.e. it is between your opt-in and Tuesday 04:00) | "You're in — your arena opens Tuesday at 4 AM", with your division |
| **Out** | not opted in and not in an arena | your division, an explanation of the ladder, and **Join** — offered whether or not the break is open (§ 8) |

There is no fifth "you missed it" state — a player who did not opt in before Tuesday
04:00 simply sits in **Out** until the next break period opens, with copy that says when
that is. Their division is untouched.

---

## 3. The weekly cycle

Every boundary is **local**, derived from `users.timezone` (migration 50) — the same
derivation the streak cron, the AI usage counter (migration 100) and the community vote
week (migration 86) already use.

```
 Tue 04:00        Tue → Sun                    Sun 16:00         Sun 16:00 → Tue 04:00
 ──────────────────────────────────────────────────────────────────────────────────────
 arenas form      ACTIVE PERIOD                arenas close      BREAK PERIOD
 members frozen   minutes count toward         promote top 5     opt in for next week
                  the arena score              demote bottom 5   scores frozen, board readable
```

### Sunday 16:00 — deliberately NOT the app's 04:00 convention (settled)

Every other boundary in this app is **04:00 local** — the streak day, the community vote
week, the challenge windows. **Sunday 16:00 is the first 16:00 boundary in the codebase**,
and it is a deliberate exception, not an oversight.

> **The reason: nobody should be fighting for a placement at 4 in the morning.**

That is the whole argument and it is decisive. A close is a **contested instant** in a way
that a streak rollover never is — the streak's 04:00 boundary is generous precisely
because it is designed for *nobody to be awake at it*, so a late-night session still
counts for the day it felt like. An arena close is the opposite: the last five minutes
before it are the most competitive of the week, because that is when a rank 5/6 or 20/21
boundary is decided. Putting that moment at 04:00 would reward whoever is willing to set
an alarm, and would punish the honest sleeper with a demotion decided while they were in
bed. **16:00 on a Sunday is an hour people are awake, free, and can actually choose to
play.**

The 36-hour break falling across Sunday evening and Monday is a second benefit: the week's
most valuable study slot for most people is not spent on a leaderboard sprint.

The cost is real and must be carried in the implementation:

* `shared/streakDay.ts` cannot be reused as-is — its 4-AM shift is baked in. Arena needs
  its own boundary helper, or `streakDay` gains an hour parameter.
* A day of arena scoring is **not** a streak day. Sunday's arena scoring stops at 16:00
  but Sunday's *streak* day runs to Monday 04:00, so minutes earned Sunday evening count
  for the streak and not for the arena. That is a real, user-visible split and the copy
  must be explicit ("scoring ends Sunday 4 PM"), never "Sunday".
* The countdown in the board header is the main defence against surprise, so it must be
  visible whenever the board is — not only in the final hours.

Note the **open** boundary stays at 04:00 (Tuesday), because opening is not contested:
nobody needs to be awake for it, and it inherits the app-wide convention for free.

### Membership is frozen at formation

An arena's 25 members are chosen once, before Tuesday 04:00, and **never change** after it
goes live. Nobody is removed, and a user who deletes their account leaves a tombstone row
rather than shrinking the board. A leaderboard whose denominator moves is not a
competition. (The one qualification: stragglers who opt in during the final hour before
04:00 are still placed — see § 5.3. Membership is frozen at 04:00, not at the snapshot.)

### Timezone is the arena's, not the member's

Every member shares the arena's timezone **at formation** — it is a hard clustering
partition (§ 5), not a coincidence of geography. The arena stores that timezone and closes
on it.

If a member travels mid-week, **their arena's clock does not follow them.** All 25 members
close at the same instant, which is the only way "the bottom 5" is a well-defined set.
Their streak clock still follows them; the two are independent, and that is fine.
Accounting for the difference is the user's job — but the app must not make them do it
blind:

> **Display rule.** Whenever the arena's timezone differs from the user's current
> `users.timezone`, the countdown and the close time are labelled with **the arena's**
> timezone. When they agree, no label is shown — an unqualified time is correct and a
> redundant timezone tag is noise.

This is the same principle as the countdown itself: a contested deadline must never be
something a user has to infer.

---

## 4. Scoring

**Arena score = minutes earned during the arena's active period.**

Three decisions inside that sentence:

1. **Gross, not net.** Penalties from the inactivity cron
   ([STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)) do **not** debit an arena
   score. The arena measures what you did this week; a penalty is a debit against a
   wallet for what you didn't do in an earlier one. Mixing them would let a player's
   arena rank fall while they were studying. This makes arena score behave like
   `lifetimeMinutesEarned` (monotonic) rather than `totalMinutePoints` (net).
2. **Scored in the member's own language, not summed across languages.** A membership is
   a (user, language) pair, so only minutes earned in *that* language count toward *that*
   arena. This is the same rule the friends leaderboard applies, and it is what makes a
   multi-language arena fair: everyone on the board is being measured on one track, their
   own.

   The consequence to hold onto: a learner splitting time between two languages is
   **genuinely at a disadvantage in both arenas** compared to a single-language learner
   with the same total study time. That is the accepted cost of "climb the divisions for
   each language you're learning" — the ladder measures progress in a language, not hours
   in the app. The global leaderboard on the tdp remains the place where all your study
   counts at once.
3. **Zero at formation.** Every member starts at 0 on Tuesday 04:00. Nothing carries over.

### 4.1 Why a stored counter, not a SUM over `userminutepoints`

`userminutepoints` is keyed **(userId, streakDate, language)** — one row per *day*. The
active period ends **mid-day** (Sunday 16:00), so no query over that table can express
the window exactly: Sunday's row contains both in-window and out-of-window minutes.

Therefore the arena score is a **counter incremented at credit time**:

> `arena_members."minutesEarned"` is incremented in the **same code path and the same
> transaction** that credits minute points, whenever the crediting **(user, language)**
> has a live arena membership whose window contains `now()`.

That path is the minute-points sync ([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)),
which is **already per-language** (migration 130, and `userminutepoints.language` since
migration 62) — so the credit call carries the language it needs and lands on exactly one
membership row. Per-language divisions fit this path better than a global score would
have: a global score would have had to fan one credit into a language-blind counter.

Consequences worth stating before anyone builds it:

* **The window check happens at write time**, so a late-arriving sync for minutes earned
  before Sunday 16:00 but delivered after it is **not** counted. Accepted: the alternative
  (trusting a client-supplied timestamp) is worse, and the app syncs continuously.
* It makes the sync path depend on the arena domain. Keep the dependency one-way —
  `MinutePointsService` calls into `ArenaService.creditMinutes(userId, language, minutes)`,
  which is a no-op when there is no live membership, and **never** the reverse.
* It is the only reason the board can be read with a single indexed query on
  `arena_members` rather than a grouped scan of the minute table per render.

### 4.2 Ties

Ties break on **earliest `updatedAt`** — whoever reached that total first is ahead. This
makes the ordering total and stable, so a promotion never hinges on the order the
database happened to return rows in. Two members on 0 minutes tie-break on member id.

---

## 5. Clustering — how the 25 are chosen

Runs **shortly before** Tuesday 04:00, **for one timezone at a time**, from an hourly cron
(same shape and same host as the existing penalty cron — prod only). The lead time is not
cosmetic: arenas must already exist at 04:00 because that is when minutes begin counting
toward them (§ 5.3).

Candidates for a run = every **(user, language)** pair that (a) has **opted in** for this
week, (b) whose user has `users.timezone` = the timezone being formed, grouped by (c) that
pair's current `division`. Each **(timezone, division)** pair is clustered independently.

**Timezone is a hard partition, not a preference.** Every member of an arena shares one
`users.timezone` as of formation, which is what lets the arena have a single unambiguous
close instant (§ 3). Geography is optimized *within* a timezone bucket, never across one.
A user whose timezone changes after formation stays in their arena and races to the
arena's clock — see § 3.

### 5.0 Language does NOT partition a cluster

**Clusters are multi-language by design.** Division 7 in `Europe/Madrid` is one candidate
pool whether its members are studying Chinese or Spanish; only the *score* is
language-scoped (§ 4). Two reasons this is the right call and not merely the cheap one:

* **It keeps the buckets full.** Partitioning by language would give 12 divisions ×
  N languages × M timezones, and every extra dimension is paid for in synthetic padding
  (§ 6). Language is the one dimension that can be dropped without making the ranking
  unfair, because everyone is measured in minutes.
* **Minutes are commensurable across languages.** A minute of Spanish study and a minute
  of Chinese study are the same unit — unlike, say, mastery bands, which are not. There is
  nothing to normalise.

The visible consequence is the badge on every row (§ 2.1): you can see that the person
beating you is doing it in a different language. That reads as variety, not as unfairness,
and it is the same thing `/friends` already shows.

One thing this makes possible and which is **not** allowed: the same human appearing twice
on one board, once as their Chinese self and once as their Spanish self. **Settled as Q18 —
forbidden.** A person may hold a membership per language and race on several boards at
once, but never twice on the same one; two rows with one face reads as a bug even when it
is honestly badged. This is a **formation-time constraint**, not a model change, and it is
enforced by the duplicate-human pass in § 5.1 — which matters more than it sounds, because
both memberships share a `geoCell` and would otherwise sort adjacent and land in the same
chunk nearly every time.

### 5.1 The algorithm — sort by locality, cut every 25

Within one **(timezone, division)** candidate set, clustering is a **sort and a chunk**:

```sql
SELECT "userId", language
FROM   candidates
ORDER  BY "geoCell", "userId";     -- geohash string == locality-preserving sort key
-- then: cut the ordered list into consecutive runs of 25
```

That is the whole algorithm. It is deliberately **approximate** — it does not find the
optimal partition and is not trying to. The objective is a *generically low* average
intra-cluster distance at near-zero cost, and a geohash sort delivers that because a
geohash is a **space-filling curve**: it interleaves latitude and longitude bits, so
strings that share a prefix are neighbours on the ground. Sorting by it lays the map out
in 1D with locality mostly intact, and consecutive runs of 25 are therefore geographically
tight runs of 25.

| | |
|---|---|
| **Cost** | one `ORDER BY` — O(n log n), no iteration, no convergence, no seeded RNG |
| **Quality** | within a few percent of a capacity-constrained k-means on real population distributions |
| **Failure mode** | **seams.** Where the curve jumps (a geohash prefix boundary can put two adjacent towns far apart in sort order) one arena in a bucket is more scattered than it should be. Rare, self-correcting the following week, and invisible to a user who cannot see anyone's location anyway |
| **Determinism** | total. Same candidates → same arenas. Re-runnable, diffable, debuggable by eye |

Rejected: **capacity-constrained k-means** (tighter pods, but an iterative solver plus a
non-obvious exactly-25 repair step, and it needs a seeded RNG to keep formation
reproducible) and **greedy nearest-neighbour accretion** (excellent early clusters,
but the last clusters are whatever scattered stragglers remain — bad pods exactly where
you least want them).

#### Affinity is emergent, not implemented

The earlier draft had "keep last week's arena together" as an explicit first step. **It is
gone, and nothing was lost.** A user's `geoCell` does not change week to week, so the same
people sort into the same order and fall into the same chunks. Recurring rivalry comes out
of the sort for free. Chunk boundaries do shift as the opt-in set changes — someone joining
upstream in the sort shifts everyone downstream by one seat — so the cast rotates at the
edges rather than being frozen. That is a better outcome than a hard affinity rule, which
would have needed its own group-merge logic and could pin two people together for months.

**This stability is wanted, not tolerated (Q24).** A recurring cast is what turns a
leaderboard into a rivalry, and it is good for variety only in the weak sense that the
edges rotate. The alternative — mixing a week-derived salt into the sort key — was
considered and **rejected**: it would guarantee a fresh board every week and destroy the
affinity property in the same stroke, so you would never see the same rival twice.

⚠️ Still worth watching after launch: a player who is durably 11th of the same 25 sees a
board that never moves. If that proves stale, the salt is a one-line change to the sort key
with no schema impact, so nothing about this decision is expensive to revisit.

#### The duplicate-human pass (Q18)

Two memberships of the **same human** (their Chinese self and their Spanish self) carry the
**same `geoCell`**, so they sort adjacent and would land in the same chunk nearly every
time. Since a person must not appear twice on one board, a post-pass walks each chunk,
detects a repeated `userId`, and **swaps one of the two across the nearest chunk boundary**
with a member of comparable position. O(n) and geographically near-free, because the
swapped-with member is a sort neighbour by construction.

### 5.2 Location

**No location column exists on `users` today.** This feature needs one:

> **Proposed:** `users."geoCell" varchar(5) NULL` — a **geohash truncated to 5 characters**
> (a cell roughly 5 km × 5 km), nullable, defaulting to NULL (= not shared).

Why a geohash cell rather than a country code or a coordinate pair:

* **It is an identifier, not a position.** `gcpvj` cannot locate a home or a workplace; it
  names a 5 km tile. If the column leaks it says "somewhere in west London", which is the
  most a clustering input should ever be able to say.
* **It is already the sort key.** Storing the cell means § 5.1 is `ORDER BY "geoCell"`
  with no distance maths, no trigonometry and no coordinate columns anywhere in the
  schema. The storage format and the algorithm are the same object.
* **5 characters matches what the OS actually hands us.** iOS approximate location and
  Android `ACCESS_COARSE_LOCATION` both return something on the order of a few kilometres.
  Storing finer than the platform gives would be storing noise, and storing coarser would
  throw away resolution we were freely given.
* **Country was rejected** (it was the earlier draft). A country is not a proximity
  measure: it puts Vancouver with Halifax and separates Detroit from Windsor. Clustering
  wants "near each other", and a country code cannot express it.

Rules:

* **Opt-in.** NULL is a normal, permanent, fully supported state.
* **Never displayed.** The cell is a clustering input, not a profile field. No flag, no
  place name on the board, no "players near you" copy. Displaying it would turn an opt-in
  convenience into a disclosure the user did not agree to.
* **Never used for anything else.** If a second feature wants location, that is a new
  consent conversation, not a free ride on this column.

#### How it is obtained — the iOS pattern, and what this app can actually do

A native iOS app asks **CoreLocation**, which shows the system permission sheet
("Allow While Using App" / "Allow Once" / "Don't Allow") with a developer-written purpose
string from `Info.plist`. Since iOS 14 the sheet also carries a **Precise Location**
toggle, and an app that only needs a rough area requests **reduced accuracy** — the OS then
hands back a location good to roughly a few kilometres. Android's equivalent is requesting
`ACCESS_COARSE_LOCATION` instead of `ACCESS_FINE_LOCATION`, which the system grants with a
visibly weaker prompt. Both platforms have a first-class "roughly where you are" mode, and
that mode is exactly what Arena wants.

**This app is not native today.** It is a Vite/React web app served through nginx — there
is no Capacitor, Cordova, React Native or Electron wrapper in the repo. The web equivalent
is the **Geolocation API**:

```ts
navigator.geolocation.getCurrentPosition(onOk, onDenied, { enableHighAccuracy: false });
```

which triggers the browser's own permission prompt — on iOS Safari, backed by the same
CoreLocation grant and honouring the same Settings toggle; on Android Chrome, backed by the
same coarse/fine distinction. `enableHighAccuracy: false` is the web's reduced-accuracy
request and is the correct one here: Arena needs a tile, not a street.

The flow, mirroring the native one:

1. **Ask in context, not at startup.** The prompt fires when the user taps **Join next
   week's arena**, behind our own explanatory sheet ("We use your rough area only to group
   you with nearby players. We never show it to anyone.") — the web has no `Info.plist`
   purpose string, so that sentence is our substitute and it must appear *before* the
   browser prompt. A permission asked cold on first load is the one users deny.
2. **Truncate on the device.** Take the returned lat/long, compute the geohash, **cut it to
   5 characters, and send only those 5 characters.** The coordinates are never transmitted
   and never stored. This is why the client-side-versus-server-side question (old Q4b) has
   no server-side branch left to consider: geohashing is ~20 lines of bit-interleaving with
   no lookup table, so there was never a reason to ship coordinates anywhere.
3. **Denial is a first-class outcome, not an error.** `geoCell` stays NULL, the user joins
   the location-less pool (§ 5.2a), and they are never asked again in that session. Never
   re-prompt on a later join — a repeated permission sheet is the fastest way to a
   permanent browser-level block.
4. **A visible off switch** in Account settings that clears `geoCell`, because a permission
   the app remembers must be revocable inside the app and not only in OS settings.

#### Would Capacitor help?

**Yes, but it is an improvement, not an unblock** — and per Q4c the decision is **recorded,
not acted on**. `@capacitor/geolocation` calls the platform APIs directly, which buys four
things the web path cannot have:

| | Web (`navigator.geolocation`) | Capacitor (`@capacitor/geolocation`) |
|---|---|---|
| Purpose string | none — we write our own pre-sheet and hope it is read | the real `NSLocationWhenInUseUsageDescription`, shown **inside** the system prompt |
| Accuracy control | `enableHighAccuracy: false` (a hint) | explicit reduced-accuracy authorization; `ACCESS_COARSE_LOCATION` on Android |
| Denial recovery | permanently blocked at the browser level; we cannot re-prompt or deep-link to settings | can open the app's Settings pane so a user who changes their mind has a path back |
| Where it works | Safari/Chrome, HTTPS only; a Home-Screen PWA has its own quirks | anywhere the app is installed |

The gap that actually matters is the **purpose string**. On the web, our explanation lives
in a sheet *we* render before the browser's own prompt — two dialogs in a row, the second
of which says only "wants to use your location". Native shows one dialog, carrying our
sentence. For a permission whose entire justification is "we only want a rough tile and we
will never show it", collapsing that into the system prompt is a real difference in how
many people say yes.

None of this blocks Arena: the web path works and denial is already a first-class outcome.
It is one more entry on the ledger for
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md)'s standing recommendation —
*"ship Capacitor if native packaging is wanted"* — and notably it is a capability
**Capacitor supplies**, so it argues for Capacitor rather than for React Native.

⚠️ **What we should NOT do:** silently infer location from
`Intl.DateTimeFormat().resolvedOptions().timeZone` (which we already collect for streaks).
It would work, cost nothing and prompt nobody — and that is exactly the objection. Storing
a location field the user never agreed to give, derived from data collected for an
unrelated purpose, is the kind of thing that is defensible right up until someone reads the
schema. **Settled as Q4a: the real prompt, not the free inference.**

### 5.2a The location-less pool

`geoCell IS NULL` sorts as its own group. Location-less candidates are clustered **with
each other**, in `userId` order, and are not mixed into a located arena unless the bucket
runs out of candidates to fill a chunk. "Unknown" is treated as a coherent group rather
than a wildcard — mixing a location-less user into an otherwise tight regional pod makes
that pod worse and gains the user nothing.

Because a NULL cell sorts before or after every real cell depending on the collation, the
formation query must partition on `"geoCell" IS NULL` **explicitly** rather than relying on
NULL ordering. That is an easy bug and worth a comment in the DAL.

### 5.3 Timing — the algorithm runs *before* the boundary

Arenas must **exist at 04:00**, because 04:00 is when minutes start counting toward them
(§ 4). A clustering run that starts at 04:00 would leave a gap in which credited minutes
have no membership to land on. So:

```
03:00  SNAPSHOT — candidate set frozen, sort-and-chunk runs, arenas written
       ↓ (stragglers may still opt in during this hour)
04:00  ARENAS GO LIVE — minutes begin counting
```

The one-hour lead is a **budget, not a measurement** — the sort is fast enough that it
could run at 03:55, and the margin exists so a slow run or a retry cannot miss the
boundary.

#### ⚠️ Forming EARLY is a lockout, not a harmless head start

Running the snapshot before 03:00 is not "the same thing, sooner". Formation is what makes
`arenaExistsForBucket` true, and that flag closes the bucket to **every subsequent opt-in of
the break**. A bucket formed on Sunday evening therefore contains whoever happened to have
joined by Sunday evening, and everyone who joins across the remaining ~31 hours is skipped —
with no error, because a skipped bucket and a quiet hour both log `formed 0`.

**This happened on prod, 2026-08-17.** `arenaFormationAt()` was written, exported, and never
called by anything: `formArenas` had no time gate at all, so it fired on the first hourly
tick that saw any candidate — 21:06 local Sunday. The `America/Los_Angeles` division-1 bucket
froze around 55 seeded test accounts, and the four real users who opted in later that break
spent the week in no arena at all.

The gate is now the first thing `formArenas` does per bucket
(`server/services/ArenaService.ts` → `formArenas`, against
`server/shared/arenaWeek.ts` → `arenaFormationAt`), and the regression is pinned at the exact
instant it occurred in `server/__tests__/arenaFormation.test.ts`.

#### A candidate's week key is read in the CANDIDATE's timezone

`user_languages."arenaOptInWeek"` is written by `ArenaService.optIn` as the Tuesday date **in
the opting user's zone**, so it is only meaningful against a week start computed in that same
zone. Formation therefore lists *all* opt-ins (`ArenaDAL.listUnseatedCandidates`) and matches
each one against `arenaWeekKey(weekStart, bucket.timezone)` inside the bucket loop, rather
than filtering by one server-side "current week" in SQL. The earlier shape asked the DAL for
`nextArenaWeekKey(now, 'UTC')` — a single UTC key applied to every bucket, which is wrong for
any zone far enough from UTC to be in a different arena week at the same instant, and which
additionally goes stale the moment 04:00 passes, hiding exactly the stragglers the next tick
is supposed to seat.

#### Stragglers — naive placement, still a full 04:00 contract

Anyone who opts in **between the snapshot and 04:00** is legal and gets a live arena at
04:00 like everyone else. What they do not get is a re-run of the algorithm — re-clustering
the whole bucket for one late arrival is not worth it. They are placed **naively**, in this
order:

1. **Into the bucket's last, partly-empty arena**, at the seat a bot would otherwise take.
   A real player is always better than a synthetic one, and this costs nothing.
   (`ArenaDAL.findArenaWithFreeSeat` picks it — newest arena of the bucket first, because
   chunking fills each arena to 25 before opening the next (§ 5.4), so the newest one *is*
   the remainder — then `ArenaDAL.replaceSyntheticWithHuman` takes the chair.)
2. **If no partial arena exists**, stragglers accumulate and are chunked among themselves
   by `geoCell` — the same sort, just over a much smaller set, so it is naive only in the
   sense that it cannot see the already-placed candidates.
3. **Padded with synthetic members** to 25, exactly like a batch arena (§ 6).

**There is no separate straggler entry point.** Whether a bucket gets the batch path or the
straggler path is decided *per bucket*, inside `formArenas`, from whether its arenas already
exist — because no caller could know: one tick is routinely the batch run for one timezone
and the straggler run for another in the same second. `formArenas` consequently takes no
`kind` argument; `formationKind` is derived.

⚠️ **The straggler path must only ever see UNSEATED candidates.** `createArenaWithMembers`
inserts all 25 members in one statement with no `ON CONFLICT`, so a single candidate who
already holds a live seat violates `uq_arena_member_live` and fails the **whole arena**. That
filter is `NOT EXISTS` inside `ArenaDAL.listUnseatedCandidates`, mirroring the unique index
column-for-column, rather than a check in the service — a candidate that survives the query
cannot collide on insert.

The straggler path was **written and then never wired up** (found 2026-08-17):
`ArenaService.placeStraggler` and `ArenaDAL.replaceSyntheticWithHuman` had no callers, and
`formArenas(now, 'straggler')` was never invoked, so late opt-ins had nothing to catch them.
`placeStraggler` has since been deleted — its logic lives in the bucket loop, where the
timezone, division and week start are already in hand.

So a bucket generally ends with **two** partly-synthetic arenas rather than one: the batch
remainder and the straggler remainder. That is accepted — the alternative is holding
stragglers out of the week entirely, and a user who opts in at 03:30 and is told "come back
next Tuesday" has been punished for being awake.

⚠️ Straggler placement is geographically worse than batch placement, by construction. This
is invisible to users (nobody can see anyone's location) but it does mean the average
intra-cluster distance reported by any future diagnostic will be dragged up by these
arenas. Measure batch and straggler arenas separately or the number is misleading.

### 5.4 Remainder handling

A (timezone, division) with, say, 32 candidates yields **two** arenas of 25 — one full of
humans, one with 7 humans and 18 synthetic members — not one of 25 and one of 7, and not
one oversized arena of 32. Splitting evenly (16/16 + padding) is the alternative and is
**rejected**: it doubles the number of bot-heavy boards. The rule is **fill each arena to
25 with humans before opening the next one**, so bots concentrate in the last arena of
each bucket.

---

## 6. Synthetic members

An arena below 25 humans is padded. Without padding, a 3-person arena makes "top 5" and
"bottom 5" overlap and the ladder collapses.

### 6.1 They are not user accounts

> **Proposed:** synthetic members are rows in `arena_members` with `"userId" IS NULL` and
> a `"syntheticName"` / `"syntheticAvatarIconId"` pair, **not** rows in `users`.

This is the important structural decision. Putting bots in `users` would mean every query
in the app that reads users — the global leaderboard, friend search, admin counts,
validator lists, analytics — needs a new `AND NOT "isSynthetic"` clause, forever, and the
first one anybody forgets ships a bot to a real surface. Keeping them inside
`arena_members` confines the concept to one table.

The cost: `arena_members."userId"` becomes nullable, so every join to `users` from that
table is a LEFT JOIN, and reads must handle a null user. That cost is local and visible.

### 6.2 Their scores

A wall of zeros is worse than no padding at all. Each synthetic member gets a **target
score and a pacing curve**, seeded at formation, and its displayed score is
**computed on read** as a deterministic function of elapsed active-period time — no cron,
no writes, no drift.

* The target is drawn from the **distribution of real scores in that division** from
  recent closed arenas, so a division-11 bot is not lazier than a division-2 human. Until
  there is history to draw from, fall back to a hardcoded per-division band.
* The curve is monotonic and slightly irregular (a stepped curve, not a straight line),
  because a perfectly linear climb is obviously mechanical when watched for a day.
* Determinism matters: the same bot must show the same number to every viewer at the same
  instant, and must never go down. `seed` is stored on the row; the curve is pure.

> **Implementation note — monotonic BY CONSTRUCTION.** The first implementation built the
> curve as a smooth base with a signed "wobble" added per day. It was wrong: the wobble was
> redrawn at each day boundary, so a day whose noise came in lower than its predecessor's
> stepped the displayed score **down** — the single most obvious tell that a member is fake.
> A guard that clamped against the previous value only hid it *between* boundaries. The
> shipped curve is a cumulative sum of strictly positive per-segment effort weights,
> normalised to land exactly on target, so a dip is impossible rather than patched.
> `server/services/arenaSynthetic.ts` → `syntheticScoreAt`; the property is asserted across
> 50 seeds × 500 samples.

### 6.3 They occupy real ranks

A synthetic member in the top 5 **consumes a promotion slot**. Promotion is "the top 5
rows of the board", full stop.

The alternative — promote the top 5 *humans* — was considered and rejected: it makes the
displayed rank a lie (you are 6th but you promoted), and it means a bot-heavy arena is a
free ride, which is exactly the arena a struggling player is most likely to be in.
Honest ranks are worth more than a slightly kinder ladder. **This is Q5** — it is the
decision most likely to be reversed after seeing real boards.

Synthetic members are of course never promoted or demoted; they simply cease to exist
when the arena closes.

---

## 7. Divisions, promotion and demotion

12 divisions. **Division 1 is the entry rung; division 12 is the top.** "Promoted to the
next division" = `division + 1`.

| Placement | Effect |
|---|---|
| ranks 1–5 | `division = LEAST(division + 1, 12)` |
| ranks 6–20 | unchanged |
| ranks 21–25 | `division = GREATEST(division - 1, 1)` |

The write targets the **(user, language)** row the membership belongs to, so a Spanish
arena result never moves a Chinese division.

* **Both ends are floors, not wraps.** Top 5 of division 12 stay in division 12; bottom 5
  of division 1 stay in division 1. The results banner must say so explicitly, or a
  division-1 player who finished 24th will believe the ladder is broken.
* Applied **at the arena's close instant** (Sunday 16:00 in the arena's timezone), not at
  the next formation, so the break-period Results screen can show the player their new
  division as an outcome rather than a promise.
* A player who never opts in **keeps their division indefinitely** — **settled as Q6:
  there is no decay.** Not opting in is a pause, never a loss, and a division is a
  permanent record of the hardest bracket you have held. Two consequences accepted
  knowingly: the top divisions slowly accumulate dormant holders, and someone returning
  after months re-enters at a rung well above their current pace. Both are the price of a
  ladder that never punishes a holiday.
* **There is no reward for promotion — settled as Q19.** The division number and the board
  are the whole prize. This is not an oversight to be fixed later: any payout (minute
  points, a night-market unlock) is farmable by players who agree to sit out and hand each
  other a cluster, and status is the one prize collusion cannot manufacture.
* **A new (user, language) pair starts at division 1.**

### 7.0 Division names

The rungs are **named** in the UI; the number is the storage and wire format, and it
appears only as the small "Division N of 12" subtitle under the name. A learner cannot
tell whether "Division 7" is good, but can tell that Platinum is above Gold.

| # | Name | # | Name |
|---|---|---|---|
| 1 | Slate | 7 | Iridium |
| 2 | Bronze | 8 | Obsidian |
| 3 | Silver | 9 | Titanium |
| 4 | Gold | 10 | Jade |
| 5 | Steel | 11 | Diamond |
| 6 | Platinum | 12 | Legendary |

The ladder is a **materials** progression — soft stone → the three medals → rare and
engineered metals → gems → the unnamed top rung.

* **Code**: `src/features/arena/arenaStyles.ts` → `DIVISION_NAMES`, `DIVISION_COLORS`,
  `divisionName`, `divisionColor`, `divisionTextColor`. Consumed by
  `src/features/arena/ArenaPage.tsx` → `DivisionHeader`.
* Both arrays are index-aligned and 0-based (`division - 1`); the two lookup helpers clamp,
  so a division outside 1–12 renders the nearest rung rather than crashing the page.
* `DIVISION_COLORS` is drawn entirely from existing `src/theme/colors` tokens — no arena
  palette. Two rungs (Iridium, Obsidian) are dark enough that the default dark body text
  fails on them, so **any surface tinted with `divisionColor` must take its foreground from
  `divisionTextColor`**, never from `COLORS.onSurface` directly.

### 7.1 Where the division lives — `user_languages`, not `users`

> **Proposed:** `user_languages.division smallint NOT NULL DEFAULT 1`.

A learner climbs the ladder **once per language they study**. Chinese division 9 and
Spanish division 2 is a normal, expected state.

#### Why not on `users`?

The brief said "divisions are stored on the user table", and that was right when a user
had **one** division. Once a user has one division **per language**, `users` can only hold
them in one of three shapes, and the third is the one we already built:

| Shape | Problem |
|---|---|
| `users."zhDivision"`, `users."esDivision"`, … | A **column per language**. Every new language is a migration, every query naming a language is a `CASE`, and [ADDING_NEW_LANGUAGE_GUIDE.md](./ADDING_NEW_LANGUAGE_GUIDE.md) grows a schema step. This is the shape the codebase has rejected everywhere else |
| `users.divisions jsonb` = `{"zh":9,"es":2}` | One column, but it is **not a scalar the database can act on**. The resolution cron's `division = LEAST(division + 1, 12)` becomes a `jsonb_set` with a cast; the formation cron's "everyone in division 7" becomes an unindexable expression scan; and nothing stops a typo'd key. jsonb is right for shapes we only ever read whole (`typedMarkHistory`, `iconLayout`), wrong for a value we sort, filter and increment |
| **A row per (user, language)** | ✅ — and that table already exists |

`user_languages` (PK `("userId", language)`, migration 130) **is** "the user table,
for one language". It already holds `totalMinutePoints`, `currentStreak`, `lastStreakDate`
and `lastPenaltyDate` — and it holds them precisely because migration 130 **took those
four columns off `users`** for this exact reason. Putting `division` on `users` would
re-create, one column at a time, the thing that migration deleted.

The practical payoff is that every arena query is a plain scalar predicate on an indexable
column:

```sql
-- formation candidates
SELECT "userId", language FROM user_languages
WHERE division = $1 AND "arenaOptInWeek" = $2;

-- resolution
UPDATE user_languages SET division = LEAST(division + 1, 12)
WHERE ("userId", language) IN (...);
```

Neither is expressible cleanly against a jsonb map or a column-per-language table.

**Mental model:** think of `user_languages` as *the user table* — it is just the
half of it that varies by language. Nothing about the division is per-account; it is
per-track, the same as the streak sitting next to it.

Three things fall out of this choice:

* **A row must exist to hold a division.** `user_languages` rows are created when a
  language is first studied, so a user who has never studied Spanish has no Spanish
  division — correctly, since they cannot opt into a Spanish arena either. Read it as
  `COALESCE(division, 1)` and never assume the row is there.
* **The default is 1 for a new language**, so a division-11 Chinese learner starting
  Spanish starts Spanish at the bottom. That is the intent.
* **Clusters stay language-blind** (§ 5.0), so per-language divisions cost **nothing** in
  bucket dilution — the bucket count is still 12 × timezones. This is what makes the
  choice cheap; had clusters been partitioned by language too, it would have doubled the
  synthetic padding.

---

## 8. Opting in

Opt-in applies to exactly one upcoming arena — **next** week's — and **the gate is a seat,
not the clock**: anyone who is not in this week's live arena may enrol at any time,
including while that arena is running.

| Caller | Result |
|---|---|
| No live seat, any day, any hour | enrolled in next week's arena |
| Already in a live arena | 400, *"You're already in this week's arena; you can join the next one once it closes."* |

It was originally the break period (Sunday 16:00 → Tuesday 04:00) that opened the door.
That is coherent with the cycle but hostile at the wrong moment: a learner who finds the
Arena on a Wednesday, having just decided they want to compete, was told to come back in
four days — and the decision does not survive four days. The refusal for a live member
stays loud rather than a silent no-op, because a second live seat cannot exist
(`uq_arena_member_live`) and someone tapping Join mid-race has misunderstood something.

Withdrawal is gated on the same seat, so it too is legal until formation seats you.

Two consequences worth knowing:

* **Formation must check the week it is forming.** `nextWeekStartFor` only rolls past the
  close, so mid-week it returns the week ALREADY RUNNING while every candidate's stored
  key is next Tuesday's. `formArenas` therefore keeps only the candidates whose
  `optInWeek` equals its bucket's own week key (§ 5.3) — without that filter, a Wednesday
  enrolment would be seated into an arena two days old, alone with 24 bots. It is a
  per-candidate filter rather than a per-bucket skip because one bucket can legitimately
  hold both this week's stragglers and a stale opt-in.
* **The `closed` page state now renders the same Join card as `opt-in`** (§ 2.3). The two
  differ only in whether the break is open, which no longer changes what you may do.

**Code:** `server/services/ArenaService.ts` → `optIn`, `withdraw`, `formArenas`;
`src/features/arena/ArenaPage.tsx` → `OptInCard`.

> **Proposed:** `user_languages."arenaOptInWeek" date NULL` — the date of the
> Tuesday whose arena this (user, language) opted into. Set by the opt-in endpoint, read
> by the formation cron, and self-expiring: any value ≤ the last formed week is simply
> stale and ignored.

### 8.1 Why this isn't already answered by `arena_members`

`arena_members` records **membership**, which does not exist yet at the moment someone
opts in. The two are separated by up to 36 hours:

```
 Sun 16:00 ─────────── you tap "Join" ─────────── Tue 04:00 ─────────►
 arena closes          ▲                          ▲
                       │                          │
                    INTENT recorded            MEMBERSHIP created
                    (arenaOptInWeek)           (arena_members row)
                       └──────── the gap ─────────┘
```

Nothing can be written to `arena_members` when you tap **Join**, because **the arena does
not exist**. It cannot exist: the whole job of the formation cron at Tuesday 04:00 is to
look at *everyone who opted in*, group them by division and region, keep last week's
casts together, and only then decide what the arenas are and who is in each one. Creating
a membership at opt-in time would mean deciding your cluster before knowing who else is
running — which is precisely the decision the clustering algorithm (§ 5.1) exists to make
with the full candidate list in hand.

So the column is the **input** to formation and `arena_members` is its **output**. They
answer two different questions:

| Question | Answered by |
|---|---|
| "Do you want in next week?" | `user_languages."arenaOptInWeek"` |
| "Who are your 24 opponents?" | `arena_members` |

This is also exactly what the page's **Waiting** state (§ 2.3) renders — "You're in, your
arena opens Tuesday at 4 AM" is a user who has the first and not yet the second.

**The alternative considered:** create the `arena_members` row at opt-in with a NULL
`arenaId`, and have the cron fill it in. That unifies the two into one table, but it makes
`arenaId` nullable — so every read of the members table has to exclude unassigned rows,
the partial-unique constraint gets messier, and "a member of no arena" becomes a state
that means "not a member". Trading a nullable date on an existing row for a nullable
foreign key on the table everything reads is a bad trade.

**Why a column and not an `arena_optins` table:** there is exactly one live value per
(user, language), no history worth keeping (membership history is already in
`arena_members`), and it self-expires without a cleanup job. It sits beside `division` in
the same row for the same reason — both are "this learner's standing in this language".

**Opt-in is per language.** A learner studying both must join twice, from each language's
board. That is more taps than a single "join everything" button, but it is honest: joining
a Spanish arena is a commitment to study Spanish this week, and a learner who only wants
one race should get one race. The **Join** button acts on the currently selected language
and says so ("Join next week's Spanish arena").

* **Explicit every week, no auto-enrol.** Per the brief. The friction is real and is the
  point: an arena of 25 people who each chose to be there beats one padded with the
  indifferent. The Results screen puts **Join next week's arena** directly under the
  promotion banner, which is the moment the player is most likely to say yes.
* **Opting in outside the break period is a 400**, not a queued intent. A player who opens
  the app on Thursday should be told when the door opens, not silently enrolled for a week
  they will forget about.
* **Opting out after opting in** is allowed until formation — it clears the column. After
  formation, membership is frozen (§ 3); there is no leaving an arena.

---

## 9. Proposed data model

✅ **Confirmed by the product owner (2026-08-16)** — the two tables and three columns
below are approved; what remains open in § 11 is behaviour, not schema.

Migration numbers start at **146**. 145 is taken by the
`user_language_points` → `user_languages` rename that this design prompted (see § 7.1);
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)'s draft also targets 146+, so whichever is
written first takes it and the other renumbers, per CLAUDE.md's collision rule.

### `arenas`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `division` | smallint | 1–12; every member shares it at formation |
| `timezone` | text | the IANA zone this arena's boundaries are computed in |
| — | — | **no `language` column** — arenas are deliberately multi-language (§ 5.0) |
| `geoCellPrefix` | varchar(5) NULL | the longest geohash prefix common to the arena's located members, or NULL for the location-less pool. **Informational only** — a diagnostic for "how tight did clustering get", never read by any user-facing query |
| `formationKind` | text | `'batch'` or `'straggler'` (§ 5.3). Kept so cluster-quality metrics can be reported separately; mixing them makes the average distance meaningless |
| `weekStartsAt` | timestamptz | the UTC instant of Tuesday 04:00 in `timezone` — the anchor every boundary derives from |
| `closesAt` | timestamptz | the UTC instant of Sunday 16:00 in `timezone`. Stored, not recomputed, so a tz-database update can never move a running arena |
| `resolvedAt` | timestamptz NULL | stamped when promotions/demotions were applied. Doubles as the cron's idempotency guard |

Index: `(timezone, weekStartsAt)`, `(division, weekStartsAt)`.

### `arena_members`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `arenaId` | uuid → `arenas(id)` CASCADE | |
| `userId` | uuid → `users(id)` **NULL**, ON DELETE SET NULL | NULL ⇒ synthetic (§ 6.1). SET NULL, not CASCADE, so a deleted account leaves the board intact |
| `language` | varchar(10) NOT NULL | the track this membership competes in. Denormalised onto every row, bots included, so the board renders its badges without a join |
| `syntheticName` | text NULL | non-null iff `userId IS NULL` |
| `syntheticAvatarIconId` | text NULL | ditto |
| `syntheticSeed` | integer NULL | drives the deterministic score curve (§ 6.2) |
| `syntheticTarget` | integer NULL | end-of-week score the curve converges to |
| `minutesEarned` | integer NOT NULL DEFAULT 0 | the counter of § 4.1. Humans only |
| `finalRank` | smallint NULL | written at close, so history never needs re-sorting |
| `divisionChange` | smallint NULL | −1 / 0 / +1, written at close for the Results banner |
| `updatedAt` | timestamptz | the tie-break key (§ 4.2) |
| `isLive` | boolean NOT NULL DEFAULT true | denormalised from `arenas.resolvedAt IS NULL`; exists **only** to make the uniqueness below indexable (see next) |

Constraints:

* `UNIQUE (arenaId, userId, language)` partial, `WHERE "userId" IS NOT NULL` — one
  membership per (user, language) per arena.
* A CHECK that `userId IS NULL` and the synthetic columns are non-null together, and that
  `syntheticName IS NULL` when `userId` is not.
* **`UNIQUE ("userId", language) WHERE "userId" IS NOT NULL AND "isLive"`** — one *live*
  membership per (user, language) across all arenas. **Settled as Q21.**
* Index `("userId", language, arenaId)` for "my current arena".
* Index `(arenaId, "userId")` — the duplicate-human pass (§ 5.1) and the Q18 constraint.

#### Q21 — why the extra `isLive` column exists

The uniqueness that actually matters is *"a (user, language) must not hold two **live**
memberships"*, and liveness is a property of the **arena**, not the member. Postgres cannot
put a joined column in a partial index predicate, so the choice was between enforcing it in
code and denormalising liveness onto the member row. **Decision: denormalise, and index
it.** A buggy cron then gets a constraint violation instead of quietly producing a person
on two boards, which is the class of bug nobody notices until a user reports an impossible
leaderboard.

⚠️ The cost is a **denormalisation that must be maintained**: the resolution transaction has
to stamp `arenas.resolvedAt` **and** flip `arena_members.isLive = false` for that arena, or
every member of a resolved arena permanently blocks that user from joining a new one. This
is the single most dangerous line in the design — a missed update is a silent, spreading
lockout. It must be one statement pair inside one transaction in one DAL function, with a
test that resolves an arena and asserts no live members remain.

Considered and rejected: enforcing it purely as a formation-time invariant (the candidate
query excludes anyone already holding a live membership). Cheaper and needs no column, but
correctness would live entirely inside one `NOT EXISTS` clause that a future refactor could
drop without any test failing.

### Changes to existing tables — ⚠️ needs confirmation

| Table | Column | Why |
|---|---|---|
| `user_languages` | `division smallint NOT NULL DEFAULT 1` | § 7.1 — the ladder rung, per (user, language) |
| `user_languages` | `"arenaOptInWeek" date NULL` | § 8 — self-expiring opt-in, per (user, language) |
| `users` | `"geoCell" varchar(5) NULL` | § 5.2 — a 5-character geohash cell (~5 km). On `users`, not `user_languages`: a person has one location regardless of what they study |

No change to `userminutepoints` or any vet table.

---

## 10. Layering map (proposed)

| Layer | File | Responsibility |
|---|---|---|
| Contract | `server/contracts/wire.ts` | `ARENA_SIZE = 25`, `ARENA_DIVISION_COUNT = 12`, `ARENA_PROMOTE_COUNT = 5`, `ARENA_RELEGATE_COUNT = 5`, boundary constants |
| Shared | `server/shared/arenaWeek.ts` | the Tuesday-04:00 / Sunday-16:00 boundary maths, mirrored to `src/utils/` like `streakDay` is, so the countdown can never disagree with the server. `arenaFormationAt` is the gate `formArenas` gets its window from — see the § 5.3 warning about what happened while nothing called it |
| DAL | `server/dal/{interfaces,implementations}/ArenaDAL` | `arenas` + `arena_members`. **No policy**. `listUnseatedCandidates` (opt-ins holding no live seat) and `findArenaWithFreeSeat` are the two formation reads |
| Service | `server/services/ArenaService.ts` | board reads, opt-in policy, `creditMinutes`, formation (`formArenas` + `seatStragglers`), resolution, the `countStranded` alarm, synthetic curve |
| Service | `server/services/MinutePointsService.ts` | one new call into `ArenaService.creditMinutes` (§ 4.1) |
| Controller | `server/controllers/ArenaController.ts` | HTTP edge only |
| Routes | `server/routes/arenaRoutes.ts` | ⚠️ static segments above any `/:id`, as in `friendRoutes` |
| Cron | `server/scripts/arena-cron.ts` + `database/cron/cow-arena.{service,timer}.template` | the `cow-arena` systemd user timer, hourly at **HH:06**: resolve any arena past Sun 16:00, then form for any timezone crossing Tue 04:00 |
| Client API | `src/api/arena.ts` | typed calls, **no `token` param** (FRONTEND_LAYERING § 3.2) |
| Client | `src/features/arena/*` | `ArenaPage` + the four states |
| Client (shared) | `src/components/leaderboard/*` | `LeaderboardPersonRow` extracted from `features/friends` (§ 2.1) |
| Client | `src/pages/HomePage.tsx`, `src/routes/routeMeta.ts`, `src/routes/registry.ts` | the hub row and the route |

### Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/arena` | `ArenaBoardResponse` — `{state, division, arena, entries, boundaries}`; entries ranked, viewer flagged |
| POST | `/api/arena/optIn` | 200 `{weekKey}` — 400 only if the caller already holds a live seat (§ 8) |
| DELETE | `/api/arena/optIn` | 204 — withdraw before formation; 400 once seated |

All require `authenticateToken`. Wire types in `server/types/arena.ts`, mirrored in
`src/api/arena.ts`.

### The cron pass is RESOLVE-then-FORM

⚠️ **The order is load-bearing.** Resolution *releases* each member's live seat
(`isLive` → false); formation *consumes* a seat by inserting a live membership. Forming
first means any arena that has closed but not yet resolved still holds its members' seats,
so `uq_arena_member_live` rejects the new memberships.

This was found in implementation, and the failure was worse than expected: because
formation ran as one pass, the first blocked candidate threw and **took the entire run
down** — one stale arena denying every bucket its week. Two changes: `ArenaService.tick()`
resolves before forming, and each arena's creation is individually guarded so one failure
costs one arena rather than the week. The scenario is not hypothetical — it is exactly what
a cron outage produces.

### `stranded` — the alarm that was missing

Every failure this feature has actually had was **silent**. A bucket frozen 31 hours early
and a straggler path with no caller both produce `formed 0`, which is also what a correct
quiet hour produces. Nothing threw, nothing was logged, and the first signal was a user
asking why they were not on a board — five days into the week, when it was too late to fix.

So each pass now ends by counting the thing that should be impossible:
`ArenaService.countStranded` — opted-in (user, language) pairs whose arena week **has already
opened** and who hold no live seat. Zero is the only correct value after 04:00 local.

* It is **counted, not repaired**. A repair would be an unattended write on a path nobody is
  watching; the job here is to make the next hour's log say so out loud.
* `arena-cron.ts` logs it *and* **exits non-zero**, so a non-zero count reaches
  `systemctl --user status cow-arena` and `journalctl --user -u cow-arena` rather than only
  the log file. (This is why `main()` exits with `process.exitCode` instead of a hard `0`.)
* It rides on `tick()`'s return value, so `POST /api/arena/admin/tick` and
  `server/scripts/arena-tick.ts` report it too.

Members still inside their formation window, and stale opt-ins naming a past week, are **not**
stranded and are not counted — neither is a fault.

### The cron is the risky part

Formation and resolution are **the only writes that must not run twice**. Both are
guarded by a stored timestamp (`arenas.weekStartsAt` uniqueness per (timezone, division)
for formation; `arenas.resolvedAt IS NULL` for resolution), and both must run inside a
transaction. This is the same shape as the penalty cron's `lastPenaltyDate` guard
([STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)), and it is worth copying that
pattern rather than inventing one.

Because the cron is **prod-only**, dev needs a manual trigger — an admin/validator-gated
`POST /api/arena/admin/tick` or a `server/scripts/arena-tick.ts` — or the feature is
untestable locally. Do not skip this.

### How the cron is actually installed

The `cow-arena` **systemd user timer**, a sibling of the existing `cow-maintenance` timer,
installed by `database/cron/install-timers.sh` (renamed from `install-maintenance-timer.sh`
when this second schedule arrived; it now installs both, and `/deploy` runs it every
deploy). Verify with `systemctl --user list-timers cow-arena.timer --no-pager` and
`tail logs/arena-cron.log` (expect `arena-cron: done — resolved N, formed M, stranded 0`);
force a pass with `systemctl --user start cow-arena.service`.

Three decisions worth keeping:

1. **A separate unit, not a third `ExecStart` on `cow-maintenance`.** systemd aborts a
   oneshot when a step fails. Appending the arena there would mean a failed
   inactivity-penalty run silently prevents arenas from forming — and since formation only
   happens in the hours around the Tuesday boundary, a failure in the wrong hour costs a
   whole week of arenas for every user. The two jobs share no data; they should not share a
   failure domain.
2. **HH:06, not HH:01.** `cow-maintenance` fires at HH:01 and updates `user_languages`
   row-by-row for the penalty pass; arena formation reads and writes the same table
   (`division`, `arenaOptInWeek`). The stagger keeps them off each other's row locks
   without either job needing to know the other exists. Formation runs on a 60-minute lead
   (`ARENA_FORMATION_LEAD_MINUTES`), so lateness of a few minutes is invisible.
3. **A dedicated entry point, `arena-cron.ts`, separate from the dev `arena-tick.ts`.**
   The dev trigger accepts `--seed-opt-ins`, which opts *every user in the database* into
   next week. That flag must not exist on any code path a scheduler can reach, so the prod
   entry point takes no arguments at all. It exits non-zero on failure, which is what makes
   a bad run visible in `systemctl --user status cow-arena` rather than only in a log file.

`Persistent=true` on the timer is safe — and matters more here than for the maintenance
timer. A skipped penalty hour is retried an hour later with the same outcome; a skipped
formation hour is a timezone bucket that never got its arena, and no later hour would
notice.

---

## 11. Question log

### Drafted (change freely — nothing is built)

| # | Question | Draft answer |
|---|---|---|
| Q7 | Division numbering direction | **1 = entry, 12 = top**; promotion is `+1`, both ends clamp |
| Q8 | Do minute-point penalties reduce arena score | **no** — arena score is gross and monotonic (§ 4) |
| Q9 | Can you leave a live arena | **no** — membership frozen at formation (§ 3) |
| Q10 | Traveller mid-week | arena keeps **its own** timezone; only the streak follows the user (§ 3) |
| Q11 | Remainder split | **fill to 25 before opening the next arena**; bots concentrate (§ 5.3) |
| Q12 | Are bots stored in `users` | **no** — nullable `userId` on `arena_members` (§ 6.1) |
| Q13 | Bot scores | deterministic curve computed on read from a stored seed + target (§ 6.2) |
| Q14 | Tie-break | earliest `updatedAt`, then member id (§ 4.2) |
| Q15 | Opt-in storage | one self-expiring `"arenaOptInWeek"` date, not a table — on **`user_languages`**, not `users`, since Q2 made opting in a per-(user, language) act (§ 8) |
| Q16 | Reuse the friends row component | **yes, by extraction** into `src/components/leaderboard/`, not by copy (§ 2.1) |

### Settled by the product owner

| # | Question | Decision |
|---|---|---|
| **Q2** | Division and score global vs per-language | **Per-language** — a learner climbs the ladder separately for each language they study. Division and opt-in move to `user_languages`; a membership is a (user, language) pair (§ 7.1) |
| **Q2b** | Are clusters partitioned by language too | **No** — arenas are deliberately **multi-language**; only the score is language-scoped. This is what keeps per-language divisions free of bucket dilution (§ 5.0) |
| **Q5** | Does a synthetic member in the top 5 consume a promotion slot | **Yes** — promotion is literally "the top 5 rows". Honest ranks over a kinder ladder (§ 6.3) |
| **Q4a** | How location is requested | **The real permission prompt**, iOS/Android-style: an in-context explanatory sheet, then the Geolocation API at reduced accuracy, truncated to a geohash cell on the device, denial → the location-less pool. **Not** the free timezone inference (§ 5.2) |
| **Q1** | Sunday 16:00 vs the app-wide 04:00 convention | **Keep 16:00.** A close is a *contested* instant, unlike a streak rollover — 04:00 would reward whoever sets an alarm and demote the sleeper. 16:00 is an hour people are awake and can choose to play. The **open** boundary stays 04:00, since opening is uncontested (§ 3) |
| **Q3a** | Where the division lives | **`user_languages`** — a column-per-language on `users` doesn't scale and a jsonb map isn't a scalar the cron can increment or the formation query can index. Migration 130 already moved the other four progress columns off `users` for this reason (§ 7.1) |
| **Q3b** | Why an opt-in column when `arena_members` exists | **They answer different questions.** Opt-in happens up to 36 h *before* the arena exists — membership can't be written until the cron has the full candidate list to cluster. The column is formation's input; `arena_members` is its output (§ 8.1) |
| **Q3** | The two new tables and three new columns | **Confirmed, 2026-08-16** (§ 9) |
| **Q3c** | Is `user_language_points` still the right name now that it holds a division | **No — renamed to `user_languages`** by migration 145, after its key rather than its contents, so a future column can never make the name wrong again (§ 7.1) |
| **Q21** | Enforcing one *live* membership per (user, language) | **A partial unique index**, backed by a denormalised `arena_members.isLive`. The DB refuses a second live membership rather than trusting the cron (§ 9) |
| **Q6** | Does an inactive player's division decay | **No — a division is kept forever.** Not opting in is a pause, never a loss. Consequence accepted: top divisions accumulate dormant holders, and a returning player re-enters at a rung above their current pace (§ 7) |
| **Q19** | Reward for promotion | **None — status only.** The division number and the board are the whole prize. Nothing to farm means nothing for colluding players to farm (§ 7) |
| **Q18** | May the same human appear twice on one board | **No — forbidden**, enforced by the duplicate-human pass at formation. Sharper than it looks: two memberships share a `geoCell` and would otherwise sort adjacent (§ 5.0, § 5.1) |
| **Q4d** | Cluster by country, or by geographic proximity | **Proximity.** A country is not a proximity measure — it groups Vancouver with Halifax and separates Detroit from Windsor. Clustering minimises average intra-cluster distance, **approximately**: a generically low average at near-zero cost, not an optimum (§ 5.1) |
| **Q4e** | What location is stored | **`users."geoCell"`, a 5-character geohash** (~5 km cell) — an identifier rather than a position, and simultaneously the sort key the algorithm runs on. Matches what iOS approximate / Android coarse location actually return (§ 5.2) |
| **Q4f** | Which clustering algorithm | **Sort by `geoCell`, cut every 25.** A geohash is a space-filling curve, so one `ORDER BY` buys most of the locality that a capacity-constrained k-means would. Deterministic, O(n log n), no solver (§ 5.1) |
| **Q4b** | Client-side or server-side country resolution | **Moot — the question dissolved.** With a geohash there is no lookup table to host: the client truncates and sends 5 characters, and coordinates never leave the device. The privacy-weaker branch stopped existing (§ 5.2) |
| **Q4c** | Does Arena's prompt justify a Capacitor shell now | **Record it, decide later.** Arena ships on the web Geolocation API. The demand is logged in [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) beside notifications; the packaging call waits for something that actually blocks (§ 5.2) |
| **Q22** | Timezone: hard partition or optimised across | **Hard requirement** — every member of an arena shares a timezone at formation. Geography is optimised only *within* a bucket. A post-formation timezone change is the user's to account for, but the app labels the countdown with the arena's timezone whenever it differs from theirs (§ 3, § 5) |
| **Q23** | When does clustering run, and who is a straggler | **Before the boundary** — arenas must exist at 04:00 because that is when minutes start counting. Snapshot ~1 h early; anyone opting in during that hour still gets a live arena, placed **naively** (fill the partial arena first, then chunk the rest), never a re-run of the algorithm (§ 5.3) |
| **Q17** | A combined "all my arenas" view for multi-language learners | **No** — `/arena` follows the selected language, like decks, minute points, night markets and the whole vet layer. Switching language switches the board. The header leads with the language so a Spanish division is never misread as a Chinese one (§ 2.2) |
| **Q20** | Does the board show anything about the other 24 beyond name/avatar/language/score | **No.** Every extra field is a disclosure to 24 strangers who never consented to each other, unlike `/friends` where both parties opted in. A streak in particular exposes a daily routine to people who cannot be unfriended. The board is a race, not a profile directory (§ 2.1) |
| **Q24** | Are stable week-to-week arenas wanted, or should the sort be salted | **Stable — rivalry is the point.** A recurring cast is what turns a leaderboard into a rivalry, and the geohash sort yields it for free. Chunk boundaries still move as the opt-in set changes, so the cast rotates at the edges rather than freezing (§ 5.1) |

### Open

**None.** Every question raised by this design has been answered — schema (§ 9) and
behaviour alike. New questions belong in this table as they surface; work that is agreed
but deliberately postponed belongs in [DEFERRED_WORK.md](./DEFERRED_WORK.md), not here.

---

## 12. Code ↔ doc dependencies

This document describes (all of the following now exist except where marked):
`database/migrations/146+` (`arenas`, `arena_members`, two `user_languages` columns,
`users."geoCell"`),
`server/scripts/arena-tick.ts` (the dev trigger) and `server/scripts/arena-cron.ts`
(the prod entry point, driven by the `cow-arena` systemd timer —
`database/cron/cow-arena.{service,timer}.template`, `database/cron/install-timers.sh`),
`server/contracts/wire.ts` (arena constants),
`server/shared/arenaWeek.ts` + `src/utils/arenaWeek.ts`,
`server/types/arena.ts`,
`server/dal/{interfaces,implementations}/ArenaDAL`,
`server/services/ArenaService.ts`,
`server/services/arenaClustering.ts` (the sort-and-chunk + duplicate-human pass),
`server/services/arenaSynthetic.ts` (the bot curve and name pool),
`server/services/UserMinutePointsService.ts` (the `creditMinutes` call),
`server/controllers/ArenaController.ts`,
`server/routes/arenaRoutes.ts`,
`server/dal/setup.ts` (arena wiring), `server/server.ts` (mount),
`src/api/arena.ts`,
`src/utils/geohash.ts` (client-side truncation — the privacy contract),
`src/features/arena/*`,
`src/components/leaderboard/*` (**not done** — extraction from `src/features/friends/`
is still owed; Arena ships `ArenaEntryRow` of its own),
`src/pages/HomePage.tsx` (the Arena hub row),
`src/routes/routeMeta.ts` + `src/routes/registry.ts`.

Tests: `server/__tests__/arenaWeek.test.ts` (boundary maths incl. DST),
`server/__tests__/arenaDal.test.ts` (the resolution statement shape — the isLive flip),
`server/__tests__/arenaClustering.test.ts`, `server/__tests__/arenaSynthetic.test.ts`,
`src/__tests__/geohash.test.ts` (reference values).

**Owed to other docs — still outstanding after implementation:**
* [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) — `FriendPersonRow` / `friendStyles.ts` move
  to `src/components/leaderboard/`; its § 1a and § 7 both name those paths (§ 2.1).
* [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) — the credit path gains an arena
  side-effect (§ 4.1).
* [PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md) — `user_languages` gains
  `division` and `"arenaOptInWeek"`; that doc's column table is the canonical one (§ 7.1).
* [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) — a second prod-only cron now
  shares the host; its idempotency pattern is the model for arena formation (§ 10).
* [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md) — the new hp row.

Related docs:
[FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) (the board this one looks like),
[PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md) (`user_languages`, which now
also holds the division and the opt-in),
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) (the scored quantity),
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) (local-boundary cron precedent),
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (the never-block philosophy padding follows),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md), [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md),
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md), [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md).

---

## 13. Not in scope

No arena chat, no reactions, no reporting/blocking of arena members (there is no
interaction surface to abuse), no cross-division play, no arena history page beyond the
current and just-closed arena, no push notification when an arena opens or closes — the
same constraint [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) operates under, since the app
has no push infrastructure.
