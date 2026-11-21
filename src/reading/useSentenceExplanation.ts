import { useCallback, useEffect, useRef, useState } from "react";
import { explainSentence } from "../api/sentenceExplanation";
import { ApiError } from "../api/http";
import type { LongDefinitionPart } from "../types";

/**
 * useSentenceExplanation — the rdb sentence face's Explain state
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain").
 *
 *   idle → (explain) → loading → ready | empty | error
 *
 * A new sentence resets to `idle` and aborts any request still in flight, so a late answer
 * can never land on the wrong sentence. Nothing is fetched until the learner taps Explain:
 * a cache miss costs one call of their daily AI budget, so it is never spent implicitly.
 *
 * The SERVER holds the durable cache (sentence_explanation_cache, migration 195); this hook
 * only remembers this visit's answers (`sessionAnswers`) so re-highlighting a sentence and
 * tapping Explain again shows the answer without another round trip.
 *
 * Layer: shared hook (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Caller: ReaderSentenceFace.
 */

export type SentenceExplanationStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface SentenceExplanationState {
    status: SentenceExplanationStatus;
    explanation: string | null;
    explanationParts: LongDefinitionPart[] | null;
    // `error`: the message to show (the server's 429 text, or a generic failure line).
    errorMessage: string | null;
}

const IDLE: SentenceExplanationState = { status: "idle", explanation: null, explanationParts: null, errorMessage: null };

// This visit's answers, keyed by language + sentence. Module-level so it survives the face
// remounting as the rdb switches between word and sentence mode.
const sessionAnswers = new Map<string, { explanation: string; explanationParts: LongDefinitionPart[] | null }>();

export function useSentenceExplanation(sentence: string, language: string) {
    const [state, setState] = useState<SentenceExplanationState>(IDLE);
    const abortRef = useRef<AbortController | null>(null);
    const key = `${language}\u0000${sentence}`;

    // A new sentence (or leaving the face) drops the old request and its answer.
    useEffect(() => {
        setState(IDLE);
        return () => {
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [key]);

    const explain = useCallback(async () => {
        const remembered = sessionAnswers.get(key);
        if (remembered) {
            setState({ status: "ready", ...remembered, errorMessage: null });
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setState({ ...IDLE, status: "loading" });
        try {
            const result = await explainSentence(sentence, language, controller.signal);
            if (controller.signal.aborted) return;
            if (!result.explanation) {
                setState({ ...IDLE, status: "empty" });
                return;
            }
            const answer = { explanation: result.explanation, explanationParts: result.explanationParts };
            sessionAnswers.set(key, answer);
            setState({ status: "ready", ...answer, errorMessage: null });
        } catch (error) {
            if (controller.signal.aborted) return;
            // The 429 body carries the user-facing daily-limit message; anything else gets a
            // generic line (the server logs the detail).
            const serverMessage = error instanceof ApiError
                ? (error.response.data as { error?: unknown } | null)?.error
                : undefined;
            setState({
                ...IDLE,
                status: "error",
                errorMessage: error instanceof ApiError && error.status === 429 && typeof serverMessage === "string"
                    ? serverMessage
                    : "Couldn't explain this sentence. Try again.",
            });
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [key, sentence, language]);

    return { ...state, explain };
}
