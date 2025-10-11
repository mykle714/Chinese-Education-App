import { useState, useCallback } from "react";
import { processDocumentForTokens, estimateTokenCount } from "../utils/tokenUtils";
import { fetchVocabEntriesByTokens } from "../utils/vocabApi";
import type { VocabEntry } from "../types";

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
    loadedCards: VocabEntry[];
    setLoadedCards: React.Dispatch<React.SetStateAction<VocabEntry[]>>;
    processingVocab: boolean;
    vocabError: string | null;
    processedDocuments: Set<string>;
    setProcessedDocuments: React.Dispatch<React.SetStateAction<Set<string>>>;
    processDocumentVocabulary: (text: Text) => Promise<void>;
}

export function useVocabularyProcessing(token: string | null): UseVocabularyProcessingReturn {
    // Vocabulary processing state
    const [loadedCards, setLoadedCards] = useState<VocabEntry[]>([]);
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
        // OR if loadedCards is empty (which means we need to populate it regardless)
        const isAlreadyProcessed = processedDocuments.has(text.id);
        const needsVocabLoading = loadedCards.length === 0;

        if (isAlreadyProcessed && !needsVocabLoading) {
            console.log(`[VOCAB-CLIENT] 📋 Document already processed and loadedCards populated:`, {
                documentId: text.id,
                documentTitle: text.title,
                loadedCardsCount: loadedCards.length,
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
                entriesFound: vocabEntries.length,
                matchRate: `${(vocabEntries.length / tokens.length * 100).toFixed(1)}%`,
                foundEntries: vocabEntries.map(e => ({ key: e.entryKey, value: e.entryValue })).slice(0, 10),
                performance: {
                    tokensPerSecond: Math.round(tokens.length / (totalProcessingTime / 1000)),
                    entriesPerSecond: Math.round(vocabEntries.length / (vocabLookupTime / 1000))
                }
            });

            // Update loaded cards state
            setLoadedCards(vocabEntries);

            // Mark document as processed in session state
            setProcessedDocuments(prev => new Set(prev).add(text.id));

            console.log(`[VOCAB-CLIENT] ✅ Document processing complete:`, {
                documentId: text.id,
                documentTitle: text.title,
                totalTime: `${totalProcessingTime.toFixed(2)}ms`,
                tokensProcessed: tokenCount,
                vocabularyEntriesLoaded: vocabEntries.length,
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
    }, [token, processedDocuments, loadedCards.length]);

    return {
        loadedCards,
        setLoadedCards,
        processingVocab,
        vocabError,
        processedDocuments,
        setProcessedDocuments,
        processDocumentVocabulary
    };
}
