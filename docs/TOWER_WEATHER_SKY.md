# Tower Weather Sky (main world)

> **PARTLY BUILT (2026-11-04).** The weather → HUE mapping (§ 2) is live for the main
> world: `src/features/deckTower/weatherSky.ts` → `weatherDaySky` / `worldsUnderWeather`,
> applied in `DeckTowerPage.tsx`. The dawn/sunset cut (§ 1) is built: `DayPhase` is
> `"day" | "night"` (`src/timeOfDay/dayPhase.ts`). NOT built yet: lightness from the sun's
> elevation — the sky still blends between the day token and the night recipe. The weather
> fetch itself (`WeatherNow`, `useTowerWeather`, `WeatherToggle`) is documented in
> DECK_TOWER.md § "Weather".
> Parent: [DECK_TOWER.md](./DECK_TOWER.md) § "Time of day".

The Deck Tower's **main** world sky is driven by two inputs, one per OKLCH axis:

| Axis | Driven by | Range |
|---|---|---|
| **L** (lightness) | the sun's elevation at the learner's location (not built: today the phase recipes set L) | 0.34 (night) → 0.72 (sunrise) → 0.77 (solar noon — the original `bluMk` lightness) |
| **h** (hue) | the current weather (WMO code) | 239° (clear — the original) → 274° (fog) |
| **C** (chroma) | derived: the sRGB gamut maximum at (L, h) by day, easing to night's 0.08 | — |

Reading and writing worlds are **out of scope** for now; they keep their fixed day sky and
a plain day ↔ night blend. Their weather is a later design.

## 1. Decisions

- **Dawn and sunset are cut from the whole app** (BUILT 2026-11-04), not just the tower:
  `DayPhase` is `"day" | "night"` in the shared clock (`src/timeOfDay/dayPhase.ts` →
  `DayPhase`, `DAY_PHASES`, `timeOfDayAt`), and every reader dropped its dawn/sunset looks:
  the tower sky (`features/deckTower/timeOfDay.ts` → `NIGHT_SKY`, `PHASE_STARS`; the
  per-world `TowerWorld.skyRecipes` overrides went too), the wash (`src/timeOfDay/wash.ts` →
  `PHASE_LIGHT`), the eip palette (`eipPalette.ts` → `PHASE_PALETTE`), acp
  (`sortTimeOfDay.ts` → `PHASE_LOOK`), tier-2 looks (`tier2Look.ts` → `PHASE_GROUND`, which
  the beginner keyboard's colours read) and the tester chips (`TimeOfDayToggle` → Auto ·
  Day · Night). Each twilight is now one hour-long linear day ↔ night blend centred on the
  sun event. The planned night ↔ day transition along L (with chroma rising) is meant to
  become the visible "blue hour" (not built).
- **Full chroma by day.** Softer, lower-chroma skies were tried on 2026-11-04 and rejected
  as dingy/dead; the original `bluMk` (`#59BFFF`, ≈ oklch 77% 0.132 239) sits at the gamut
  edge, and every weather hue does too.
- **Night is tinted by the weather, damped.** Night keeps its existing recipe — L 0.34,
  C 0.08, hue turned 35% of the shortest arc toward 270° — starting from the weather hue.
- **Windy is ignored.** Open-Meteo has no wind weather code (wind is only numeric:
  `wind_speed_10m`, `wind_gusts_10m`), and wind co-occurs with every other kind. It may
  return later as a modifier with its own visual (the tower already has gusts), never a hue.
- **Clear weather is the original blue.** Clear sits at 239°, so a clear noon (and no
  weather at all — loading, offline, the Settings switch off, no location) is the original
  `bluMk` (`#59BFFF`; `SKY_BY_KIND.clear` is the token itself). Every other kind turns toward violet from there.
- **Weather provider:** the app is headed commercial, so Open-Meteo's free tier
  (non-commercial only) is out. Candidates: MET Norway `api.met.no` (free incl. commercial,
  CC BY 4.0, attribution + User-Agent + caching required), Open-Meteo paid or self-hosted,
  Apple WeatherKit. Decided by the weather workstream.

## 2. Weather kind → hue

Code: `weatherSky.ts` → `SKY_BY_KIND`, `skyKindOf`. Keyed on `WeatherNow.wmoCode` (WMO), which
is finer than `WeatherNow.kind` (no partly cloudy or freezing kinds); an unknown code falls
back to `kind`. Noon hex = L 0.77 (the original `bluMk`'s lightness) at max chroma, except
overcast; night = the §1 recipe, its chroma scaled by the day sky's (`timeOfDay.ts` →
`SATURATED_DAY_CHROMA`: every saturated sky gets night's full 0.08, overcast's grey gets a
grey night).

| Sky kind | WMO codes | Hue | Noon | Night | Tester pin |
|---|---|---|---|---|---|
| Clear | 0, 1 | 239° | `#59BFFF` (`bluMk`) | `#113A5F` | Clear |
| Snow | 71, 73, 75, 77, 85, 86 | 252° | `#79B9FF` | `#1C3861` | Snow → any |
| Partly cloudy | 2 | 254° | `#7DB8FF` (`PARTLY_CLOUDY_SKY`) | `#1D3761` | Cloudy → Partly |
| Rain (incl. drizzle) | 51, 53, 55, 61, 63, 65, 80, 81, 82 | 260° | `#88B5FF` | `#223661` | Drizzle / Rain → non-freezing variants |
| Sleet | 56, 57, 66, 67 | 263° | `#8DB4FF` | `#243661` | Drizzle / Rain → Freezing variants |
| Storm | 95, 96, 99 | 267° | `#93B2FF` | `#263561` | Storm → any |
| Fog | 45, 48 | 274° (lavender) | `#9DAEFF` | `#2A3461` | Fog |
| **Overcast** | 3 | 254°, L **0.82**, chroma **0.04** | `#B3C6DE` (`OVERCAST_SKY`) | `#2F3847` | Cloudy → Overcast |

**Overcast is the one grey (2026-11-13).** It keeps the cloudy family's hue (254°), is
lifted to L 0.82 (a real overcast sky is a bright pale sheet) and drops to chroma 0.04 (both
tuned by the owner the same day: "slightly bluer and lighter"), derived in code from `PARTLY_CLOUDY_SKY` (`weatherSky.ts` →
`OVERCAST_SKY`) rather than picked, and flies **no clouds** (`towerWeather.ts` →
`weatherCloudCount`): an overcast sky is one unbroken sheet. Partly cloudy took over the look
overcast had before (`#7DB8FF`, 4 clouds); its old 246° `#6CBBFF` is retired. At night overcast
turns into its own darker grey (`#2F3847`) instead of night blue.

Chosen 2026-11-04 over two alternatives shown side by side: a hue spread to 302° (wet
weather turned purple) and a hue + lightness version (overcast paler, storms deeper). These
hues are close — neighbours are about 0.4–1.8 ΔE (OKLab ×100) apart, under the ~4 needed to
tell two skies apart one at a time — so the kinds read as a gradual shift rather than
distinct looks; the particles (WeatherLayer) carry most of the difference.

Notes on the data:
- Open-Meteo has no standalone hail or sleet code. Hail appears only inside thunderstorm
  codes 96/99 (and only from models with a hail forecast, e.g. DWD ICON, UKMO); freezing
  drizzle/rain (56/57/66/67) is the nearest thing to sleet, so it carries the hail/sleet hue.
- A fetched summary of the docs also listed a code 97 ("severe thunderstorm"); unconfirmed —
  if it exists, it maps to Thunderstorm.
- Fog sits past storm (the most violet sky).

## 3. Open questions

- **Spacing.** See § 2: the kinds are perceptually close by choice.
- **Continuous cloud cover.** `cloud_cover` (%) could set the hue continuously across
  sunny → partly cloudy → cloudy instead of three steps.
- **Hue changes** should ease over about a minute when a new reading arrives, so the sky
  never jumps under the learner.

## 4. Code

Built: `src/features/deckTower/weatherSky.ts` (`weatherDaySky`, `worldsUnderWeather`), read by
`DeckTowerPage.tsx` (the `skyWorlds` map feeding `light.skyOf`, `useWorldPan` and `litWorld`).
The Add Cards page honours the same sky without the particles: `AddCardsPage.tsx` passes
`weatherDaySky(...)` to `sortTimeOfDay.ts` → `sortLookAt`, whose day ground IS the weather sky and whose night ground is the weather sky turned to night
(docs/SORT_CARDS_REQUIREMENTS.md § 4.9). Main's static day sky (`TOWER_WORLDS.core.sky`)
is `COLORS.bluMk`, the clear colour; `bluSky` was deleted 2026-11-04.

Planned, not yet existing: a sun-elevation function beside `sunDay`
(`src/timeOfDay/sunTimes.ts`); lightness from it in place of `NIGHT_SKY` / the day token for main
(`src/features/deckTower/timeOfDay.ts`); a time row (night / twilight / morning / noon) in the
tester chips (`src/features/deckTower/TimeOfDayToggle.tsx`).
