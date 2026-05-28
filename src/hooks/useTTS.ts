import { useCallback, useEffect, useRef, useState } from 'react';
import type { VocabEntry } from '../pages/FlashcardsLearnPage/types';
import { getTTSProvider, tts } from '../services/tts';
import type { TTSLang, TTSProvider } from '../services/tts';
import { useTTSSettings } from './useTTSSettings';

/**
 * useTTS — single entry point for narrating flashcards.
 *
 * Resolves provider from user settings, handles cloud→browser fallback,
 * cancels prior utterance on rapid calls, and no-ops when disabled.
 */
export function useTTS() {
    const { settings, update } = useTTSSettings();
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

        const lang: TTSLang = 'zh-CN';
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
    }, [settings.enabled, settings.engine, settings.rate, cancel]);

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
        tts.cloud.prefetch(entry.entryKey, 'zh-CN', entry.pronunciation);
    }, [settings.enabled, settings.engine]);

    // Sentence variant of prefetch — warm the cloud cache without playing.
    const prefetchSentence = useCallback((text: string, pronunciation?: string) => {
        if (!text) return;
        if (!settings.enabled) return;
        if (settings.engine === 'browser') return;
        tts.cloud.prefetch(text, 'zh-CN', pronunciation);
    }, [settings.enabled, settings.engine]);

    return {
        speak,
        speakSentence,
        cancel,
        prefetch,
        prefetchSentence,
        isSpeaking,
        speakingKey,
        enabled: settings.enabled,
        settings,
        updateSettings: update,
    };
}
