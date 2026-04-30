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

// DAL instances
const userDAL = new UserDAL();
const vocabEntryDAL = new VocabEntryDAL();
const userMinutePointsDAL = new UserMinutePointsDAL();
const dictionaryDAL = new DictionaryDAL();
const nightMarketDAL = new NightMarketDAL();

// Service instances (with DI)
const userService = new UserService(userDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL, dictionaryService);
const onDeckVocabService = new OnDeckVocabService(vocabEntryDAL, dictionaryService);
const userMinutePointsService = new UserMinutePointsService(userMinutePointsDAL, userDAL);
const textService = new TextService(userDAL);
const starterPacksService = new StarterPacksService(vocabEntryDAL, dictionaryDAL);
const nightMarketService = new NightMarketService(nightMarketDAL, userDAL);

// Controller instances
const userController = new UserController(userService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);
const userMinutePointsController = new UserMinutePointsController(userMinutePointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL);
const textController = new TextController(textService);
const starterPacksController = new StarterPacksController(starterPacksService);
const nightMarketController = new NightMarketController(nightMarketService);

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
};
