import React, { createContext, useContext, useCallback } from 'react';
import type { VocabEntry } from '../types';
import { addCachedEntry, updateCachedEntry, removeCachedEntry } from '../utils/vocabCache';

interface VocabularyUpdateContextType {
    addVocabEntry: (entry: VocabEntry) => void;
    updateVocabEntry: (entry: VocabEntry) => void;
    removeVocabEntry: (entryId: number) => void;
    bulkAddVocabEntries: (entries: VocabEntry[]) => void;
    // Event listeners for components to subscribe to changes
    onVocabAdd: (callback: (entry: VocabEntry) => void) => () => void;
    onVocabUpdate: (callback: (entry: VocabEntry) => void) => () => void;
    onVocabRemove: (callback: (entryId: number) => void) => () => void;
    onVocabBulkAdd: (callback: (entries: VocabEntry[]) => void) => () => void;
}

const VocabularyUpdateContext = createContext<VocabularyUpdateContextType | undefined>(undefined);

interface VocabularyUpdateProviderProps {
    children: React.ReactNode;
}

export const VocabularyUpdateProvider: React.FC<VocabularyUpdateProviderProps> = ({ children }) => {
    // Event listener storage
    const addListeners = React.useRef<Set<(entry: VocabEntry) => void>>(new Set());
    const updateListeners = React.useRef<Set<(entry: VocabEntry) => void>>(new Set());
    const removeListeners = React.useRef<Set<(entryId: number) => void>>(new Set());
    const bulkAddListeners = React.useRef<Set<(entries: VocabEntry[]) => void>>(new Set());

    // Add vocabulary entry
    const addVocabEntry = useCallback((entry: VocabEntry) => {
        console.log('[VOCAB-UPDATE] Adding vocabulary entry:', {
            id: entry.id,
            entryKey: entry.entryKey,
            entryValue: entry.entryValue
        });

        // Update cache
        addCachedEntry(entry);

        // Notify all listeners
        addListeners.current.forEach(callback => {
            try {
                callback(entry);
            } catch (error) {
                console.error('[VOCAB-UPDATE] Error in add listener:', error);
            }
        });
    }, []);

    // Update vocabulary entry
    const updateVocabEntry = useCallback((entry: VocabEntry) => {
        console.log('[VOCAB-UPDATE] Updating vocabulary entry:', {
            id: entry.id,
            entryKey: entry.entryKey,
            entryValue: entry.entryValue
        });

        // Update cache
        updateCachedEntry(entry);

        // Notify all listeners
        updateListeners.current.forEach(callback => {
            try {
                callback(entry);
            } catch (error) {
                console.error('[VOCAB-UPDATE] Error in update listener:', error);
            }
        });
    }, []);

    // Remove vocabulary entry
    const removeVocabEntry = useCallback((entryId: number) => {
        console.log('[VOCAB-UPDATE] Removing vocabulary entry:', { entryId });

        // Update cache
        removeCachedEntry(entryId);

        // Notify all listeners
        removeListeners.current.forEach(callback => {
            try {
                callback(entryId);
            } catch (error) {
                console.error('[VOCAB-UPDATE] Error in remove listener:', error);
            }
        });
    }, []);

    // Bulk add vocabulary entries (for CSV imports)
    const bulkAddVocabEntries = useCallback((entries: VocabEntry[]) => {
        console.log('[VOCAB-UPDATE] Bulk adding vocabulary entries:', {
            count: entries.length,
            sampleEntries: entries.slice(0, 3).map(e => ({ id: e.id, entryKey: e.entryKey }))
        });

        // Update cache for each entry
        entries.forEach(entry => {
            addCachedEntry(entry);
        });

        // Notify all listeners
        bulkAddListeners.current.forEach(callback => {
            try {
                callback(entries);
            } catch (error) {
                console.error('[VOCAB-UPDATE] Error in bulk add listener:', error);
            }
        });
    }, []);

    // Event listener registration functions
    const onVocabAdd = useCallback((callback: (entry: VocabEntry) => void) => {
        addListeners.current.add(callback);
        return () => {
            addListeners.current.delete(callback);
        };
    }, []);

    const onVocabUpdate = useCallback((callback: (entry: VocabEntry) => void) => {
        updateListeners.current.add(callback);
        return () => {
            updateListeners.current.delete(callback);
        };
    }, []);

    const onVocabRemove = useCallback((callback: (entryId: number) => void) => {
        removeListeners.current.add(callback);
        return () => {
            removeListeners.current.delete(callback);
        };
    }, []);

    const onVocabBulkAdd = useCallback((callback: (entries: VocabEntry[]) => void) => {
        bulkAddListeners.current.add(callback);
        return () => {
            bulkAddListeners.current.delete(callback);
        };
    }, []);

    const contextValue: VocabularyUpdateContextType = {
        addVocabEntry,
        updateVocabEntry,
        removeVocabEntry,
        bulkAddVocabEntries,
        onVocabAdd,
        onVocabUpdate,
        onVocabRemove,
        onVocabBulkAdd
    };

    return (
        <VocabularyUpdateContext.Provider value={contextValue}>
            {children}
        </VocabularyUpdateContext.Provider>
    );
};

// Custom hook to use the vocabulary update context
export const useVocabularyUpdate = (): VocabularyUpdateContextType => {
    const context = useContext(VocabularyUpdateContext);
    if (context === undefined) {
        throw new Error('useVocabularyUpdate must be used within a VocabularyUpdateProvider');
    }
    return context;
};
