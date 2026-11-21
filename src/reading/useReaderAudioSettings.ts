import { useCallback, useEffect, useState } from "react";
import { tts } from "../services/tts";
import { AUDIO_MODE_ORDER, type AudioMode, type AudioRoute } from "../hooks/useTTSSettings";

/**
 * useReaderAudioSettings — the Reader document page's OWN audio setting, behind the audio
 * chip in its display strip (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear").
 *
 * The same three states as the app-wide narration chip (AudioModeChip / useTTSSettings) —
 * mute → default (passthrough) → media — but a SEPARATE value (owner's call 2026-11-17):
 * the Reader's automatic audio is "say each word I tap to", a different behaviour from the
 * flp's card-flip narration, so a learner can want one without the other.
 *
 *   - mute         — tapping to a new word plays nothing (the keycap speaker still speaks).
 *   - default      — each newly selected word is spoken, passthrough route.
 *   - media        — same, media route (mixes with music, obeys the silent switch).
 *
 * Stored like useTTSSettings: `autoplay` + `route`, so mute → on restores the route picked
 * before. Per DEVICE in localStorage (`reader.audio`), like the Reader's display mode — no
 * account column. Default: 'default' (autoplay on, passthrough), matching the app-wide one.
 *
 * While the page is mounted its route OUTRANKS the app-wide one for every clip the page
 * plays — tap-to-hear, the keycap speaker and the read-aloud alike — through
 * CloudTTSProvider.setRouteOverride, released on unmount. Only the AUTOPLAY half is new
 * behaviour; the route half keeps one page from playing on two sinks.
 *
 * ONE setting for every reading page: the Reader document page (its display strip) and the
 * cyoa story page (its header, docs/CYOA_FEATURE.md § 3.1) both render `ReaderAudioChip`
 * over this hook, so the same `reader.audio` value drives both. Each mount reads storage
 * fresh; the two pages are never mounted together, so no cross-instance sync is needed.
 *
 * Layer: shared hook (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Depended on by ReaderDocumentPage and
 * StoryPlayPage (state + the tap-to-hear effect via useReadingKeycap) and rendered by
 * AudioModeChip's `ReaderAudioChip` skin via props.
 */

const STORAGE_KEY = "reader.audio";

interface ReaderAudioSettings {
    autoplay: boolean;
    route: AudioRoute;
}

const DEFAULT_READER_AUDIO: ReaderAudioSettings = { autoplay: true, route: "passthrough" };

function readReaderAudio(): ReaderAudioSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_READER_AUDIO;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return DEFAULT_READER_AUDIO;
        const blob = parsed as Record<string, unknown>;
        return {
            autoplay: blob.autoplay !== false,
            route: blob.route === "media" ? "media" : "passthrough",
        };
    } catch {
        return DEFAULT_READER_AUDIO;
    }
}

export function useReaderAudioSettings() {
    const [settings, setSettings] = useState<ReaderAudioSettings>(readReaderAudio);
    const mode: AudioMode = settings.autoplay ? settings.route : "off";

    // Advance mute → default → media → mute (AUDIO_MODE_ORDER, the app-wide chip's order).
    // Picking mute keeps `route`, so the next tap back on restores it.
    const cycleMode = useCallback(() => {
        setSettings((prev) => {
            const current: AudioMode = prev.autoplay ? prev.route : "off";
            const next = AUDIO_MODE_ORDER[(AUDIO_MODE_ORDER.indexOf(current) + 1) % AUDIO_MODE_ORDER.length];
            const updated: ReaderAudioSettings = next === "off"
                ? { ...prev, autoplay: false }
                : { autoplay: true, route: next };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            } catch {
                // Storage unavailable — the choice just won't outlive this page.
            }
            return updated;
        });
    }, []);

    // Claim the cloud provider's route for this page; give it back on unmount.
    const { route } = settings;
    useEffect(() => {
        tts.cloud.setRouteOverride(route);
        return () => tts.cloud.setRouteOverride(null);
    }, [route]);

    return { mode, autoplay: settings.autoplay, cycleMode };
}
