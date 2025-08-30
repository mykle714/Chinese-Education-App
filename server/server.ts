import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import * as vocabEntryModel from './models/vocabEntryModel.js';
import * as userModel from './models/userModel.js';
import * as onDeckVocabModel from './models/onDeckVocabModel.js';
import { authenticateToken } from './authMiddleware.js';
import { User, VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, UserCreateData, UserLoginData, Text, OnDeckVocabSetCreateData } from './types/index.js';

// Import new DAL architecture for gradual migration
import { userController, vocabEntryController, onDeckVocabController } from './dal/setup.js';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// CSV parsing function
function parseCSV(csvContent: string): { entryKey: string; entryValue: string }[] {
  const lines = csvContent.split('\n');
  const entries: { entryKey: string; entryValue: string }[] = [];
  
  // Skip header row (assuming first line is header)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV line - handle quoted fields
    const fields = parseCSVLine(line);
    if (fields.length >= 2) {
      const entryKey = fields[0].trim();
      const entryValue = fields[1].trim();
      
      if (entryKey && entryValue) {
        entries.push({ entryKey, entryValue });
      }
    }
  }
  
  return entries;
}

// Helper function to parse a single CSV line with proper quote handling
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  // Add the last field
  fields.push(current);
  
  return fields;
}

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes with credentials
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);
    
    // Define allowed origins
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:5175',
      'http://127.0.0.1:5175', // Also allow 127.0.0.1 equivalent
      'http://localhost:5174',  // Vite dev server port
      'http://127.0.0.1:5174',  // Also allow 127.0.0.1 equivalent
      'http://localhost:5173',  // Fallback for development
      'http://127.0.0.1:5173',  // Also allow 127.0.0.1 equivalent for development
      'http://174.127.171.180', // Production frontend URL
      'https://174.127.171.180' // Production frontend URL with HTTPS
    ];
    
    if(allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`Origin ${origin} not allowed by CORS`);
      callback(null, false);
    }
  },
  credentials: true
}));

// Middleware to parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

// Add JWT secret to environment variables
process.env.JWT_SECRET = process.env.JWT_SECRET;

// Get all vocab entries - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get all vocab entries');
  await vocabEntryController.getAllEntries(req, res);
});

// Get paginated vocab entries - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries/paginated', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get paginated vocab entries');
  await vocabEntryController.getPaginatedEntries(req, res);
});

// Get vocab entry by ID - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get vocab entry by ID');
  await vocabEntryController.getEntryById(req, res);
});

// Create new vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/vocabEntries', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for create vocab entry');
  await vocabEntryController.createEntry(req, res);
});

// Update vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.put('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for update vocab entry');
  await vocabEntryController.updateEntry(req, res);
});

// Delete vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.delete('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for delete vocab entry');
  await vocabEntryController.deleteEntry(req, res);
});

// Authentication routes
// Register a new user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/register', async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for user registration');
  await userController.register(req, res);
});

// Login user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/login', async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for login');
  await userController.login(req, res);
});

// Logout user
// @ts-ignore
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ message: 'Logged out successfully' });
});

// Get current authenticated user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get current user');
  await userController.getCurrentUser(req, res);
});

// Change user password - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for change password');
  await userController.changePassword(req, res);
});

// Get all users - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get all users');
  await userController.getAllUsers(req, res);
});

// Get user by ID - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get user by ID');
  await userController.getUserById(req, res);
});

// Create new user (admin only) - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/users', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for create user');
  await userController.createUser(req, res);
});

// Get all texts for reader feature (protected route)
// @ts-ignore
app.get('/api/texts', authenticateToken, async (req, res) => {
  try {
    // Read texts from JSON file
    const textsFilePath = path.join(process.cwd(), '..', 'data', 'sample-texts.json');
    
    if (!fs.existsSync(textsFilePath)) {
      return res.status(404).json({
        error: 'Texts file not found',
        code: 'ERR_TEXTS_FILE_NOT_FOUND'
      });
    }

    const fileContent = fs.readFileSync(textsFilePath, 'utf-8');
    const textsData = JSON.parse(fileContent);
    
    // Sort texts by creation date (newest first)
    const sortedTexts = textsData.texts.sort((a: Text, b: Text) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(sortedTexts);
  } catch (error: any) {
    console.error('Error fetching texts:', error);
    const errorCode = error.code || 'ERR_FETCH_TEXTS_FAILED';
    const errorMessage = error.message || 'Failed to retrieve texts';
    res.status(error.statusCode || 500).json({
      error: errorMessage,
      code: errorCode
    });
  }
});

// Import vocab entries from CSV file - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/vocabEntries/import', authenticateToken, upload.single('file'), async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for CSV import');
  await vocabEntryController.importFromCSV(req, res);
});

// OnDeck Vocab Sets API Routes - USING NEW DAL ARCHITECTURE

// Get all on-deck vocab sets for authenticated user (protected route)
// @ts-ignore
app.get('/api/onDeckPage', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getAllSets');
  await onDeckVocabController.getAllSets(req, res);
});

// Get a specific on-deck vocab set by feature name (protected route)
// @ts-ignore
app.get('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getSetByFeatureName');
  await onDeckVocabController.getSetByFeatureName(req, res);
});

// Create or update an on-deck vocab set (protected route)
// @ts-ignore
app.put('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck createOrUpdateSet');
  await onDeckVocabController.createOrUpdateSet(req, res);
});

// Delete an on-deck vocab set (protected route)
// @ts-ignore
app.delete('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck deleteSet');
  await onDeckVocabController.deleteSet(req, res);
});

// Get user's on-deck set statistics (protected route)
// @ts-ignore
app.get('/api/onDeckPage/stats', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getUserStats');
  await onDeckVocabController.getUserStats(req, res);
});

// Get all feature names for the user (protected route)
// @ts-ignore
app.get('/api/onDeckPage/features', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getFeatureNames');
  await onDeckVocabController.getFeatureNames(req, res);
});

// Add entries to an existing set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/add', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck addEntriesToSet');
  await onDeckVocabController.addEntriesToSet(req, res);
});

// Remove entries from an existing set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/remove', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck removeEntriesFromSet');
  await onDeckVocabController.removeEntriesFromSet(req, res);
});

// Clear all entries from a set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/clear', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck clearSet');
  await onDeckVocabController.clearSet(req, res);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
