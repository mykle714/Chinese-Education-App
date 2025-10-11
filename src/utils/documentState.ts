/**
 * Document processing state management
 * Tracks which documents have been processed for vocabulary token extraction
 */

export interface DocumentProcessingState {
  processed: boolean;
  lastProcessed: Date;
  tokenCount: number;
  version: string; // For cache invalidation when processing logic changes
}

export interface DocumentStateStorage {
  [documentId: string]: DocumentProcessingState;
}

const DOCUMENT_STATE_KEY = 'cow_document_processing_state';
const CURRENT_VERSION = '1.0.0'; // Update this when processing logic changes

/**
 * Gets the processing state for a specific document
 * @param documentId Unique identifier for the document
 * @returns DocumentProcessingState or null if not found
 */
export function getDocumentProcessingState(documentId: string): DocumentProcessingState | null {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    if (!stateData) return null;

    const allStates: DocumentStateStorage = JSON.parse(stateData);
    const state = allStates[documentId];

    if (!state) return null;

    // Check if version matches current version
    if (state.version !== CURRENT_VERSION) {
      // Version mismatch - consider as not processed
      removeDocumentProcessingState(documentId);
      return null;
    }

    // Convert date string back to Date object
    return {
      ...state,
      lastProcessed: new Date(state.lastProcessed)
    };
  } catch (error) {
    console.error('Error reading document processing state:', error);
    return null;
  }
}

/**
 * Sets the processing state for a specific document
 * @param documentId Unique identifier for the document
 * @param tokenCount Number of tokens processed for this document
 */
export function setDocumentProcessingState(documentId: string, tokenCount: number): void {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    const allStates: DocumentStateStorage = stateData ? JSON.parse(stateData) : {};

    allStates[documentId] = {
      processed: true,
      lastProcessed: new Date(),
      tokenCount,
      version: CURRENT_VERSION
    };

    localStorage.setItem(DOCUMENT_STATE_KEY, JSON.stringify(allStates));
  } catch (error) {
    console.error('Error saving document processing state:', error);
  }
}

/**
 * Removes the processing state for a specific document
 * @param documentId Unique identifier for the document
 */
export function removeDocumentProcessingState(documentId: string): void {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    if (!stateData) return;

    const allStates: DocumentStateStorage = JSON.parse(stateData);
    delete allStates[documentId];

    localStorage.setItem(DOCUMENT_STATE_KEY, JSON.stringify(allStates));
  } catch (error) {
    console.error('Error removing document processing state:', error);
  }
}

/**
 * Checks if a document has been processed and is up to date
 * @param documentId Unique identifier for the document
 * @returns boolean indicating if document processing can be skipped
 */
export function isDocumentProcessed(documentId: string): boolean {
  const state = getDocumentProcessingState(documentId);
  return state !== null && state.processed;
}

/**
 * Gets all processed document IDs
 * @returns Array of document IDs that have been processed
 */
export function getAllProcessedDocumentIds(): string[] {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    if (!stateData) return [];

    const allStates: DocumentStateStorage = JSON.parse(stateData);
    return Object.keys(allStates).filter(docId => {
      const state = allStates[docId];
      return state.processed && state.version === CURRENT_VERSION;
    });
  } catch (error) {
    console.error('Error reading processed document IDs:', error);
    return [];
  }
}

/**
 * Clears all document processing states
 * Useful for cache invalidation or reset scenarios
 */
export function clearAllDocumentStates(): void {
  try {
    localStorage.removeItem(DOCUMENT_STATE_KEY);
  } catch (error) {
    console.error('Error clearing document processing states:', error);
  }
}

/**
 * Gets statistics about document processing states
 * @returns Object with processing statistics
 */
export function getDocumentProcessingStats(): {
  totalProcessed: number;
  totalTokensProcessed: number;
  oldestProcessed: Date | null;
  newestProcessed: Date | null;
} {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    if (!stateData) {
      return {
        totalProcessed: 0,
        totalTokensProcessed: 0,
        oldestProcessed: null,
        newestProcessed: null
      };
    }

    const allStates: DocumentStateStorage = JSON.parse(stateData);
    const validStates = Object.values(allStates).filter(
      state => state.processed && state.version === CURRENT_VERSION
    );

    if (validStates.length === 0) {
      return {
        totalProcessed: 0,
        totalTokensProcessed: 0,
        oldestProcessed: null,
        newestProcessed: null
      };
    }

    const dates = validStates.map(state => new Date(state.lastProcessed));
    const totalTokens = validStates.reduce((sum, state) => sum + state.tokenCount, 0);

    return {
      totalProcessed: validStates.length,
      totalTokensProcessed: totalTokens,
      oldestProcessed: new Date(Math.min(...dates.map(d => d.getTime()))),
      newestProcessed: new Date(Math.max(...dates.map(d => d.getTime())))
    };
  } catch (error) {
    console.error('Error getting document processing stats:', error);
    return {
      totalProcessed: 0,
      totalTokensProcessed: 0,
      oldestProcessed: null,
      newestProcessed: null
    };
  }
}

/**
 * Validates and cleans up document processing states
 * Removes invalid or outdated entries
 * @returns Number of entries cleaned up
 */
export function cleanupDocumentStates(): number {
  try {
    const stateData = localStorage.getItem(DOCUMENT_STATE_KEY);
    if (!stateData) return 0;

    const allStates: DocumentStateStorage = JSON.parse(stateData);
    const originalCount = Object.keys(allStates).length;
    
    // Remove entries with invalid version or corrupted data
    const cleanedStates: DocumentStateStorage = {};
    
    Object.entries(allStates).forEach(([docId, state]) => {
      if (
        state &&
        typeof state.processed === 'boolean' &&
        state.version === CURRENT_VERSION &&
        state.lastProcessed &&
        typeof state.tokenCount === 'number'
      ) {
        cleanedStates[docId] = state;
      }
    });

    localStorage.setItem(DOCUMENT_STATE_KEY, JSON.stringify(cleanedStates));
    
    return originalCount - Object.keys(cleanedStates).length;
  } catch (error) {
    console.error('Error cleaning up document states:', error);
    return 0;
  }
}
