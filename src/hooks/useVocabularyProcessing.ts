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

            // Fetch vocabulary entries for tokens
            const vocabLookupStart = performance.now();
            const vocabEntries = await fetchVocabEntriesByTokens(tokens, token);
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

    return {
        loadedPersonalCards,
        loadedDictionaryCards,
        setLoadedPersonalCards,
        setLoadedDictionaryCards,
        processingVocab,
        vocabError,
        processedDocuments,
        setProcessedDocuments,
        processDocumentVocabulary
    };
}
