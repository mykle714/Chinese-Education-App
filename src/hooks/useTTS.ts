import { useCallback, useEffect, useRef, useState } from 'react';
import type { VocabEntry } from '../types';
import { tts } from '../services/tts';
import type { TTSLang, TTSProvider } from '../services/tts';
import { useTTSSettings } from './useTTSSettings';
import { useAuth } from '../AuthContext';
import { resolveDisplayPronunciation } from '../utils/definitionUtils';

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
 * Why a narration fired. 'manual' = the user pressed a speaker button (always
 * speaks); 'auto' = the app decided to speak (gated on the autoplay setting, and
 * subject to the media-mode fallback rule below).
 */
type SpeakTrigger = 'auto' | 'manual';

/**
 * useTTS — single entry point for narrating flashcards.
 *
 * Owns three things call sites should not re-derive:
 *   • the audio ROUTE (passthrough/media), pushed down into the cloud provider;
 *   • the AUTOPLAY flag — the app's single autoplay setting, which every
 *     automatic narration site must gate on (`autoSpeak`/`autoSpeakSentence`
 *     do it for you). A speaker BUTTON always speaks, in every mode;
 *   • the cloud→browser fallback, including the rule below.
 *
 * ⚠️ Fallback rule. `WebSpeechProvider` uses `speechSynthesis`, an OS sink we
 * cannot route: on iOS it ignores the ring/silent switch and takes audio focus,
 * i.e. it always behaves like 'passthrough'. In 'media' mode that breaks the
 * mode's promise, so an AUTOMATIC utterance stays silent when cloud TTS fails
 * rather than talking over the user's music with the phone on silent. A MANUAL
 * press still falls back — the user asked for sound, and a worse voice beats
 * none. In 'passthrough' mode the fallback matches the mode and always runs.
 * (This path is not hypothetical: it was live for three days during the
 * 2026-08-21 Google BILLING_DISABLED outage.)
 */
export function useTTS() {
    const { settings, update, mode, setMode, cycleMode } = useTTSSettings();
    const { user } = useAuth();
    // Keep the provider's sink in sync with the setting. Done in an effect (not
    // during render) because it mutates module-level singleton state.
    const route = settings.route;
    useEffect(() => {
        tts.cloud.setRoute(route);
    }, [route]);
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
    // primary→browser fallback logic lives in one place. Everything plays at the
    // synthesized speed — the app has no speech-rate control.
    const speakText = useCallback(async (
        text: string,
        pronunciation?: string | null,
        trigger: SpeakTrigger = 'manual',
    ) => {
        if (!text) return;
        // Automatic narration is the only thing the autoplay setting gates; a
        // deliberate speaker press speaks in every mode, including 'off'.
        if (trigger === 'auto' && !settings.autoplay) return;

        cancel();

        const lang: TTSLang = ttsLang;
        // Narration always runs "auto": cloud is primary (better voice), browser
        // is the fallback. There is no user engine choice anymore.
        const primary = tts.cloud;
        activeProviderRef.current = primary;
        setSpeakingKey(text);

        try {
            await primary.speak({
                text,
                lang,
                pronunciation: pronunciation ?? undefined,
            });
        } catch (err) {
            // Cloud failed (server unreachable, key missing, etc.). Whether we
            // may fall back to the browser voice depends on the mode — see the
            // fallback rule in the hook doc.
            if (trigger === 'auto' && route === 'media') {
                console.warn('[useTTS] cloud provider failed; suppressing browser fallback in media mode:', err);
                return;
            }
            console.warn('[useTTS] cloud provider failed, falling back to browser:', err);
            try {
                activeProviderRef.current = tts.browser;
                await tts.browser.speak({
                    text,
                    lang,
                    pronunciation: pronunciation ?? undefined,
                });
            } catch (err2) {
                console.warn('[useTTS] fallback provider also failed:', err2);
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
    }, [settings.autoplay, route, cancel, ttsLang]);

    // ⚠️ THE PRONUNCIATION HINT MUST BE THE ONE ON SCREEN. It is passed to the cloud
    // provider and reaches Google TTS as an SSML <phoneme> tag, so it genuinely
    // decides which reading is spoken — which makes a disagreement with the displayed
    // pinyin audible, not cosmetic.
    //
    // This used to send the raw `entry.pronunciation` column while every card face
    // rendered `resolveDisplayPronunciation` (the SENSE-AWARE reading). For a
    // polyphone the two differ by construction: 和 displays huó on its "to blend"
    // sense and was narrated hé from the headword column. A learner hearing one
    // syllable while reading another has no way to tell which is wrong — and for a
    // beginner drilling recognition, that is worse than no audio.
    //
    // `senseIndexOverride` mirrors the resolver's own parameter, for a caller holding
    // a LIVE sense pick that has not yet round-tripped to `entry.selectedSense`
    // (the flp's eip picker). Omit it and the entry's persisted sense is used, which
    // is correct for every surface that has no picker — the games, the cdp, discover.
    const speak = useCallback(async (entry: VocabEntry, senseIndexOverride?: number) => {
        if (!entry || !entry.entryKey) return;
        await speakText(entry.entryKey, resolveDisplayPronunciation(entry, senseIndexOverride));
    }, [speakText]);

    // Automatic variant of speak() — for narration the user did not ask for by
    // pressing something (a card flip revealing the Chinese face, a game
    // revealing a word). Gated on the autoplay setting and subject to the
    // media-mode fallback rule.
    const autoSpeak = useCallback(async (entry: VocabEntry, senseIndexOverride?: number) => {
        if (!entry || !entry.entryKey) return;
        await speakText(entry.entryKey, resolveDisplayPronunciation(entry, senseIndexOverride), 'auto');
    }, [speakText]);

    // Narrate an arbitrary Chinese sentence. Pronunciation is the optional
    // space-separated pinyin hint (one token per GSA segment) — see
    // buildSentencePronunciation. Server-side cache is keyed on text+pinyin+voice
    // so repeat plays of the same sentence reuse the same cached MP3.
    const speakSentence = useCallback(async (text: string, pronunciation?: string) => {
        await speakText(text, pronunciation);
    }, [speakText]);

    // Automatic variant of speakSentence() — same gating as autoSpeak.
    const autoSpeakSentence = useCallback(async (text: string, pronunciation?: string) => {
        await speakText(text, pronunciation, 'auto');
    }, [speakText]);

    // Cancel on unmount so a stale utterance can't outlive the page.
    useEffect(() => {
        return () => {
            cancel();
        };
    }, [cancel]);

    /**
     * Prime the cloud provider's in-session cache for this entry so the next
     * speak() resolves without a network round-trip. Runs in every mode —
     * including 'off', where a speaker press is still possible and is exactly
     * the case that most wants to be instant. Skipped when the server signaled
     * that synthesis failed for this card (hasAudio === false).
     */
    const prefetch = useCallback((entry: VocabEntry | null | undefined) => {
        if (!entry || !entry.entryKey) return;
        if (entry.hasAudio === false) return;
        // Same resolver as `speak`, or the prefetch warms a cache key nothing will
        // ever ask for (the buffer is keyed on text + pinyin + voice).
        tts.cloud.prefetch(entry.entryKey, ttsLang, resolveDisplayPronunciation(entry));
    }, [ttsLang]);

    /**
     * Prime the cloud provider's shared AudioContext for autoplay. Call this
     * synchronously from a real user gesture (e.g. a button click) when the next
     * autoplay will be triggered by code that runs after an `await` — such as a
     * drag handler that narrates only once playback begins — so mobile autoplay
     * policy doesn't leave the context suspended for that first programmatic
     * play.
     */
    const unlockAudio = useCallback(() => {
        tts.cloud.unlock();
    }, []);

    // Sentence variant of prefetch — warm the cloud cache without playing.
    const prefetchSentence = useCallback((text: string, pronunciation?: string) => {
        if (!text) return;
        tts.cloud.prefetch(text, ttsLang, pronunciation);
    }, [ttsLang]);

    return {
        speak,
        speakSentence,
        // Automatic narration — gated on `autoplay`; use these anywhere the user
        // did not press something to ask for sound.
        autoSpeak,
        autoSpeakSentence,
        cancel,
        prefetch,
        prefetchSentence,
        unlockAudio,
        isSpeaking,
        speakingKey,
        /** Whether narration fires on its own. Speaker buttons ignore this. */
        autoplay: settings.autoplay,
        /** The 3-state control's value, for the settings picker and the header chip. */
        mode,
        setMode,
        /** One-tap advance through off → passthrough → media. Backs AudioModeChip. */
        cycleAudioMode: cycleMode,
        settings,
        updateSettings: update,
    };
}
