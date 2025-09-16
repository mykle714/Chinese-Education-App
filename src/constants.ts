// Application-wide constants

// API base URL
export const API_BASE_URL = 'http://localhost:5000';

// Client URL
export const CLIENT_URL = 'http://localhost:5175';

// Default test user ID for development purposes
// In a production environment, this would come from authentication
export const DEFAULT_TEST_USER_ID = 'D3300675-C841-F011-A5F1-7C1E52096DE5';

// Flashcard animation timing constants (in milliseconds)
export const FLASHCARD_FLIP_DURATION = 600;           // Total flip animation time
export const FLASHCARD_CONTENT_UPDATE_DELAY = FLASHCARD_FLIP_DURATION / 2;  // Update at animation midpoint (300ms)
