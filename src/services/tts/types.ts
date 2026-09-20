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
 * Used by Immersive World to give a male NPC a male voice (docs/IMMERSIVE_WORLD.md § 6.4a).
 * Flashcard narration omits it and gets 'default'.
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
     * Set false for text that is NOT a headword — an Immersive World NPC's line, say — where
     * the stamp is a guaranteed-zero-row UPDATE on every miss
     * (docs/IMMERSIVE_WORLD.md § 6.4's code note).
     */
    stamp?: boolean;
    /**
     * Which voice to synthesize with. Defaults to 'default' (the language's single flashcard
     * voice), so every existing call site is unchanged.
     *
     * ⚠️ Part of the provider's cache key. `prepare` and the `speak` that follows it MUST pass
     * the same value, or the duration measured on one clip paces the reveal of another — the
     * one thing Immersive World's audio-as-clock contract cannot survive.
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
     * It exists for one caller: Immersive World, where **the audio is the clock**
     * (docs/IMMERSIVE_WORLD.md § 6.4) and the typewriter cannot start until the line's
     * duration is known. Every other narration site plays and forgets, and should keep using
     * `speak`.
     *
     * A subsequent `speak` for the same text is served from this provider's own caches, so
     * prepare-then-speak costs one synthesis, not two.
     */
    prepare(req: TTSRequest): Promise<number | null>;
    cancel(): void;
}
