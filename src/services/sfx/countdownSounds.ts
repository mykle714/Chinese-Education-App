import { tts } from "../tts";
import type { SoundEffect } from "../tts/CloudTTSProvider";
import { readTTSSettings } from "../../hooks/useTTSSettings";

/**
 * THE GAME COUNTDOWN'S BEEPS — a tick on each of 3 · 2 · 1, and a different, brighter
 * beep the moment the board goes live (the "release").
 *
 * Synthesized here, not shipped as audio files: two sine blips are a few lines of maths,
 * and rendering them in the browser means no asset to fetch, cache or keep in sync.
 *
 * ── THEY HONOUR THE AUDIO CHIP ──────────────────────────────────────────────
 * The beeps are AUTOMATIC sound (nobody pressed anything to hear them), so they follow
 * the same rule as autoplay narration (docs/AUDIO_PLAYBACK.md § 4):
 *   • mute (`autoplay: false`) → silent;
 *   • default (`passthrough`) → the media-element route, which plays through the iOS
 *     silent switch;
 *   • media → the Web Audio route, which mixes with music and obeys the silent switch.
 * The setting is read at the moment of each beep, so flipping the chip mid-count takes
 * effect on the very next one.
 *
 * Layer: client service (no React). Called by `useGameCountdown`
 * (src/games/shared/GameCountdown.tsx).
 * Documented in: docs/AUDIO_PLAYBACK.md § "Sound effects", docs/GAMES_FEATURE.md
 * § "The countdown".
 */

/** 44.1 kHz: the WAV the passthrough route plays is rendered at this rate. */
const SAMPLE_RATE = 44100;

/**
 * One enveloped sine blip: a 5 ms linear attack (no click), then an exponential decay to
 * silence by `durationS`. A quiet second harmonic rounds the pure sine off so it reads as
 * a beep rather than a test tone.
 */
function renderBlip(frequencyHz: number, durationS: number, peak: number): Float32Array {
    const length = Math.round(durationS * SAMPLE_RATE);
    const samples = new Float32Array(length);
    const attack = Math.round(0.005 * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE;
        const envelope = i < attack ? i / attack : Math.exp((-5 * (i - attack)) / (length - attack));
        const wave = Math.sin(2 * Math.PI * frequencyHz * t) + 0.2 * Math.sin(4 * Math.PI * frequencyHz * t);
        samples[i] = (peak * envelope * wave) / 1.2;
    }
    return samples;
}

/** 3 · 2 · 1 — short, mid-pitched (A5). */
const TICK: SoundEffect = {
    key: "countdown-tick",
    sampleRate: SAMPLE_RATE,
    render: () => renderBlip(880, 0.12, 0.35),
};

/** The release — a fifth higher (E6) and held longer, so it reads as "now". */
const RELEASE: SoundEffect = {
    key: "countdown-release",
    sampleRate: SAMPLE_RATE,
    render: () => renderBlip(1318.5, 0.38, 0.4),
};

export type CountdownSound = "tick" | "release";

/** Play one countdown beep, unless the audio chip says mute. Fire-and-forget. */
export function playCountdownSound(sound: CountdownSound): void {
    const { autoplay, route } = readTTSSettings();
    if (!autoplay) return;
    tts.cloud.playEffect(sound === "tick" ? TICK : RELEASE, route);
}
