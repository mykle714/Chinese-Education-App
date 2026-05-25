import type { TTSProvider, TTSRequest } from './types';

/**
 * Browser-native TTS via Web Speech API.
 *
 * Free, no network, but quality varies by OS/browser. zh-CN is well-supported
 * on Chrome (Mac/Windows) and Safari; Linux Chromium has weaker voices.
 *
 * iOS Safari requires the first speak() to be inside a user-gesture stack.
 * Our trigger points (flip tap, speaker tap) both qualify, so this is fine.
 */
export class WebSpeechProvider implements TTSProvider {
    readonly name = 'web-speech' as const;

    async isAvailable(): Promise<boolean> {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    async speak(req: TTSRequest): Promise<void> {
        if (!(await this.isAvailable())) return;

        // Cancel anything in-flight from previous calls so we never overlap.
        window.speechSynthesis.cancel();

        const utter = new SpeechSynthesisUtterance(req.text);
        utter.lang = req.lang;
        utter.rate = req.rate ?? 1.0;

        const voice = pickVoice(req.lang);
        if (voice) utter.voice = voice;

        return new Promise<void>((resolve) => {
            utter.onend = () => resolve();
            // onerror also resolves (not rejects) — TTS failure shouldn't break the UI
            utter.onerror = () => resolve();
            window.speechSynthesis.speak(utter);
        });
    }

    cancel(): void {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }
}

// Voices load asynchronously in some browsers. We re-query each call; this is
// cheap and avoids stale references after voicepack downloads complete.
function pickVoice(lang: string): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;
    // Exact match first, then language family (zh-CN → zh).
    const exact = voices.find(v => v.lang === lang);
    if (exact) return exact;
    const family = lang.split('-')[0];
    return voices.find(v => v.lang.startsWith(family)) ?? null;
}
