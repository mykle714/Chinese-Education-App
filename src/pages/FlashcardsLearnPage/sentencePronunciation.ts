interface SentenceLike {
    _segments?: string[];
    segmentMetadata?: Record<string, { pronunciation?: string }>;
}

// Aggregate per-segment pinyin into a single space-separated string for TTS.
// Returns undefined if segments or any segment's pronunciation are missing —
// the caller should then let the cloud TTS infer pronunciation.
export function buildSentencePronunciation(sentence: SentenceLike): string | undefined {
    const segments = sentence._segments;
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
