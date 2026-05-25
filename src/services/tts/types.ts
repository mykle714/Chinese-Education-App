// Pluggable TTS provider interface. Lets us swap engines (browser, cloud) without
// touching call-sites. To add a new engine, implement TTSProvider and register it
// in src/services/tts/index.ts.

export type TTSLang = 'zh-CN' | 'zh-TW' | 'en';

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
    // 0.5..2.0. Providers that bake rate into audio should ignore this and let
    // the audio element apply playbackRate; cache stays valid across rate changes.
    rate?: number;
}

export interface TTSProvider {
    readonly name: 'web-speech' | 'cloud';
    // Cheap, sync-ish availability check. Cloud may be false if no network /
    // server returned 503; Web Speech may be false if the browser lacks the API.
    isAvailable(): Promise<boolean>;
    // Starts playback. Resolves when audio finishes (or fails). Subsequent
    // speak() calls cancel any in-flight utterance from the same provider.
    speak(req: TTSRequest): Promise<void>;
    cancel(): void;
}
