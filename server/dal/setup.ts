// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { RefreshTokenDAL } from './implementations/RefreshTokenDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { UserMinutePointsDAL } from './implementations/UserMinutePointsDAL.js';
import { UserLanguagesDAL } from './implementations/UserLanguagesDAL.js';
import { DictionaryDAL } from './implementations/DictionaryDAL.js';
import { OnDeckVocabDAL } from './implementations/OnDeckVocabDAL.js';
import { UserService } from '../services/UserService.js';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { FlashcardMarkService } from '../services/FlashcardMarkService.js';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { TextService } from '../services/TextService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { LazyEnrichmentService } from '../services/LazyEnrichmentService.js';
import { SortPacksDAL } from './implementations/SortPacksDAL.js';
import { StarterPacksDAL } from './implementations/StarterPacksDAL.js';
import { TextDAL } from './implementations/TextDAL.js';
import { ValidationDAL } from './implementations/ValidationDAL.js';
import { UserController } from '../controllers/UserController.js';
import { VocabEntryController } from '../controllers/VocabEntryController.js';
import { OnDeckVocabController } from '../controllers/OnDeckVocabController.js';
import { UserMinutePointsController } from '../controllers/UserMinutePointsController.js';
import { DictionaryController } from '../controllers/DictionaryController.js';
import { TextController } from '../controllers/TextController.js';
import { ValidationController } from '../controllers/ValidationController.js';
import { StarterPacksController } from '../controllers/StarterPacksController.js';
import { GameAssetDAL } from './implementations/GameAssetDAL.js';
import { GameProgressDAL } from './implementations/GameProgressDAL.js';
import { Icons8DAL } from './implementations/Icons8DAL.js';
import { Icons8Controller } from '../controllers/Icons8Controller.js';
import { WinsDAL } from './implementations/WinsDAL.js';
import { WinsController } from '../controllers/WinsController.js';
import { PersonalBestDAL } from './implementations/PersonalBestDAL.js';
import { PersonalBestService } from '../services/PersonalBestService.js';
import { PersonalBestController } from '../controllers/PersonalBestController.js';
import { WritingGridDAL } from './implementations/WritingGridDAL.js';
import { WritingGridService } from '../services/WritingGridService.js';
import { WritingGridController } from '../controllers/WritingGridController.js';
import { SuperpositionService } from '../services/SuperpositionService.js';
import { SuperpositionController } from '../controllers/SuperpositionController.js';
import { WritingNotebookDAL } from './implementations/WritingNotebookDAL.js';
import { WritingNotebookService } from '../services/WritingNotebookService.js';
import { WritingNotebookController } from '../controllers/WritingNotebookController.js';
import { CommunityLayoutDAL } from './implementations/CommunityLayoutDAL.js';
import { CommunityLayoutService } from '../services/CommunityLayoutService.js';
import { CommunityLayoutController } from '../controllers/CommunityLayoutController.js';
import { GameAssetService } from '../services/GameAssetService.js';
import { GameProgressService } from '../services/GameProgressService.js';
import { GamesController } from '../controllers/GamesController.js';
import { SpeedReadingDAL } from './implementations/SpeedReadingDAL.js';
import { SpeedReadingService } from '../services/SpeedReadingService.js';
import { SpeedReadingController } from '../controllers/SpeedReadingController.js';
import { MemoryMapDAL } from './implementations/MemoryMapDAL.js';
import { FocusModeDAL } from './implementations/FocusModeDAL.js';
import { FocusModeService } from '../services/FocusModeService.js';
import { FocusModeController } from '../controllers/FocusModeController.js';
import { MemoryMapService } from '../services/MemoryMapService.js';
import { MemoryMapController } from '../controllers/MemoryMapController.js';
import { LeaderboardService } from '../services/LeaderboardService.js';
import { LeaderboardController } from '../controllers/LeaderboardController.js';
import { UsageStatsDAL } from './implementations/UsageStatsDAL.js';
import { UsageDashboardService } from '../services/UsageDashboardService.js';
import { UsageDashboardController } from '../controllers/UsageDashboardController.js';
import { TTSService } from '../services/TTSService.js';
import { CardAudioService } from '../services/CardAudioService.js';
import { TTSController } from '../controllers/TTSController.js';
import { CategoryPromotionDAL } from './implementations/CategoryPromotionDAL.js';
import { VelocityController } from '../controllers/VelocityController.js';
import { FriendshipDAL } from './implementations/FriendshipDAL.js';
import { ArenaDAL } from './implementations/ArenaDAL.js';
import { FriendsService } from '../services/FriendsService.js';
import { ArenaService } from '../services/ArenaService.js';
import { ArenaController } from '../controllers/ArenaController.js';
import { WeatherService } from '../services/WeatherService.js';
import { WeatherController } from '../controllers/WeatherController.js';
import { FriendsController } from '../controllers/FriendsController.js';
import { ProvisionalCardDAL } from './implementations/ProvisionalCardDAL.js';
import { ProvisionalCardService } from '../services/ProvisionalCardService.js';
import { StudyChallengeDAL } from './implementations/StudyChallengeDAL.js';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import { UserProfileService } from '../services/UserProfileService.js';
import { UserProfileController } from '../controllers/UserProfileController.js';
import { StudyChallengeController } from '../controllers/StudyChallengeController.js';

// DAL instances
const userDAL = new UserDAL();
const refreshTokenDAL = new RefreshTokenDAL();
const vocabEntryDAL = new VocabEntryDAL();
const userMinutePointsDAL = new UserMinutePointsDAL();
// Per-(user, language) wallet + streak state, plus the monotonic gross counter
// (migrations 130 and 134, docs/PER_LANGUAGE_STREAKS.md). Replaced the global counters on `users`.
const userLanguagesDAL = new UserLanguagesDAL();
const dictionaryDAL = new DictionaryDAL();
// The study surfaces' card reads (flp loop, game pools, Word Search, deck counts);
// OnDeckVocabService holds the selection policy over them.
const onDeckVocabDAL = new OnDeckVocabDAL();
const sortPacksDAL = new SortPacksDAL();
const starterPacksDAL = new StarterPacksDAL();
const textDAL = new TextDAL();
const validationDAL = new ValidationDAL();
const gameAssetDAL = new GameAssetDAL();
const gameProgressDAL = new GameProgressDAL();
const icons8DAL = new Icons8DAL();
const winsDAL = new WinsDAL();
const communityLayoutDAL = new CommunityLayoutDAL();
// Speed Reading owns no tables — this DAL reads the player's library.
const speedReadingDAL = new SpeedReadingDAL();
// Append-only utcm band-promotion log; velocity is summed from it (migration 137,
// docs/VELOCITY.md). Written by the flashcard mark/undo handlers.
const categoryPromotionDAL = new CategoryPromotionDAL();
// The friend graph — one row per unordered pair, pending or accepted
// (migration 138, docs/FRIENDS_FEATURE.md).
const friendshipDAL = new FriendshipDAL();
const arenaDAL = new ArenaDAL();
// Constructed here rather than beside the other controllers because
// UserMinutePointsService takes it as a dependency below — every credited minute
// is also credited to the user's live arena. Arena reads users only to render a
// board row (name + avatar), so it takes the narrow ArenaUserLookup shape rather
// than the whole UserDAL surface.
const arenaService = new ArenaService(arenaDAL, userDAL);
// Baseline top-up for games/flp: lends words as 'provisional' vet rows so no surface
// ever blocks on card count (migration 140, docs/PROVISIONAL_CARDS.md).
const provisionalCardDAL = new ProvisionalCardDAL();
// (The user Decks feature — DeckDAL / DeckService / DecksController — was removed
// 2026-11-04. Its `decks` / `deck_cards` tables (migration 141) are retained;
// VocabEntryDAL.delete still clears a deleted card's deck_cards rows.)
// The weekly head-to-head between two friends — one table, everything about a
// challenge on it (migration 148, docs/STUDY_CHALLENGE.md).
const studyChallengeDAL = new StudyChallengeDAL();
// (Night Market and Immersive World — their DALs, services and controllers — were removed
// 2026-11-09 and their tables dropped; the code is archived on the
// `archive/night-market-immersive-world` branch, see docs/ARCHIVED_FEATURES.md.)
// (The global Word of the Day — DailyWordDAL / WordOfTheDayService / its controller and
// GET /api/dictionary/word-of-the-day — was removed 2026-11-04 with the Reading/Writing
// Mastery Centers, its only client surface. The `daily_words` table (migration 169)
// is retained.)

// Service instances (with DI)
const userService = new UserService(userDAL, refreshTokenDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
// The single owner of "a learner reviewed a card" — cooldown gate, typed mark
// windows, mastery crossings and the velocity log (docs/MASTERY_REWORK.md). Depends
// only on the two DALs it writes, so it can sit anywhere after them; kept beside
// vocabEntryService because both are vet-write services.
const flashcardMarkService = new FlashcardMarkService(vocabEntryDAL, categoryPromotionDAL);
// Request-time (validator-gated) trigger for the zh discover lazy-enrichment pipeline
// (docs/DISCOVER_LAZY_ENRICHMENT.md §5). Injected into the two trigger points below.
const lazyEnrichmentService = new LazyEnrichmentService(userDAL, dictionaryDAL);
// Created before onDeckVocabService because Word Search borrows its level estimate.
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL, sortPacksDAL, starterPacksDAL, lazyEnrichmentService);
// dictionaryDAL: createText segments the first line (gsa) to derive the title.
const textService = new TextService(userDAL, dictionaryDAL, textDAL);
const validationService = new ValidationService(userDAL, validationDAL);
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL, userLanguagesDAL, arenaService);
const gameAssetService = new GameAssetService(gameAssetDAL);
const gameProgressService = new GameProgressService(gameProgressDAL);
// Community shared-layout feeds + votes; reuses vocabEntryService for the apply-to-card flow.
const communityLayoutService = new CommunityLayoutService(communityLayoutDAL, vocabEntryService);
// Read-only aggregate over four DALs; streak is masked for non-public users. Deliberately
// cross-language: it ranks on Σ per-language wallets and shows the best per-language streak.
const leaderboardService = new LeaderboardService(userDAL, userMinutePointsDAL, userLanguagesDAL, winsDAL);
// Provider-pluggable text-to-speech with an on-disk cache. No DB dependencies, but it
// is constructed HERE rather than as a module singleton so every service has one
// lifetime owner (docs/ARCHITECTURE_REVIEW.md finding 8).
const ttsService = new TTSService();
// Card audio: pre-warm + the det `ttsVoice` stamp, layered over ttsService. Shared by
// the flp/game pools (via onDeckVocabService), the loop-refill and acp pack-refill
// controllers, and /api/tts/synthesize — one stamp policy for all of them.
const cardAudioService = new CardAudioService(ttsService, dictionaryDAL);
// Constructed after starterPacksService: it borrows estimateLevel to pick which
// difficulty band to lend from (docs/PROVISIONAL_CARDS.md § Which words get lent).
const provisionalCardService = new ProvisionalCardService(provisionalCardDAL, starterPacksService);
// Constructed after cardAudioService (the working loop pre-warms each card's audio) and
// after provisionalCardService (the loop lends cards when every card it owns is
// resting on cooldown). No cycle: ProvisionalCardService knows nothing of this one.
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, onDeckVocabDAL, dictionaryService, starterPacksService, cardAudioService, provisionalCardService);
// Constructed after starterPacksService (it borrows estimateLevel for the candidate
// band, and the shared "already known" write for a struck word).
const studyChallengeService = new StudyChallengeService(
  studyChallengeDAL, friendshipDAL, userDAL, starterPacksService
);
// User profile page (docs/USER_PROFILE_PAGE.md) — a pure COMPOSITION service: it owns
// no table of its own and reads through five DALs plus onDeckVocabService, whose
// getCategoryCounts is the single definition of a per-band card count. Constructed
// after onDeckVocabService for that reason; nothing depends on it in turn.
const userProfileService = new UserProfileService(
  userDAL, friendshipDAL, categoryPromotionDAL, userLanguagesDAL, communityLayoutDAL, onDeckVocabService
);

// Friend-request policy (who may accept/revoke, crossing-request auto-accept).
// userDAL supplies the target account's existence check and public identity; the
// next two DALs are read-only and feed the velocity leaderboard (each friend scored
// in their own selected language) — see FriendsService.getLeaderboard.
//
// MUST be constructed AFTER studyChallengeService: unfriending ends the pair's
// in-flight challenges in the same transaction as the friendship delete
// (docs/STUDY_CHALLENGE.md § 6). The dependency is one-way — the challenge service
// reads the friend graph through friendshipDAL, never through this service — so
// there is no cycle to break, only an ordering to respect.
const friendsService = new FriendsService(
  friendshipDAL, userDAL, categoryPromotionDAL, userLanguagesDAL, studyChallengeService
);

// Controller instances
const userProfileController = new UserProfileController(userProfileService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
// Focus mode (docs/FOCUS_MODE.md): a per-world daily cap of 25 cards. Its own DAL; the
// service is shared by its controller and by onDeckVocabController + flashcardRoutes,
// which narrow every flp/game round to the day's set.
const focusModeDAL = new FocusModeDAL();
const focusModeService = new FocusModeService(focusModeDAL);
const focusModeController = new FocusModeController(focusModeService);
// After focusModeService: turning a Reading / Writing goal on may auto-enable focus.
const userController = new UserController(userService, icons8DAL, focusModeService);
const onDeckVocabController = new OnDeckVocabController(
  onDeckVocabService, provisionalCardService, studyChallengeService, focusModeService, cardAudioService
);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL, vocabEntryDAL, lazyEnrichmentService);
const textController = new TextController(textService);
const validationController = new ValidationController(validationService);
const starterPacksController = new StarterPacksController(starterPacksService, provisionalCardService, cardAudioService);
const gamesController = new GamesController(gameAssetService, gameProgressService);
// Speed Reading is game-SPECIFIC and so gets its own controller rather than
// growing the game-agnostic GamesController.
const speedReadingService = new SpeedReadingService(speedReadingDAL);
const speedReadingController = new SpeedReadingController(speedReadingService);
// Memory Map likewise owns tables of its own (migration 151), so it gets the full
// DAL/Service/Controller stack rather than joining the game-agnostic GamesController.
// The service's `rng` argument is left at its Math.random default here; it exists so a
// test can pin every spawn (docs/MEMORY_MAP_GAME.md § 9).
const memoryMapDAL = new MemoryMapDAL();
// Lends through provisionalCardService to keep the map full (docs/MEMORY_MAP_GAME.md § 2.1).
const memoryMapService = new MemoryMapService(memoryMapDAL, provisionalCardService);
const memoryMapController = new MemoryMapController(memoryMapService);
// icons8 image serving is a thin DB read → no service layer; the controller takes the DAL directly.
const icons8Controller = new Icons8Controller(icons8DAL);
// wins is a thin per-user event log → no service layer; controller takes the DAL directly.
const winsController = new WinsController(winsDAL);
// Personal bests (migration 171, docs/WRITING_PRACTICE_REWORK.md § 2a): the service owns
// the per-game direction rule, so unlike wins this one has a service layer.
const personalBestDAL = new PersonalBestDAL();
const personalBestService = new PersonalBestService(personalBestDAL);
const personalBestController = new PersonalBestController(personalBestService);
// Writing Grid (docs/WRITING_PRACTICE_REWORK.md § 2): deals 8 characters, lending when short.
const writingGridDAL = new WritingGridDAL();
const writingGridService = new WritingGridService(writingGridDAL, provisionalCardService);
const writingGridController = new WritingGridController(writingGridService, focusModeService, onDeckVocabService);
const superpositionService = new SuperpositionService(writingGridDAL, provisionalCardService);
const superpositionController = new SuperpositionController(superpositionService, focusModeService, onDeckVocabService);
// Writing Notebook (migration 174, docs/WRITING_NOTEBOOK.md): endless per-word practice
// sheets; the service runs the handwriting recogniser on each saved cell.
const writingNotebookDAL = new WritingNotebookDAL();
const writingNotebookService = new WritingNotebookService(writingNotebookDAL);
const writingNotebookController = new WritingNotebookController(writingNotebookService);
// velocity is likewise a thin read over an event log; userDAL only supplies the
// account's selected language for the headline number.
const velocityController = new VelocityController(categoryPromotionDAL, userDAL);
const communityLayoutController = new CommunityLayoutController(communityLayoutService);
const leaderboardController = new LeaderboardController(leaderboardService);
// The User Usage dashboard (docs/USAGE_DASHBOARD.md): a read-only cross-user DAL, and a
// service that owns the users.isAdmin gate (migration 168) — userDAL is only for that check.
const usageStatsDAL = new UsageStatsDAL();
const usageDashboardService = new UsageDashboardService(userDAL, usageStatsDAL);
const usageDashboardController = new UsageDashboardController(usageDashboardService);
const ttsController = new TTSController(cardAudioService);
const friendsController = new FriendsController(friendsService);
const arenaController = new ArenaController(arenaService);
// The Deck Tower's weather (docs/DECK_TOWER.md § "Weather"). Reads users."geoCell" through
// arenaDAL — the cell is written by the arena's location opt-in, and one stored value serves both.
const weatherService = new WeatherService(arenaDAL);
const weatherController = new WeatherController(weatherService);
const studyChallengeController = new StudyChallengeController(studyChallengeService);

export {
  focusModeService,
  focusModeController,
  userDAL,
  refreshTokenDAL,
  vocabEntryDAL,
  userMinutePointsDAL,
  userLanguagesDAL,
  dictionaryDAL,
  sortPacksDAL,
  starterPacksDAL,
  textDAL,
  validationDAL,
  userService,
  vocabEntryService,
  onDeckVocabService,
  userMinutePointsService,
  dictionaryService,
  textService,
  validationService,
  starterPacksService,
  userController,
  vocabEntryController,
  onDeckVocabController,
  userMinutePointsController,
  dictionaryController,
  textController,
  validationController,
  starterPacksController,
  gameAssetDAL,
  gameProgressDAL,
  gameAssetService,
  gameProgressService,
  gamesController,
  speedReadingDAL,
  speedReadingService,
  memoryMapDAL,
  memoryMapService,
  memoryMapController,
  speedReadingController,
  icons8DAL,
  icons8Controller,
  winsDAL,
  winsController,
  personalBestController,
  writingGridController,
  superpositionController,
  writingNotebookController,
  categoryPromotionDAL,
  flashcardMarkService,
  velocityController,
  communityLayoutDAL,
  communityLayoutService,
  communityLayoutController,
  leaderboardService,
  leaderboardController,
  usageStatsDAL,
  usageDashboardService,
  usageDashboardController,
  ttsService,
  cardAudioService,
  ttsController,
  friendshipDAL,
  friendsService,
  friendsController,
  arenaController,
  arenaService,
  weatherService,
  weatherController,
  arenaDAL,
  provisionalCardDAL,
  provisionalCardService,
  studyChallengeDAL,
  studyChallengeService,
  studyChallengeController,
  userProfileService,
  userProfileController,
};
