// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { RefreshTokenDAL } from './implementations/RefreshTokenDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { UserMinutePointsDAL } from './implementations/UserMinutePointsDAL.js';
import { UserLanguagesDAL } from './implementations/UserLanguagesDAL.js';
import { DictionaryDAL } from './implementations/DictionaryDAL.js';
import { UserService } from '../services/UserService.js';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { TextService } from '../services/TextService.js';
import { ValidationService } from '../services/ValidationService.js';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { LazyEnrichmentService } from '../services/LazyEnrichmentService.js';
import { SortPacksDAL } from './implementations/SortPacksDAL.js';
import { UserController } from '../controllers/UserController.js';
import { VocabEntryController } from '../controllers/VocabEntryController.js';
import { OnDeckVocabController } from '../controllers/OnDeckVocabController.js';
import { UserMinutePointsController } from '../controllers/UserMinutePointsController.js';
import { DictionaryController } from '../controllers/DictionaryController.js';
import { TextController } from '../controllers/TextController.js';
import { ValidationController } from '../controllers/ValidationController.js';
import { StarterPacksController } from '../controllers/StarterPacksController.js';
import { NightMarketDAL } from './implementations/NightMarketDAL.js';
import { NightMarketService } from '../services/NightMarketService.js';
import { NightMarketController } from '../controllers/NightMarketController.js';
import { NightMarketTemplateService } from '../services/NightMarketTemplateService.js';
import { NightMarketTemplateController } from '../controllers/NightMarketTemplateController.js';
import { NightMarketPlacementDAL } from './implementations/NightMarketPlacementDAL.js';
import { NightMarketPlacementService } from '../services/NightMarketPlacementService.js';
import { NightMarketSandboxDAL } from './implementations/NightMarketSandboxDAL.js';
import { NightMarketSandboxService } from '../services/NightMarketSandboxService.js';
import { NightMarketSandboxController } from '../controllers/NightMarketSandboxController.js';
import { NightMarketWorldService } from '../services/NightMarketWorldService.js';
import { NightMarketWorldController } from '../controllers/NightMarketWorldController.js';
import { GameAssetDAL } from './implementations/GameAssetDAL.js';
import { GameProgressDAL } from './implementations/GameProgressDAL.js';
import { Icons8DAL } from './implementations/Icons8DAL.js';
import { Icons8Controller } from '../controllers/Icons8Controller.js';
import { WinsDAL } from './implementations/WinsDAL.js';
import { WinsController } from '../controllers/WinsController.js';
import { CommunityLayoutDAL } from './implementations/CommunityLayoutDAL.js';
import { CommunityLayoutService } from '../services/CommunityLayoutService.js';
import { CommunityLayoutController } from '../controllers/CommunityLayoutController.js';
import { GameAssetService } from '../services/GameAssetService.js';
import { GameProgressService } from '../services/GameProgressService.js';
import { GamesController } from '../controllers/GamesController.js';
import { SpeedReadingDAL } from './implementations/SpeedReadingDAL.js';
import { SpeedReadingService } from '../services/SpeedReadingService.js';
import { SpeedReadingController } from '../controllers/SpeedReadingController.js';
import { LeaderboardService } from '../services/LeaderboardService.js';
import { LeaderboardController } from '../controllers/LeaderboardController.js';
import { TTSService } from '../services/TTSService.js';
import { TTSController } from '../controllers/TTSController.js';
import { CategoryPromotionDAL } from './implementations/CategoryPromotionDAL.js';
import { VelocityController } from '../controllers/VelocityController.js';
import { FriendshipDAL } from './implementations/FriendshipDAL.js';
import { DeckDAL } from './implementations/DeckDAL.js';
import { FriendsService } from '../services/FriendsService.js';
import { DeckService } from '../services/DeckService.js';
import { FriendsController } from '../controllers/FriendsController.js';
import { DecksController } from '../controllers/DecksController.js';
import { ProvisionalCardDAL } from './implementations/ProvisionalCardDAL.js';
import { ProvisionalCardService } from '../services/ProvisionalCardService.js';

// DAL instances
const userDAL = new UserDAL();
const refreshTokenDAL = new RefreshTokenDAL();
const vocabEntryDAL = new VocabEntryDAL();
const userMinutePointsDAL = new UserMinutePointsDAL();
// Per-(user, language) wallet + streak state, plus the monotonic gross counter
// (migrations 130 and 134, docs/PER_LANGUAGE_STREAKS.md). Replaced the global counters on `users`.
const userLanguagesDAL = new UserLanguagesDAL();
const dictionaryDAL = new DictionaryDAL();
const sortPacksDAL = new SortPacksDAL();
const nightMarketDAL = new NightMarketDAL();
const nightMarketPlacementDAL = new NightMarketPlacementDAL();
const nightMarketSandboxDAL = new NightMarketSandboxDAL();
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
// Baseline top-up for games/flp: lends words as 'provisional' vet rows so no surface
// ever blocks on card count (migration 140, docs/PROVISIONAL_CARDS.md).
const provisionalCardDAL = new ProvisionalCardDAL();
// User-authored card sets — decks and their membership rows (migration 141,
// docs/DECKS_FEATURE.md).
const deckDAL = new DeckDAL();

// Service instances (with DI)
const userService = new UserService(userDAL, refreshTokenDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
// Request-time (validator-gated) trigger for the zh discover lazy-enrichment pipeline
// (docs/DISCOVER_LAZY_ENRICHMENT.md §5). Injected into the two trigger points below.
const lazyEnrichmentService = new LazyEnrichmentService(userDAL);
// Created before onDeckVocabService because Word Search borrows its level estimate.
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL, sortPacksDAL, lazyEnrichmentService);
const textService = new TextService(userDAL);
// Validation reuses TextService to persist composed documents (with validation* columns).
const validationService = new ValidationService(userDAL, textService);
const nightMarketService = new NightMarketService(nightMarketDAL, userDAL);
// Validator-authored template CATALOG (definitions), separate from the unlock economy. The
// sandbox DAL is injected so deleting a template also removes every author's sandbox placement
// of it (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md § cleanup).
const nightMarketTemplateService = new NightMarketTemplateService(userDAL, nightMarketSandboxDAL);
// Per-user template LAYOUT read (placements → rendered world); seeds the origin hub.
const nightMarketWorldService = new NightMarketWorldService(nightMarketPlacementDAL, nightMarketTemplateService);
// Occupant/placement WRITE side (grant flow + spawn). Injected into the minute-points service so
// earning a minute reconciles the user's unlock entitlement (best-effort — see below).
const nightMarketPlacementService = new NightMarketPlacementService(nightMarketPlacementDAL, nightMarketTemplateService);
// Desktop-only Template Sandbox: template authors freely tile catalog templates (scratch state).
// Constructed after the placement service — the sandbox's Iterate action reuses its growth planner.
const nightMarketSandboxService = new NightMarketSandboxService(nightMarketSandboxDAL, userDAL, nightMarketPlacementService);
// Constructed after the placement service so the grant hook can be wired in.
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL, userLanguagesDAL, nightMarketPlacementService);
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
// Friend-request policy (who may accept/revoke, crossing-request auto-accept).
// userDAL supplies the target account's existence check and public identity; the
// last two DALs are read-only and feed the velocity leaderboard (each friend scored
// in their own selected language) — see FriendsService.getLeaderboard.
const friendsService = new FriendsService(friendshipDAL, userDAL, categoryPromotionDAL, userLanguagesDAL);
// Constructed after starterPacksService: it borrows estimateLevel to pick which
// difficulty band to lend from (docs/PROVISIONAL_CARDS.md § Which words get lent).
const provisionalCardService = new ProvisionalCardService(provisionalCardDAL, starterPacksService);
// Constructed after ttsService (the working loop pre-warms each card's audio) and
// after provisionalCardService (the loop lends cards when every card it owns is
// resting on cooldown). No cycle: ProvisionalCardService knows nothing of this one.
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, dictionaryService, starterPacksService, ttsService, provisionalCardService);
// Constructed after onDeckVocabService: a deck's card list is the third collection
// read and is delegated to it (see DeckService's class comment).
const deckService = new DeckService(deckDAL, onDeckVocabService);

// Controller instances
const userController = new UserController(userService, icons8DAL, nightMarketWorldService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
// Takes deckService as well: its game/flp endpoints accept an optional `?deck=`
// restriction and must authorize that id before assembling a round.
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService, provisionalCardService, deckService);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL, vocabEntryDAL, lazyEnrichmentService);
const textController = new TextController(textService);
const validationController = new ValidationController(validationService);
const starterPacksController = new StarterPacksController(starterPacksService, provisionalCardService);
const nightMarketController = new NightMarketController(nightMarketService);
const nightMarketTemplateController = new NightMarketTemplateController(nightMarketTemplateService);
const nightMarketSandboxController = new NightMarketSandboxController(nightMarketSandboxService);
const nightMarketWorldController = new NightMarketWorldController(nightMarketWorldService);
const gamesController = new GamesController(gameAssetService, gameProgressService);
// Speed Reading is game-SPECIFIC and so gets its own controller rather than
// growing the game-agnostic GamesController.
const speedReadingService = new SpeedReadingService(speedReadingDAL);
const speedReadingController = new SpeedReadingController(speedReadingService);
// icons8 image serving is a thin DB read → no service layer; the controller takes the DAL directly.
const icons8Controller = new Icons8Controller(icons8DAL);
// wins is a thin per-user event log → no service layer; controller takes the DAL directly.
const winsController = new WinsController(winsDAL);
// velocity is likewise a thin read over an event log; userDAL only supplies the
// account's selected language for the headline number.
const velocityController = new VelocityController(categoryPromotionDAL, userDAL);
const communityLayoutController = new CommunityLayoutController(communityLayoutService);
const leaderboardController = new LeaderboardController(leaderboardService);
const ttsController = new TTSController(ttsService);
const friendsController = new FriendsController(friendsService);
const decksController = new DecksController(deckService);

export {
  userDAL,
  refreshTokenDAL,
  vocabEntryDAL,
  userMinutePointsDAL,
  userLanguagesDAL,
  dictionaryDAL,
  sortPacksDAL,
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
  nightMarketDAL,
  nightMarketService,
  nightMarketController,
  nightMarketTemplateService,
  nightMarketTemplateController,
  nightMarketSandboxDAL,
  nightMarketSandboxService,
  nightMarketSandboxController,
  nightMarketPlacementDAL,
  nightMarketPlacementService,
  nightMarketWorldService,
  nightMarketWorldController,
  gameAssetDAL,
  gameProgressDAL,
  gameAssetService,
  gameProgressService,
  gamesController,
  speedReadingDAL,
  speedReadingService,
  speedReadingController,
  icons8DAL,
  icons8Controller,
  winsDAL,
  winsController,
  categoryPromotionDAL,
  velocityController,
  communityLayoutDAL,
  communityLayoutService,
  communityLayoutController,
  leaderboardService,
  leaderboardController,
  ttsService,
  ttsController,
  friendshipDAL,
  friendsService,
  friendsController,
  provisionalCardDAL,
  provisionalCardService,
  deckDAL,
  deckService,
  decksController,
};
