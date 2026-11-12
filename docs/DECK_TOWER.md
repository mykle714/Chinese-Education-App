# Deck Tower

The Deck Tower (td) is the app's landing page at `/`. It draws the learner's **Learning**
deck — every card that is off cooldown right now, in all four utcm bands — as a stack of
flashcards standing on an isometric platform, in the art style of Nintendo/Paladin's
*Good Job!*. It is the footer's first tab, **Flashcards** (footer order: Flashcards · Lessons · Dictionary ·
Menu). Tapping the floor plate switches the tower to the
**Mastered** deck and back. The focus lever's shrink and grow come from one library of
tower shrinks and grows (§ Tower resizes). When the account has the reading or
writing goal on, a **world** for each lies beside the main one — swipe left or right to
dash there (§ Worlds). Tapping a Learning tower **studies it in place**: the camera dives
onto the top card and the flp is laid over it, without leaving the page (§ Studying the
tower) — this is the app's only flp. Under the platform, the scroll runs on into a
**cards page**: the world's whole card library, searchable and filterable, whose title row
takes over as the page header (§ The cards page; data and components in
[CARD_LIBRARY.md](./CARD_LIBRARY.md)).

The drawing comes from the iso art framework,
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md). This doc covers only the page.

Sub-document: [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) — the deck switch:
the plate button, the deck-transition registry (trap door) and the pawn-entrance registry
(fall from the sky), all timed to the new pawn's landing.

Sub-document: [TOWER_SNOW.md](./TOWER_SNOW.md): snow settling on the platform (floor, Learning
tower, lever, corner fixtures) on page entry, kept per device until a trap door, a study,
a sky drop, a lever pull, a fixture tap or a plate press clears it; the plate buried under
the floor's snow; the pawn wading and its channel; flakes falling in front of the platform.

Sub-document: [HINT_PAWN.md](./HINT_PAWN.md): the flp's **hint pawn**, a pawn on a tiny
platform in the world's colour, in the session's bottom-left corner, which speaks the front
card's hint (writing: the used-in words; main and reading: a wrong-streak study tip after
3 misses in a row). Arrives on a session's first hint, can be swiped
away for the rest of the td visit (`useHintPawnVisit`), and has a per-device switch in Settings.

Sub-document: [LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md): the **launch screen** td opens
behind once per app launch. A full-screen solid sky colour (always day's) with a placeholder animation, a pawn dropping onto a mini platform, which opens with
a circle onto td once the weather and the shown deck's count are in (`launch/`). While it is
up the footer is away, the scroller is locked, and td's opening grow, cooldown drops and
banking run wait. It replaced the **home screen** (archived 2026-11-11,
[ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)).

Sub-document: [FOCUS_MODE.md](./FOCUS_MODE.md) — the **focus lever** in each platform's
left floor corner on screen (`IsoLever`, `useFocusLever`, `useLeverMotion`; layout
`TOWER_LAYOUT.leverAt`, whose hatch is the pawns' second obstacle). It shows on the Learning
deck once the world holds 80 off-cooldown cards (or focus is on), and switches the world to a
daily cap of 25 (`FOCUS_DAILY_CARDS`). While focus is on, the world's ready counts — and so its Learning tower —
cover only today's remaining focus set.

Parent: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (sub-documents table).

## Status

- The route row is in `src/routes/routeMeta.ts` (`/`: `access: "any"`,
  `shell: "frame"`, `chrome: "tab"`, `footerTab: "deck"`, `footerStyle: "slab"`). The
  component is in `src/routes/registry.ts`. The tab is the `deck` row of `TABS` in
  `src/components/MobileFooter.tsx`. The vet cdp (`/flashcards/card/:id`) and acp
  (`/discover/sort/:language`) also light the Flashcards tab.
- There is no Settings gear on td: Settings is a tab of the `AccountSheet` the avatar
  raises (the `/settings` route remains).
- The page renders in a non-scrolling `MobileTabScreen` (title "Deck"). It is the only
  route that wears the floating **slab** footer instead of the flat bar (§ Footer); the
  scene stands above the slab and the sky runs on under it.

## Layers

| Layer | File | Role |
|---|---|---|
| Page | `src/features/deckTower/DeckTowerPage.tsx` → `DeckTowerPage` | Picks the shown worlds, reads their counts, fits the viewBox to the world on screen (`scene` memo), runs one build-up per world (always at full height now) and the corner fixtures' grow-in, handles the world swipe and the scroll height shared across worlds, inside `MobileTabScreen` — whose header carries the world title (`title`, white via `headerTitleColor`) and is lifted above the scroller (`wrapHeader`) so its controls are tappable |
| Page view | `src/features/deckTower/DeckTowerPlatform.tsx` → `DeckTowerPlatform`, `STARTLE_AT_CARDS` | The platform in one world's colours, with its tower, pawn(s) (depth-sorted, `pawnDepthRanks`), floor plate |
| Page constants | `src/features/deckTower/towerPlatforms.ts` → `TOWER_LAYOUT`, `TowerPlatformLayout`, `FLOOR_Z`, `GROUND_Z` | The platform and the layout on it (the same in every world) |
| Page constants | `src/features/deckTower/towerWorlds.ts` → `TOWER_WORLDS`, `WORLD_ORDER`, `TowerWorld` | The worlds: name, sky, space, platform tone, floor and ground surfaces (§ Worlds) |
| Page logic | `src/features/deckTower/useWorldPan.ts` → `useWorldPan`, `WorldPanView` | The camera dash between worlds: which world is drawn, the scene's slide, speed-line strength, the blending palette (§ Worlds → The pan) |
| Page | `src/features/deckTower/SpeedLines.tsx` → `SpeedLines`; `src/features/deckTower/WorldIndicator.tsx` → `WorldIndicator` | The dash's streaks; the floating bottom-corner arrows naming the neighbouring worlds |
| Page logic | `src/features/deckTower/useBuildProgress.ts` → `useBuildProgress`, `buildTimeline`; `useFixtureGrow`, `FIXTURE_GROW_MS` | A tower's build-up, 0 → 1 (or straight to 1 when `animate` is false — every caller passes false since 2026-11-09, so no tower builds up); the corner fixtures' own grow-in after a swap lands on Learning (§ The notebook stack, § The sort platform) |
| Page | `src/features/deckTower/DeckTowerAvatar.tsx` → `DeckTowerAvatar` (skin: `src/minutePoints/dailyBanking/BankingAvatarButton.tsx` → `BankingAvatarButton` over `src/components/HeaderAvatarButton.tsx` → `HeaderAvatarButton`, whose only skin is 40px with a `SHADOW.float` rest shadow) | The learner's profile picture in the header's far-right corner (`headerTrailingActions`, right of the minute-points flame); a tap raises the `AccountSheet` (`src/pages/AccountSheet.tsx`). It is the daily banking run's ember destination (§ Daily banking) |
| Page | `src/minutePoints/dailyBanking/DailyBankingContext.tsx` → `DailyBankingProvider`, `DailyBankingOptOut`; `BankingEmbers.tsx` → `BankingEmbers`; `src/features/deckTower/BankingAlwaysPlayToggle.tsx` → `BankingAlwaysPlayToggle` | The once-per-streak-day banking run in td's header, and its feature-tester chip row (§ Daily banking) |
| Page logic | `src/features/deckTower/timeOfDay.ts` → `towerLight`, `litWorld`, `phaseSky`, `NIGHT_SKY`, `PHASE_STARS`; `src/timeOfDay/wash.ts` → `PHASE_LIGHT`, `phaseWash`; `useTimeOfDay.ts` → `useTimeOfDay`; the shared clock `src/timeOfDay/` → `dayPhase.ts` (`timeOfDayAt`), `sunTimes.ts` (`deviceLocation`, `sunDay`), `tzCoordinates.ts` (`TZ_COORDINATES`, generated by `scripts/generate-tz-coordinates.mjs`), `useDayClock.ts` (`useDayClock`, `TimeOfDayOverride`) | The time of day: day / night blended across the learner's real sunrise and sunset, each world's sky at that hour, and the wash over everything drawn on it (§ Time of day) |
| Page | `src/features/deckTower/TimeOfDayToggle.tsx` → `TimeOfDayToggle`; `TesterChipRow.tsx` → `TesterChipRow`; `TesterSharedRow.tsx` → `TesterSharedRow`, `useTesterInline`; `testerChipStyle.ts` → `testerChipSx`, `TESTER_ROW_SX`, `TESTER_GROUP_SX` | The feature-tester chip group that pins a phase (§ Time of day → "Tester toggle"); `TesterChipRow` is the single-choice chip group every tester toggle uses; `TesterSharedRow` puts short groups on one row (§ Feature-tester rows) |
| Page logic | `src/features/deckTower/towerWeather.ts` → `weatherEffect`, `isEffectless`, `weatherCloudCount`, `pinnedWeather`, `WeatherOverride`; `useTowerWeather.ts` → `useTowerWeather`; setting: `src/hooks/useWeatherEffectsSetting.ts` → `useWeatherEffectsSetting`, `useWeatherEffectsEnabled` | The learner's real weather over the sky: the particles to draw, how many clouds fly (cloudy only), the fetch, the per-device Settings switch and its location flow (§ Weather) |
| Page | `src/features/deckTower/WeatherLayer.tsx` → `WeatherLayer`; `WeatherToggle.tsx` → `WeatherToggle`; `LightningStrikeChips.tsx`; `useLightningFlashes.ts`; `towerLightning.ts` | Rain / snow / the lightning flash inside SpaceBackdrop (fog is `iso/IsoFog.tsx`, over the platform; snow in front of the platform and settled snow are [TOWER_SNOW.md](./TOWER_SNOW.md)); the feature-tester chip row that pins a kind; the lightning clock and its platform strikes, with their tester chips (§ Weather) |
| Server | `server/routes/weatherRoutes.ts`, `server/controllers/WeatherController.ts` → `getWeather`, `server/services/WeatherService.ts` → `WeatherService`, `weatherFromWmoCode`; `server/utils/geohashCenter.ts` → `geohashCenter`; `ArenaDAL.getGeoCell`; contract `server/contracts/wire.ts` → `WeatherKind`, `WeatherNow`, `WeatherResponse` | `GET /api/weather`: the stored geoCell's current weather from Open-Meteo, cached per cell (§ Weather → "Server") |
| Page | `src/features/deckTower/ForcedBreakPicker.tsx` → `ForcedBreakPicker` | The feature-tester chip row under the time-of-day row that pins a world's breaks to one game, opening the visit on one (§ Forced game breaks) |
| Page | `src/features/deckTower/SpaceBackdrop.tsx` → `SpaceBackdrop`, `SpaceBand` | The screen-space sky behind the scene, in the world's colour, which darkens into starry space as a tall tower is climbed (§ Sky → space) |
| Page | `src/features/deckTower/StarField.tsx` → `StarField`, `STAR_LAYERS`, `starLayerTransform` | The tiled star field, inside SpaceBackdrop; also acp's night sky (docs/SORT_CARDS_REQUIREMENTS.md § 4.9) |
| Page | `src/features/deckTower/ShootingStars.tsx` → `ShootingStars`; `ShootingStarChip.tsx` → `ShootingStarChip` | Night's occasional meteor bursts, inside SpaceBackdrop (§ Time of day → "Shooting stars"); also acp's night sky. The chip is the feature-tester trigger (§ Feature-tester rows) |
| Page logic | `src/features/deckTower/towerAurora.ts` → `useTowerAurora`, `auroraStrength`, `useAuroraGlowWash`, `auroraCanRoll`, `auroraShowing`, `AURORA_WORLD`, `AURORA_CHANCE`, `AURORA_COLORS`, `AURORA_GLOW`, `AURORA_BAND`; `useTowerWeather.ts` → `settled`; `useWorldPan.ts` → `WorldPalette.aurora`; `DeckTowerPage` → `aurora`, `auroraOf`, `auroraUp`, `observedWeatherFx`, `dayLight`, `light` | The reading world's rare aurora: the once-per-visit 1% roll, its strength per world (night's share, blended through a pan), and its glow over the scene's wash (§ Time of day → "Aurora") |
| Page | `src/features/deckTower/AuroraLayer.tsx` → `AuroraLayer`; `AuroraToggle.tsx` → `AuroraToggle`; `SpaceBackdrop` → `AURORA_FADE_TO` | The aurora's canvas curtains inside SpaceBackdrop, and the feature-tester Auto · On · Off chip row (§ Time of day → "Aurora") |
| Page | `src/features/deckTower/TapToStartHint.tsx` → `TapToStartHint`; `DeckTowerPage` → `startable`, `onStackTap`, `hintFit`, `TAP_HINT_FIT_CARDS` | The white "Tap to Start" + arrow painted on the sky, and the Learning stack's tap, which starts a study (§ Tap to Start) |
| Page logic | `src/features/deckTower/useTowerStudy.ts` → `useTowerStudy`, `slideCover`, `sessions` / `TowerStudySession` (the parked sessions), `PARKED_LOOP_FRESH_MS`; `towerCamera.ts` → `studyCameraView`, `easeDive`, `STUDY_CAMERA_HEIGHT`; `DeckTowerPage` → `onStackTap`, `climbedOut`, `sceneProj`, `StudySession` | Studying the tower in place: each visited world's flp session kept mounted (parked), the dive onto the top card, the count card sliding off and back on, the camera while studying, a spawn's sky drop, the climb back out and the reconcile (§ Studying the tower) |
| Page view | `src/features/deckTower/TowerCoverCard.tsx` → `TowerCoverCard`, `TowerCover` | The count card as its own layer over the session while it slides off the deck and back on (§ Studying the tower → "The count card") |
| Feature contract | `src/features/flashcards/FlashcardsLearnPage/flpTowerHost.ts` → `FlpTowerHost`; `FlashcardsLearnPage` `tower` prop; `TowerStudyHeader.tsx` | The flp running inside the tower page (§ Studying the tower → "The session") |
| Page logic | `useTowerStudy` → `platformOpacity`; `DeckTowerPlatform` `fadeOpacity` / `keepDeck` (IsoPlatform `fadeStyle` / `fadeChildren`) | The platform fading away under the cards on every dive (§ Studying the tower → "The platform fades") |
| Page view | `src/features/deckTower/TowerCardsPage.tsx` → `TowerCardsPage`, `TowerFilterKeys.tsx` → `TowerFilterKeys` (data: `src/features/flashcards/useCardLibrary.ts` → `useCardLibrary`, `toggleCardsFilter`, `activeCollection` — [CARD_LIBRARY.md](./CARD_LIBRARY.md); card: `src/components/MiniVocabCardGrid.tsx` `cardStock` → `MiniVocabCard` `stock`, the stock from `src/features/discover/sortCardStock.ts` → `sortCardStockSx`, `cardStockShadow`) | The cards page under the platform: the world's library with the Learning / Mastered filter keys, search + sort, and the sticky title row with the up arrow (§ The cards page) |
| Page logic | `src/features/deckTower/towerScroll.ts` → `platformScrollTop`, `cardsTopScrollTop`, `heightAbovePlatform`, `towerSceneOf`, `TOWER_SECTION_CLASS`, `TOWER_SCENE_CLASS`, `useTowerCardsScroll` | The platform LINE every scroll calculation is measured from, the cards LINE under it, the momentum stop at the platform line, the downward stop at the cards line, the snap zone between the two lines, the shared glide (cue / up arrow / snap), and the header hand-off (§ The cards page) |
| Page logic | `server/contracts/flpReadiness.ts` → `flpUpcomingReady`, `FLP_UPCOMING_HORIZON_MS`; `src/hooks/useFlpReadyCounts.ts` → `pendingReleases`, `applyReleases`; `DeckTowerPage` → `releaseCooldowns`, `rereadOnReturn` | Cards coming off cooldown while the page is up, each dropped onto the tower as it does (§ Cooldown releases) |
| Page logic | `src/features/deckTower/towerHeightStore.ts` → `readTowerHeight`, `writeTowerHeight`; `DeckTowerPage` → `openedAtHeightFor`, `coreSettledCount` | Main's Learning tower opening at the height it last stood at (§ Opening at the last height) |
| Framework | `src/features/deckTower/iso/` | Every object, shadow and colour (see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md)) |
| Page logic | `src/features/deckTower/useDeckSwap.ts`, `deckTransitions.ts`, `towerDecks.ts` | The deck switch (see [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)) |
| Page logic | `src/features/deckTower/towerModes.ts` → `TOWER_MODES`, `bandTotal`; `DeckTowerPage` → `learningCount` | The Learning deck's study mode — Mix only (§ Study mode) |
| Page logic | `src/features/deckTower/towerResizes.ts` → `TOWER_SHRINKS`, `TOWER_GROWS`, `GHOST_COLLAPSE`, `SKY_DROP`, `IMPACT_MS`; `useTowerResize.ts` → `useTowerResize`; `DeckTowerPage` → `startResize`, `resolveRecount` | The library of in-place tower shrinks and grows, and the per-world player the focus lever uses (§ Tower resizes) |
| Page logic | `src/features/deckTower/usePopUpMotion.ts` → `usePopUpMotion`, `useTween` | The floor fixture's rise / sink / sky-fall tweens (the focus lever's `useLeverMotion` builds on it) (§ Floor fixtures) |
| Data | `src/hooks/useFlpReadyCounts.ts` (once per bar: core, reading, writing; `GET /api/onDeck/flpReadyCounts`) + `src/hooks/useMasteredCounts.ts` + `src/features/flashcards/builtinCollections.ts` → `builtinCollectionCount` | Each world's figures, read through its own bar. **Learning** = the bar's cards that are OFF COOLDOWN (`flpReadyCountsByBand`, the flp's own readiness rule; the response is `{ counts, upcoming, focusOn }`), in all four utcm bands (`TOWER_MODES.mix.bands` summed by `bandTotal`); **Mastered** = the bar's whole Mastered total, cooling or not. Two different **Learning** counts are on td on purpose: the tower's Learning deck is off-cooldown cards in all four bands, while the cards page's Learning filter key (and the sort platform's low test) counts cooling cards too and leaves out Mastered (`builtinCollectionCount({ kind: "learn-now" })`). Fetched on open; a card coming off cooldown while the page is up joins the tower as its own sky drop (§ Cooldown releases). The reading and writing figures are fetched even with the goal off (the same choice `useMasteredCounts` makes) |

## The scene

The platform geometry lives in `towerPlatforms.ts` and the worlds' colours in
`towerWorlds.ts`; `DeckTowerPage` holds the sky bands and the framing;
`DeckTowerPlatform` draws the platform.

| Constant | What |
|---|---|
| `PLATFORM`, `PLATFORM_THICKNESS` (`towerPlatforms.ts`) | The platform: an 11×11 slab, corner radius 0.9, 1.5 thick, `floating` (a slow bob, see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Levitation). The same in every world |
| `GROUND_Z` (`towerPlatforms.ts`), `TowerWorld.ground` | The sky's plane, 1.6 below the slab's underside, which receives the platform's shadow (its colour is the world's sky) |
| `FLOOR_Z` (`towerPlatforms.ts`), `TowerWorld.floor` | The platform's top (z = 0). The stack and the pawns stand on it (its colour is the world's platform top) |
| `TowerPlatformLayout.card` | A portrait 4.8 × ~6.93 (`CARD_W` × `CARD_D`) footprint, centred on the platform. `CARD_D` is derived from the flp card's proportions (`FLP_CARD_ASPECT`, 295 : 426, `src/features/flashcards/constants.ts`) because the study camera lands the top card exactly on the flp card (§ Studying the tower); it was 6.6 until 2026-10-24. Its corner radius, `CARD_W × FLP_CARD_CORNER_RATIO` (= 0.45), is shared with the flp card the same way — the flp sets it as a width-proportional `--card-radius` (`FlashCardSection` → `flpCardRadiusCss`; docs/SHELF_REDESIGN.md D14) |
| `TowerPlatformLayout.pawnAt`, `.roam` | Where the pawn starts (front right of the tower), and where it wanders: the floor inside the rim, around the tower (the floor label is not an obstacle: the pawn steps up onto it — `DeckTowerPlatform` → `pawnSteps`, `IsoPawn` `steps`). The obstacles are listed back-to-front; `DeckTowerPlatform` keeps `pawnDepthRanks` in state and slots each pawn into the keyed children just before the first obstacle it stands behind (`depthRankAmong` — not a count of those it is in front of, which put a pawn on the tower's back-left in front of the tower because it was past the lever, then at the back-right corner), so it walks behind the tower rather than over it. The order follows the camera (`backToFront`): on the study dive, once the camera is over a face of the tower, what stands past that face — the lever, a pawn — goes behind the tower, whose top now hides the floor round its foot (ISO_ART_FRAMEWORK.md § IsoPawn → "Depth sorting") |
| `STARTLE_AT_CARDS` (`DeckTowerPlatform.tsx`) | 50. When the build-up puts this many cards on a tower, its pawn is startled: it looks up, leaps away from the tower and a `!` pops over its head, stares up for a few seconds, then goes back to wandering (`IsoPawn` `startled`, `startledBy={layout.card}`). Decks under 50 never trigger it, and neither does a tower that is already at 50+ when the pawn first sees it: arriving in such a world (the remounted pawn was not watching it grow) or loading the page with one (the count reads 0 while it loads, so `DeckTowerPlatform`'s `towerCountKnown` holds `startled` at `null` until it lands, and `usePawnMotion` takes the first known value as a baseline, not a rise). Only a grow past 50 counts: a sky drop landing — a resize's, or a deck swap's new tower (DECK_TOWER_TRANSITIONS.md § "The new tower's sky drop") |
| `IsoPawn` `tappable` (`DeckTowerPlatform` → `renderPawn`) | Tapping the pawn pops its `!` and makes it jump on the spot; it then stands until the bubble has gone. Taps while it is still in the air chain the jump higher. An outgoing pawn (mid-swap) takes no taps (ISO_ART_FRAMEWORK.md § IsoPawn → "Poke") |
| `DeckTowerPlatform` → `pawnSteps`, `summitCards`, `summitHeld` | The tower's top is the pawn's **summit**: a tap while its feet are above the top throws it onto the deck, where it wanders (ISO_ART_FRAMEWORK.md § IsoPawn → "Summit"). When the height changes under it: **marks or a focus shrink** — it falls onto the new top, from the shrink's start (`summitCards`); **a sky drop** — it is thrown up as the drop lands; **a deck swap** — it falls with the tower, like any floor drop; **a study** — it stands still (`summitHeld`), stays out of the platform's fade, and rides the count card off and back on (`summitSpot`, `TowerCoverCard` `pawnAt`, § Studying the tower → "The count card"); **no cards left** — the top closes and it flies back to `pawnAt`, after any study. A world swipe remounts the pawn on the floor. Nothing else brings it down |
| `CLOUD_BAND_CARDS` | Clouds (`IsoCloud`, `useCloudDrifts`) are **weather, not altitude**: they fly only under the `cloudy` weather kind (`towerWeather.ts` → `weatherCloudCount`; § Weather), in every world, whatever the card count. Rain, snow, storm and fog draw no clouds, by design. They drift slowly (about a minute per crossing) past the tower's four sides, their bases at the height of cards 150–200 (card k's underside is (k − 1) · `CARD_THICKNESS` up). `weatherCloudCount` sets how many may be in the sky at once — 2–3 for partly cloudy, 4 for overcast — with 4–14 s gaps between drifts. Every cloud traverses in from off screen; none spawns mid-sky when cloudy weather starts, and the slots' first drifts are staggered by ordinary 4–14 s gaps, so the band fills one cloud at a time (cloudy is the commonest weather, so it stays unobtrusive). A deck that stops inside the band lowers its top to `SKY_CEILING_ABOVE_TOP` (3 units) over its settled top (`skyBand`), so they drift by the tower and not empty sky; a deck under 150 keeps the whole band, above the framed scene and so out of sight. Back-side clouds are drawn first (before the stack, which hides them) and front-side clouds last, after the pawn's depth-sorted layers. They sit inside `IsoPlatform`, so they ride its 0.35-unit bob. Within each side they are sorted with `sortCloudsBackToFront`. Under reduced motion they still show, parked and still. **The red balloon:** each drift has a 1-in-100 chance (`BALLOON_CHANCE`) of being a red balloon instead (`IsoBalloon`; ISO_ART_FRAMEWORK.md § IsoBalloon). It takes the cloud's slot and path but flies lower, its body's bottom at cards 110–140 (`BALLOON_BAND_CARDS`, lowered by `skyBand` like the clouds'). Feature testers can send one across on demand (`BalloonSpawnChip`, § Feature-tester rows). Each cloud casts a glaze shadow on the floor and the ground just off the point below it (`IsoCloudShadow`, drawn by `SkyTraffic.tsx` → `SkyTrafficCloudShadows` through `DeckTowerPlatform`'s `cloudShadows` prop; ISO_ART_FRAMEWORK.md § IsoCloud → Shadow). Clouds and wind are scheduled and drawn by `SkyTraffic.tsx` (`SkyTrafficSource` runs both schedulers and publishes into a small store, `skyTrafficStore.ts`; the memoised `SkyTrafficLayer side="behind"|"front"` subscribes and draws one side), so a crossing starting or ending re-renders only those two layers, never the page |
| `WIND_BAND_CARDS`, `WIND_GUSTS_MAX` | Wind gusts (`IsoWind`, `useWindGusts`) sweep past the tower's four sides with their baselines at the height of cards 350–400, in the empty sky between the clouds and space. A gust is two or three straight white streaks, the main one ending in a curl. It draws on head-first, then erases tail-first, over about 1.5–2.3 s. Up to 2 play at once, with 1–4 s gaps. Wind starts when the 350th card is on the tower (a sky drop counts from its impact), so a deck under 350 never has wind; a deck short of 400 lowers the band's top the same way as the clouds' (`skyBand`). Back-side gusts are drawn after the back-side clouds, front-side gusts before the front-side clouds. Under reduced motion there is no wind |
| `SPACE_BAND_CARDS` | 450–650. Over this height band the sky darkens into space and stars fade in (§ Sky → space) |
| `TowerPlatformLayout.notebook`, `.notebookRoam` | The Writing Notebook's paper stack (writing world only, § The notebook stack): a 1.2 × 1.55 portrait footprint in the floor's RIGHT corner on screen (high x, low y — the lever's corner mirrored), 1.45 units off the tower's right face so the pawn still passes between them. `notebookRoam` is `roam` with the stack appended as obstacle 2; `DeckTowerPlatform` uses it only on a platform that draws the stack |
| `TowerPlatformLayout.sortBin`, `.sortBinRoam` | The mini sort platform (main world only, § The sort platform): a miniature of acp's Comfortable bin, 1.28 × `1.28 × SORT_BIN_ASPECT` (1.6) at (9.15, 0.45), in the same right corner as the notebook, 1.25 off the tower's right face (the pawn needs 1.2) and 0.29 in from the back rim. Its shadow (~0.39 past the right edge at its 0.24 thickness) ends just inside the rim. One obstacle and one tap target. `sortBinRoam` is `roam` with it appended as obstacle 2 |
| `TowerPlatformLayout.labelPlate`, `.labelPlateHit` | The deck's floor plate in front of the stack, and its enlarged tap target. Tapping it switches the world's deck |
| `TOWER_DECKS` (`towerDecks.ts`) | Each deck's name (on the plate) and its `band` (the plate's fill), the same in every world: `RAMP[LEARNING_HUE].mid` (`yelM`) for Learning, `RAMP[MASTERY_BAR_HUES.core].mid` (`bluM`) for Mastered — the `mid` tier, because the pale `surface` tier washes out. The cards themselves are plain card stock in both decks |
| `FALL_CLEARANCE` | Extra world units a falling tower drops past the screen's bottom edge (the scene memo's `fallDistance`) |

There is no carpet (the kit's `IsoCarpet` was deleted on 2026-11-08).

The stack's `count` is the shown deck's figure on that world's bar (Learning on open).
The clouds, wind and sky → space follow the tower of the world on screen; none
start while the camera dashes between worlds (the ones already out finish crossing). The deck's name
(`TOWER_DECKS[…].label`) is printed twice: across the top card's coloured head band
(`TOWER_DECKS[…].band`, DeckTowerPlatform `stack.label` / `stack.bandColor`, carried by the
study cover card too — TowerCoverCard `deck`; restored 2026-10-24 after a short stretch as
bare card stock), and on the label plate, an `IsoFloorLabel` on the floor in front of the stack (as wide as the card,
between its front-left face and the platform edge), raised slightly off the floor as a push
button (`IsoFloorLabel` `raised`; [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)
§ "The plate button"). It is part of the floor: it is passed
to `IsoPlatform` as a floor decal, outside the pawn's depth sort, and the pawn steps up onto
it (`IsoPawn` `steps` at the plate's live height, so a pawn on the plate sinks with it when it
is pressed). The floor plate keeps
the deck named when a tall tower's top card is scrolled off screen. It is also the deck
switch ([DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md)).

**Fixed scale, scroll instead of zoom.** Cards keep a fixed thickness, so a big deck is
far taller than the screen. The page never zooms out to fit it:

- **Width sets the scale.** The viewBox is as wide as the platform (plus padding) and
  the svg is always the full width, so the scale depends only on the platform. The
  viewBox is centred on the platform's own centre; the shadow is ignored, because it
  slides off down-right with the light and would push the platform left of centre.
- **Height follows the tower on screen.** The viewBox runs from the settled tower's top
  in the world on screen (plus `TOP_HEADROOM`, 9 units, so the top card clears the header
  and title) down to the platform shadow's lowest point plus `BOTTOM_MARGIN` (1.2 units, ≈24 viewBox px — raised from 0.4 on 2026-11-04 to leave sky for the bottom cues).
  The svg takes that aspect ratio (`style.aspectRatio`). It is fitted to the settled
  tower, so nothing reflows mid-animation: it refits once, when the bar's counts
  arrive (until then it fits as 0 cards), and on arriving in another world. The memo is
  keyed on that tower's count — the TALLER of a resize's two heights while one plays, and
  mid-swap the new deck's count from `clearedMs`, before its sky drop starts.
- **Cards' imprint.** The floor under the stack always carries an imprint of its cards,
  printed "0 cards" (`IsoCardImprint`, a floor decal before the plate, so it swings with
  the trap door; see [ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § IsoCardImprint). The
  stack covers it; an empty deck, a collapse to 0 or the trap door's fall shows it already
  there. It is not a shadow, so it has no light offset. It is hidden while the deck's
  count is still loading (that reads as 0): `DeckTowerPlatform` `showImprint`, set by
  `DeckTowerPage` from `towerCounts`. Code: `DeckTowerPlatform.tsx` →
  `DeckTowerPlatform` (`decals`).
- **Build-up pace (dormant).** No tower builds up any more: since 2026-10-24 main opens at
  its last height (§ Opening at the last height), and since 2026-11-09 a deck swap's new
  tower sky-drops in (DECK_TOWER_TRANSITIONS.md § "The new tower's sky drop"), so every
  `useBuildProgress` caller passes `animate` false. The timeline is kept for now:
  `buildTimeline` (driven by `useBuildProgress`) has two phases:
  - **Cruise:** a steady `BUILD_CARDS_PER_SECOND` (40), so every deck rises at the same
    speed and the duration scales with the deck.
  - **Settle:** the last `BUILD_DECEL_CARDS` (60) cards decelerate on a power-
    `BUILD_DECEL_POWER` (3, cubic) ease-out to a stop — it brakes hard, then crawls over
    the last few cards. It is timed to start at the cruising speed (settle time =
    power × cards ÷ speed = 4.5 s), so there is no lurch where the phases meet. A deck
    smaller than 60 decelerates the whole way.

  581 cards take about 17.5 s. The build-up is skipped under `prefers-reduced-motion`.
- **Scrolling.** The svg sits in `deck-tower-page__scroller`, the page's one vertical
  scroll surface (`touch-action: pan-y`). It runs from the **top of the screen**, over
  the header, to the screen's **bottom** edge, so a tall tower climbs over the header and
  off the top of the screen. Its last `SLAB_FOOTER_TOTAL_HEIGHT` (the slab footer's
  footprint, § Footer) are a spacer under the footer (`deck-tower-page__footer-spacer`, measured into px as `footerPx` /
  `footerSpacerPx`, since the height is a `calc` with the safe area), so a tower scrolled
  to the bottom rests its platform on the slab's top. The band is **not clipped** (it was,
  by a `footerBand` `clip-path`, until 2026-10-27): the slab floats, so a tall tower
  scrolling down passes behind it and shows in the gaps beside and below it. Scroll maths that means "what the learner
  sees" uses the view above the spacer (`startResize` → `viewH`). This works because the stage is
  deliberately *unpositioned*: the scroller's containing block is `MobileTabScreen`'s
  full-screen `ScreenRoot`, which also lets it escape the clipping of the
  overflow-hidden (but unpositioned) `ScrollArea`. The cost: the header's controls (the
  minute-points flame) are covered and not tappable on this page. Its scrollbar is hidden (`scrollbarWidth: none` +
  `::-webkit-scrollbar`), the same pattern as `GamesBelt`. The scene is pinned to the bottom with
  `marginTop: auto`, so a short tower sits on the footer with sky above it. (Not
  `justify-content: flex-end`, which would push overflow past the top, where a scroll
  container cannot reach.) The scene and the footer spacer sit in a **tower section**
  (`TOWER_SECTION_CLASS`, at least a screen tall — the `marginTop: auto` pin works inside
  it), and the **cards page** runs on below it (§ The cards page). So the scroll no longer
  ends at the platform: every "bottom" in this page's scroll maths is the **platform line**
  (`towerScroll.ts` → `platformScrollTop`, the scrollTop that rests the tower section's
  bottom on the screen's), never `scrollHeight`. The page opens on the platform line. A
  refit within a world (its count arriving, a deck swap) re-snaps to it — unless the
  learner is down in the cards page, where the refit keeps their place; arriving in another
  world keeps the height of the world left (§ Worlds → "Scroll height").
- **Title.** The page header's own title is the world on screen's `TowerWorld.title`
  ("Flashcards", "Reading" or "Writing"; until 2026-10-19 it named
  the deck, and the count subtitle was removed 2026-10-17), at the standard hub size
  (28px since the 2026-11-05 header scale-up) in white (`ISO.white`, through `MobileTabScreen` `headerTitleColor` →
  `PageHeader` `titleColor`) so it reads on the sky and on space. Until 2026-10-24 it was
  a separate 40px title block under a dark "Deck" header. The header is lifted above the
  scroller (`wrapHeader`, `z-index: 2` over the scroller's 1), so the flame and the
  profile picture (`DeckTowerAvatar`) are tappable; the trade-off is that a drag starting
  on the header strip does not scroll the tower. A tall tower scrolls up behind it.
- **Status-bar band.** The scroller runs up under the clock, where iOS Safari draws its
  own scroll-edge effect, tinted with `theme-color`. Left at the paper default, it showed
  as a white fade over the sky and the top of a tall tower. The page claims the shown
  world's sky (`useThemeColor(light.skyOf(…))`, `src/hooks/useThemeColor.ts`), so the
  tint matches the sky. It follows the world and the time of day, not the sky → space
  darkening, so high up a tall tower the band can still read lighter than space.
  That covers a Safari TAB only. In the **home-screen app** the fade (an overlay that remains) takes its tint from
  `body`'s background, so on mobile `body` follows the same claim through `--surface-ground`
  (`ThemeContext.tsx` → `MuiCssBaseline`; `useThemeColor.ts` → `applyTopClaim`; device probes, 2026-10-30, [IOS_STATUS_BAR_BUG.md](./IOS_STATUS_BAR_BUG.md)
  round 8). The claim also sets `documentElement`'s `color-scheme` to `dark` on night skies
  (`useThemeColor.ts` → `schemeFor`). That was an earlier attempt at this fade and did not
  affect it; its effect on the clock glyphs is untested.
- **Shadow.** It is fitted (above), so the platform's shadow ends above the footer
  spacer rather than running under the slab.

## Footer

The page wears the **slab** footer, the floating nav bar from the Tower Style design
(`.sx-flp .ft`, frames T1–T4), instead of the app-wide flat bar. Since 2026-10-29 the
Dictionary tab wears it too (`/dictionary` — Tier-2 design,
docs/SHELF_REDESIGN.md § 7b), without a cast shadow or wash, and so do the vet cdp
(`/flashcards/card/:id`, also on the Tier 2 ground) and acp. Every Menu-reached page
(`/friends/*`, `/users/:id`, `/reader`, `/community`) and `/arena` keeps
the bar. The Menu tab's popover (`src/components/menuPopover/MenuPopover.tsx`, docs/NAVIGATION.md
§ 3) is cut from the same card stock as the slab, on both footer styles. Every slab colour is written `tier2Var(<key>, <card colour>)`
(`src/timeOfDay/tier2Chrome.ts`): unset on the tower, so the slab is the card stock below;
a Tier 2 page sets them (slate at night).

- **Opt-in per route.** The `/` row (and the two Dictionary rows, the vet cdp's and acp's) in `src/routes/routeMeta.ts` carries
  `footerStyle: "slab"`; `routeFooterStyle` defaults every other row to `"bar"`.
  `FooterPresenter` passes it to `MobileFooter` as `variant`. Between two footer routes
  of different styles the swap is **instant** (tabs have no page slide, so it lands with
  the page); leaving for a footerless route, the slab slides out as a slab (the
  presenter remembers the last style, as it does the last tab), by
  `SLAB_FOOTER_HIDDEN_OFFSET` — its footprint plus its cast shadow.
- **Shape** (`SlabFooter` in `src/components/MobileFooter.tsx`). A slab 64px tall, 16px in
  from each side and `SLAB_FOOTER_BOTTOM` (`max(26px, safe-area inset)`) off the bottom,
  radius `CARD_SURFACE_RADIUS` (15, the app's card radius — it was 22 until 2026-11-08), one equal column per tab with 6px padding (`SlabFooterFace` →
  `grid-auto-flow: column` + `grid-auto-columns: 1fr`, so the slab rebalances if a tab is
  ever flagged off). It does not bob (the design's `lev`
  float was left out on purpose).
- **Flashcard colours.** It is cut from the same stock as the tower's cards (`ISO.card`):
  `COLORS.cardFace` top, standing on a 6px lip in `COLORS.cardWall` (the card's shaded
  right wall — the token was added for this and `ISO.card.right` / `ISO.leverBase.right`
  now read it). The lip is **diagonal** (since 2026-11-08, `slabLipShadow`): the face's
  outline stepped 1px along (1, 1), so the wall shows below *and* to the right, like td's
  filter keys and the mini cards' card stock (`sortCardStock.ts` → `panelWall`), and the face's
  perimeter has the same hairline **rounded edge** (`src/theme/roundedEdge.ts`: a 0.5px fillet
  half-way between `footerFace` and `footerWall`, a 1px rim light on the top-left edge — mixed
  with CSS `color-mix` so the Tier 2 night slate carries through). The active tab is marked by ONE sliding selector (`SlabFooterSelector`) rather than a per-tab background: a FLAT rounded rectangle in `COLORS.cardBeige` (the card's face panel, `ISO.cardPanel`) with a 1px outline in `tier2Var("outline", COLORS.border)`, radius 11 (`SLAB_KEY_RADIUS`: the concentric 15 − 6px padding = 9, plus 2). It sits absolutely in the face's padding box, one `1fr` column wide, and moves by `translateX(index × 100%)` with a 280ms transform transition (`SLAB_SELECTOR_SLIDE`; none under `prefers-reduced-motion`), so switching between two slab routes slides it from the old cell to the new one — the footer is mounted once by `FooterPresenter`, so it survives the navigation. A bar↔slab style swap remounts it and does not slide. The slide starts **on the tap, not when the page arrives**: React Router v7 runs navigations as React transitions, so while a lazy route chunk loads or the page mounts, the location (and `activePage`) still reads the old tab. A tap therefore records the tab it is heading to (`pendingTab`, an urgent state update tagged with the current `location.key`), and the selector and tab ink follow `displayedTab` = that record while the location is unchanged, else `activePage`. Menu records nothing (it opens the popover). It has no side face or rounded edge: until 2026-11-10 it was a keycap with a 3px inset diagonal `cardWall` lip, which was dropped for the app's plain selected-rectangle look. Tabs, left to right, are a filled Material Symbol (`stacks` Deck,
  `school` Lessons, `translate` Dictionary, `apps` Menu; 22px, weight 500) over an 11px/600 label, `textSecondary` idle and
  `onSurface` active. The bar stays text-only.
- **Not lit by the wash** (since 2026-10-30). From 2026-10-25 the slab's face was drawn
  through the study layer's SVG `feColorMatrix` wash filter (`--footer-slab-filter`); that
  filter was cut app-wide because WebKit rasterises an SVG `url()` filter on HTML on the
  CPU, re-filtering on every repaint (§ Studying the tower → "Tap responsiveness"). The
  slab keeps its two layers — `SlabFooter` (outer: position + the cast shadow on the sky)
  and `SlabFooterFace` (inner: card colours, lip, tabs) — and is drawn in the card stock
  as is, at every hour.
- **Cast shadow.** A `10px 10px` hard shadow (`SLAB_CAST_PX` = the 6px lip + a 4px reach, along the lip's (1, 1) diagonal — the filter keys' and card stock's rule; it was the design's steeper `10px 16px` until 2026-11-08), as dark as
  the sky darkened one iso step (`shadeHex(sky, 0.1)`) but painted as a TRANSLUCENT black of
  that depth (`translucentShadow`), so it darkens whatever passes under the slab — the cards
  page included — rather than covering it with a sky-coloured patch. The sky changes every
  scroll frame as a tall tower climbs into space, and the footer is rendered outside the
  page, so the colour travels as a CSS custom property on the document root
  (`--footer-slab-cast-shadow`): `SpaceBackdrop`'s `apply` writes it with
  `setFooterCastShadow` (`src/components/footerCastShadow.ts`) and clears it on unmount.
  Unset, the slab casts nothing.
- **Layout around it.** `SLAB_FOOTER_TOTAL_HEIGHT` (screen edge → slab top; the cast shadow
  is excluded and may fall over the scene) is the scroller's bottom spacer and the `WorldIndicator`s' floor. The backdrop and `SpeedLines` run
  to the screen's bottom. A study still hides the footer with `useHideFooter`.

Code: `src/components/MobileFooter.tsx` → `SlabFooter`, `SlabFooterFace`, `SlabFooterSelector`, `SlabFooterItem`,
`SLAB_FOOTER_*`; `src/components/footerCastShadow.ts`; `src/components/FooterPresenter.tsx`
→ `HIDDEN_OFFSET`, `lastStyle`; `src/routes/routeMeta.ts` → `footerStyle`,
`routeFooterStyle`; `src/features/deckTower/SpaceBackdrop.tsx` → `apply`;
`src/features/deckTower/DeckTowerPage.tsx` → `footerSpacerRef`; `src/theme/colors.ts` →
`cardWall`.

## Worlds

`towerWorlds.ts`, `useWorldPan.ts`, `SpeedLines.tsx`, `WorldIndicator.tsx`,
`DeckTowerPage.tsx`.

| World | Id (`MasteryWorldId`) | Title | Sky (day) | Platform | Lever knob | Shown when |
|---|---|---|---|---|---|---|
| Main | `core` | Flashcards | `bluMk` (clear; turned by the weather) | `gld` | `redMk` | Always |
| Reading | `reading` | Reading | `grnSky` | `pnk` | `redMk` | `users.readingGoal` |
| Writing | `writing` | Writing | `pnkSky` | `bluCorn` | `redMk` | `users.writingGoal` |

Side by side, left to right (`WORLD_ORDER`): **reading ← main → writing**. One world is on
screen at a time: the same platform and layout (`TOWER_LAYOUT`) in that world's colours.
A world whose goal is off is skipped, and if it goes off while it is on screen the page falls back to main.

- **Coming back to the same world.** The page opens on the world its route state names
  (`{ towerWorld }`, `DeckTowerPage` → `readTowerWorldState`). A launched page's arrow pushes
  `/` with that state (`NOTEBOOK_EXIT`, `SORT_EXIT`). A browser-owned Back — the iOS/Android
  edge swipe, the browser back button, Android system back — is a `POP` to td's own earlier
  entry instead, so td keeps that entry naming the world on screen: `useRememberTowerWorld`
  writes the chosen world (`pan.world`) into `history.state.usr.towerWorld` with
  `window.history.replaceState` (not a router navigation) whenever it changes. Any back path
  therefore reopens on the world it was left from (BACK_NAVIGATION.md § 2.1 Rule 1). The
  swipe cannot play the arrow's circle close; the destination just appears.

- **Colours.** Each world has its own sky and platform hue (table above, all from the
  framework — the DAY look; night is reading's and writing's own `nightSky` or main's derived turn, § Time of day); they are NOT the bars' `MASTERY_BAR_HUES` (writing's sky is cherry-blossom pink, not its
  bar's purple). Reading's `grnSky` and `pnk` and writing's `pnkSky` and `bluCorn` are single-tier tokens added for this page
  (`colors.ts` § "Sky green, pinks and cornflower"), outside the design's ramp. Main's sky is the ramp's `bluMk` (`#59BFFF`) in
  clear weather; on the page and on acp the weather turns it toward violet (`weatherSky.ts`, § Weather). (A softer `bluSky`,
  `#83C7F0`, replaced it for part of 2026-11-04 and was deleted the same day.) Space is ONE night for every world (`SPACE` = `spaceOver(bluMk)`, the ramp's blue mark taken down to
  night): each sky fades into the same starfield. `platformTone` gives a platform the gold platform's shading. No platform is yellow (it
  would hide the `yelM` LEARNING plate). The decks' plates are the same in every world —
  Mastered is always blue (`bluM`) — so writing's cornflower platform (`bluCorn`, `#A5C5FC`, 82% L)
  carries it as a much lighter blue (88% L).
- **Getting there.** A horizontal swipe on the scene (`useSwipeCommit` on the scroller,
  axis-locked so a vertical drag still climbs the tower): LEFT brings the right-hand
  world in, RIGHT the left-hand one. It commits past `WORLD_SWIPE_FRACTION` (18%) of the
  stage width (min `WORLD_SWIPE_MIN_PX`, 48 px) of FINGER travel, or on a flick. While held,
  the scene runs slightly ahead of the finger (`DRAG_FOLLOW`, 1.15, so the scene has moved
  about 21% of the stage at the commit point; only `DRAG_FOLLOW_EDGE`, 0.12, toward an edge
  with no world) on the svg's CSS `translate`, separate from the pan's `transform`, and springs
  back if it does not commit. The edge indicators (`WorldIndicator`) name the
  neighbours: a white arrow in the bottom-left / bottom-right corner (just above
  the slab footer's top, `SLAB_FOOTER_TOTAL_HEIGHT` + `FOOTER_GAP_PX`) with the world's name beside it on the inner side
  ("‹ Reading", "Writing ›"), arrow and name floating gently outward together (the
  float rides an inner wrapper, so the tap target stays put; the two indicators float in
  step on a shared clock, `floatPhaseDelay`), drawn straight on the sky
  with no box — an exception to the
  app's outline rule for tappable things. The indicators (and the cards cue on their line)
  are part of the SCROLLING content, not fixed to the screen: they are rendered inside the
  scroller's tower section (`TOWER_SECTION_CLASS`, `position: relative`), measured from its
  bottom edge, so at the platform line they sit just above the footer slab and they move with
  the platform — up and away as the cards page rises, down out of view as a tall tower is
  climbed. A tap does the same as the swipe. Swipe and arrows are off (arrows hidden) while a pan or this world's deck
  swap runs.
- **The pan** (`useWorldPan`, ~0.8 s; instant under reduced motion). Its timings are
  `DASH_MOTION` (`src/utils/pageTransition.ts`) and its streaks `speedLineField`
  (`src/utils/speedLineField.ts`), both shared with the route **dash** that opens Add
  Cards from the sort platform (§ The sort platform), so the two read as one move:
  1. `OUT_MS` (260): the scene whips off the far side (ease-in) as the speed lines gather.
     A swipe carries straight into this (`PanCarry`): the release hands over the scene's
     dragged offset and the finger's release speed (`useSwipeCommit`'s `SwipeRelease`, both
     × `DRAG_FOLLOW`), and the scene leaves from there at that speed, still accelerating
     (`outPlan` → `carriedOutPlan`: the phase is shortened to the distance left, and never decelerates; a drag
     that took the scene fully off screen skips it). The
     drag's `translate` is dropped the same frame the pan's `transform` takes the offset
     over; only a release that does not move to a world springs back. A finger that stopped
     before lifting (`RELEASE_STALE_MS`, 60 ms) carries no speed, only its offset.
  2. `CRUISE_MS` (260): empty sky racing past (`SpeedLines` at full strength: 16 flat white
     streaks racing opposite to the camera) while the sky blends into the new world's
     colour (sky and space both, smoothstep). The drawn world switches at the start of this
     phase, while no scene is on screen.
  3. `IN_MS` (300): the new world's scene slides in from the near side (ease-out) and the
     streaks die away.
  The camera travels toward the destination, so going right (main → writing) the scene
  leaves to the left. The header title does NOT ride with it: it stays put and its text
  swaps when the drawn world switches (phase 2, while no scene is on screen). The plate does not press during a pan.
- **Arriving.** The platform is keyed by world, so it mounts fresh with its pawn standing.
  Every world's tower is kept built whether on screen or not, at full height
  (`useBuildProgress` `animate` false). Main's
  tower opens at its last height (§ Opening at the last height); the skill worlds' do not.
- **Scroll height.** One altitude shared by all worlds: the camera pans sideways, so
  arriving opens at the height the learner last scrolled to (`climb`, px above the
  platform line, `heightAbovePlatform`; the svg's height differs per world, so a
  `scrollTop` would not carry over). A
  shorter tower clips it at its top, but `climb` keeps the height asked for (the page's
  own scroll sets are ignored when recorded, `placedScrollTop`), so panning on to a taller
  world climbs back to it. Down in the cards page `climb` is negative, and an arrival keeps
  that depth in the next world's cards page. A refit within a world (counts arriving, a
  deck swap) resets it to the platform, unless the learner is in the cards page. Not
  persisted: a page open starts on the platform.
- **Its own deck.** Every world has its own plate, deck and swap (one `useDeckSwap` per
  world, [DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § "Several worlds"):
  reading flips between reading Learning (off cooldown) and reading Mastered, writing
  likewise. The deck shown is named on the plate and the top card; the page title names
  the world (`TowerWorld.title`), switching mid-pan while no scene is on screen.
- **Sky travellers everywhere.** Clouds, wind and space appear in every world, at the
  same card heights, around that world's tower. Clouds follow the weather (only under
  `cloudy`, in any world). Wind and space are earned in EVERY world: wind blows only once
  the tower reaches the wind band (`cardsOnTower >= WIND_BAND_CARDS.from`, `windActive`;
  until 2026-11-08 reading and writing had wind whatever their count). Reading's and
  writing's bands are still measured against a sky at least `SKILL_WORLD_SKY_CARDS` (the
  wind band's top, 400 cards) high (`alwaysHasSky`), so a band is never lowered to a short
  tower — today that matters only for their clouds, which keep their card heights. The
  scene (and the scroll) is still framed to the tower's own top + `TOP_HEADROOM`, like
  main's, so a cloud band above a short tower flies above the screen, out of sight.
  Space is earned too, so a short skill tower never reaches it. While the reading world's
  aurora shows, its clouds are off (§ Time of day → "Aurora").

(Until 2026-10-19 the reading and writing towers stood on their own platforms behind the
main one, up-left and up-right, reached by a diagonal camera pan; that layout was replaced
by the swipeable worlds.)

## Study mode

`towerModes.ts` (`TOWER_MODES`, `bandTotal`), `DeckTowerPage.tsx` (`learningCount`).

The Learning tower always stands in **Mix**: all four utcm bands, off-cooldown cards only
— the flp's Study Mix, the only loop the flp deals (the flp has no Review / Challenge
modes; `server/contracts/studyMode.ts` is the world axis only). `TOWER_MODES` is still
keyed by mode (`mix` only) so `TOWER_MODES.mix.bands` reads as what it is.

Until 2026-10-22 a **Mix / Review switch** (`IsoModeSwitch`, in its own hatch at the floor's
right corner on screen) flipped each world's Learning tower to Review (Comfortable +
Mastered), shrinking or growing it through § Tower resizes. It was dropped, and the
component was deleted on 2026-11-08. The floor corner it
stood in is open floor the pawn may roam, except on the writing world, where the notebook's
paper stack stands there (§ The notebook stack).

## Floor fixtures

`DeckTowerPage.tsx` (`leverArgs`, `LEVER_LANDS_AFTER_PAWN_MS`), `usePopUpMotion.ts`,
`DeckTowerPlatform.tsx` (`fallSx`, `leverTappable`).

The focus lever ([FOCUS_MODE.md](./FOCUS_MODE.md) § 5) is the platform's one floor fixture:
it stands in a hatch, only while the Learning deck is up, and its rise / sink / sky-fall
tweens are `usePopUpMotion`'s.

- **Leaving Learning** on a trap-door swap, it falls away with the old tower and is put away
  sunk and shut, unanimated.
- **Arriving at Learning**, it drops in from the sky on the incoming pawn's `FALL_FROM_SKY`
  cue, shifted `LEVER_LANDS_AFTER_PAWN_MS` (500 ms) later, so the pawn lands on the trap
  door's slam and the lever a beat after it. The cue is only shifted later, so the whole fall
  plays; a lever still waiting to fall draws nothing and takes no taps, even after the swap
  has ended.
- **Arriving at the page** (the Deck Tower remounts on every return to `/`), a lever the
  first counts say should stand is put up standing, with no hatch rise: the rise is kept for
  the deck growing past the threshold while the learner is on the page (`useFocusLever` →
  `firstLoad`).
- **While the tower is studied** it stays where it stands and fades away with the platform
  (§ Studying the tower → "The platform fades").

## The notebook stack

`DeckTowerPage.tsx` (`notebook` prop, `NOTEBOOK_EXIT`, `readTowerWorldState`),
`DeckTowerPlatform.tsx` (`notebook`, `roam`), `towerPlatforms.ts` (`notebook`,
`notebookRoam`), `iso/IsoPaperStack.tsx`, `useWorldPan.ts` (`initialWorld`),
`features/flashcards/writingNotebook/notebookEntry.ts` → `useNotebookTotal`,
`NOTEBOOK_PATH`.

The **writing** world's platform has a small stack of notebook paper (`IsoPaperStack`) in the
floor's right corner. It is the Writing Notebook's only entry point
([WRITING_NOTEBOOK.md](./WRITING_NOTEBOOK.md) § Entry point).

- **Height.** It has `1 + ⌊total / 20⌋` sheets (`notebookSheets`,
  `NOTEBOOK_POINTS_PER_SHEET`), where total is the notebook's belt total
  (`GET /api/writingNotebook/summary` → `totalCount`, the sum of every sheet's counter). So it
  starts as a single sheet, and is a button before anything is written, and gains a sheet per
  20 points. It is **uncapped**: a sheet is `PAPER_SHEET_THICKNESS` (0.06 units, ~1px), half a
  card, so 2,000 points (101 sheets) is about 6 units tall. The total is fetched once per visit, so writing in the notebook grows the
  stack on the next visit to the tower.
- **Shown when.** Only on the writing world, only while the **Learning** tower is drawn
  (`stackDrawn && swap.towerDeck === "learn-now"`, like the focus lever), and only once the
  total has loaded: `useNotebookTotal` stays undefined (no stack) with the `writingNotebook`
  flag off, for a non-Chinese account, while the request is in flight, and on a failed
  request.
- **Tap.** It opens `/flashcards/writing/notebook` with the **circle transition**
  ([LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § The circle transition): the notebook grows
  out of the stack's centre on screen (`DeckTowerPlatform` → `openNotebook`, the
  `.iso-paper-stack` element's rect), and Back closes it onto the same point
  (`state.circleFrom` → `WritingNotebookPage` → `LeafPage` `exitCircleTo`). The launch
  carries `state.exitTo = NOTEBOOK_EXIT`. The notebook's Back then returns to `/` with
  `state.towerWorld = "writing"`, which `useWorldPan` takes as its initial world, so the
  page reopens on writing, not main (a Back without `exitTo` also lands on `/`'s writing
  world). Taps are ignored while a swap,
  pan, resize or study is running (`busy`). The tap target is the stack's hull grown by 0.4
  units, because one sheet is only ~1px thick.
- **Animations: the tower's own.** It is driven by the tower's numbers, not its own. Leaving
  Learning on the trap door, it falls with the old tower (`fallSx(stackFalling)`). Arriving
  at Learning, it waits off stage until the swap's `readyMs`, then grows in on its own clock
  while the new tower sky-drops in (`useFixtureGrow`, `FIXTURE_GROW_MS` 900 ms, ease-out
  cubic → `fixtureProgress`): the top sheet first, the rest growing in under it
  (`IsoPaperStack` `progress`, `paperStackHeight`). Anywhere else (page open, a world
  arrival) it stands at full height. It fades with the platform during a study. Focus-lever
  resizes do not touch it, because they change the card count, not the notebook total.
- **Shadow: the tower's rules.** It casts its own `IsoShadow` (classed
  `iso-paper-stack__shadow`), hidden by the same DeckTowerPage `.deck-tower-page__falling`
  rule that hides the tower's (`iso-card-stack__shadow`), so the shadow leaves the floor the
  instant the stack starts to fall.
- **In the scene.** It is the pawn's third obstacle (the pawn walks round it), it pierces
  the fog, and rain lands on it (the fog piercers and rain solids include it, at its
  built-up height).
- **Not excluded from lightning.** `towerLightning.ts` → `STRIKE_SOLIDS` lists only the
  tower, so a strike can scorch the floor under the stack (the stack then hides the burn
  mark). The lever's corner is not excluded either.

## The sort platform

`DeckTowerPage.tsx` (`sortBin` prop, `SORT_EXIT`, `learningLow`), `DeckTowerPlatform.tsx`
(`sortBin`, `cornerButton`, `roam`), `towerPlatforms.ts` (`sortBin`, `sortBinRoam`,
`roamWithCornerFixture`), `iso/IsoSortPlatform.tsx`, `iso/sortPlatformMetrics.ts`,
`src/hooks/useDiscoverNavigation.ts` → `sortPath`, `src/hooks/useCategoryCounts.ts`,
`server/contracts/wire.ts` → `LEARN_NOW_LOW_THRESHOLD`.

The **main** world's platform has a miniature of acp's Comfortable bin (`IsoSortPlatform`; acp's
band-coloured bins, SORT_CARDS_REQUIREMENTS.md § 5.3) in the floor's right corner — the corner the notebook stack takes on the writing world. It is
the Add Cards button ([SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md)).

- **Look.** An exact miniature of acp's third bin, Comfortable, as it looks empty: its
  platform in `BAND_MID.Comfortable` (`grnM`, the band MID tier) washed for the time of day,
  with IsoPlatform's light rim bevel, and acp's own print on the top — the big "3" in the
  deck's dotted outline (`src/features/discover/SortBinPrint.tsx` → `SortBinPrint`, in the
  washed `SORT_BIN_PRINT_INK`). Everything is acp's bin scaled by 0.2
  (`sortPlatformMetrics.ts` → `sortMiniScale`): a 1.28 × 1.6 footprint, corner radius 0.2,
  0.24 thick (`sortMiniThickness`). No deck. It sits on the floor (acp's bins float).
  On 2026-11-11 it went through one slab in four coloured quadrants → four platforms in
  acp's S piece → a 2 × 2 → tiles set in a base (white, grey, red) → the Unfamiliar bin
  (red; read muddy on the gold floor) → this. Green was picked for contrast: of the four band
  colours it stands clearest of the gold floor (OKLab ΔE ~19, luminance ratio 1.43; red was
  ~15 / 1.11) without repeating a colour beside it (the yellow Learning plate, the blue
  Mastered plate and sky), and the print reads on it at ~4.3:1. Under snow one cap
  hides the top, print included (docs/TOWER_SNOW.md). Its right edge is set in from the
  floor's right edge so its shadow stops just inside the rim; its left edge is 1.25 off the
  tower's right face, so the pawn still passes between (`towerPlatforms.ts` → `SORT_BIN`).
- **Shown when.** Only on the main world, only while the **Learning** tower is drawn
  (`stackDrawn && swap.towerDeck === "learn-now"`) — the notebook stack's rule. It falls
  with the old tower on the trap door, and arriving it grows in on the notebook's clock
  (`fixtureProgress`, from `readyMs`): the slab grows up out of the floor.
- **Cards low: it jumps.** While the core Learning count (U+T+C, cooling or not —
  `builtinCollectionCount({ kind: "learn-now", world: "core" })` over
  `useCategoryCounts("core")`) is under `LEARN_NOW_LOW_THRESHOLD`, it makes one big jump
  every 2 s (`HOP_PERIOD_MS`): a 1.6-unit jump and two rebounds (0.28 and 0.08 of it),
  all inside 1 s, each flight timed by the square root of its height, then 1 s of rest. Its
  shadow shrinks and fades as it rises. This is deliberately the cards page's Learning figure, not the
  tower's own off-cooldown figure (`DeckTowerPage` → `learningLow`). It reads `ok`, not `loaded`, so a failed fetch
  never sets it jumping. It stops while it falls and freezes with the tower's bob during a study;
  none under reduced motion. The count is fetched once per visit.
- **Tap.** It opens `/discover/sort/:language` with the **dash transition**
  ([LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § The dash transition): the world pan's camera
  dash, travelling RIGHT — td whips off to the left, the speed lines stream past in this
  world's washed `ISO.wind` (`light.wash`), and acp slides in from the right. The launch
  carries `state.exitTo = SORT_EXIT` (`/`, `towerWorld: "core"`) and `state.dash`
  (`{ lineColor }`), so acp's Back dashes LEFT back onto the tower and lands on main
  (`AddCardsPage` → `leave`, `dashBack`; NodePage `exitDash`). The footer's **Flashcards
  tab** does the same on such a launch: it plays Back, dash included, instead of jumping
  (NodePage `backOnFooterTab="deck"`, `components/footerTabOverride.ts`; LEAF_NODE_PAGES.md
  § Footer tab overrides). Without `exitTo` (a deep link, or a reload that lost the
  state), acp's Back slides to `/`'s main world.
  Taps are ignored while a swap, pan, resize or study is running (`busy`). The tap target
  is the base's hull grown by 0.3 units, and up to the top of its jump while hopping.
- **Shadow, fog, rain.** Its shadow (`iso-sort-platform__shadow`) is hidden by the same
  `.deck-tower-page__falling` rule as the tower's. It is the pawn's third obstacle, and a
  fog piercer / rain solid up to its slab's top.
- **Shared code with the notebook.** Both corner fixtures go through
  `DeckTowerPlatform` → `cornerButton` (the role/keyboard/hit-path wrapper and the circle
  point — only the notebook still uses the point), and both roams are built by `roamWithCornerFixture`. Never both on one platform.

## Corner fixture labels

`DeckTowerPlatform.tsx` (`FIXTURE_PRINT`, `fixturePrint`, `renderFixturePrint`, `floorDecalsShaded`, `decals`), `towerPlatforms.ts`
(`sortBinLabelAt`, `notebookLabelAt`, `labelUnder`), `iso/IsoFloorPrint.tsx`,
`src/softIntro/softIntroRegistry.ts` (`towerSortLabel`, `towerNotebookLabel`).

Each corner fixture is named on the floor in front of it — "ADD MORE / CARDS →" under the sort
platform, "WRITING / NOTEBOOK" with a "→" hung after row 2 under the notebook stack — as a soft introduction
([SOFT_INTRODUCTION.md](./SOFT_INTRODUCTION.md)): the print shows until that fixture's si
graduates (70 visits and 14 days on this device), then the fixture stands alone.

- **Look.** Two lines printed flat into the floor (`IsoFloorPrint`, bold, letter-spaced, 0.7
  units for both prints), turned a quarter-turn so they read along world −y (`run="-y"` —
  up-right on screen, toward the fixture) and set flush to their end (`align="right"`). Row 2
  ends with a "→" that, reading in the run's direction, points straight at the fixture. On
  the sort print it is part of the line ("CARDS →" ends flush with "ADD MORE"); on the
  notebook's it hangs past row 2's end, outside the edge (`IsoFloorPrint` `tail`), so the
  last letters line up (WRITING's G with NOTEBOOK's K).
  In white (`COLORS.white`, washed for the time of day). No plate, not raised: the pawn walks over it. The pawn's shadow DARKENS it
  rather than covering it: the print is passed again in its shaded ink (`shadowTone` of the
  washed white) in the pawn's `decals`, alongside the shaded plate (`DeckTowerPlatform` →
  `renderFixturePrint`, `floorDecalsShaded`; ISO_ART_FRAMEWORK.md § IsoPawn "Shadow on decals").
- **Where.** On the floor in front of the fixture's front-left face (+y) — the way the deck
  plate sits in front of the tower — with the arrow's tip anchored `FIXTURE_LABEL_GAP` off
  that face (`anchor="end"`, `labelUnder`), so the print runs out toward the viewer from there.
  Across the run the block is centred on the fixture's x, capped so its second line stays
  inside the rim (`FIXTURE_LABEL_MAX_X`).
- **Shown when.** Exactly when its fixture is drawn (§ The notebook stack / § The sort
  platform rules), and only in the intro state. It fades in on the fixture's grow-in
  (`progress`), swings away with the floor on the trap door, and fades with the platform
  during a study (it is a floor decal).
- **Visits.** One `useSoftIntro` per fixture in `DeckTowerPlatform`, each `enabled` only
  while its fixture is passed in, so neither world nor the Mastered deck graduates the other's
  print. The platform remounts per world, and the 30-minute dedupe keeps pans from counting
  up. Testers force either style from Settings → "Soft introductions"
  ([SOFT_INTRODUCTION.md](./SOFT_INTRODUCTION.md) § 5).

## Tower resizes

`towerResizes.ts` (the library), `useTowerResize.ts` (the player), `DeckTowerPage.tsx`
(`startResize`, `resolveRecount`, the camera effect, `keepClimbFor`), `DeckTowerPlatform.tsx`
(draws them), `useFocusLever.tsx` (`onRecount`), `src/hooks/useFlpReadyCounts.ts` (`version`).

Every action that changes a standing tower's height in place plays an animation from one
library (a study session's count changes play nothing, § Studying the tower; a shrink from the learner's own marks plays nothing, below): a **shrink** from `TOWER_SHRINKS`, a **grow** from `TOWER_GROWS`, picked at random
(`pickTowerShrink` / `pickTowerGrow`, the shape of the deck swaps' `DECK_TRANSITIONS`). Each
list has one entry today. Callers:

| Action | Shrink | Grow |
|---|---|---|
| Focus lever ([FOCUS_MODE.md](./FOCUS_MODE.md) § 5) | focus on (the pile → today's set, ≤ 25) | focus off (today's set → the pile) |
| Deck swap's new tower ([DECK_TOWER_TRANSITIONS.md](./DECK_TOWER_TRANSITIONS.md) § "The new tower's sky drop") | — | 0 → the new deck's count at the slam, either deck, no camera move (`startResize(…, { camera: false })`) |
| Climbing out of a study (§ Studying the tower) | none — the tower just stands at the lower figure | cards came back off cooldown mid-session |
| Opening the page, main only (§ Opening at the last height) | none — the tower just stands at the lower figure | cards came off cooldown since the last visit |

- **Marks are not a removal.** Cards leaving the tower because they were marked correct, on
  a card or in a game, are the learner's progress, so the ghost collapse never plays for
  them: only the focus lever's shrink shows it. The two hold with `quietShrink`
  (`useTowerResize` → `hold`, `holdQuietShrink`), and `resolveRecount` `release`s a lower
  figure instead of calling `startResize`.

- **Planning and playing.** The page plans a resize (`startResize(fromCards, toCards)`): it
  sets `keepClimbFor` to the frame it will refit to, and for a grow that `usesCamera` it
  plans the camera move and how far above the landing the sky starts. The library entry
  turns that into a `TowerResizePlan` (`kind` names the animation). One `useTowerResize`
  per world plays it, and DeckTowerPlatform draws it by `kind`. A new animation is an entry
  in a list, a `kind`, a branch in the player's clock and a branch in the renderer.
- **The old height holds.** While a resize plays, the settled tower stands at `fromCards`
  (`heldCards`, on either deck — a Mastered tower only ever has one through a swap's drop),
  and the scene is fitted to the taller of the two heights, so nothing redraws the count
  mid-animation. At the end the new count takes over.
- **Busy.** While one plays (or holds), the plate, the lever, swipes and arrows
  are off.
- **The focus lever's hold.** The lever's new figure comes from the server some time after
  the popup's Yes. Just before the re-read, `useFocusLever` calls `onRecount`, and the page
  `hold`s the tower at the height it stands at, tagged with the counts' fetch `version`
  (`useFlpReadyCounts`, bumped whenever a fetch settles — success or failure). When the
  version moves (`resolveRecount`), the held tower shrinks or grows to the re-read figure.
  An unchanged figure (or a failed re-read) plays nothing; a world no longer on screen, or
  no longer on Learning, just lets the hold go.
- **Instant** under reduced motion, or when the counts do not change: the count just changes.

**Shrink: ghost collapse (`GHOST_COLLAPSE`).** `planCardCollapse(fromCards, fromCards − toCards)` picks the
cards that go at random (`IsoCardRuns`): they ghost out a few at a time over about `planCardCollapse(mixCards, U+T)` picks the U+T count's worth
of the tower's cards at random (`IsoCardRuns`): they ghost out a few at a time over about
a second, each leaving a light wireframe of its cards behind that holds a beat and then
fades too (in the same order), while the top card's figure counts down to the new
total. Once the last wireframe has gone the gaps hold open a beat, then every floating run
drops into place under gravity, the lower ones landing first. If the bottom card is one of
the ghosts, the tower's floor shadow fades with it and darkens back in as the lowest run
lands on the floor, from the impact (it stays gone when every card ghosts). The scene stays fitted to the taller tower until the collapse ends, then refits to the
shorter one keeping the altitude (`keepClimbFor`), so the camera does not jump.

**Grow: sky drop (`SKY_DROP`).** The page plans against the taller frame it is about to
refit to (`fitScene`, pure):

1. **Camera** (`CAMERA_BASE_MS` 260 + 0.5 ms/px, ≤ `CAMERA_MAX_MS` 900; 0 if already
   there): the scene refits to the taller frame keeping the altitude, then the scroller eases
   so the landing point — the standing tower's top — sits `LANDING_ON_SCREEN` (62%) down the
   screen. Written straight to `scrollTop` and marked as the page's own (`placedScrollTop`).
2. **Drop:** a tower of the new cards (`IsoCardStack` with its top card printing the new
   total, `figure`) falls from with its underside `DROP_CLEARANCE` (1 unit) above the
   screen's top edge — at least `DROP_MIN_LIFT` (8) above the landing — under
   `SKY_DROP_GRAVITY` (130 units/s²), as a CSS free fall. A seam is drawn under its bottom card,
   where it meets the standing tower's top card. When the standing tower had no cards it lands
   on the bare floor instead: its floor shadow is drawn there, still, and fades in from the
   impact (`shadowLandTiming`) — not before, or it would cover the "0 cards" imprint while
   the tower is still in the air.
3. **Impact** (`IMPACT_MS` 760): the whole loaded platform sinks `IMPACT_SINK` (0.55
   units) and springs back past rest before settling (on top of its bob), and a ring of
   smoke puffs bursts round the join — the back half under the dropped tower, the front half
   over it. The tower counts as the new total from this frame (`dropLanded`, timed from
   the frame the drop mounted, since its CSS fall starts on that paint), so a total crossing
   `STARTLE_AT_CARDS` startles the pawn on the impact, and a band the tower now reaches
   (wind) switches on with it.

At the end the two stacks are replaced by one `IsoCardStack` of the new count, which draws
the same picture.

## Time of day

→ **Partly built:** [TOWER_WEATHER_SKY.md](./TOWER_WEATHER_SKY.md) — dawn and sunset are cut
app-wide (built 2026-11-04) and main's day-sky hue follows the weather (built); main's sky
lightness following the sun's elevation is NOT built. Everything below describes today's code.

`timeOfDay.ts`, `useTimeOfDay.ts`, `TimeOfDayToggle.tsx`, `DeckTowerPage.tsx`; the wash
itself is the iso framework's ([ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § "Ambient wash").

**The CLOCK is shared (2026-10-29)** — `src/timeOfDay/`: `dayPhase.ts` → `timeOfDayAt`,
`DayPhase`, `TimeOfDay`, `phaseShare`; `sunTimes.ts` → `deviceLocation`, `sunDay`;
`tzCoordinates.ts` → `TZ_COORDINATES`; `useDayClock.ts` → `useDayClock`, `TimeOfDayOverride`
(sampling + the feature-tester override, a module store so every reader sees a pin at
once). The tower's `timeOfDay.ts` keeps only what a phase LOOKS like over the tower and
re-exports the clock's types; `useTimeOfDay` wraps `useDayClock`. Other readers: the Dictionary
page's tier-2 look (`src/timeOfDay/tier2Look.ts`) and the acp
(`features/discover/sortTimeOfDay.ts`). The eip was a reader until 2026-11-05; it now follows
the Settings theme instead ([EIP_SHEET_GESTURES.md](./EIP_SHEET_GESTURES.md) § "Light / dark theme").

Every world follows the learner's clock through two phases, **day** and **night**
(`DayPhase`). Day is each world's own sky token (the Worlds table). Night is the world's own
`nightSky` where it has one (reading, writing), else derived from its day sky (main). Dawn and sunset were phases of
their own (pink / orange skies, tints on every tier-2 reader) until they were cut app-wide
on 2026-11-04 ([TOWER_WEATHER_SKY.md](./TOWER_WEATHER_SKY.md) § 1); the day ↔ night blend
is now the only twilight.

- **Where and when.** The location is the device's IANA timezone (`Intl`) looked up in
  `TZ_COORDINATES` (each zone's principal city, legacy aliases included); a zone missing
  from it falls back to longitude = UTC offset × 15° at latitude 35°N (`deviceLocation`).
  No permission prompt, no server call. A wide zone collapses to one city — accepted.
  `sunDay` computes that day's sunrise and sunset (NOAA sunrise equation, ±a few minutes).
- **Keyframes** (`timeOfDayAt`), `TWILIGHT_MS` (30 min, cut from 1 h on 2026-10-28) either side of
  each event: night until sunrise − 30 min → blend → day from sunrise + 30 min; day until
  sunset − 30 min → blend → night from sunset + 30 min. So each twilight is one hour-long
  linear day ↔ night blend, half-way at the sun event (yesterday's, today's and tomorrow's
  keyframes are all built, so a night is always bracketed). A day too short for any plain
  day blends up to day at its midday and straight back; a polar day / night holds day / night.
- **Sampling** (`useTimeOfDay`). Once a minute and on `visibilitychange` → visible; a sample
  with the same look (blend within 0.005) keeps the old `TowerLight`, so nothing re-renders.
- **Skies** (`phaseSky`, `NIGHT_SKY`, `TowerWorld.nightSky`). Day is the token itself. Night
  is the world's own `nightSky` (OKLCH, `towerWorlds.ts` → `READING_NIGHT_SKY`,
  `WRITING_NIGHT_SKY`; chosen 2026-11-08 in an OKLCH explorer) or, for a world without one,
  the day token in OKLCH with its hue turned 35% toward 270° along the shortest arc, at
  L 0.34, C 0.08 (`NIGHT_SKY`). Main has no `nightSky` on purpose: its day sky follows the
  weather, so its night must be derived from whatever the day sky is.

  | Phase | Main (bluMk + weather) | Reading (grnSky) | Writing (pnkSky) |
  |---|---|---|---|
  | Day | `#59BFFF` clear, turned by the weather (`weatherSky.ts`) | `#78E292` | `#FFD8EA` cherry blossom |
  | Night | `#0D3A5F` (the `NIGHT_SKY` turn) | `#004C37` aurora teal — `nightSky` L 0.36 C 0.095 h 172 (red channel clipped: just outside sRGB) | `#372053` velvet violet — `nightSky` L 0.30 C 0.09 h 302 |

  The per-world `TowerWorld.skyRecipes` overrides were removed with dawn and sunset (every
  override was a dawn or sunset recipe). `nightSky` (2026-11-08) is a different thing: a
  fixed night colour, not a recipe.

  Night stays lighter than `SPACE` (L ≈ 0.25), so climbing a tall tower at night still
  deepens into space. ⚠️ Derived colours, outside the colour framework (like `spaceOver`).
- **The wash** (`src/timeOfDay/wash.ts` → `PHASE_LIGHT`, `phaseWash`; `towerLight` → `wash`). Everything drawn ON the sky is lit:
  platform, floor, cards, plates, pawns, lever, clouds, wind, smoke, and the page's own
  white ink — the header title (`headerTitleColor`), the world arrows (`WorldIndicator`
  `color`), the speed lines (`SpeedLines` `color`) and Tap to Start. **Only night washes**: 7% toward `bluMk` (cut from 14% on
  2026-10-28 — it read too blue), dimmed 4% (OKLCH lightness; cut from 22% on 2026-10-25 —
  it read too dark). `src/timeOfDay/wash.ts` → `NIGHT_WASH_ENABLED = false` switches the wash off
  (night unlit, no filter) without touching the sky, stars or shooting stars. Day is the
  identity, so the wash only appears blending into and out of night. The sky is never washed — it is the light. The
  page hands the wash to `IsoScene` (`wash`), to `TowerCoverCard` (which must match the
  scene's top card), and lights each world with `litWorld` (sky, ground plane, platform
  tone, floor, lever ball). **The flp session (§ Studying the tower) and the slab footer are
  NOT washed**, and no DOM game panel is. Until 2026-10-30 the study layer took the wash
  as an SVG `feColorMatrix` `url()` filter (`washColorMatrix`); it was cut because WebKit
  rasterises that filter on the CPU and re-ran it on every repaint inside the session,
  which made the flp's taps lag at night (§ Studying the tower → "Tap responsiveness").
  **The wash fades with the dive** (`DeckTowerPage` → `sceneWash`, `WASH_FADE_STEPS`): the
  scene and `TowerCoverCard` take `blendWash(light.wash, NO_WASH, e)` on the dive's eased
  position `e` (stepped to 1/24 of the dive, since each new wash re-washes `IsoScene`'s
  palette), so the wash is gone by the time the camera lands on the count card, stays off
  while the camera is down (the count card sliding off and back on is unwashed, matching the
  flp card under it), and returns on the climb. By day `light.wash` is `NO_WASH` and this is
  the identity. The page's sky ink (title, arrows, speed lines) keeps `light.wash` — it has
  faded out by then anyway.
- **Stars** (`PHASE_STARS` → `SpaceBackdrop` `groundStars`): 0.55 opacity from the ground at
  night, 0 by day (blended across each twilight); the climb's own fade-in wins wherever it is stronger.
- **Shooting stars** (`towerLight` → `shootingStars` → `SpaceBackdrop` → `ShootingStars`).
  While night's share of the blend is ≥ 50%, a roll every 5 s (`ROLL_INTERVAL_MS`) fires
  a burst of 1–3 meteors with 1% probability (`BURST_CHANCE`), so a burst comes about once
  every 8 min of night. The first roll waits one tick.
  A burst's meteors are 180–650 ms apart and **always fall down-left** (18–38° below
  horizontal), spawning in the right 35–95% and upper half of the backdrop.
  Each is a flat `ISO.star` streak (round head, tapering 55%-opacity tail polygon, no
  gradient) that travels 150–260 px in a straight line over 0.42–0.65 s while fading in and
  out (one CSS keyframe on CSS variables), then removes itself. (A curved flight was tried
  on 2026-11-11 and rejected; meteors fly straight.) Screen space, behind the scene svg, so
  the tower occludes it. Skipped while the tab is hidden and under
  `prefers-reduced-motion`; leaving night drops any meteor mid-flight. State lives in
  `ShootingStars`, so a burst re-renders only that layer.
  *Tester trigger* (`ShootingStarChip` "☄️ Meteor", § Feature-tester rows): each tap bumps
  `DeckTowerPage` → `shootingStarRequest` → `SpaceBackdrop` → `ShootingStars`
  `burstRequest`, which fires one burst now regardless of night, a hidden tab, reduced
  motion or a showing aurora. Pair it with the time-of-day row's Night (by day the white
  streaks are faint).
- **Aurora** (`towerAurora.ts`, `AuroraLayer.tsx`, `AuroraToggle.tsx`; decided 2026-11-08).
  A rare aurora over the **reading world only** (`AURORA_WORLD`). Not weather-dependent.
  - *The roll.* `useTowerAurora` rolls `AURORA_CHANCE` (1%) **once per page visit**, the
    first time during this mount of DeckTowerPage that the look is mostly night
    (`light.shootingStars`). A visit that never reaches night never rolls. The result holds
    across world swipes and study sessions (the flp runs in place) and ends when the page
    unmounts.
  - *Strength.* `auroraStrength` = night's share of the blend (`TowerLight.nightShare`) in
    the reading world, 0 elsewhere. It rides the pan's palette (`WorldPalette.aurora`,
    blended like the sky), so a swipe out of reading fades it with the sky's colour.
  - *Drawing* (`AuroraLayer`, inside SpaceBackdrop between `StarField` and `ShootingStars`).
    One canvas, within `AURORA_BAND`: three swaying folds of thin vertical strips, each strip a stretched copy of
    one gradient sprite running from `pnk` tips down to a `grnSky` base (`AURORA_COLORS` —
    the day sky comes back as the night's light), modulated by shimmering rays and a rolling
    envelope, added with `lighter`. No blur or filter (the reason the SVG-filter wash was
    cut). ~30 fps, idle at strength 0 or while the tab is hidden, DPR capped at 1.5, one
    still frame under `prefers-reduced-motion`. SpaceBackdrop fades it out over the whole
    climb into space (`AURORA_FADE_TO` = 1).
  - *Glow.* While the reading world's aurora is up, the scene's wash gains an sRGB mix
    `AURORA_GLOW` (5.8%) × strength toward `grnSky` (`useAuroraGlowWash`, stepped to 1/20).
    DeckTowerPage builds `light` from `dayLight` with that wash, so everything `light.wash`
    reaches (platform via `litWorld`, IsoScene, `TowerCoverCard`, the sky ink) takes the
    glow, and it fades with the dive like the wash. The sky is not glowed. With no aurora,
    `light` IS `dayLight` (same identity), so no memo is disturbed.
  - *The roll needs a clear sky* (`auroraCanRoll`): mostly night AND no known non-clear
    weather — a `clear` reading, or no reading at all (weather effects off, the default,
    or a failed fetch), so learners without weather still get it. With weather on, it
    waits for the first answer (`useTowerWeather` → `settled`). A tester's weather pin
    counts like a reading. If the first night is cloudy, the roll waits for it to clear.
  - *The only event in the sky.* While it shows (`auroraShowing`, DeckTowerPage →
    `auroraUp`), that world has no weather effects — `weatherFx` is undefined (no
    rain/snow particles, lightning flashes or strikes, fog), `rainFall` is withheld and
    `cloudsInSky` is 0 — and no shooting stars. The observed weather still reads
    (`observedWeatherFx`; main's day sky follows it), so swiping to main brings it back.
  - *Band.* It fills a band of the screen's height (`AURORA_BAND`: 5% → 60% from the top
    of the backdrop, which is the full screen): each fold's base sways near the band's
    bottom and its rays reach toward the band's top; nothing draws outside it.
  - *Tester toggle* (`AuroraToggle`): Aurora: Auto · On · Off, beside the time-of-day chips (§ Feature-tester rows). Page
    state, not per-device storage: it resets when the page is left, like the aurora. On
    still shows only at night, so pair it with the time-of-day row's Night.
- **A pan** blends between the two worlds as they look now (`useWorldPan`'s `paletteOf`).
- **Tester toggle.** Accounts with `users."isFeatureTester"` (migration 178) and the Settings
  testing switch on (`useTestingFeatures`, [FEATURE_TESTING.md](./FEATURE_TESTING.md)) get a chip group
  under the header — Auto · Day · Night (`TimeOfDayToggle`, frosted chips,
  the chosen one solid ink). A phase pins that look; Auto follows the clock. Stored per
  device (`localStorage` `deckTower.timeOfDayOverride`) and read only for feature testers,
  so a stale key on a shared device never changes a learner's sky. A pin stored before the
  2026-11-04 cut (`dawn` / `sunset`) is not a `DAY_PHASES` value and reads as Auto. It rides the header
  layer, so it fades and unmounts with the header during a study.

## Weather

The learner's **real local weather** over the sky — purely aesthetic (nothing else reads
it). Shown **only on the Deck Tower** for now (owner's choice 2026-11-04: not on the tier-2
pages, the acp or the eip). Off by default; turned on per device in Settings → Display.

**Code:** `towerWeather.ts`, `useTowerWeather.ts`, `WeatherLayer.tsx`, `WeatherToggle.tsx`,
`SpaceBackdrop.tsx` (`weather` prop, `WEATHER_FADE_TO`), `weatherSky.ts`, `DeckTowerPage.tsx` (`weatherFx`, `rainFall`, `RAIN_CEILING_CARD`, `skyWorlds`), `DeckTowerPlatform.tsx` (`fog`, `rain`, `rainCeilingY`), `iso/IsoFog.tsx`, `iso/IsoRain.tsx`; `src/hooks/useWeatherEffectsSetting.ts`;
`src/pages/settings/SettingsBody.tsx` (`settings-page__weather-row`, `WEATHER_SUBTITLE`);
`src/api/weather.ts` → `fetchWeather`, `fetchWeatherShared`; `src/hooks/useWeatherPrefetch.ts`; server files in the Layers table.

### What it looks like

`WeatherNow` (`server/contracts/wire.ts`) carries a particle family `kind`
(`WEATHER_KINDS`), a 0–1 `intensity`, and the raw `wmoCode` + `cloudCover` it was folded
from:

| Kind | Particles (`weatherEffect` → `WeatherLayer`) |
|---|---|
| `clear` | none |
| `cloudy` | no particles; drifting clouds (`IsoCloud`) at cards 150–200 — 2–3 for partly cloudy, 4 for overcast (`weatherCloudCount`; the `CLOUD_BAND_CARDS` row) — and, 1 drift in 100, a red balloon at cards 110–140 instead. The only kind with clouds: the others are cloudy in life, but the tower draws none for them |
| `fog` | flat translucent white fog clouds — 2–4 skinny staggered pills each, bridged where they overlap by gaps with filleted (rounded, concave) ends — at three heights, rolling across the whole screen width (over the platform and the sky either side) in iso space (`iso/IsoFog.tsx`, field from `iso/fogClouds.ts` → `planFogClouds`; drawn by `DeckTowerPlatform` via its `fog` prop — not `WeatherLayer`) |
| `drizzle` | very sparse short rain streaks (2–5 per 100k px² by intensity), plus small splashes on the platform (`iso/IsoRain.tsx`) |
| `rain` | longer, faster rain streaks just denser than drizzle (5–8 per 100k px²), plus drops in front of the tower splashing on the platform and the tower's top (`iso/IsoRain.tsx`) |
| `snow` | falling, swaying flakes; flakes also fall in front of the platform and settle on it (`iso/IsoSnow.tsx`), and snow **settles on the platform's components** on page entry and stays until cleared — [TOWER_SNOW.md](./TOWER_SNOW.md) |
| `storm` | heavy rain (with `IsoRain`'s front drops and splashes) + a double-strike white flash every ~11 s ± 45%, each with a 1% chance to strike the platform (§ Lightning strikes) |

- **Sky colour (main world only):** `weatherSky.ts` → `weatherDaySky` sets main's DAY sky
  hue per WMO code at the original `bluMk` lightness and full chroma — clear (and no
  weather, including the Settings switch off) is the original `bluMk` `#59BFFF`, worse weather turns
  toward violet up to fog's `#9DAEFF`. Night turns that sky as usual
  (`phaseSky`). Design and the full table: [TOWER_WEATHER_SKY.md](./TOWER_WEATHER_SKY.md).
  This is why `WeatherNow` keeps `wmoCode`: the particle `kind` folds codes the sky tells
  apart (partly cloudy vs overcast, sleet vs rain). Tester pins use one code per kind
  (`pinnedWeather`), so partly cloudy and sleet appear only with real weather.
- **Particles** are flat `ISO.rain` / `ISO.snow` / `ISO.fog` / `ISO.lightning` (all
  `COLORS.white`) at the layer's own opacities. Rain and snow share one `<canvas>` and one
  rAF loop (no React state per frame), densities per 100k px² of sky, backing store capped
  at 2× DPR, frame step clamped to 50 ms. `prefers-reduced-motion`: no particles or flashes,
  fog holds still.
- **Fog is in the scene, not the sky.** `WeatherEffect.fog` is the fog's opacity per
  height level (0.2 + 0.12 · intensity). The page plans the field once per framing (`fogClouds`,
  `planFogClouds` over `scene.fogCover`: the scene's full width, from `FOG_ABOVE_SLAB` over the
  slab's back corner down to the scene's bottom edge) and hands both to `DeckTowerPlatform`
  (`fog`), which draws
  `IsoFog` over everything on the floor. The standing tower is a *piercer*: it is cut out
  of every fog level it rises above, and a tower shorter than a level sits wholly under it
  (ISO_ART_FRAMEWORK.md § IsoFog). Because the fog is a platform layer, it bobs with the
  slab, takes the study fade (`layerFade`) and leaves with the world on a pan. It does not
  use the altitude fade: it scrolls away with the platform instead.
- **Rain is in BOTH places.** The sky's rain (`WeatherLayer`) is behind the svg, so the
  platform and tower hide it. `IsoRain` draws the drops that layer cannot: each one has a
  landing point on the visible floor or on the standing tower's top card. It falls in front
  of everything on the floor and splashes there with a flat iso ring and two droplets. The
  page builds `rainFall` from `weatherFx` for every kind with `rainDensity > 0`. Streak
  lean, opacity and width are the shared `RAIN_LEAN` / `RAIN_ALPHA` / `RAIN_STROKE_PX`
  (`towerWeather.ts`), so both layers read as one rain. `DeckTowerPlatform` mounts it
  (`rain` prop) after the fog and before the front sky travellers. The standing tower is its
  one solid (the same `fogPiercers`), so the floor behind the tower never gets rain. It is
  not mounted during a study, and it starts no higher than `RAIN_CEILING_CARD` (a quarter
  of the way into the space band, `scene.rainCeilingY`). That cloud base stands in for the
  altitude fade it does not take (ISO_ART_FRAMEWORK.md § IsoRain).
- **Placement:** inside SpaceBackdrop, over the stars and meteors, BEHIND the scene svg —
  the tower and cards stay crisp in front of the weather, and the flp session and footer
  are never covered. (Fog and `IsoRain` are the exceptions above, inside the scene.)
- **Altitude:** the layer fades out over the first half of the sky → space blend
  (`WEATHER_FADE_TO`, a direct style write in SpaceBackdrop's `apply`) — weather belongs to
  the sky, not to orbit.
- **Stacks with time of day:** a rainy night is still night.

### Lightning strikes

**Code:** `useLightningFlashes.ts` → `useLightningFlashes`; `towerLightning.ts` →
`STRIKE_CHANCE`, `STRIKE_HIT_RADIUS`, `MAX_BURNS`, `pickStrikePoint`, `struckPawn`,
`withStrike`, `WorldLightning`, `PlatformLightning`; `DeckTowerPage.tsx` →
`strikePlatform`, `forceStrike`, `lightningByWorld`, `pawnSpotFor`; `DeckTowerPlatform.tsx`
(`lightning` prop); `LightningStrikeChips.tsx`; `iso/IsoLightningBolt.tsx`,
`iso/IsoBurnMark.tsx`, `iso/openFloor.ts`; IsoPawn `floorSpot` / `shockId` / `crispy`
(usePawnMotion's SHOCK).

- **One clock.** `useLightningFlashes` (the page) times the storm's flashes, which used to
  be timed inside `WeatherLayer`. It hands `flashId` down through SpaceBackdrop to
  `WeatherLayer`, which now only draws the flash. Each scheduled flash rolls
  `STRIKE_CHANCE` (1%), so a strike always lands on a flash. `WeatherLayer` ignores any
  flash count it mounted with, so re-pinning the weather never replays an old flash.
- **The strike** (`strikePlatform`) hits the world on screen. It never fires during a
  study, a pan or a deck swap, because the floor may be swinging open. It lands on
  **walkable, visible** floor, with room for its whole scorch (`pickStrikePoint`,
  `scorchFits`). The mark's full radius (`BURN_MARK_RADIUS`, 0.95) stays inside the pawn's
  roam area (`TOWER_LAYOUT.roam.area`, inside the rim) and clear of every roam obstacle (the
  tower's footprint, the lever's hatch) and of the floor plate. So a scorch never runs under
  an object on the ground. Floor the tower hides is skipped too (`openFloorSpot`). A jagged white
  bolt comes down onto that spot in front of everything (`IsoLightningBolt`, ~0.5 s). It
  leaves a scorch decal under everything on the floor (`IsoBurnMark`, its shape seeded by
  the strike id).
- **The pawn.** Each live pawn reports its ground point every frame (`floorSpot`, null while
  it is not on the floor). A strike within `STRIKE_HIT_RADIUS` (0.8) of a pawn shocks it: it
  freezes for 1 s while it flickers ink ↔ white, jitters and throws white sparks. A smoke
  puff follows, then it stands a beat and walks on. After that it is **crispy**: thin white
  smoke wisps keep curling up off its head (IsoPawn, ISO_ART_FRAMEWORK.md § IsoPawn). A
  frizzled-hair crown was dropped on 2026-11-04 (owner's call).
  By chance alone a pawn hit is rare. A storm strikes about once every ~18 min, and a pawn
  covers only a percent or two of the open floor.
- **Retention.** Everything lasts until the learner leaves the page. It is page state per
  world (`lightningByWorld`), since the platform remounts on every pan and pawn keys restart
  at 0 in each world. Burns are capped at `MAX_BURNS` (40) per world, oldest first.
  **Crispy is per pawn instance** (owner's choice 2026-11-04). It is keyed by the swap's
  pawn key, so the same pawn is still crispy after a pan, while a deck swap's new pawn
  arrives clean. Burn marks stay through swaps.
- **Tester chips** (`LightningStrikeChips`, feature testers only, under the weather row,
  sharing a row with the banking chips — § Feature-tester rows):
  **⚡ Strike** forces a strike at a random spot, and **⚡ Pawn** aims at the pawn,
  falling back to a random spot while it is off the floor. An aimed strike where a whole
  scorch would not fit (the pawn beside the tower or the plate) still shocks him but leaves
  no burn (`withStrike`). Both flash the sky with the
  strike, though the flash only draws while some weather layer is mounted (any kind but
  clear and cloudy). They work in any weather.
- **Reduced motion:** no scheduled flashes, no bolt, flicker, sparks, wisps or puff. A
  tester's strike still leaves its burn, but a crispy pawn looks like any other.

### The setting

Settings → Display → **Weather effects** (`useWeatherEffectsSetting`). The Display section
now shows for every language; its two reading rows stay Chinese-only.

- **Per device** in `localStorage` `deckTower.weatherEffects` (owner's choice), one
  app-wide value behind `useSyncExternalStore`, so a flip reaches a mounted tower at once.
- **Turning it on:** `GET /api/weather`. Anything but `no-location` → on. `no-location` →
  `shareArenaLocation()` (src/api/arena.ts) asks the browser, truncates to the 5-character
  geoCell ON THE DEVICE and stores it in the same `users."geoCell"` the Arena uses
  (owner's choice: one stored location for both). Granted → on; declined → stays off with
  an explanation under the row. The browser is asked at most once per session.
- **Turning it off** only hides the effects. It does **not** clear the geoCell — the Arena
  still groups by it, and the Arena page owns that off switch.

### Server

`GET /api/weather` → `WeatherResponse`: `ok` (with `WeatherNow`), `no-location`, or
`unavailable`. `WeatherService` reads the cell (`ArenaDAL.getGeoCell`), decodes its centre
(`geohashCenter`) and asks **Open-Meteo** (`current=weather_code,cloud_cover`, free, no API
key) from the server, so the third party never sees the learner's IP and the client never
reads its cell back. WMO codes fold into kinds in `weatherFromWmoCode` (unknown → clear).
In-process cache **per cell**: 30 min for a reading, 5 min for a failure, concurrent misses
share one request, 5,000 cells max (oldest evicted). No table, no migration.

The route is **not feature-flagged**: it only reads the geoCell, which only
`POST /api/arena/location` writes — with the `arena` flag off, nobody new can store a cell,
and turning the switch on fails with "Couldn't turn on weather right now".

The tower refetches every 30 min while mounted and when a tab returns after longer than
that (`useTowerWeather`, keyed on `user?.id`, never on `token`). Its FIRST read shares the
request the app-level prefetch started as soon as the user was known (`useWeatherPrefetch`
→ `fetchWeatherShared`; [LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md) § Weather prefetch).

**The sky fades.** A change of main's sky colour that is not a world pan (the weather
arriving or changing, the clock moving through a twilight) eases over `SKY_FADE_MS` (10 s)
in `SpaceBackdrop` rather than snapping; a pan still follows the blend at once (`snapSky`),
and so does td while the launch screen fully hides it, so its circle opens onto the true time
of day and the weather if known (clear if not).
Only the backdrop and the footer's cast shadow fade. The iso scene's sky-derived ground tone
changes at once. [LAUNCH_SCREEN.md](./LAUNCH_SCREEN.md) § The sky fade.

### Tester toggle

Feature testers get a chip row of its own under the time-of-day / aurora row — Auto · Clear · Cloudy ·
Fog · Drizzle · Rain · Snow · Storm (`WeatherToggle`, `TesterChipRow`). A pin shows the
kind's heaviest look (`pinnedWeather`) **even with the setting off**, so every effect can be
previewed without granting location. Stored per device (`deckTower.weatherOverride`),
honoured only for feature testers.

## Feature-tester rows

`DeckTowerPage.tsx` (inside `wrapHeader`); `TesterSharedRow.tsx` → `TesterSharedRow`,
`TesterInlineContext`, `useTesterInline`; `TesterChipRow.tsx`; `LightningStrikeChips.tsx`;
`SnowResetChip.tsx`; `BalloonSpawnChip.tsx` ("🎈 Balloon": sends one red balloon across now, whatever the weather — ISO_ART_FRAMEWORK.md § IsoBalloon → "Tester spawn");
`ShootingStarChip.tsx` ("☄️ Meteor": fires one burst of shooting stars now, whatever the time of day — § Time of day → "Shooting stars");
`testerChipStyle.ts` → `testerChipSx`, `TESTER_ROW_SX`, `TESTER_GROUP_SX`.

Feature testers (`users.isFeatureTester` + the Settings testing switch) see the tester
chips under the header, in this order. Short groups share a row. Long groups get a row
each:

| Row | Groups |
|---|---|
| `TesterSharedRow name="sky"` | `TimeOfDayToggle` │ `AuroraToggle` |
| own row | `WeatherToggle` |
| `TesterSharedRow name="actions"` | `LightningStrikeChips` │ `SnowResetChip` │ `BalloonSpawnChip` │ `ShootingStarChip` │ `BankingAlwaysPlayToggle` |
| own row | `ForcedBreakPicker` (one chip per break game, so its length varies) |

- **Group vs row.** A chip group renders as a full row (`TESTER_ROW_SX`: page gutter +
  bottom padding) on its own, and as an inline group (`TESTER_GROUP_SX`) inside a
  `TesterSharedRow`, which it learns from `TesterInlineContext`. The toggles take no prop
  for it.
- **The divider.** A 1px × 16px `COLORS.border` seam (the chip outline's ink) between the
  groups. It shows **only while the whole row fits on one line**. The row compares the
  groups' natural widths plus the gaps against its content width, using a `ResizeObserver`
  on the row and on each group. When the groups don't fit, they wrap as unbroken units
  (`flexShrink: 0`) and the divider is dropped, so it never dangles at a line's edge. The
  measured sum doesn't depend on the divider, so hiding it can't flip the result back.
- **Fitting a phone.** Measured 2026-11-08 at 12px bold: time │ aurora ≈ 344px, and
  lightning │ banking ≈ 330px, against the ≈ 343px a 375px phone leaves inside the row's
  gutter. That width is why tester chips have 8px side padding (`testerChipSx`), why the
  pawn chip reads "⚡ Pawn", and why the banking chips read "Bank: daily" · "Every visit".
  The banking group follows Aurora's convention: the first chip carries the group's name.
  On the narrowest phones the sky row can still wrap, and the divider then drops as above.

## Forced game breaks

`ForcedBreakPicker.tsx`, `TesterChipRow.tsx`, `DeckTowerPage.tsx`;
`src/features/flashcards/FlashcardsLearnPage/gameBreak/forcedBreak.ts` → `setForcedBreak`,
`useForcedBreak`; `src/games/flpBreak/index.ts` → `flpBreakSuiteFor`.

Testers (`useTestingFeatures`) get a second chip row under the time-of-day row:
Auto, then the suite of the world on screen. Each world keeps its own pin, so the row
changes with the world. Pinning a game opens each visit to that world on a break of that
game, with no card swiped, and makes every next card one too; Auto restores the usual rhythm. Same chips, same per-device storage
(`localStorage` `deckTower.forcedBreak.<world>`), same tester-only read, and the same ride
on the header layer as the time-of-day row. A game in the suite with no break adapter yet
is listed but disabled. The break side is
[FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 10.

## Sky → space

On a tall tower the sky turns into space as the learner scrolls up.

- **Backdrop.** `SpaceBackdrop` is an absolutely positioned box from the top of the
  screen to the screen's **bottom** edge (`bottom={0}`) — the slab footer floats, so sky
  shows beside and below it (§ Footer) — at the scroller's z-index (1). It comes before the scroller in the
  DOM, so the svg paints over it. It is drawn in screen space and is not part of the iso
  framework. `MobileTabScreen`'s `surfaceColor` follows the same palette's sky, but the
  backdrop covers it everywhere. Each repaint also hands the slab footer its cast-shadow
  colour (`setFooterCastShadow`, § Footer). `SpeedLines` likewise runs to the screen's
  bottom (`bottom={0}`), behind the slab.
- **Altitude, not time.** The scene memo gives it `spaceBand`: the viewBox y's of cards
  `SPACE_BAND_CARDS.from` and `.to` on the tower's axis. On each scroll it maps the
  middle of the visible scroller (above the footer spacer, `scrollerBottomInset`) to a
  viewBox y and gets `t` (0 below the band, 1 above it). While the tower is studied the
  page hands it the altitude at the tap instead and the sky holds it (`altitudeY`,
  § Studying the tower).
  - It measures the scene through the scroller's direct `<svg>` child
    (`:scope > svg`), not its first child — the scroller also holds the page's
    falling-shadow `<style>`.
  - The background blends the world's sky → space (`palette`, from `useWorldPan`) with
    `mixHex` on `smoothstep(0, 1, t)`. Mid-pan the palette itself blends between worlds;
    each change repaints at once, without waiting for a scroll.
  - The stars fade in on `smoothstep(0.35, 1, t)` (`STARS_FADE_FROM`), so they never
    show on a light sky.
  - At night the stars already show faintly from the ground (`groundStars`, § Time of day);
    the fade-in only takes over once it is stronger.
  - Scrolling back down brings the sky back. A tower whose top stays below the band
    never sees space. One just short of it can show a slight darkening at its top,
    because the screen's middle sits in the `TOP_HEADROOM` sky above the top card.
- **Stars.** Two tiled layers of flat white dots (`STAR_LAYERS`) are made once as SVG
  data URIs from a seeded PRNG, so the field is the same on every visit. The tiles are
  233 px and 317 px, so the repeat is hard to spot. The layers drift down at 0.4% and 0.8%
  of the distance climbed, a slow parallax that keeps space looking far away.
- **No re-render.** The scroll listener is passive and rAF-throttled. It writes
  `backgroundColor`, `opacity` and each star layer's `transform` straight to the DOM rather
  than React state, so scrolling never re-renders the tower, pawn, clouds or wind.
  (`SpaceBackdrop.tsx` → `apply`, `starLayerTransform`.)
- **Cheap scroll frames.** A scroll frame writes only what changed since the last one (a
  style write invalidates even when the value is unchanged). The stars' parallax is a
  `translate3d` on each layer's own compositor layer (`will-change: transform`), taken
  modulo the tile, with the layer extended one tile above the backdrop; a moving
  `background-position` would repaint the full-screen layer every frame. The footer's
  cast-shadow colour is a custom property on the document root, and a root style write
  re-checks the styles of the whole document, so `setFooterCastShadow`
  (`src/components/footerCastShadow.ts` → `setRootProperty`) writes only on a change.

## Tap to Start

Tapping the **Learning** tower studies that world's Learning deck in Mix, in place
(§ Studying the tower). A white
"Tap to Start" with a thick, filled arrow is painted on the sky, pointing down at the tower.

Code: `src/features/deckTower/TapToStartHint.tsx` → `TapToStartHint`; `tapToStartGeometry.ts` →
`tapHintBaselineY` (the words' line);
`DeckTowerPage.tsx` → `startable`, `onStackTap`, `hintFit`, `TAP_HINT_FIT_CARDS`, `fitScene`
(`minX`, `width`, `towerTopY`); `DeckTowerPlatform.tsx` → `stack.onTap`.

- **When.** `startable`: the plate and the tower both show Learning, no swap or study is
  running, and the count has loaded. The tap is also refused mid-pan and mid-resize, and
  after a drag (`worldSwipe.wasDrag()`), so the click that ends a world swipe or a scroll
  does not start a session. The Mastered tower never starts a session and never shows
  the hint. The hint fades (220 ms) rather than cutting.
- **An empty tower starts one too.** At 0 cards there is no stack to hit, so the tower's
  footprint — the "0 cards" imprint — is the tap target (`DeckTowerPlatform` →
  `deck-tower-page__empty-stack-hit`, a transparent floor path inside the stack's `<g>`).
  The visit opens straight on the flp's out-of-ready-cards card (§ Running out of ready
  cards). The hint is NOT shown over an empty tower (`startable && towerCount > 0`): it
  points at a tower to study down.
- **Fixed placement.** The hint does not follow the live tower. It is fitted once to where
  the top of a `TAP_HINT_FIT_CARDS` (40) card tower stands (`hintFit` = `fitScene` of a
  40-card tower) and stays there for every deck size and through every resize. A shorter
  tower leaves sky under the arrow; a taller one covers it.
- **Fixed to the platform.** It is a `<g>` drawn as the FIRST child of the scene's
  `IsoScene` svg, in the scene's own viewBox px, so the tower paints over it and it
  scrolls with the scene — scrolled up, it moves down with the platform rather than
  staying put on screen. It rides the world pan and a held swipe for free (both move the
  scene svg). Every scene shares the platform's width and centre, so `hintFit`'s centre
  and `towerTopY` are valid in any world's viewBox; on a tower shorter than 40 cards the
  words stand above the svg's top edge and still paint (the scene svg is
  `overflow: visible`). It ignores pointer events: the tap belongs to the stack.

## Studying the tower

`useTowerStudy.ts` (the state machine and its clocks), `towerCamera.ts` (the camera's two
ends), `iso/camera.ts` (`makeCameraProjector`, ISO_ART_FRAMEWORK.md § The camera),
`DeckTowerPage.tsx` (`onStackTap`, `sceneProj`, `climbedOut`, `StudySession`, the fades),
`TowerCoverCard.tsx` (the count card's slide),
`DeckTowerPlatform.tsx` (`bobPaused`, `stack.printOpacity`, `fadeOpacity`, `keepDeck`),
`src/features/flashcards/FlashcardsLearnPage/flpTowerHost.ts` (`FlpTowerHost`),
`src/features/flashcards/FlashcardsLearnPage/towerPlate.ts` (`towerPlateSx`, `towerPlatePressSx`),
`src/minutePoints/studySurface.ts`, `TowerStudyHeader.tsx`.

A tap on a Learning tower (core, reading or writing — the same code for every world)
does not navigate. The camera dives onto the tower's top card — the count card, "N
cards", as it stands — which then slides off the deck by itself to uncover the flp
session's first card lying exactly where it was, and the learner studies the tower down.
It is meant to read as using the deck: take the top card off, work through the cards
under it. The session is page state: no route, no URL.

```
idle ──tap──▶ preparing ──(deal in + card measured)──▶ diving ──▶ uncovering ──▶ studying
  ▲                                                                                │ back
  └──────────────────────────── climbing ◀──────────── covering ◀──────────────────┘
```

- **Parked sessions** (`useTowerStudy` → `sessions`, `dealtWorlds`, `PARKED_LOOP_FRESH_MS`;
  `FlpTowerHost.parked`; DeckTowerPage's `deck-tower-page__study-layer--parked`). Every
  enabled world's flp session (main, plus reading / writing while their goal is on) MOUNTS
  as the page lands — the world on screen first, so its deal is requested first — and stays
  mounted for the page's life, dealt and hidden under the tower: panning between worlds
  fetches nothing, and a tap on any world's tower dives straight onto a session already laid
  out. A goal switched on while the page is up mounts that world's session then; one
  switched off keeps its session (mounting only adds). Until 2026-11-08 a session mounted on
  the world's first VISIT instead, so the first tap after arriving, or after panning to a
  world for the first time, could beat the deal and wait on it (the tap waits in
  `preparing`, below) with the footer already gone. A parked layer is
  laid out (so its card measures) but drawn as `opacity: 0` + `clip-path: inset(50%)`,
  which hides every child whatever its own `visibility` and takes no hits. Its host is a
  fixed object per world (`parkedHostFor`), so the memoised session never re-renders for
  the tower's frames; every session reports through its own world's handles
  (`handlesFor`), and only the studied one's reports move the tower. While parked the flp
  draws no header (one PageHeader at a time), leaves the tab title alone
  (`usePageTitle(null)`), holds the lent-cards notice and narrates nothing — the first card
  is narrated when the visit starts. A climb-out PARKS the session again with its working
  loop kept; what belonged to the visit is reset on that edge (FlashcardsLearnPage's
  parking effect): undo is cleared (the tower was reconciled, so undoing would put back a
  card already counted), the sort offer is re-armed, the game-break counter starts over
  (`useGameBreak` → `reset`), the eip closes, and a card flipped but not yet marked is
  turned back to Side 1 (`useCardDrag` → `resetCard`; a writing card's graded attempt is
  wiped too, `useWritingFlashcard` → `resetAttempt`) — a visit never opens flipped. The lent words reviewed stay on the
  offer's list across visits. A session whose deal is older than `PARKED_LOOP_FRESH_MS`
  (5 min, from mount or its last climb-out) is RE-DEALT on its next tap: its layer is
  re-keyed, so it remounts and fetches afresh while the tap waits in `preparing`. A
  session whose deal came back **empty** is re-dealt the same way on any tap that finds the
  tower counting cards for that world (`start` → `emptyButCounted`), however young the
  deal: `useWorkingLoop` never re-fetches on its own, so a deal made while nothing was
  playable — e.g. while the day's focus set was exhausted, before the learner switched focus
  off (docs/FOCUS_MODE.md) — would otherwise open on "no cards" until the 5 minutes ran out.
  A deal holding cards is never discarded by this rule.
- **Preparing.** The world's parked session is un-parked — still invisible
  (`sessionOpacity` 0, no pointer events) — and its card's box measured at once (it is
  already laid out); the camera must know where it is flying to. If the session's deal is
  still loading (a fresh visit, or a re-deal) the tap waits for its `onLoopChange`. The box is
  measured into the scene's viewBox units (`toSceneFrame`), re-measured two frames on (the
  flp settles its card slot over its first frames) and on every resize. The platform's
  bob is frozen (IsoLevitate `paused`) and its frozen offset read back
  (`frozenBobOffsetPx`) so the camera aims at where the tower really stands. After
  `PREPARE_TIMEOUT_MS` (5 s) without a card it dives onto a fallback frame.
- **The dive** (`DIVE_MS` 550, `easeDive`: a trapezoidal velocity profile — hard constant acceleration over the first `DIVE_RAMP_SHARE` (0.15) of the clock, a cruise, the mirror-image braking; not a cubic in-out, whose near-still tails read as a stall at the hand-over to the count card's slide). The scene's projector becomes
  the study camera (`sceneProj` = `makeCameraProjector(study.view)`): at e = 0 it is
  exactly the page's fixed dimetric view, whatever the scroll, so nothing jumps; at e = 1
  it looks straight down on the top face, **head-on** — the camera over the card's
  centre, `STUDY_CAMERA_HEIGHT` (14 units) above it, so everything under the top card
  recedes behind it and only the platform shows around it — with the face filling the
  measured card box. `studyCameraView` blends yaw, pitch and the z foreshortening
  linearly, the scale geometrically and the perspective in by e². Every framing number
  (the viewBox, the hint, the sky bands) stays in the fixed view (`proj`); the scene's fit
  is frozen at the tapped tower's count (`fitCards`) and the scroller locked, so the svg
  never moves under the camera. On `e`: the tower header, title and avatar fade out by
  `TOWER_UI_GONE_AT` (0.4), clouds and wind by `SKY_TRAFFIC_GONE_AT` (0.3) (their
  drifts are planned in the fixed view; none start while a study is up), and the session's
  header and buttons fade in from `SESSION_FADE_FROM` (0.6). The session's CARDS do not
  fade: they are hidden under the count card (`FlpTowerHost.cardsCovered`, a
  `clip-path: inset(50%)` on FlashCardSection's card frame that keeps the box measurable —
  not `visibility: hidden`, which CardFace's facing side overrides with its own `visible`), and the top card keeps its print
  all the way down. The footer slides away from the tap
  (`useHideFooter`).
- **The count card** (`uncovering`, `TowerCoverCard`). Once the camera is down, the top
  card is handed to a layer of its own OVER the session — the session's cards are DOM over
  the scene svg, so a card drawn in the scene could only pass under them. The layer draws
  the same IsoCard (the tower's footprint, one card thick, its face at the tower top, the
  same print) in a small svg through the camera's on-the-card view (`studyCameraView` at
  e = 1, with no bob), laid on the session's card frame on screen: at e = 1 the face lands
  on exactly that box, so the hand-over is invisible. In the same commit the scene's top
  card loses its print (`towerPrintShown` → `stack.printOpacity` 0) and the session's
  cards are uncovered under it. They cast no drop shadow on the tower (`FlashCardSection`
  draws every card shadowless): they lie flush on the deck like the scene's top
  card, so nothing appears around the card's border when it is uncovered. The card slides
  off to the right the moment the camera lands — no rest on the deck — turning as it goes (`COVER_LIFT_MS` 340, ease-in), and the phase
  becomes `studying`. Its `SHADOW.lifted` drop shadow is not there at the hand-over (the
  scene's top card casts none, so it would snap a halo on): it grows in from the start of
  the slide (`COVER_SHADOW_IN_MS` 320). On the way out (`covering`) it slides back on from
  the right (`COVER_RETURN_MS` 280, ease-out) printed with the session's tally, its shadow
  shrinking to nothing as it lands, and the scene's top card takes over as the climb starts. A tower that has run
  out has no top card, so it climbs straight out — and a dive onto an empty tower skips
  `uncovering` the same way, landing straight in `studying` (§ Running out of ready cards); a back tap mid-dive climbs straight out
  too (the count card never came off). `cameraDown` (uncovering, studying, covering) is
  when the session owns the screen.
- **A pawn on the deck.** A pawn standing on the tower's top when the session starts stands still
  (`summitHeld`), keeps out of the platform's fade, and rides the count card both ways:
  `TowerCoverCard` draws it (`pawnAt`, `IsoPawnStill`) while the scene's own pawn is hidden.
  A pawn in the air then or on the floor fades with the platform as usual.
- **Studying.** The session takes input once the count card is off. The tower page's own
  header is UNMOUNTED while the camera is down (`wrapHeader` returns null on
  `cameraDown`): the session's header
  (`TowerStudyHeader`) is the page's one PageHeader, so only one minute-points tick runs.
  The page claims the study surface (`useClaimStudySurface`), so it earns minute points
  ([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)),
  and blocks the edge swipe (`useBlockEdgeSwipe`). The pawn keeps wandering: its motion
  reads the camera through a ref, and its body is a projected 3D capsule + ball, so from
  the straight-down camera it reads as a pawn seen from above — a round head with the body
  peeking out — rather than a flat pill (ISO_ART_FRAMEWORK.md § IsoPawn → "View").

  | Event (`FlpTowerHost`) | Tower |
  |---|---|
  | Correct swipe on a card the learner owns (`onMarked(true, false)`, at the swipe) | −1 card (never below 0) — the flp slides the marked card off right, still on its answer face, from where the finger let go (FlashCardSection `TOWER_FLY_RIGHT_KEYFRAMES`, the held `outgoingEntry`) |
  | Incorrect swipe | unchanged — the flp flies the card fully off-screen left, then slides it back in under the new top card (FlashCardSection `TOWER_TUCK_KEYFRAMES`) |
  | Correct swipe on a LENT card (`onMarked(true, true)`) | unchanged — a lent card was never on the tower |
  | Undo of a correct mark on an owned card (`onUndone(true, false)`) | +1 card |
  | Game break's correct mark (`onGameCardCleared` via `useBreakClears`, off the mark's response; not a suppressed mark or a lent card — the card also leaves the working loop, FLP_GAME_BREAKS.md § 4a) | tallied, unchanged until the game ends |
  | Game break ends (`onGameBreakChange(false)`, as the game starts to shrink back onto the card) | −the tally, all at once. Leaving mid-game takes them off in `climbOut` |
  | Tower reaches 0 | stays at 0 — the bottom. Nothing refills it during the visit |
  | Session runs dry (loaded, no card) | unchanged, and the camera stays down: the flp shows its out-of-ready-cards card (§ Running out of ready cards) |

  The camera stands still through all of these (§ "The platform fades"). The flip does not
  lift or shadow the card, but the tower's flip is still slower than the plain flp's —
  `TOWER_CARD_FLIP_MS` (350) vs `CARD_FLIP_MS` (250), `src/features/flashcards/constants.ts`;
  everything timed off the flip takes that duration as `flipMs` (the rotation's
  `cardFlipTransition`, CardFaceSide's away-face hide, `useCardDrag`'s flip lockout,
  FlashCardSection's `flipInProgress` window).

  The tower's count is the page's local tally, and it is ITS OWN figure, not the flp's
  working loop: no report from the session carries the loop's size (`FlpTowerHost.onLoopChange`
  reports only `loading` / `hasCard`), so the loop being refilled, re-dealt or padded with lent
  words never moves it. Until 2026-11-11 a tower that reached 0 while the loop still held cards
  was set back up to the loop's size (`afterTowerEmptied`), and a dry session climbed out by
  itself (`DRY_CLIMB_DELAY_MS`); both are gone. The count stays exact because the flp now deals
  only off-cooldown cards before it lends — the same cards the tower counts. A correct mark
  comes off at the swipe, even one the server later drops on cooldown (rare now: only a card
  marked on another surface mid-visit); the climb-out reconcile corrects it.
- **The platform fades** (`useTowerStudy` → `platformOpacity`;
  `DeckTowerPlatform` `fadeOpacity`, `keepDeck`). Every session is studied on the bare sky.
  The studied world's platform — the slab, the pawns, the plate, the lever, but NOT the
  deck — fades out ON THE DIVE and back in on the climb, on the dive's eased position
  (`platformOpacity` = 1 − `e`, 0 while the camera is down; through IsoPlatform `fadeStyle`).
  The deck stays: for the whole visit (`keepDeck`) IsoPlatform stops fading its children as
  one group (`fadeChildren={false}`) and every depth-sorted layer but the deck — pawns,
  lever, the sky traffic's `behind` / `front` — takes the fade on its own wrapper
  (`DeckTowerPlatform` → `layerFade`). The deck keeps its slot in the draw order at full
  opacity, riding the bob — only its floor shadow takes the fade
  (`.deck-tower-page__kept-deck` rule, `--platform-fade`). So the camera still lands on the
  count card, it still slides off (`uncovering`) and back on (`covering`), and the session's
  own fade-in and fade-out (`sessionOpacity`) stay hidden under it. Because the deck keeps
  its slot, a pawn or the lever in front of it stays in front of it while it fades. Every
  layer is wrapped the same way in and out of a session, so a session starting re-styles the
  wrappers without remounting the pawn. The plate and the lever stay where they stand and
  fade with the platform; both ignore taps while a session is up (`study.active`).
  The camera does not follow the tower: a mark, undo or cleared game card only changes the
  count (`setCards`), and `climbOut` settles the camera on the tower's real top before it
  flies out. The sky is held at the tap's altitude for the whole session, so it stays put too.
- **Hint labels in the card's corners** (`FlashCardSection.tsx` → `TOWER_TOP_BAND_VARS` /
  `PLAIN_TOP_BAND_VARS`; `FlashcardsLearnPage/styled.ts` → `SwipeHintLabel` /
  `FlipHintLabel`). The flp's
  hint labels (← Incorrect / Correct →, Tap to flip) are children of the card FRAME, in the
  card's top-left / top-right corners (Tap to flip centred), vertically centred in the card's
  top band (`--card-hint-band`) and in from the side by the card's corner radius. On the
  tower the band is the stock's cream rim (`--card-stock-inset`); the plain flp has no rim, so
  it is a fixed 30px row. They used to sit above the card in the slot, where on the tower they
  landed on the platform's floor and its light top-edge bevel with no contrast. Nothing else
  sits on the card's top edge (the `•••` card-options rail and the card-note strip were
  deleted 2026-11-05), so the band is the labels' alone.
- **The climb** (back arrow, a tap off the card, or the sort offer's "Leave anyway" — a dry session no longer climbs out by itself, § Running out of ready cards). A tap off the card is Back: a press that starts and ends, without travelling, on the session's bare space round the card — `FlashcardsLearnPage` → `handleTowerOffCardTap`, matched against `TOWER_OFF_CARD_SELECTOR` (a whitelist of the content area's empty layout boxes, so the card and every control are excluded); off during an icon edit and once a game break leaves the stack (its card is a card, so a tap off that works the same; `stackIsCards`). Like the back arrow it goes through `handleBack`, so the sort offer still gets its turn. The dive
  in reverse (`CLIMB_MS` 480; a climb that cuts a dive short flies back from where it
  had got to), after the count card is back on (`covering`, above; skipped at 0 cards — there is
  no count card to put back). The tower header
  remounts and fades back in, the session's header and buttons fade out and
  unmounts at the end, the footer returns. Then `climbedOut` HOLDS the tower at the
  session's count and re-reads the bar's counts (`useFlpReadyCounts.reload`); when they
  land, `resolveRecount` plays a sky drop to a higher figure (the focus lever's path) and
  simply stands at a lower one, with no collapse (§ Tower resizes). Every world reconciles. The refit from the frozen
  session frame keeps the altitude (`keepClimbFor`).
- **The backdrop** is NOT altitude-aware during a session: `studyAltitudeY` is the
  view's middle at the tap (`study.startMidY`), held constant until the session ends, so
  the sky and its stars keep the colour they had at the tap through the dive, the
  session and the climb (it used to follow the camera down to the tower's top on `e`,
  bringing a tall tower's sky back from space mid-dive). Time of day and a world pan's
  palette still repaint it.
- **The session.** It is `FlashcardsLearnPage` itself, lazily loaded and memoised
  (`StudySession`), with its required `tower` host (`FlpTowerHost`): the host's world in
  Mix (the working-loop request is `{ world }`), `onExit` instead of a navigation, transparent backgrounds, `TowerStudyHeader` (the flp header's back, undo
  and narration controls, plus the tower's own platform toggle, in the tower's white-on-sky PageHeader style, with
  **no title** — dropped 2026-11-08 to free the row for controls; `PageHeader`'s `title` is optional for it), and the
  card stack as the tower's top card (the next card waits flush under the current one; an
  incorrect swipe is tucked back into the deck; flips at `TOWER_CARD_FLIP_MS`). There is
  no routed flp: `/flashcards/learn` was deleted, and the flp renders only here.
- **The card stock** (`src/features/flashcards/card/CardFace.tsx`;
  `src/features/flashcards/card/cardStock.ts` → `cardStockVars`, applied by
  `FlashCardSection.tsx` → `FLP_CARD_STOCK_VARS`;
  `src/features/flashcards/constants.ts` → `FLP_CARD_STOCK_INSET_RATIO`,
  `FLP_CARD_PANEL_RADIUS_RATIO`). Every face is card stock (the vet cdp's hero card
  wears the same `cardStockVars`). Both faces of every
  session card are the tower's IsoCard stock: a cream rim (`COLORS.cardFace`) around a beige
  printed panel (`COLORS.cardBeige`), inset `FLP_CARD_STOCK_INSET_RATIO` of the card's width
  on every side (= IsoCard `FACE_PAD` / `CARD_W`), the panel's corner
  `FLP_CARD_PANEL_RADIUS_RATIO` (= IsoCard `PANEL_RADIUS` / `CARD_W`). No hairline and no drop shadow — the tower's cards have neither. A custom
  `cardColor` (advanced layout) fills the panel, not the rim, and the card's content is clipped to the
  panel (`--card-panel-clip`, CARD_ICON_LAYOUT.md § "Where the clip lives"). Fixed tokens,
  not the theme's `flashCard`. (Not washed at night — § Time of day → "The wash".)
  See TOWER_STYLE_SHIFT.md § "Card stock".
- **The buttons.** The session's page buttons — the word-tools rail's `Write it`,
  `Compare` and `Customize` and the `More Info` pill — are the tower's floor-plate push button redrawn in
  HTML (`src/theme/towerPlate.ts` → `towerPlateSx`):
  a WHITE plate (`FlpTowerHost.plateTones` = `bandMaterial(COLORS.white)`,
  `useTowerStudy.ts` → `STUDY_PLATE_TONES`: white face, walls stepped down to light greys), seen from the
  straight-down camera as a face over one wall (`PLATE_WALL_PX` 5 ≈ `RAISED_HEIGHT`) with a
  `SHADOW.chip` contact shadow, the hairline rounded edge in its straight-lip form (a 1px top
  rim light, a 0.5px fillet over the wall — `roundedEdgeRimLightTop` / `roundedEdgeFilletDown`,
  docs/designGuidelines.md § "The rounded edge") and the plate's print (ink, bold, upper-case, tracked). A
  press SNAPS the face down flush and back up with no transition — the app's raised-key
  press (`src/theme/keycapPress.ts` → `keycapPressSx`; every HTML keycap snaps since
  2026-10-29). The in-scene plate (`usePlatePress`) still animates its 80 ms sink and 220 ms
  overshoot pop; the HTML copy deliberately does not, and skips its wait-to-bottom-out. No `COLORS.border` outline, like the scene's plate.
  Wired through `WordToolsRail` `pillSx` (→ `PracticeWritingButton` `railSx`) and
  `MoreInfoPill` `plate` (`styled.ts`). The rail's plates (`Write it` · `Compare` · `Customize`)
  are also sized down from the shared pill (`towerPlate.ts` → `TOWER_RAIL_PILL_SIZE_SX`: 7 px
  vertical padding, 11 px type, 15 px glyph) and fixed at `TOWER_RAIL_PILL_WIDTH` (104 px) each
  as a centred group; `TOWER_RAIL_SX` pins `Write it`'s Badge root and lifts the rail's
  card-width cap, since three pills (326 px) are wider than the card. `More Info` keeps its size. Any rail plate pressed while the question
  face is up flips the card first (`FlashcardsLearnPage` → `revealAnswer`, wired as
  `WordToolsRail` `onToolPress`); `Customize` then waits for the flip to land before opening
  the fie ([CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md) § "Entry point").
- **The lettering.** The session's button labels (`Write it`, `Compare`, `Customize`,
  `More Info`) are set in 975 Maru SC
  (`src/theme/towerPlate.ts` → `TOWER_STUDY_FONT`, which is `FONTS.cjk`), overriding only the
  family: size, weight, case and tracking stay as each control defines them. The face ships
  one weight, so semibold and bold labels are browser-synthesised. The pills get it through
  `FlashcardsLearnPage` → `towerPlatePillSx`. acp and game plates keep their own faces. The header title stays in `FONTS.sans` and the
  minute-points count in `FONTS.mono`. The audio chip is 975 Maru too, but through the shared
  outlined skin (`outlinedChipSx`) rather than a tower-only override (below).
- **The audio chip.** The study header's narration chip (`TowerStudyHeader` →
  `AudioModeChip`) is NOT a plate: it is the app-wide outlined audio chip with white `ink`
  (`HeaderCycleChip` `tone="bare"` — no fill), so its glyph and label are plain white in every audio
  mode; the label carries the state. A 1px white pill outline (`AudioModeChip` →
  `outlinedChipSx` in `src/components/pageHeaderSizing.ts`) bundles the pair into one button — white rather than
  `COLORS.border`, which is a paper hairline and goes muddy on the sky. Type 12 px and
  glyph 15 px (`OUTLINED_CHIP_TEXT_PX` / `OUTLINED_CHIP_ICON_PX`), the label in
  975 Maru SC (`FONTS.cjk`) at its only weight, 400, pinned in `outlinedChipSx`; the label is centred in a box sized to
  the longest label in its real face (`fitLabels` — its `sx` resizes the label, so
  the default `ch` width would be wrong). It was a grey floor plate until 2026-10-26, stripped
  because a filled chip drew the eye off the card. Every audio chip in the app has used this skin since 2026-11-04, each in its own ground's ink (docs/AUDIO_PLAYBACK.md § The chip).
- **Reduced motion** is not handled yet: the dive and the climb always play
  ([DEFERRED_WORK.md](./DEFERRED_WORK.md)).
- **Tap responsiveness** (2026-10-30). Opening the eip from `More Info` costs a blocked frame
  (no network: `useEipTabs.openForRoot` seeds the root tab from the in-memory entry), so
  the tap path is built to show its press first and to keep that frame small:
  - **Press on pointerdown, held ≥ `KEYCAP_MIN_HELD_MS`** (100 ms) — every plate (Write
    it, Compare, More Info) presses through the app-wide keycap delegate
    (`src/utils/keycapPressDelegate.ts`; EIP_SHEET_GESTURES.md § Add key → "Every raised
    key presses through one delegate"), which sets `KEYCAP_PRESSED_CLASS` on the DOM with
    no React render. The two taps that open the eip — More Info
    (`FlashcardsLearnPage` → the `MoreInfoPill` `onClick`) and Compare (`handleCompare`) —
    run through `src/utils/afterNextPaint.ts` → `afterNextPaint`, so the pressed frame
    paints before the mount.
  - **The card stack does not re-render** for eip state: `FlashCardSection` is
    `React.memo`'d, and `FlashcardsLearnPage` keeps its props identity-stable ("Stable
    props for the memoised FlashCardSection": event handlers via
    `src/hooks/useEventCallback.ts` → `useEventCallback`, a memoised `cardTopRail`, and
    `useCardIconEditor` → `displayCurrentEntry` / `displayNextEntry` memoised). The writing
    card's `renderFace` is NOT stabilised (it renders, so it must change), so writing
    sessions still re-render the card each page render.
  - **Only the active eip pane mounts on open** (`InfoCardPanelBody.tsx` →
    `OFFSCREEN_PANES_WARM_MS`, `panesWarm`; EIP_SHEET_GESTURES.md).
  - **The sheet opens with a transform slide**, not a height animation (`SheetPanel.tsx` →
    "Entry slide"; EIP_SHEET_GESTURES.md).
  - **No SVG filter over the session**: the night wash's `feColorMatrix` filter was cut
    (§ Time of day → "The wash").

## Running out of ready cards

`server/services/OnDeckVocabService.ts` (`canLendProvisional`, `getDistributedWorkingLoop`,
`getNextLibraryCardWithFallback`, `refillWorkingLoop`), `server/controllers/OnDeckVocabController.ts`
(`getDistributedWorkingLoop`, `getLoopRefill` — the `lend` query param),
`server/routes/flashcardRoutes.ts` (`POST /api/flashcards/mark` — the `lend` body field),
`src/api/workingLoop.ts` (`WorkingLoopRequest.lend`), `src/api/flashcards.ts`
(`MarkFlashcardRequest.lend`), `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts`
(`lendMode`, `enableLend`, `resetLend`), `FlashcardsLearnPage.tsx` (`readyOut`, `loopDry`,
`onReadyOutCardGone`, the parking effect), `ReadyOutCardLayer.tsx` (`ReadyOutKind`, the copy),
`FlashCardSection.tsx` (`readyOutCard`), `gameBreak/interimCardPlate.ts` (the "Got it!" plate),
`useTowerStudy.ts` (`onMarked` / `onUndone` with `lent`).

The tower is studied **to the bottom**. The flp serves the learner's own **off-cooldown**
cards and nothing else until they are spent — so every right swipe takes one off the tower,
and the tower reaches 0 exactly when they run out. What comes after is the flp's business,
announced by a card in the stack:

- **No cooling cards, ever.** Neither the deal nor any refill serves a card still on
  cooldown. (Until 2026-11-11 a short loop was padded with the learner's own cooling cards —
  the old "borrow, cool, lend" ladder, docs/PROVISIONAL_CARDS.md § 4b. Their marks were
  dropped, they cycled forever, and the tower counted them down and then reconciled back
  up on the climb-out.)
- **The lend switch.** Lending is off at the start of every visit. With it off, a loop that
  runs short stays short, and an empty one is the trigger. The switch is the flp's, held with
  the loop it governs (`useWorkingLoop` → `lendMode`), and travels on the deal (`?lend=1`),
  the break refill (`?lend=1`) and the mark (`lend: true`); the server lends only with it on
  AND outside a focused world (`canLendProvisional`). The deal's baseline top-up
  (`ensureBaselineForSurface`) is gated the same way, so even a brand-new learner studies
  their own cards first. It is reset when the visit ends (the flp's parking effect →
  `resetLend`, which re-deals from the learner's own ready cards for the next visit).
- **The trigger** (`loopDry`): the session is being studied, its deal is loaded, it has no
  card, and no game break is up. With the switch off, the flp turns it on (`enableLend`,
  which flips `loading` in the same batch so the next render already waits on the new deal)
  and shows the **`pending`** card — blank card stock, a spinner only if the deal is slow.
- **`lend`** — the re-deal came back with cards: "You're out of ready cards / From here on
  we'll show you words you haven't added yet." with a **Got it!** plate in the Learning hue
  (`LEARNING_HUE`). A tap anywhere on the card (the plate included) throws it off; a swipe
  either way flies it off from the release point. It marks nothing and has no undo. Study
  then carries on with lent words. Off-cooldown cards still come first: a card coming off
  cooldown mid-visit rejoins the loop through the ordinary refill before any lent card.
- **`done`** — nothing to deal even with the switch on: a focused world (it never lends —
  [FOCUS_MODE.md](./FOCUS_MODE.md)), or a dictionary with nothing left to lend. "Done for the
  day / Every card you have is resting. Tap outside the card to leave." It stays put; the
  learner leaves with Back or a tap off the card. A focused world never sees the `lend` card.
- **While a card is up** the word under it is hidden in every other way too: no narration,
  no word-tools rail, More Info disabled, undo locked (the re-deal clears the snapshot
  anyway). The card is a layer over the word slots at z 4, like the game break's card
  (FLP_GAME_BREAKS.md § 5) and in the same card stock.
- **The tower never hears of it.** Its count stays at 0 through the whole lent stretch:
  lent cards don't move it (`onMarked(isCorrect, lent)`), and nothing refills it. The
  climb-out's reconcile picks up any card that came off cooldown meanwhile.
- **The empty tower.** A tap on the "0 cards" imprint starts a visit (§ Tap to Start). The
  world's parked deal is empty, so the dive lands with no count card to slide off (`uncovering`
  is skipped at 0 cards) on the `pending` card, which becomes `lend` (or `done`).
- **The lent-cards notice is gone from the flp.** The generic `ProvisionalCardsNotice` that
  announced lent cards on arrival was replaced by the `lend` card. The end-of-visit offer to
  keep the lent words reviewed (`ProvisionalSortOffer`) still gates the way out.

## The cards page

Below the platform, td's scroll runs on into the world's card library. The data, the
filter keys' figures, the mini card, the windowed grid, the search field and the sort menu
are in [CARD_LIBRARY.md](./CARD_LIBRARY.md); this section is the page.

```
  ↑ the tower, the sky, space …
  ── platform ── (the platform LINE: the platform resting on the slab footer)
  ┌ Cards                           [↑] ┐ ← sticky title row; becomes the page header
  │ [ Learning 212 ] [ Mastered 400 ]   │ ← filters (scroll away)
  │ [ Search your cards…       (sort) ] │ ← search + sort (scroll away)
  │  ▢  ▢  ▢                            │ ← the cards, three to a row
  └ …                                   ┘
```

- **Per world.** Each world's page reads that world's bar (`useCardLibrary(world)`): the
  filter keys' figures and each card's mastery strip answer the same question as its tower. The
  page is keyed by world, so a pan mounts the next world's page fresh (search, sort and
  filter are per visit). It slides with the scene through a pan (`pan.sceneShiftX`, and the
  swipe's `paint` moves it with the svg), and a world swipe works from inside it too.
- **The filter keys.** Learning and Mastered are TWO-STATE KEYCAPS
  (`src/features/deckTower/TowerFilterKeys.tsx` → `TowerFilterKeys`): rounded tiles
  (radius, padding, glyph-over-label-and-figure layout; no outline since 2026-11-06), painted like the floor plate of the same deck: face `TOWER_DECKS[deck].band` (`yelM`
  Learning, `bluM` Mastered — blue in every world, like the plate), on that plate's front
  wall (`plateWallSteps.right`, else `bandMaterial`'s), not washed for the time of day. A key
  pressed down STAYS down while it filters the grid; pressing it again lifts it. Same
  toggle-group contract (`useCardLibrary` → `toggleCardsFilter`: at most one key down;
  pressing the other moves the latch across). The wall is DIAGONAL — it shows below and to
  the right of the face, stepped 1px along (1, 1) like the mini cards' card stock
  (`sortCardStock` → `panelWall`), and the latch and the press move the face along that same
  diagonal. **Edge:** a hairline rounded perimeter (`keyShadow` →
  `src/theme/roundedEdge.ts` `roundedEdgeFillet` / `roundedEdgeRimLight`, 2026-11-08): one 0.5px
  wall copy half-way between face and wall colour over the solid wall, plus a crisp 1px rim light
  on the face's top-left edge — the same edge as the mini cards' card stock. Up: a 5px wall and the sky's cast shadow (`--tower-cards-ground-shadow`, 9px
  right and down). Latched: sat 3px down-right on a 2px wall, glyph at full ink. Colour never changes with state — no mute of the
  other key — so the latch's height alone says which is down (the eip Add key's "stayed down" idiom, `EipAddKey`). Held: flush, the app's snapping press (`keycapPressSx`, with `restX`/`pressedX` for the diagonal). The pair sits in the same 364px column as the search row and the grid (`TowerCardsPage` → `GRID_WIDTH_PX`, 28px sides), so its edges line up with theirs. Each key keeps its figure,
  right-adjusted. The search field carries the sort menu (`CollectionSortControl`,
  common orderings only). The title is always "Cards" — a filter never renames the page
  (2026-11-08) — with no count: the latched key names the set and carries the figure.
- **The cards** are acp's mini cards: `MiniCard` on the Deck Tower's card stock (cream rim,
  beige panel), drawn as a **thick panel** — a 4px wall and a near-solid cast shadow
  down-right, with no outline (removed 2026-11-06) (`src/features/discover/sortCardStock.ts` → `sortCardStockSx`,
  `cardStockShadow`, through `MiniVocabCard` `stock`) — the same stock as acp's cards
  (2026-11-05). With the mastery strip and without acp's levitation. The strip is pulled in
  off the cream rim onto the panel (`TowerCardsPage.tsx` → `STRIP_SIDE_INSET_PX`, the
  panel's inset + 5px, overriding MiniCard's 8px through `.mini-card__mastery-window`). A card with its own
  colour (an advanced layout's `cardColor`) fills the panel and keeps the cream rim
  (`--mini-card-panel`), the rule the tower-hosted flp's faces follow. The ground is the
  world's sky, so the shadow is that sky's iso shadow tone (`shadowTone`), set as the
  `--tower-cards-ground-shadow` variable on the page root so a sky that changes every pan
  frame never re-renders a card. **Pressed, a card is pushed back** (`sortCardStock.ts` →
  `cardStockPressSx`, the app's raised-key press from `theme/keycapPress.ts`): it stops
  floating without going flush. The cast shadow vanishes and the face moves 2px down-right
  (`PRESS_SINK_PX`), while the outlined 4px wall stays, so it is still a thick card. It snaps and is held at least `KEYCAP_MIN_HELD_MS`. The press moves through
  the CSS `translate` property because `useScrollStretch` writes an inline `transform` on
  these cards; a press that travels into a scroll lets the card up. The cdp opens on
  release (`click`), through the world's lens (`withLens`); the click that ends a desktop
  swipe drag is ignored.
- **The platform stop.** Momentum always stops at the platform line, from above or below
  (`useTowerCardsScroll`): a scroll event that CROSSES the line while no finger is down
  (touch momentum, wheel, trackpad) is pinned to it, and the scroller's overflow goes
  `hidden` for one frame, which ends native momentum on WebKit and Blink. A finger dragging
  across the line is left alone. The page's own placed scrolls (refits, the resize camera)
  are never caught. Not CSS scroll-snap: the tower above and the grid below are both taller
  than the screen, and free scrolling inside an oversized snap area differs between iOS and
  Chrome.
- **The cards stop.** Heading **down**, momentum stops at the cards line too: a fling
  from the platform lands on the top of the cards page rather than sailing on into the
  grid (`useTowerCardsScroll`, behaviour 4). Two catches: a touch release in the snap zone
  whose projected momentum overshoots the cards line glides to that line
  (`snapOnRelease`), and a no-finger downward crossing of the line (wheel, trackpad,
  momentum the projection under-read) is pinned to it the way the platform stop pins
  (`onScroll`). A finger dragging across is left alone, and an **upward** crossing out of
  the grid is not caught: that fling carries on up to the platform stop.
- **The snap zone.** The screen of scroll between the platform line and the cards line
  (`towerScroll.ts` → `cardsTopScrollTop`: the cards page's top at the screen's top, its
  title row standing in as the header) is never a resting place: a scroll that would stop
  inside it glides to one of the two lines (`SNAP_MS`, ease-out so it carries on from the
  scroll). **When it decides:** a touch released inside the zone decides the moment the
  finger lifts (`useTowerCardsScroll` → `snapOnRelease`), on the position its momentum
  would reach — release velocity (`releaseVelocityOf`, over the drag's last
  `RELEASE_VELOCITY_WINDOW_MS`) × `MOMENTUM_PROJECTION_MS` — and glides there with the
  momentum dropped (the scroller's overflow held `hidden` for the glide; a finger
  touching down releases it). Waiting for an iOS fling to coast to a stop took most of a
  second. A release whose momentum would carry it up out of the zone is left to coast to
  the platform stop; one that would carry it down past the cards line glides to the cards
  line instead (the cards stop, below). Everything else — wheel, trackpad, a fling
  released outside the zone that coasts into it — waits for `SETTLE_MS` of quiet
  (`snapIfInZone`; a timer, since older iOS Safari has no `scrollend`). The breakpoint depends on
  the scroll's **last direction of movement** (`towerScroll.ts` → `snapTargetOf`):
  heading down, it goes on to the cards once a quarter of the zone past the platform line;
  heading up, it goes on to the platform once a quarter above the cards line
  (`SNAP_COMMIT_SHARE`); short of that it springs back to the line it left. The rule and
  the direction tracking live in `src/utils/directionalSnap.ts` (`directionalSnapTarget`,
  `nextSnapDirection`), shared with the eip's maximize / shrink
  (docs/EIP_SHEET_GESTURES.md § "Height model"). Finger drags
  count, so a drag down that turns back up is heading up; steps under
  `DIRECTION_MIN_STEP_PX` are ignored so a lifting finger's jitter cannot flip it. With
  no direction known it falls back to the halfway point. Above the platform (the tower)
  and below the cards line (the grid) scroll freely. It applies to wheel and trackpad
  scrolling too: at a quarter-screen, one or two wheel notches commit. A finger or
  a wheel cancels the glide; the page's own placements (refits, the resize camera —
  `cancelGlide`) neither trigger it nor let one run on under them, and it is off while a
  pan, deck swap, resize or study holds the scroller (`snapEnabled`). It also stands down
  while any glide is in flight (`useTowerCardsScroll` → `gliding`, checked in
  `snapLines`): a glide is already headed for a line and its frames pass through the zone.
  Without that, a tap on the up arrow at the top of the cards page was reversed — the
  tap's `touchend` armed the `SETTLE_MS` timer, which fired 140 ms into the arrow's glide,
  still near the cards line with the last hand-scroll heading down, and snapped back.
- **The glide.** The cue, the up arrow and the snap share one rAF tween
  (`useTowerCardsScroll` → `glideTo`: `GLIDE_MS` ease-in-out for the cue and the arrow,
  `SNAP_MS` ease-out for the snap). Every frame goes through `onPlaced`, which marks it as the
  page's own (`placedScrollTop`) and records the altitude it reached as `climb`, so the
  platform stop lets it through and a glide into the cards page leaves `climb` negative.
  Not `scrollTo({ behavior: "smooth" })`: a smooth scroll crosses the platform line with
  no finger down, which the platform stop would catch.
- **The header hand-off.** The title row is `position: sticky` at the scroller's top, laid
  out as a hub page header (`pageHeaderSizing.ts` → `HUB_HEADER_*`, with the safe-area
  inset). As the cards page's top rises into the page header, it pushes the header layer
  (title, flame, avatar, tester chips — `deck-tower-page__header-layer`) up with it px for
  px (a `transform` written straight to the DOM on scroll), so the title row arrives at the
  top as the old header leaves. It is not a second `PageHeader` (each runs a minute-points
  tick). It has no fill: the title and up arrow float on the sky, and the cards scroll visibly under them and off the top. Only the title row sticks;
  the filter keys and the search bar scroll away with the cards.
- **The up arrow** in the title row's right slot (`HeaderIconButton` `outlined`, ring and
  glyph in the sky's ink via `outlineColor` — the paper hairline goes muddy on a scene
  ground) climbs one stop (`useTowerCardsScroll` → `up`, the glide): from anywhere below
  the top of the cards page (scrolled into the grid, past the cards line) it glides back
  to the top of the cards page; from the top of the cards page it glides on up to the
  platform line. So two taps from deep in the grid return to the deck.
  It must work **mid-fling**: the arrow sits inside td's scroller, and a tap on a coasting
  scroller is spent on stopping it (no `click`). So it passes `scrollSafeTap`
  (`src/hooks/useScrollSafeTap.ts` → `useScrollSafeTap`: touch fires on `pointerup`), and
  `up` glides with the overflow `lock` so any momentum the tap did not stop cannot overwrite
  the glide's frames.
- **The cards cue** (`CardsCue.tsx` → `CardsCue`). "Cards" over a down chevron at the
  bottom centre, in the WorldIndicators' box and ink (`skyInk`), so "Cards" stands on one
  line with "Reading" and "Writing". A squat chevron (16 × 7) hangs just under the word,
  and the two bob together, centred on that line, on their `FLOAT_MS` clock (`skyCueFloat.ts` → `floatPhaseDelay`) so
  all three cues move in step. A tap glides to the
  cards page, its title row at the top (`useTowerCardsScroll` → `toCards`, the glide). It fades out over the first 48px below the platform line (its own
  scroll listener writes `opacity`), and hides with the world arrows (`panBlocked`). Like
  them it lives in the tower section and scrolls with the platform. It
  overlaps the platform's front corner.
- **The footer.** The slab floats over the last rows the way it floats over the tower; the
  page pads its bottom by `SLAB_FOOTER_TOTAL_HEIGHT` and is at least a screen tall, so the
  title row can always reach the top.
- **Studying.** The page fades with the tower's UI on the dive (`towerUiOpacity`) and takes
  no input while a session is up; the platform stop is off then (the scroller is locked).
- **Back.** Returning from a cdp remounts td on the platform line: the cards page does not
  yet restore its scroll, search or filter.

Code: `TowerCardsPage.tsx` → `TowerCardsPage`, `TOWER_CARD_STOCK`; `towerScroll.ts` →
`useTowerCardsScroll`, `platformScrollTop`; `DeckTowerPage.tsx` → `cardsPageRef`,
`headerLayerRef`, `onOpenTowerCard`, `cardsPageStyle`; `useTowerCardsScroll` → `toCards`,
`up`, `cancelGlide`; `towerScroll.ts` → `cardsTopScrollTop`, `snapTargetOf`, `releaseVelocityOf` (both tested in `__tests__/towerScroll.test.ts`); `CardsCue.tsx` → `CardsCue`.

## Opening at the last height

`towerHeightStore.ts` (`readTowerHeight`, `writeTowerHeight`), `DeckTowerPage.tsx`
(`openedAtHeightFor`, `coreSettledCount`, `resolveRecount`).

The main world's **Learning** tower opens at the height it last stood at on this device,
then animates to today's figure: a learner who left with 10 cards, and had 5 come off
cooldown overnight, opens on 10 and watches 5 drop in (a sky drop); cards that went on
cooldown elsewhere (games mark cards too) just leave: it stands at the lower figure, with
no ghost collapse.

- **How.** On arrival (once per account + language, before the bar's counts land) the
  stored height is `hold`-ed on main's `useTowerResize` against the counts' fetch
  `version`, with `quietShrink`; when the fetch settles, `resolveRecount` plays the grow —
  the same path as the focus lever and the climb-out. A lower or equal figure plays nothing. Nothing
  stored (a first visit, another device, cleared storage): the tower simply stands at its
  height.
- **Stored** in localStorage under `deckTower.towerHeight:<user>:<language>:core:learn-now`
  whenever main's Learning tower is SETTLED (not mid-resize, mid-swap or loading), and
  card by card through a study of it.
- **Main only.** The reading and writing worlds are visited far less, so their towers
  would have grown a lot between visits: a big drop on nearly every visit is
  demoralising. They open at their real height, as before. The Mastered deck is not
  stored either.
- **No build-up.** This replaced main's build-up on page load (2026-10-24).

## Cooldown releases

`server/contracts/flpReadiness.ts` (`flpUpcomingReady`, `FLP_UPCOMING_HORIZON_MS`),
`OnDeckVocabService.getFlpReadyCounts`, `src/hooks/useFlpReadyCounts.ts` (`pendingReleases`,
`applyReleases`), `DeckTowerPage.tsx` (`releaseCooldowns`, `rereadOnReturn`, `startResize`).

A card whose cooldown ends while the learner is on the page joins the tower at that moment,
**as its own one-card sky drop**: one card, one drop, never several cards in one drop.

- **The schedule.** `GET /api/onDeck/flpReadyCounts` returns `upcoming`, which lists every card
  still cooling that comes off cooldown in the next 24 h (`{ readyAt, band }`, soonest first).
  It's computed from the same rows as `counts` and scoped the same way (a focused world gets
  today's set only). A card's release time and band depend on its marks alone (`barReadyAt`,
  whose window is the band's), so the schedule holds until the next mark, and every mark
  path re-reads the counts anyway. A release never triggers a request.
- **The clock.** `useFlpReadyCounts` keeps one timer for the next `readyAt`. When it fires, the
  card becomes *due* (`pendingReleases`), but it is not counted into `counts` until the page
  `applyReleases` it.
- **The drop.** On the tower that's showing (the world on screen, Learning deck), the page
  plays `startResize(n, n + 1)` and applies one release, both in the same pass. The tower stands
  at `n` until the drop lands, then at `n + 1`. Cards that come due during a swap, pan, resize
  or study wait, then play one after another. Under reduced motion the count simply changes.
- **Quietly elsewhere.** An off-screen world, or this world on its Mastered deck, counts its
  releases in with no animation. Arriving there shows the tower standing at the new height.
- **A hidden tab** applies nothing, since a drop would play unseen. Coming back re-reads every
  world (`rereadOnReturn`): timers sleep in the background, and another device may have marked
  cards meanwhile. The tower that's showing is held first (`quietShrink`), so cards released
  while it was out of sight land as **one** grow, the way opening the page does
  (§ Opening at the last height). A lower figure just stands.
- **Not covered:** a page left open for more than 24 h without being hidden misses releases
  past the horizon until the next re-read.

## Daily banking

`DeckTowerPage.tsx` (`DailyBankingProvider`, `DailyBankingOptOut`, `BankingEmbers`),
`DeckTowerAvatar.tsx`, `BankingAlwaysPlayToggle.tsx`. The run itself — phases, scaling,
the server's once-per-day marker — is [DAILY_MINUTE_BANKING.md](./DAILY_MINUTE_BANKING.md);
this is how td hosts it.

- **Path.** `[flame] [avatar]` — td's header has no Settings gear, so the embers fly
  straight from the flame into the 40px avatar, whose `SHADOW.float` rest shadow keeps
  showing under the run's glow.
- **Starts on arrival**, whatever the tower is doing (an opening sky drop plays alongside it).
- **The study sessions are opted out.** They mount inside td (parked ones on arrival) and
  each has its own header flame. `DailyBankingOptOut` around each `StudySession` keeps
  those flames on the live readout and out of the anchor registry; otherwise the last to
  mount would become the embers' launch point, invisible behind a clip-path.
- **A dive mid-run.** The tower header unmounts once the camera is down; the run keeps its
  clock and finishes unseen (the embers draw nothing without both anchors). It is already
  stamped seen, so it does not replay on the way back out.
- **Tester chips.** `BankingAlwaysPlayToggle` (`deck-tower-page__banking-*`), beside the
  lightning chips on a shared feature-tester row: "Bank: daily" · "Every visit"
  (§ Feature-tester rows).

## Palette notes

The white page title on the worlds' `Mk` skies breaks v2's "colour never carries text" rule
(at night it is that white under the time-of-day wash, § Time of day). That
copies the reference art's white logo on blue. Over space (`spaceOver(sky)`) it reads
as normal light-on-dark. For the framework's colour divergence, see
[ISO_ART_FRAMEWORK.md](./ISO_ART_FRAMEWORK.md) § Palette.
