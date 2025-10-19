// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { OnDeckVocabDAL } from './implementations/OnDeckVocabDAL.js';
import { UserWorkPointsDAL } from './implementations/UserWorkPointsDAL.js';
import { DictionaryDAL } from './implementations/DictionaryDAL.js';
import { UserService } from '../services/UserService.js';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { UserWorkPointsService } from '../services/UserWorkPointsService.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { TextService } from '../services/TextService.js';
import { UserController } from '../controllers/UserController.js';
import { VocabEntryController } from '../controllers/VocabEntryController.js';
import { OnDeckVocabController } from '../controllers/OnDeckVocabController.js';
import { UserWorkPointsController } from '../controllers/UserWorkPointsController.js';
import { DictionaryController } from '../controllers/DictionaryController.js';
import { TextController } from '../controllers/TextController.js';

// Create DAL instances
const userDAL = new UserDAL();
const vocabEntryDAL = new VocabEntryDAL();
const onDeckVocabDAL = new OnDeckVocabDAL();
const userWorkPointsDAL = new UserWorkPointsDAL();
const dictionaryDAL = new DictionaryDAL();

// Create Service instances with proper dependency injection
const userService = new UserService(userDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL);
const onDeckVocabService = new OnDeckVocabService(onDeckVocabDAL);
const userWorkPointsService = new UserWorkPointsService(userWorkPointsDAL, userDAL);
const dictionaryService = new DictionaryService(dictionaryDAL);
const textService = new TextService(userDAL);

// Create Controller instances
const userController = new UserController(userService);
const vocabEntryController = new VocabEntryController(vocabEntryService, dictionaryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);
const userWorkPointsController = new UserWorkPointsController(userWorkPointsService);
const dictionaryController = new DictionaryController(dictionaryService, userDAL);
const textController = new TextController(textService);

// Export configured instances
export { 
  userDAL, 
  vocabEntryDAL,
  onDeckVocabDAL,
  userWorkPointsDAL,
  dictionaryDAL,
  userService, 
  vocabEntryService,
  onDeckVocabService,
  userWorkPointsService,
  dictionaryService,
  textService,
  userController,
  vocabEntryController,
  onDeckVocabController,
  userWorkPointsController,
  dictionaryController,
  textController
};
