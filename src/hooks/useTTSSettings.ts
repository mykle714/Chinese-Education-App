import { useCallback, useSyncExternalStore } from 'react';

// localStorage key for the user's narration preferences. Single JSON blob so
// adding new knobs later doesn't require new keys.
const STORAGE_KEY = 'tts.settings';

// Legacy keys read ONCE during migration (see migrateLegacy). These hooks own
// them normally; we only peek at the raw blobs to carry a user's old autoplay
// choice into the unified setting.
const LEGACY_LEARN_KEY = 'flashcard.learn-settings';
const LEGACY_DISCOVER_KEY = 'discover.settings';

/**
 * How narration audio is routed to the OS. This is a real behavioral fork on
 * mobile, not a cosmetic preference — see docs/AUDIO_PLAYBACK.md.
 *
 *  • 'passthrough' — plays through an <audio> element. iOS Safari classifies a
 *    media element as Playback, so it IGNORES the hardware ring/silent switch.
 *    The price is inherent and unavoidable on the web platform: it takes audio
 *    focus (pausing the user's music/podcast) and registers with the system
 *    "Now Playing" center, so lock-screen transport controls appear.
 *  • 'media' — plays through Web Audio. Not a media session, so it MIXES with
 *    other audio (music keeps playing) and shows no lock-screen controls, but
 *    iOS silences it when the ring/silent switch is off.
 *
 * On Android the mute half of this is moot — the silent toggle mutes the ringer
 * stream, not the media stream — but the audio-focus half still applies.
 */
export type AudioRoute = 'passthrough' | 'media';

/**
 * The single user-facing narration setting: a 3-state control.
 *
 * 'off' is NOT a third route — it is the autoplay flag turned off. Audio still
 * plays from a deliberate speaker-button press, using whichever route is
 * remembered, which is why `route` survives an off → on round trip.
 */
export type AudioMode = 'off' | AudioRoute;

/**
 * Cycle order for the one-tap header chip, and the display order on /settings.
 *
 * 'off' first so a single tap from the default silences the app — the most urgent
 * thing a learner ever asks of this control (walking into a quiet room). The two
 * audible states then follow in increasing politeness: 'passthrough' overrides the
 * silent switch and takes audio focus, 'media' yields on both counts.
 */
export const AUDIO_MODE_ORDER: readonly AudioMode[] = ['off', 'passthrough', 'media'] as const;

export interface TTSSettings {
    /**
     * Whether narration fires on its own (card flips, game reveals, on-deck
     * packs). When false the app is silent until the user presses a speaker
     * button. This is the app's ONLY autoplay setting — the former per-surface
     * toggles (flp/games `autoplayChinese`, scp `discover.settings.autoplay`)
     * were unified into it.
     */
    autoplay: boolean;
    /** Where audio goes when it does play. Persists across `autoplay: false`. */
    route: AudioRoute;
}

// Passthrough by default: a learner who turns audio on wants to hear it, and the
// most confusing failure is "I pressed play and nothing happened" because the
// phone's silent switch was on. The cost (music pauses, lock-screen controls
// appear) is visible and self-explanatory; silence is not.
const DEFAULT_SETTINGS: TTSSettings = {
    autoplay: true,
    route: 'passthrough',
};

/** Read + JSON-parse one localStorage blob, or null if absent/malformed. */
function readBlob(key: string): Record<string, unknown> | null {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

/**
 * One-time migration from the pre-unification settings.
 *
 * Before: a master `tts.settings.enabled` switch (silenced EVERYTHING, speaker
 * buttons included) plus two independent autoplay flags — `autoplayChinese`
 * (flp + Bubble Match + Hydra + Match Speed) and `discover.settings.autoplay`
 * (scp). All three collapse into `autoplay` here.
 *
 * A user who had turned ANY of them off wanted less automatic sound, so any
 * explicit `false` migrates to `autoplay: false`. That is the closest available
 * meaning — note it is not identical for the old master switch, whose `false`
 * also silenced speaker buttons; under the new model a deliberate press always
 * speaks. Route has no predecessor, so it takes the default.
 */
function migrateLegacy(legacy: Record<string, unknown>): TTSSettings {
    const wasEnabled = legacy.enabled !== false;
    const learn = readBlob(LEGACY_LEARN_KEY);
    const discover = readBlob(LEGACY_DISCOVER_KEY);
    const autoplayChinese = learn?.autoplayChinese !== false;
    const discoverAutoplay = discover?.autoplay !== false;
    return {
        autoplay: wasEnabled && autoplayChinese && discoverAutoplay,
        route: DEFAULT_SETTINGS.route,
    };
}

function loadSettings(): TTSSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    const parsed = readBlob(STORAGE_KEY);
    if (!parsed) return DEFAULT_SETTINGS;
    // Pre-unification blobs have `enabled` and no `route`. Detect on `route`
    // rather than on `enabled` so a partially-written blob still migrates.
    if (typeof parsed.route !== 'string') return migrateLegacy(parsed);
    return {
        autoplay: parsed.autoplay !== false,
        route: parsed.route === 'media' ? 'media' : 'passthrough',
    };
}

/**
 * ── The store ───────────────────────────────────────────────────────────────
 *
 * ONE module-level value, not per-hook state. This matters: `useTTS` (and through
 * it `useTTSSettings`) is called by ~13 components, and several of them are on
 * screen at the same time — the flp renders `AudioModeChip` in its header AND
 * reads `autoplay` in its card-flip narration effect, from two different
 * instances of the hook.
 *
 * While each instance owned its own `useState`, those two copies DIVERGED the
 * moment the chip was tapped: the chip wrote 'off' to its own state and to
 * localStorage, but the page's instance never heard about it and kept narrating
 * (and kept lighting the speaker spinner) with a stale `autoplay: true` until the
 * page remounted. A setting with one on-screen control has to be one value.
 *
 * `subscribe`/`getSnapshot` back a `useSyncExternalStore`, so every instance
 * re-renders off the same object identity. The `storage` event keeps OTHER tabs
 * in step too — it does not fire in the tab that wrote, which is exactly why the
 * writer publishes to its own listeners directly.
 */
let currentSettings: TTSSettings | null = null;
const listeners = new Set<() => void>();

/** Lazily read localStorage once, then serve the in-memory copy forever. */
function getSnapshot(): TTSSettings {
    if (currentSettings === null) currentSettings = loadSettings();
    return currentSettings;
}

/** Server render / prerender has no localStorage — hand back the defaults. */
function getServerSnapshot(): TTSSettings {
    return DEFAULT_SETTINGS;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Replace the store value, persist it, and wake every mounted instance. */
function setSettings(next: TTSSettings): void {
    currentSettings = next;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage full or disabled — the setting still works in-memory.
    }
    listeners.forEach(l => l());
}

// Another tab changed the setting: adopt it. Re-parsed through loadSettings so a
// foreign write gets the same validation/migration as our own.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== null && e.key !== STORAGE_KEY) return;
        currentSettings = loadSettings();
        listeners.forEach(l => l());
    });
}

/**
 * useTTSSettings — reads/writes the app-wide narration preference.
 *
 * Exposes the stored two-field model AND the 3-state `mode` the settings UI
 * shows. Two fields internally so that turning audio off and back on restores
 * the route the user picked; one control on screen so there is a single answer
 * to "what does audio do".
 *
 * Every caller shares ONE value (see the store note above), so the header chip,
 * the /settings picker and the narration effects can never disagree.
 *
 * Future: migrate to a server-backed user preferences column when we want
 * cross-device sync. The shape — and the store — can stay the same.
 */
export function useTTSSettings() {
    const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const update = useCallback((patch: Partial<TTSSettings>) => {
        setSettings({ ...getSnapshot(), ...patch });
    }, []);

    // The 3-state projection the UI binds to.
    const mode: AudioMode = settings.autoplay ? settings.route : 'off';

    // Selecting 'off' preserves `route` so the previous choice returns when the
    // user switches back on; selecting a route implies autoplay on.
    const setMode = useCallback((next: AudioMode) => {
        const prev = getSnapshot();
        setSettings(next === 'off'
            ? { ...prev, autoplay: false }
            : { autoplay: true, route: next });
    }, []);

    // Advance to the next mode in AUDIO_MODE_ORDER. Backs the one-tap header chip,
    // which has room for a single control but must reach all three states — so the
    // full picker on /settings and the chip stay the same setting, not two.
    const cycleMode = useCallback(() => {
        const prev = getSnapshot();
        const current: AudioMode = prev.autoplay ? prev.route : 'off';
        const next = AUDIO_MODE_ORDER[(AUDIO_MODE_ORDER.indexOf(current) + 1) % AUDIO_MODE_ORDER.length];
        setSettings(next === 'off'
            ? { ...prev, autoplay: false }
            : { autoplay: true, route: next });
    }, []);

    return { settings, update, mode, setMode, cycleMode };
}
