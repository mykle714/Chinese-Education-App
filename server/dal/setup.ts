// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { UserMinutePointsDAL } from './implementations/UserMinutePointsDAL.js';
import { DictionaryDAL } from './implementations/DictionaryDAL.js';
import { UserService } from '../services/UserService.js';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { TextService } from '../services/TextService.js';
import { StarterPacksService } from '../services/StarterPacksService.js';
import { UserController } from '../controllers/UserController.js';
import { VocabEntryController } from '../controllers/VocabEntryController.js';
import { OnDeckVocabController } from '../controllers/OnDeckVocabController.js';
import { UserMinutePointsController } from '../controllers/UserMinutePointsController.js';
import { DictionaryController } from '../controllers/DictionaryController.js';
import { TextController } from '../controllers/TextController.js';
import { StarterPacksController } from '../controllers/StarterPacksController.js';
import { NightMarketDAL } from './implementations/NightMarketDAL.js';
import { NightMarketService } from '../services/NightMarketService.js';
import { NightMarketController } from '../controllers/NightMarketController.js';
import { GameAssetDAL } from './implementations/GameAssetDAL.js';
import { GameProgressDAL } from './implementations/GameProgressDAL.js';
import { GameAssetService } from '../services/GameAssetService.js';
import { GameProgressService } from '../services/GameProgressService.js';
import { GamesController } from '../controllers/GamesController.js';

// DAL instances
const userDAL = new UserDAL();
const vocabEntryDAL = new VocabEntryDAL();
const userMinutePointsDAL = new UserMinutePointsDAL();
const dictionaryDAL = new DictionaryDAL();
const nightMarketDAL = new NightMarketDAL();
const gameAssetDAL = new GameAssetDAL();
const gameProgressDAL = new GameProgressDAL();

// Service instances (with DI)
const userService = new UserService(userDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, dictionaryService);
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL);
const textService = new TextService(userDAL);
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL);
const nightMarketService = new NightMarketService(nightMarketDAL, userDAL);
const gameAssetService = new GameAssetService(gameAssetDAL);
const gameProgressService = new GameProgressService(gameProgressDAL);

// Controller instances
const userController = new UserController(userService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL, vocabEntryDAL);
const textController = new TextController(textService);
const starterPacksController = new StarterPacksController(starterPacksService);
const nightMarketController = new NightMarketController(nightMarketService);
const gamesController = new GamesController(gameAssetService, gameProgressService);

export {
  userDAL,
  vocabEntryDAL,
  userMinutePointsDAL,
  dictionaryDAL,
  userService,
  vocabEntryService,
  onDeckVocabService,
  userMinutePointsService,
  dictionaryService,
  textService,
  starterPacksService,
  userController,
  vocabEntryController,
  onDeckVocabController,
  userMinutePointsController,
  dictionaryController,
  textController,
  starterPacksController,
  nightMarketDAL,
  nightMarketService,
  nightMarketController,
  gameAssetDAL,
  gameProgressDAL,
  gameAssetService,
  gameProgressService,
  gamesController,
};
