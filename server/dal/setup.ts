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
const gameAssetDAL = new GameAssetDAL();
const gameProgressDAL = new GameProgressDAL();
const icons8DAL = new Icons8DAL();
const winsDAL = new WinsDAL();
const communityLayoutDAL = new CommunityLayoutDAL();

// Service instances (with DI)
const userService = new UserService(userDAL, refreshTokenDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
// Created before onDeckVocabService because Word Search borrows its level estimate.
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL, sortPacksDAL);
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, dictionaryService, starterPacksService);
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL);
const textService = new TextService(userDAL);
// Validation reuses TextService to persist composed documents (with validation* columns).
const validationService = new ValidationService(userDAL, textService);
const nightMarketService = new NightMarketService(nightMarketDAL, userDAL);
// Validator-authored template CATALOG (definitions), separate from the unlock economy.
const nightMarketTemplateService = new NightMarketTemplateService(userDAL);
const gameAssetService = new GameAssetService(gameAssetDAL);
const gameProgressService = new GameProgressService(gameProgressDAL);
// Community shared-layout feeds + votes; reuses vocabEntryService for the apply-to-card flow.
const communityLayoutService = new CommunityLayoutService(communityLayoutDAL, vocabEntryService);

// Controller instances
const userController = new UserController(userService, icons8DAL);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL, vocabEntryDAL);
const textController = new TextController(textService);
const validationController = new ValidationController(validationService);
const starterPacksController = new StarterPacksController(starterPacksService);
const nightMarketController = new NightMarketController(nightMarketService);
const nightMarketTemplateController = new NightMarketTemplateController(nightMarketTemplateService);
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
