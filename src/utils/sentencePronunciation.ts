interface SentenceLike {
    /** Runtime GSA segmentation attached at read time by the DAL. */
    _segments?: string[];
    /** Authoritative stored segmentation from the tagging pass. */
    segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string }>;
}

/** A segment with no Han character (punctuation, latin, digits) has no pinyin to give. */
const HAS_HAN = /\p{Script=Han}/u;

/**
 * Aggregate an example sentence's per-segment pinyin into a single
 * space-separated string — one token per GSA segment, which is the hint format
 * cloud TTS expects (`useTTS.speakSentence`) and also what the Speed Reading
 * prompt displays for a sentence round.
 *
 * Punctuation segments (「，」「。」and friends) are SKIPPED rather than treated as a
 * missing pronunciation. They have no det row, so they never carry a `pronunciation`,
 * and bailing on them meant this returned `undefined` for essentially EVERY example
 * sentence — every one ends in 。 — silently dropping the TTS phoneme hint and the
 * Speed Reading pinyin line. The consequence was audible: with no hint the provider
 * guessed each reading, so 行家 in a sentence was narrated *xíng jiā* while the card
 * displayed *háng jiā*. The server's `buildPinyinSsml` aligns these syllables to the
 * text's HAN characters only, so omitting punctuation here keeps both sides in step.
 *
 * Returns undefined if the segmentation is missing, or if any segment that DOES
 * contain a Han character lacks a pronunciation: a partial hint would misalign every
 * syllable after the gap, so the caller should let the provider infer the whole
 * sentence instead.
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
        // Punctuation and any other non-Han token contributes no syllables.
        if (!HAS_HAN.test(seg)) continue;
        const p = meta[seg]?.pronunciation;
        if (!p) return undefined;
        parts.push(p);
    }
    if (parts.length === 0) return undefined;
    return parts.join(' ');
}
