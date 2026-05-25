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
    const [isSpeaking, setIsSpeaking] = useState(false);
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
        setIsSpeaking(false);
    }, []);

    const speak = useCallback(async (entry: VocabEntry) => {
        if (!settings.enabled) return;
        if (!entry || !entry.entryKey) return;

        // Cancel anything in-flight before starting the next utterance.
        cancel();

        // Map the entry's language to a BCP-47 tag the TTS layer understands.
        // VocabEntry currently only carries Chinese, but this is the seam where
        // additional languages would plug in.
        const lang: TTSLang = 'zh-CN';

        const primary = getTTSProvider(settings.engine);
        activeProviderRef.current = primary;
        setIsSpeaking(true);

        try {
            await primary.speak({
                text: entry.entryKey,
                lang,
                pronunciation: entry.pronunciation,
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
                        text: entry.entryKey,
                        lang,
                        pronunciation: entry.pronunciation,
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
            setIsSpeaking(false);
        }
    }, [settings.enabled, settings.engine, settings.rate, cancel]);

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

    return {
        speak,
        cancel,
        prefetch,
        isSpeaking,
        enabled: settings.enabled,
        settings,
        updateSettings: update,
    };
}
