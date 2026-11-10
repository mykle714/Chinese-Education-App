// Pluggable TTS provider interface. Lets us swap engines (browser, cloud) without
// touching call-sites. To add a new engine, implement TTSProvider and register it
// in src/services/tts/index.ts.

// BCP-47-ish tags the UI can request. The cloud provider strips the region to a
// short code for the server; the browser provider uses the full tag for voice
// selection. `es-US` is Google's Latin-American/Mexican Spanish locale.
export type TTSLang = 'zh-CN' | 'zh-TW' | 'es-US' | 'en-US' | 'en';

/**
 * WHICH voice within the language, as an abstract ROLE. Mirrors `TTSVoiceKey` in
 * `server/services/TTSService.ts`, which owns the role → provider-voice-name mapping; the
 * name itself is never sent over the wire (see that type's doc for why).
 *
 * Set by the learner's `/settings` Voice choice; a caller may also name one per utterance
 * (Immersive World did, for its NPCs — removed 2026-11-09, docs/ARCHIVED_FEATURES.md). Flashcard narration
 * otherwise gets 'default'.
 */
export type TTSVoice = 'default' | 'male' | 'female';

export interface TTSRequest {
    // Hanzi (or other Chinese text) to speak. For non-Chinese languages, the
    // appropriate field on the entry — callers should choose what to read.
    text: string;
    lang: TTSLang;
    // Tone-marked space-separated pinyin (one syllable per hanzi). When present,
    // the cloud provider passes it to the server as an SSML phoneme hint so
    // polyphones (中 zhōng vs. zhòng) cache and play distinctly. WebSpeech
    // ignores it. Browsers don't expose phoneme overrides.
    pronunciation?: string | null;
    /**
     * Whether the server may stamp `det."ttsVoice"` on a cache miss. Default true.
     *
     * Set false for text that is NOT a headword — a spoken sentence, say — where the stamp is
     * a guaranteed-zero-row UPDATE on every miss.
     */
    stamp?: boolean;
    /**
     * Which voice to synthesize with. Defaults to 'default' (the language's single flashcard
     * voice), so every existing call site is unchanged.
     *
     * ⚠️ Part of the provider's cache key. `prepare` and the `speak` that follows it MUST pass
     * the same value, or the duration measured on one clip paces the reveal of another — the
     * one thing an audio-as-clock caller cannot survive.
     */
    voice?: TTSVoice;
}

export interface TTSProvider {
    readonly name: 'web-speech' | 'cloud';
    // Cheap, sync-ish availability check. Cloud may be false if no network /
    // server returned 503; Web Speech may be false if the browser lacks the API.
    isAvailable(): Promise<boolean>;
    // Starts playback. Resolves when audio finishes (or fails). Subsequent
    // speak() calls cancel any in-flight utterance from the same provider.
    speak(req: TTSRequest): Promise<void>;
    /**
     * Fetch and decode WITHOUT playing, resolving with the clip's duration in ms — or null
     * when this provider cannot know it ahead of time.
     *
     * It was built for one caller — Immersive World (removed 2026-11-09, docs/ARCHIVED_FEATURES.md), where
     * **the audio was the clock** and the typewriter could not start until the line's
     * duration was known. No caller today. Every other narration site plays and forgets, and should keep using
     * `speak`.
     *
     * A subsequent `speak` for the same text is served from this provider's own caches, so
     * prepare-then-speak costs one synthesis, not two.
     */
    prepare(req: TTSRequest): Promise<number | null>;
    cancel(): void;
}
