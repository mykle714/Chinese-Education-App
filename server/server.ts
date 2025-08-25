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
      'http://127.0.0.1:5173'   // Also allow 127.0.0.1 equivalent for development
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Get all vocab entries (protected route)
// @ts-ignore
app.get('/api/vocabEntries', authenticateToken, async (req, res) => {
  try {
    const data = await vocabEntryModel.getAllVocabEntries();
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching vocab entries:', error);
    const errorCode = error.code || 'ERR_FETCH_FAILED';
    const errorMessage = error.message || 'Failed to retrieve vocab entries';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Get paginated vocab entries (protected route)
// @ts-ignore
app.get('/api/vocabEntries/paginated', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const data = await vocabEntryModel.getPaginatedVocabEntries(limit, offset);
    const total = await vocabEntryModel.getVocabEntriesCount();
    
    res.json({
      entries: data,
      total,
      hasMore: offset + data.length < total
    });
  } catch (error: any) {
    console.error('Error fetching paginated vocab entries:', error);
    const errorCode = error.code || 'ERR_FETCH_FAILED';
    const errorMessage = error.message || 'Failed to retrieve vocab entries';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Get vocab entry by ID (protected route)
// @ts-ignore
app.get('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  try {
    const data = await vocabEntryModel.getVocabEntryById(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ 
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching vocab entry by ID:', error);
    const errorCode = error.code || 'ERR_FETCH_FAILED';
    const errorMessage = error.message || 'Failed to retrieve vocab entry';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Create new vocab entry (protected route)
// @ts-ignore
app.post('/api/vocabEntries', authenticateToken, async (req, res) => {
  try {
    const vocabEntryData: VocabEntryCreateData = {
      userId: req.user.userId, // Use the authenticated user's ID
      entryKey: req.body.entryKey,
      entryValue: req.body.entryValue
    };
    
    const newData = await vocabEntryModel.createVocabEntry(vocabEntryData);
    res.status(201).json(newData);
  } catch (error: any) {
    console.error('Error creating vocab entry:', error);
    const errorCode = error.code || 'ERR_CREATE_ENTRY_FAILED';
    const errorMessage = error.message || 'Failed to create vocabulary entry';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Update vocab entry (protected route)
// @ts-ignore
app.put('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  try {
    const updateData: VocabEntryUpdateData = {
      entryKey: req.body.entryKey,
      entryValue: req.body.entryValue
    };
    const updatedData = await vocabEntryModel.updateVocabEntry(Number(req.params.id), updateData);
    if (!updatedData) {
      return res.status(404).json({ 
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }
    res.json(updatedData);
  } catch (error: any) {
    console.error('Error updating vocab entry:', error);
    const errorCode = error.code || 'ERR_UPDATE_FAILED';
    const errorMessage = error.message || 'Failed to update vocab entry';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Delete vocab entry (protected route)
// @ts-ignore
app.delete('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  try {
    await vocabEntryModel.deleteVocabEntry(Number(req.params.id));
    res.status(204).end();
  } catch (error: any) {
    console.error('Error deleting vocab entry:', error);
    const errorCode = error.code || 'ERR_DELETE_FAILED';
    const errorMessage = error.message || 'Failed to delete vocab entry';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Authentication routes
// Register a new user
// @ts-ignore
app.post('/api/auth/register', async (req, res) => {
  try {
    const userData: UserCreateData = {
      email: req.body.email,
      name: req.body.name,
      password: req.body.password
    };
    const newUser = await userModel.createUser(userData);
    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error registering user:', error);
    const errorCode = error.code || 'ERR_REGISTRATION_FAILED';
    const errorMessage = error.message || 'Failed to register user';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Login user
// @ts-ignore
app.post('/api/auth/login', async (req, res) => {
  try {
    const loginData: UserLoginData = {
      email: req.body.email,
      password: req.body.password
    };
    const { user, token } = await userModel.loginUser(loginData);
    
    // Set token in HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ user, token });
  } catch (error: any) {
    console.error('Error logging in user:', error);
    const errorCode = error.code || 'ERR_LOGIN_FAILED';
    const errorMessage = error.message || 'Failed to login';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Logout user
// @ts-ignore
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ message: 'Logged out successfully' });
});

// Get current authenticated user
// @ts-ignore
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await userModel.getUserById(req.user.userId);
    // Don't return the password
    delete user.password;
    res.json(user);
  } catch (error: any) {
    console.error('Error getting current user:', error);
    const errorCode = error.code || 'ERR_FETCH_USER_FAILED';
    const errorMessage = error.message || 'Failed to retrieve user';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Change user password (protected route)
// @ts-ignore
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!currentPassword) {
      return res.status(400).json({ 
        error: 'Current password is required',
        code: 'ERR_MISSING_CURRENT_PASSWORD'
      });
    }
    
    if (!newPassword) {
      return res.status(400).json({ 
        error: 'New password is required',
        code: 'ERR_MISSING_NEW_PASSWORD'
      });
    }
    
    // Change the password
    const updatedUser = await userModel.changeUserPassword(
      req.user.userId,
      currentPassword,
      newPassword
    );
    
    res.json({ 
      user: updatedUser,
      message: 'Password changed successfully'
    });
  } catch (error: any) {
    console.error('Error changing password:', error);
    const errorCode = error.code || 'ERR_PASSWORD_CHANGE_FAILED';
    const errorMessage = error.message || 'Failed to change password';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Get all users (protected route)
// @ts-ignore
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await userModel.getAllUsers();
    res.json(users);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    const errorCode = error.code || 'ERR_FETCH_USERS_FAILED';
    const errorMessage = error.message || 'Failed to retrieve users';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Get user by ID (protected route)
// @ts-ignore
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const user = await userModel.getUserById(req.params.id as string);
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        code: 'ERR_USER_NOT_FOUND'
      });
    }
    res.json(user);
  } catch (error: any) {
    console.error('Error fetching user by ID:', error);
    const errorCode = error.code || 'ERR_FETCH_USER_FAILED';
    const errorMessage = error.message || 'Failed to retrieve user';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Create new user (admin only, protected route)
// @ts-ignore
app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    const userData: UserCreateData = {
      email: req.body.email,
      name: req.body.name,
      password: req.body.password
    };
    const newUser = await userModel.createUser(userData);
    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error creating user:', error);
    const errorCode = error.code || 'ERR_CREATE_USER_FAILED';
    const errorMessage = error.message || 'Failed to create user';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
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

// Import vocab entries from CSV file (protected route)
// @ts-ignore
app.post('/api/vocabEntries/import', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    // Start timing the entire import process
    console.time('CSV Import - Total Process');
    
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        code: 'ERR_NO_FILE'
      });
    }

    // Time file validation
    console.time('CSV Import - File Validation');
    
    // Check file type
    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      console.timeEnd('CSV Import - File Validation');
      return res.status(400).json({ 
        error: 'File must be a CSV file',
        code: 'ERR_INVALID_FILE_TYPE'
      });
    }

    console.timeEnd('CSV Import - File Validation');

    // Time CSV parsing
    console.time('CSV Import - CSV Parsing');
    
    // Parse CSV content
    const csvContent = req.file.buffer.toString('utf-8');
    const entries = parseCSV(csvContent);

    console.timeEnd('CSV Import - CSV Parsing');
    console.log(`CSV Import - Parsed ${entries.length} entries from CSV`);

    if (entries.length === 0) {
      console.timeEnd('CSV Import - Total Process');
      return res.status(400).json({ 
        error: 'No valid entries found in CSV file',
        code: 'ERR_NO_VALID_ENTRIES'
      });
    }

    // Time database operations
    console.time('CSV Import - Database Operations');
    
    // Import entries for the authenticated user using batch processing
    const importResults = {
      total: entries.length,
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    };

    console.log(`CSV Import - Starting batch processing of ${entries.length} entries`);
    
    // Time the batch operation
    console.time('CSV Import - Batch Insert');
    
    const batchResult = await vocabEntryModel.bulkUpsertVocabEntries(req.user.userId, entries);
    importResults.imported = batchResult.upserted;
    console.log(`CSV Import - Batch operation completed: ${batchResult.upserted} entries processed`);
    
    console.timeEnd('CSV Import - Batch Insert');
    console.timeEnd('CSV Import - Database Operations');
    console.log(`CSV Import - Database Results: ${importResults.imported} imported, ${importResults.skipped} skipped`);

    console.timeEnd('CSV Import - Total Process');

    res.json({
      message: `Import completed. ${importResults.imported} entries imported, ${importResults.skipped} skipped.`,
      results: importResults
    });
  } catch (error: any) {
    console.error('Error importing CSV:', error);
    console.timeEnd('CSV Import - Total Process'); // End timing even on error
    const errorCode = error.code || 'ERR_IMPORT_FAILED';
    const errorMessage = error.message || 'Failed to import CSV file';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// OnDeck Vocab Sets API Routes

// Get all on-deck vocab sets for authenticated user (protected route)
// @ts-ignore
app.get('/api/onDeckPage', authenticateToken, async (req, res) => {
  try {
    const data = await onDeckVocabModel.getAllOnDeckSetsForUser(req.user.userId);
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching on-deck vocab sets:', error);
    const errorCode = error.code || 'ERR_FETCH_ONDECK_SETS_FAILED';
    const errorMessage = error.message || 'Failed to retrieve on-deck vocab sets';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Create or update an on-deck vocab set (protected route)
// @ts-ignore
app.put('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  try {
    const onDeckSetData: OnDeckVocabSetCreateData = {
      featureName: req.params.featureName,
      vocabEntryIds: req.body.vocabEntryIds
    };
    
    const result = await onDeckVocabModel.createOrUpdateOnDeckSet(req.user.userId, onDeckSetData);
    res.json(result);
  } catch (error: any) {
    console.error('Error creating/updating on-deck vocab set:', error);
    const errorCode = error.code || 'ERR_UPSERT_ONDECK_SET_FAILED';
    const errorMessage = error.message || 'Failed to create or update on-deck vocab set';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Delete an on-deck vocab set (protected route)
// @ts-ignore
app.delete('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  try {
    const deleted = await onDeckVocabModel.deleteOnDeckSet(req.user.userId, req.params.featureName);
    
    if (!deleted) {
      return res.status(404).json({ 
        error: 'On-deck vocab set not found',
        code: 'ERR_ONDECK_SET_NOT_FOUND'
      });
    }
    
    res.status(204).end();
  } catch (error: any) {
    console.error('Error deleting on-deck vocab set:', error);
    const errorCode = error.code || 'ERR_DELETE_ONDECK_SET_FAILED';
    const errorMessage = error.message || 'Failed to delete on-deck vocab set';
    res.status(error.statusCode || 500).json({ 
      error: errorMessage,
      code: errorCode
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
