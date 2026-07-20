// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { RefreshTokenDAL } from './implementations/RefreshTokenDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { UserMinutePointsDAL } from './implementations/UserMinutePointsDAL.js';
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

// DAL instances
const userDAL = new UserDAL();
const refreshTokenDAL = new RefreshTokenDAL();
const vocabEntryDAL = new VocabEntryDAL();
const userMinutePointsDAL = new UserMinutePointsDAL();
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

// Service instances (with DI)
const userService = new UserService(userDAL, refreshTokenDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
// Request-time (validator-gated) trigger for the zh discover lazy-enrichment pipeline
// (docs/DISCOVER_LAZY_ENRICHMENT.md §5). Injected into the two trigger points below.
const lazyEnrichmentService = new LazyEnrichmentService(userDAL);
// Created before onDeckVocabService because Word Search borrows its level estimate.
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL, sortPacksDAL, lazyEnrichmentService);
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, dictionaryService, starterPacksService);
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
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL, nightMarketPlacementService);
const gameAssetService = new GameAssetService(gameAssetDAL);
const gameProgressService = new GameProgressService(gameProgressDAL);
// Community shared-layout feeds + votes; reuses vocabEntryService for the apply-to-card flow.
const communityLayoutService = new CommunityLayoutService(communityLayoutDAL, vocabEntryService);

// Controller instances
const userController = new UserController(userService, icons8DAL, nightMarketWorldService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL, vocabEntryDAL, lazyEnrichmentService);
const textController = new TextController(textService);
const validationController = new ValidationController(validationService);
const starterPacksController = new StarterPacksController(starterPacksService);
const nightMarketController = new NightMarketController(nightMarketService);
const nightMarketTemplateController = new NightMarketTemplateController(nightMarketTemplateService);
const nightMarketSandboxController = new NightMarketSandboxController(nightMarketSandboxService);
const nightMarketWorldController = new NightMarketWorldController(nightMarketWorldService);
const gamesController = new GamesController(gameAssetService, gameProgressService);
// icons8 image serving is a thin DB read → no service layer; the controller takes the DAL directly.
const icons8Controller = new Icons8Controller(icons8DAL);
// wins is a thin per-user event log → no service layer; controller takes the DAL directly.
const winsController = new WinsController(winsDAL);
const communityLayoutController = new CommunityLayoutController(communityLayoutService);

export {
  userDAL,
  refreshTokenDAL,
  vocabEntryDAL,
  userMinutePointsDAL,
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
  icons8DAL,
  icons8Controller,
  winsDAL,
  winsController,
  communityLayoutDAL,
  communityLayoutService,
  communityLayoutController,
};
