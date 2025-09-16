// Setup file to wire together DAL, Service, and Controller instances
import { UserDAL } from './implementations/UserDAL.js';
import { VocabEntryDAL } from './implementations/VocabEntryDAL.js';
import { OnDeckVocabDAL } from './implementations/OnDeckVocabDAL.js';
import { UserService } from '../services/UserService.js';
import { VocabEntryService } from '../services/VocabEntryService.js';
import { OnDeckVocabService } from '../services/OnDeckVocabService.js';
import { UserController } from '../controllers/UserController.js';
import { VocabEntryController } from '../controllers/VocabEntryController.js';
import { OnDeckVocabController } from '../controllers/OnDeckVocabController.js';

// Create DAL instances
const userDAL = new UserDAL();
const vocabEntryDAL = new VocabEntryDAL();
const onDeckVocabDAL = new OnDeckVocabDAL();

// Create Service instances with proper dependency injection
const userService = new UserService(userDAL);
const vocabEntryService = new VocabEntryService(vocabEntryDAL, userDAL);
const onDeckVocabService = new OnDeckVocabService(onDeckVocabDAL);

// Create Controller instances
const userController = new UserController(userService);
const vocabEntryController = new VocabEntryController(vocabEntryService);
const onDeckVocabController = new OnDeckVocabController(onDeckVocabService);

// Export configured instances
export { 
  userDAL, 
  vocabEntryDAL,
  onDeckVocabDAL,
  userService, 
  vocabEntryService,
  onDeckVocabService,
  userController,
  vocabEntryController,
  onDeckVocabController
};
