import { useEffect, useMemo, useRef } from "react";
import { prewarmTtsClips, type PrewarmClip } from "../api/tts";
import type { DictionaryEntry, VocabEntry } from "../types";
import { dictionaryEntryToVocabEntry } from "../utils/dictEntryAdapter";
import { resolveDisplayPronunciation } from "../utils/definitionUtils";
import type { SegmentSpan } from "./documentSegmentation";

/**
 * useReaderAudioPreload — gets tap-to-hear's clips ready before the learner lands on them
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear" → Preloading). Two layers:
 *
 *   1. **Server pre-warm, on open** — every distinct keycap word of the document (its gsa
 *      spans, each resolved to the entry the keycap would show) is sent once to
 *      `POST /api/tts/prewarm` (`prewarmTtsClips`), in document order. The server
 *      synthesizes the misses to its disk cache in the background, so no tap waits on
 *      Google; each word still costs one round trip to our server. Words that resolve
 *      later (the English → Chinese lookup lands after the det lookup) are sent as a
 *      follow-up batch: a ref remembers what was already sent, so nothing goes twice.
 *   2. **Client neighbour prefetch, per move** — when the selection lands on a word, the
 *      next `PREFETCH_AHEAD` words and the `PREFETCH_BEHIND` previous one are fetched into
 *      the browser (`useTTS().prefetch` → CloudTTSProvider's blob cache), so tapping
 *      forward or back plays at once. Already-fetched words cost nothing.
 *
 * Both run only while tap-to-hear is on (`enabled`: the Reader chip not on mute, and not
 * editing) and stand down while Read is stepping the selection (it preloads its own
 * clauses). The pinyin hint is `resolveDisplayPronunciation` on the adapted entry, the
 * same value `useTTS().speak` requests with, so the warmed cache key is the one played.
 *
 * Server pre-warm is the DEFAULT voice only (CardAudioService.prewarmClips): a learner on
 * the male voice gets the neighbour prefetch but not the warm disk cache.
 *
 * Layer: shared hook (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Depended on by ReaderDocumentPage.
 */

/** Words fetched ahead of / behind the selection on each move. */
const PREFETCH_AHEAD = 3;
const PREFETCH_BEHIND = 1;

interface UseReaderAudioPreloadArgs {
    enabled: boolean;
    /** The document's language — the clips' language (an English word speaks its Chinese translation). */
    language: string | undefined;
    spans: SegmentSpan[];
    /** A span's text → the entry the keycap shows for it (det row, else English translation). */
    resolveEntry: (text: string) => DictionaryEntry | null;
    selectionStart: number;
    readAloudPlaying: boolean;
    /** useTTS().prefetch — warms the browser cache without playing. */
    prefetch: (entry: VocabEntry | null | undefined) => void;
    /** useTTS().prefetchSentence — the same, for a word spoken with a chosen reading. */
    prefetchText?: (text: string, pronunciation?: string) => void;
    /**
     * READING CHOICES: a span's chosen (toned) reading, which its clip is then requested
     * with — the same text + pinyin key useReaderWordActions plays it under.
     */
    readingAt?: (span: SegmentSpan) => string | undefined;
}

/**
 * The clip a word will be played as (text + the pinyin hint `useTTS().speak` sends, or the
 * occurrence's chosen reading — READING CHOICES).
 */
function clipOf(entry: DictionaryEntry, chosenReading?: string): { vocab: VocabEntry; clip: PrewarmClip } {
    const vocab = dictionaryEntryToVocabEntry(entry);
    return { vocab, clip: { text: vocab.entryKey, pronunciation: chosenReading ?? resolveDisplayPronunciation(vocab) ?? null } };
}

const clipKey = (clip: PrewarmClip) => `${clip.text}\u0000${clip.pronunciation ?? ""}`;

export function useReaderAudioPreload({
    enabled, language, spans, resolveEntry, selectionStart, readAloudPlaying, prefetch, prefetchText, readingAt,
}: UseReaderAudioPreloadArgs): void {
    // ── 1. Server pre-warm ──────────────────────────────────────────────────
    // Every distinct clip in document order.
    const documentClips = useMemo(() => {
        const seen = new Set<string>();
        const clips: PrewarmClip[] = [];
        for (const span of spans) {
            const entry = resolveEntry(span.text);
            if (!entry) continue;
            const { clip } = clipOf(entry, readingAt?.(span));
            const key = clipKey(clip);
            if (seen.has(key)) continue;
            seen.add(key);
            clips.push(clip);
        }
        return clips;
    }, [spans, resolveEntry, readingAt]);

    // Clips already sent for this document. Reset when the language changes; the page
    // remounts per document, so a new document starts empty.
    const sentRef = useRef<{ language: string | undefined; keys: Set<string> }>({ language, keys: new Set() });
    useEffect(() => {
        if (!enabled || !language || readAloudPlaying) return;
        if (sentRef.current.language !== language) sentRef.current = { language, keys: new Set() };
        const sent = sentRef.current.keys;
        const fresh = documentClips.filter((clip) => !sent.has(clipKey(clip)));
        if (fresh.length === 0) return;
        fresh.forEach((clip) => sent.add(clipKey(clip)));
        prewarmTtsClips(fresh, language).catch((err) => {
            // Non-fatal: the words just play at their usual speed. Forget them so a later
            // run (a new key set, tap-to-hear switched back on) can retry.
            fresh.forEach((clip) => sent.delete(clipKey(clip)));
            console.warn("Reader: audio pre-warm failed:", err);
        });
    }, [enabled, language, readAloudPlaying, documentClips]);

    // ── 2. Neighbour prefetch ───────────────────────────────────────────────
    // Keyed on the selection's START only: the latest spans / resolver / prefetch are read
    // through a ref, so a new word list or a re-render alone fetches nothing.
    const latestRef = useRef({ enabled, readAloudPlaying, spans, resolveEntry, prefetch, prefetchText, readingAt });
    latestRef.current = { enabled, readAloudPlaying, spans, resolveEntry, prefetch, prefetchText, readingAt };
    useEffect(() => {
        const {
            enabled: on, readAloudPlaying: reading, spans: wordSpans, resolveEntry: resolve,
            prefetch: warm, prefetchText: warmText, readingAt: chosenAt,
        } = latestRef.current;
        if (!on || reading || wordSpans.length === 0) return;
        const index = wordSpans.findIndex((span) => span.start <= selectionStart && selectionStart < span.end);
        if (index < 0) return;
        const from = Math.max(0, index - PREFETCH_BEHIND);
        const to = Math.min(wordSpans.length - 1, index + PREFETCH_AHEAD);
        for (let i = from; i <= to; i++) {
            if (i === index) continue;
            const entry = resolve(wordSpans[i].text);
            if (!entry) continue;
            const chosen = chosenAt?.(wordSpans[i]);
            const { vocab, clip } = clipOf(entry, chosen);
            if (chosen && warmText) warmText(clip.text, chosen);
            else warm(vocab);
        }
    }, [selectionStart]);
}
