import { useState, useCallback } from "react";
import { processDocumentForTokens, estimateTokenCount } from "../utils/tokenUtils";
import { fetchVocabEntriesByTokens } from "../utils/vocabApi";
import type { VocabEntry, DictionaryEntry } from "../types";

// Text interface for TypeScript
interface Text {
    id: string;
    title: string;
    description: string;
    content: string;
    createdAt: string;
    characterCount: number;
}

interface UseVocabularyProcessingReturn {
    loadedPersonalCards: VocabEntry[];
    loadedDictionaryCards: DictionaryEntry[];
    setLoadedPersonalCards: React.Dispatch<React.SetStateAction<VocabEntry[]>>;
    setLoadedDictionaryCards: React.Dispatch<React.SetStateAction<DictionaryEntry[]>>;
    processingVocab: boolean;
    vocabError: string | null;
    processedDocuments: Set<string>;
    setProcessedDocuments: React.Dispatch<React.SetStateAction<Set<string>>>;
    processDocumentVocabulary: (text: Text) => Promise<void>;
    processDocumentVocabularyIncremental: (oldText: Text, newText: Text) => Promise<void>;
}

/**
 * Helper function to fetch vocabulary entries in batches
 * Automatically handles token lists > 1000 by splitting into batches
 */
async function fetchVocabInBatches(
    tokens: string[],
    authToken: string
): Promise<{ personalEntries: VocabEntry[], dictionaryEntries: DictionaryEntry[] }> {
    if (tokens.length === 0) {
        return { personalEntries: [], dictionaryEntries: [] };
    }

    // If tokens fit in one batch, fetch directly
    if (tokens.length <= 1000) {
        return await fetchVocabEntriesByTokens(tokens, authToken);
    }

    // Split into batches of 1000
    const batchSize = 1000;
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += batchSize) {
        batches.push(tokens.slice(i, i + batchSize));
    }

    console.log(`[VOCAB-BATCH-HELPER] 📦 Batching ${tokens.length} tokens:`, {
        totalTokens: tokens.length,
        batchSize: batchSize,
        batchCount: batches.length,
        batchSizes: batches.map(b => b.length)
    });

    // Process each batch
    const allPersonalEntries: VocabEntry[] = [];
    const allDictionaryEntries: DictionaryEntry[] = [];

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchStart = performance.now();

        console.log(`[VOCAB-BATCH-HELPER] 🚀 Processing batch ${i + 1}/${batches.length}:`, {
            batchIndex: i + 1,
            batchSize: batch.length,
            sampleTokens: batch.slice(0, 10)
        });

        const batchResult = await fetchVocabEntriesByTokens(batch, authToken);
        const batchTime = performance.now() - batchStart;

        console.log(`[VOCAB-BATCH-HELPER] ✅ Batch ${i + 1}/${batches.length} completed:`, {
            batchTime: `${batchTime.toFixed(2)}ms`,
            personalEntriesFound: batchResult.personalEntries.length,
            dictionaryEntriesFound: batchResult.dictionaryEntries.length
        });

        allPersonalEntries.push(...batchResult.personalEntries);
        allDictionaryEntries.push(...batchResult.dictionaryEntries);
    }

    // Deduplicate entries by id
    const uniquePersonalEntries = Array.from(
        new Map(allPersonalEntries.map(entry => [entry.id, entry])).values()
    );
    const uniqueDictionaryEntries = Array.from(
        new Map(allDictionaryEntries.map(entry => [entry.id, entry])).values()
    );

    console.log(`[VOCAB-BATCH-HELPER] ✅ Batching complete:`, {
        totalBatches: batches.length,
        personalEntriesTotal: uniquePersonalEntries.length,
        dictionaryEntriesTotal: uniqueDictionaryEntries.length
    });

    return {
        personalEntries: uniquePersonalEntries,
        dictionaryEntries: uniqueDictionaryEntries
    };
}

export function useVocabularyProcessing(token: string | null): UseVocabularyProcessingReturn {
    // Vocabulary processing state
    const [loadedPersonalCards, setLoadedPersonalCards] = useState<VocabEntry[]>([]);
    const [loadedDictionaryCards, setLoadedDictionaryCards] = useState<DictionaryEntry[]>([]);
    const [processingVocab, setProcessingVocab] = useState(false);
    const [vocabError, setVocabError] = useState<string | null>(null);

    // Session-based document processing state (resets on page refresh/component remount)
    const [processedDocuments, setProcessedDocuments] = useState<Set<string>>(new Set());

    // Process document for vocabulary tokens
    const processDocumentVocabulary = useCallback(async (text: Text) => {
        if (!token) {
            console.log('[VOCAB-CLIENT] ⚠️ No authentication token available for vocabulary processing');
            return;
        }

        // Check if document has already been processed in this session
        // OR if loaded cards are empty (which means we need to populate them regardless)
        const isAlreadyProcessed = processedDocuments.has(text.id);
        const needsVocabLoading = loadedPersonalCards.length === 0 && loadedDictionaryCards.length === 0;

        if (isAlreadyProcessed && !needsVocabLoading) {
            console.log(`[VOCAB-CLIENT] 📋 Document already processed and cards populated:`, {
                documentId: text.id,
                documentTitle: text.title,
                personalCardsCount: loadedPersonalCards.length,
                dictionaryCardsCount: loadedDictionaryCards.length,
                action: 'skipping processing'
            });
            return;
        }

        try {
            setProcessingVocab(true);
            setVocabError(null);

            console.log(`[VOCAB-CLIENT] 🔄 Starting document processing:`, {
                documentId: text.id,
                documentTitle: text.title,
                contentLength: text.content.length,
                characterCount: text.characterCount,
                isAlreadyProcessed,
                needsVocabLoading,
                reason: needsVocabLoading ? 'loadedCards empty' : 'first time processing'
            });

            const processingStart = performance.now();

            // Extract tokens from document content
            const tokens = processDocumentForTokens(text.content);
            const tokenCount = tokens.length;
            const estimatedTokens = estimateTokenCount(text.content);

            const tokenExtractionTime = performance.now() - processingStart;

            console.log(`[VOCAB-CLIENT] 🔍 Token extraction completed:`, {
                documentId: text.id,
                extractionTime: `${tokenExtractionTime.toFixed(2)}ms`,
                uniqueTokensFound: tokenCount,
                estimatedTokens: estimatedTokens,
                efficiency: `${(tokenCount / estimatedTokens * 100).toFixed(1)}%`,
                sampleTokens: tokens.slice(0, 15), // Show first 15 tokens
                tokensByLength: {
                    length1: tokens.filter(t => t.length === 1).length,
                    length2: tokens.filter(t => t.length === 2).length,
                    length3: tokens.filter(t => t.length === 3).length,
                    length4: tokens.filter(t => t.length === 4).length
                }
            });

            if (tokens.length === 0) {
                console.log(`[VOCAB-CLIENT] 📝 No tokens found in document:`, {
                    documentId: text.id,
                    contentPreview: text.content.substring(0, 100) + '...',
                    reason: 'No non-English characters detected'
                });
                // Mark document as processed even if no tokens found
                setProcessedDocuments(prev => new Set(prev).add(text.id));
                return;
            }

            console.log(`[VOCAB-CLIENT] 🚀 Initiating vocabulary lookup:`, {
                documentId: text.id,
                tokensToLookup: tokens.length,
                allTokens: tokens.length <= 30 ? tokens : `${tokens.slice(0, 30).join(', ')}... (+${tokens.length - 30} more)`
            });

            // Fetch vocabulary entries for tokens (with automatic batching)
            const vocabLookupStart = performance.now();
            const vocabEntries = await fetchVocabInBatches(tokens, token);
            const vocabLookupTime = performance.now() - vocabLookupStart;

            const totalProcessingTime = performance.now() - processingStart;

            console.log(`[VOCAB-CLIENT] 📚 Vocabulary lookup completed:`, {
                documentId: text.id,
                lookupTime: `${vocabLookupTime.toFixed(2)}ms`,
                totalProcessingTime: `${totalProcessingTime.toFixed(2)}ms`,
                tokensRequested: tokens.length,
                personalEntriesFound: vocabEntries.personalEntries.length,
                dictionaryEntriesFound: vocabEntries.dictionaryEntries.length,
                personalMatchRate: `${(vocabEntries.personalEntries.length / tokens.length * 100).toFixed(1)}%`,
                dictionaryMatchRate: `${(vocabEntries.dictionaryEntries.length / tokens.length * 100).toFixed(1)}%`,
                samplePersonalEntries: vocabEntries.personalEntries.slice(0, 10).map(e => ({ key: e.entryKey, value: e.entryValue })),
                performance: {
                    tokensPerSecond: Math.round(tokens.length / (totalProcessingTime / 1000))
                }
            });

            // Update loaded cards state with both personal and dictionary entries
            setLoadedPersonalCards(vocabEntries.personalEntries);
            setLoadedDictionaryCards(vocabEntries.dictionaryEntries);

            // Mark document as processed in session state
            setProcessedDocuments(prev => new Set(prev).add(text.id));

            console.log(`[VOCAB-CLIENT] ✅ Document processing complete:`, {
                documentId: text.id,
                documentTitle: text.title,
                totalTime: `${totalProcessingTime.toFixed(2)}ms`,
                tokensProcessed: tokenCount,
                personalEntriesLoaded: vocabEntries.personalEntries.length,
                dictionaryEntriesLoaded: vocabEntries.dictionaryEntries.length,
                status: 'success'
            });
        } catch (error) {
            const processingTime = performance.now();
            console.error(`[VOCAB-CLIENT] ❌ Document processing failed:`, {
                documentId: text.id,
                documentTitle: text.title,
                error: error instanceof Error ? error.message : 'Unknown error',
                processingTime: `${processingTime.toFixed(2)}ms`
            });
            setVocabError(error instanceof Error ? error.message : 'Failed to process vocabulary');
        } finally {
            setProcessingVocab(false);
        }
    }, [token, processedDocuments, loadedPersonalCards.length, loadedDictionaryCards.length]);

    // Process only new tokens added to a document (incremental processing with batching)
    const processDocumentVocabularyIncremental = useCallback(async (oldText: Text, newText: Text) => {
        if (!token) {
            console.log('[VOCAB-CLIENT] ⚠️ No authentication token available for incremental vocabulary processing');
            return;
        }

        try {
            setProcessingVocab(true);
            setVocabError(null);

            console.log(`[VOCAB-CLIENT] 🔄 Starting incremental document processing:`, {
                documentId: newText.id,
                documentTitle: newText.title,
                oldContentLength: oldText.content.length,
                newContentLength: newText.content.length,
                contentChanged: oldText.content !== newText.content
            });

            const processingStart = performance.now();

            // Extract tokens from both old and new content
            const oldTokens = new Set(processDocumentForTokens(oldText.content));
            const newTokens = processDocumentForTokens(newText.content);
            
            // Find only the tokens that were added
            const addedTokens = newTokens.filter(token => !oldTokens.has(token));

            const tokenExtractionTime = performance.now() - processingStart;

            console.log(`[VOCAB-CLIENT] 🔍 Token diff analysis completed:`, {
                documentId: newText.id,
                extractionTime: `${tokenExtractionTime.toFixed(2)}ms`,
                oldTokenCount: oldTokens.size,
                newTokenCount: newTokens.length,
                addedTokenCount: addedTokens.length,
                sampleAddedTokens: addedTokens.slice(0, 15),
                needsProcessing: addedTokens.length > 0
            });

            if (addedTokens.length === 0) {
                console.log(`[VOCAB-CLIENT] ✅ No new tokens to process:`, {
                    documentId: newText.id,
                    reason: 'All tokens already processed',
                    totalTime: `${(performance.now() - processingStart).toFixed(2)}ms`
                });
                
                // Update the text but keep existing vocabulary
                setProcessedDocuments(prev => new Set(prev).add(newText.id));
                return;
            }

            // Fetch vocabulary for new tokens (with automatic batching)
            const vocabLookupStart = performance.now();
            const newVocabEntries = await fetchVocabInBatches(addedTokens, token);
            const vocabLookupTime = performance.now() - vocabLookupStart;

            console.log(`[VOCAB-CLIENT] 📚 New vocabulary lookup completed:`, {
                documentId: newText.id,
                lookupTime: `${vocabLookupTime.toFixed(2)}ms`,
                tokensRequested: addedTokens.length,
                personalEntriesFound: newVocabEntries.personalEntries.length,
                dictionaryEntriesFound: newVocabEntries.dictionaryEntries.length
            });

            // Merge new entries with existing loaded cards (avoiding duplicates)
            const updatedPersonalCards = [...loadedPersonalCards];
            const existingPersonalIds = new Set(updatedPersonalCards.map(e => e.id));
            
            for (const entry of newVocabEntries.personalEntries) {
                if (!existingPersonalIds.has(entry.id)) {
                    updatedPersonalCards.push(entry);
                    existingPersonalIds.add(entry.id);
                }
            }

            const updatedDictionaryCards = [...loadedDictionaryCards];
            const existingDictIds = new Set(updatedDictionaryCards.map(e => e.id));
            
            for (const entry of newVocabEntries.dictionaryEntries) {
                if (!existingDictIds.has(entry.id)) {
                    updatedDictionaryCards.push(entry);
                    existingDictIds.add(entry.id);
                }
            }

            // Update loaded cards state
            setLoadedPersonalCards(updatedPersonalCards);
            setLoadedDictionaryCards(updatedDictionaryCards);

            // Mark document as processed
            setProcessedDocuments(prev => new Set(prev).add(newText.id));

            const totalTime = performance.now() - processingStart;

            console.log(`[VOCAB-CLIENT] ✅ Incremental processing complete:`, {
                documentId: newText.id,
                documentTitle: newText.title,
                totalTime: `${totalTime.toFixed(2)}ms`,
                addedTokensProcessed: addedTokens.length,
                newPersonalEntriesLoaded: newVocabEntries.personalEntries.length,
                newDictionaryEntriesLoaded: newVocabEntries.dictionaryEntries.length,
                totalPersonalCards: updatedPersonalCards.length,
                totalDictionaryCards: updatedDictionaryCards.length,
                status: 'success'
            });
        } catch (error) {
            const processingTime = performance.now();
            console.error(`[VOCAB-CLIENT] ❌ Incremental processing failed:`, {
                documentId: newText.id,
                documentTitle: newText.title,
                error: error instanceof Error ? error.message : 'Unknown error',
                processingTime: `${processingTime.toFixed(2)}ms`
            });
            setVocabError(error instanceof Error ? error.message : 'Failed to process vocabulary incrementally');
        } finally {
            setProcessingVocab(false);
        }
    }, [token, loadedPersonalCards, loadedDictionaryCards]);

    return {
        loadedPersonalCards,
        loadedDictionaryCards,
        setLoadedPersonalCards,
        setLoadedDictionaryCards,
        processingVocab,
        vocabError,
        processedDocuments,
        setProcessedDocuments,
        processDocumentVocabulary,
        processDocumentVocabularyIncremental
    };
}
