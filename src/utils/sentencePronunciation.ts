interface SentenceLike {
    /** Runtime GSA segmentation attached at read time by the DAL. */
    _segments?: string[];
    /** Authoritative stored segmentation from the tagging pass. */
    segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string }>;
}

/**
 * Aggregate an example sentence's per-segment pinyin into a single
 * space-separated string — one token per GSA segment, which is the hint format
 * cloud TTS expects (`useTTS.speakSentence`) and also what the Speed Reading
 * prompt displays for a sentence round.
 *
 * Returns undefined if the segmentation or ANY segment's pronunciation is
 * missing: a partial hint would mis-pronounce the gaps, so the caller should let
 * the provider infer the whole sentence instead.
 *
 * `_segments` is preferred over `segments` because it is what the read path
 * attaches (falling back to a live greedy segmentation for rows tagged before
 * `segments` was persisted); `segments` is the stored copy and is used only when
 * an entry reaches the client without enrichment. See docs/EXAMPLE_SENTENCES.md.
 *
 * Lives in `src/utils/` rather than under `features/flashcards/` because two
 * unrelated surfaces read it: the flp est list and the Speed Reading finale
 * (docs/SPEED_READING_GAME.md § The last two rounds are sentences).
 */
export function buildSentencePronunciation(sentence: SentenceLike): string | undefined {
    const segments = sentence._segments ?? sentence.segments;
    if (!segments || segments.length === 0) return undefined;
    const meta = sentence.segmentMetadata;
    if (!meta) return undefined;
    const parts: string[] = [];
    for (const seg of segments) {
        const p = meta[seg]?.pronunciation;
        if (!p) return undefined;
        parts.push(p);
    }
    return parts.join(' ');
}
