import { useCallback, useEffect, useRef, useState } from 'react';
import type { VocabEntry } from '../pages/FlashcardsLearnPage/types';
import { getTTSProvider, tts } from '../services/tts';
import type { TTSLang, TTSProvider } from '../services/tts';
import { useTTSSettings } from './useTTSSettings';
import { useAuth } from '../AuthContext';

/**
 * Map the user's selected study language → the TTS tag we narrate in. Without
 * this, narration was hardcoded to Mandarin, so Spanish cards were read by the
 * Chinese voice. Unknown/missing languages fall back to English (a neutral
 * default rather than assuming Chinese).
 */
function toTTSLang(selectedLanguage: string | undefined): TTSLang {
    switch (selectedLanguage) {
        case 'zh': return 'zh-CN';
        case 'es': return 'es-US';
        default: return 'en-US';
    }
}

/**
 * useTTS — single entry point for narrating flashcards.
 *
 * Resolves provider from user settings, handles cloud→browser fallback,
 * cancels prior utterance on rapid calls, and no-ops when disabled.
 */
export function useTTS() {
    const { settings, update } = useTTSSettings();
    const { user } = useAuth();
    // The language to narrate in, derived from the user's current study language.
    const ttsLang = toTTSLang(user?.selectedLanguage);
    // The text currently being narrated, or null when idle. Buttons compare
    // their target text to this to decide whether to show the loading spinner,
    // so only the clicked button spins when multiple are visible at once.
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);
    const isSpeaking = speakingKey !== null;
    // Track the active provider so cancel() hits the right one even after
    // settings change mid-playback.
    const activeProviderRef = useRef<TTSProvider | null>(null);

    const cancel = useCallback(() => {
        if (activeProviderRef.current) {
            activeProviderRef.current.cancel();
            activeProviderRef.current = null;
        }
        // Belt and suspenders: also cancel both singletons in case state drifted.
        tts.browser.cancel();
        tts.cloud.cancel();
        setSpeakingKey(null);
    }, []);

    // Shared playback core for any (text, pronunciation) pair. Used by both
    // speak(entry) and speakSentence(text, pronunciation) so the cancel +
    // primary→browser fallback logic lives in one place.
    const speakText = useCallback(async (text: string, pronunciation?: string | null) => {
        if (!settings.enabled) return;
        if (!text) return;

        cancel();

        const lang: TTSLang = ttsLang;
        const primary = getTTSProvider(settings.engine);
        activeProviderRef.current = primary;
        setSpeakingKey(text);

        try {
            await primary.speak({
                text,
                lang,
                pronunciation: pronunciation ?? undefined,
                rate: settings.rate,
            });
        } catch (err) {
            // Cloud failed (server unreachable, key missing, etc.) — fall back
            // to browser unless the user explicitly chose cloud-only.
            console.warn('[useTTS] primary provider failed, falling back:', err);
            if (settings.engine === 'auto') {
                try {
                    activeProviderRef.current = tts.browser;
                    await tts.browser.speak({
                        text,
                        lang,
                        pronunciation: pronunciation ?? undefined,
                        rate: settings.rate,
                    });
                } catch (err2) {
                    console.warn('[useTTS] fallback provider also failed:', err2);
                }
            }
        } finally {
            if (activeProviderRef.current === primary || activeProviderRef.current === tts.browser) {
                activeProviderRef.current = null;
            }
            // Only clear if this invocation still owns the speakingKey — a
            // subsequent speak() may have already overwritten it via cancel()
            // + setSpeakingKey(newText) before our finally ran.
            setSpeakingKey(prev => (prev === text ? null : prev));
        }
    }, [settings.enabled, settings.engine, settings.rate, cancel, ttsLang]);

    const speak = useCallback(async (entry: VocabEntry) => {
        if (!entry || !entry.entryKey) return;
        await speakText(entry.entryKey, entry.pronunciation);
    }, [speakText]);

    // Narrate an arbitrary Chinese sentence. Pronunciation is the optional
    // space-separated pinyin hint (one token per GSA segment) — see
    // buildSentencePronunciation. Server-side cache is keyed on text+pinyin+voice
    // so repeat plays of the same sentence reuse the same cached MP3.
    const speakSentence = useCallback(async (text: string, pronunciation?: string) => {
        await speakText(text, pronunciation);
    }, [speakText]);

    // Cancel on unmount so a stale utterance can't outlive the page.
    useEffect(() => {
        return () => {
            cancel();
        };
    }, [cancel]);

    /**
     * Prime the cloud provider's in-session blob cache for this entry so the
     * next speak() resolves without a network round-trip. No-ops when the user
     * disabled TTS, picked the browser engine, or the server signaled that
     * synthesis failed for this card (hasAudio === false).
     */
    const prefetch = useCallback((entry: VocabEntry | null | undefined) => {
        if (!entry || !entry.entryKey) return;
        if (!settings.enabled) return;
        if (settings.engine === 'browser') return;
        if (entry.hasAudio === false) return;
        tts.cloud.prefetch(entry.entryKey, ttsLang, entry.pronunciation);
    }, [settings.enabled, settings.engine, ttsLang]);

    /**
     * Prime the cloud provider's shared AudioContext for autoplay. Call this
     * synchronously from a real user gesture (e.g. a button click) when the next
     * autoplay will be triggered by code that runs after an `await` — such as a
     * drag handler that narrates only once playback begins — so mobile autoplay
     * policy doesn't leave the context suspended for that first programmatic
     * play. No-op for the browser engine, which primes itself on its first
     * in-gesture speak().
     */
    const unlockAudio = useCallback(() => {
        if (!settings.enabled) return;
        if (settings.engine === 'browser') return;
        tts.cloud.unlock();
    }, [settings.enabled, settings.engine]);

    // Sentence variant of prefetch — warm the cloud cache without playing.
    const prefetchSentence = useCallback((text: string, pronunciation?: string) => {
        if (!text) return;
        if (!settings.enabled) return;
        if (settings.engine === 'browser') return;
        tts.cloud.prefetch(text, ttsLang, pronunciation);
    }, [settings.enabled, settings.engine, ttsLang]);

    return {
        speak,
        speakSentence,
        cancel,
        prefetch,
        prefetchSentence,
        unlockAudio,
        isSpeaking,
        speakingKey,
        enabled: settings.enabled,
        settings,
        updateSettings: update,
    };
}
