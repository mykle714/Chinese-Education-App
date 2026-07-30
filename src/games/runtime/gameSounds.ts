/**
 * Tiny synthesized answer-feedback sounds for the games.
 *
 * ── Why synthesized instead of audio files ──────────────────────────────────
 * These are two blips totalling well under a second. Shipping .mp3 assets for
 * them would add binary files to the repo, a fetch on first play (so the FIRST
 * answer of a run — the one that most needs the feedback — would be silent),
 * and a decode step. WebAudio oscillators cost nothing and are instant.
 *
 * ── Mobile autoplay policy ──────────────────────────────────────────────────
 * A browser only lets an AudioContext produce sound if it was created or
 * resumed inside a user gesture. Both play functions are called synchronously
 * from a tap handler, so the lazily-created context is always born inside a
 * gesture. `resume()` covers the case where the OS suspended it (backgrounded
 * tab, an incoming call) between rounds.
 *
 * Used by: src/games/speed-reading/SpeedReadingPage.tsx.
 * Documented in: docs/SPEED_READING_GAME.md.
 */

/** One shared context for the whole app — browsers cap how many can exist. */
let ctx: AudioContext | null = null;

/** Set once a context fails to construct, so we stop retrying every tap. */
let audioUnavailable = false;

/**
 * The shared AudioContext, created on first use. Returns null when WebAudio is
 * unavailable (older browsers, or a locked-down webview) — every caller then
 * silently no-ops, because sound is an enhancement and never a requirement.
 */
function getContext(): AudioContext | null {
    if (audioUnavailable) return null;
    if (!ctx) {
        // webkitAudioContext for older iOS Safari.
        const Ctor: typeof AudioContext | undefined =
            window.AudioContext
            || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
            audioUnavailable = true;
            return null;
        }
        try {
            ctx = new Ctor();
        } catch {
            audioUnavailable = true;
            return null;
        }
    }
    // Suspended contexts stay silent until resumed; this call is inside the tap
    // gesture, which is the only place the browser accepts it.
    if (ctx.state === "suspended") void ctx.resume().catch(() => { /* stays silent */ });
    return ctx;
}

/**
 * Play one short tone.
 *
 * The gain envelope matters: a bare oscillator start/stop clicks audibly at both
 * ends, so every tone ramps up over 10ms and decays exponentially to silence.
 *
 * @param startAt  Offset in seconds from "now", for sequencing a two-note chirp.
 */
function tone(
    audio: AudioContext,
    freq: number,
    startAt: number,
    durationSec: number,
    peakGain: number,
    type: OscillatorType = "sine",
): void {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    const t0 = audio.currentTime + startAt;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.02);
    // Nodes are single-use; dropping the references lets them be collected once
    // they finish. No disconnect needed — a stopped node releases itself.
}

/** Rising two-note chirp (E6 → A6). Bright, and clearly "up". */
export function playCorrectSound(): void {
    const audio = getContext();
    if (!audio) return;
    tone(audio, 1318.5, 0, 0.09, 0.18);
    tone(audio, 1760.0, 0.07, 0.13, 0.16);
}

/**
 * Falling two-note buzz (A3 → E3) on a square wave. Deliberately duller and
 * lower than the correct sound so the two are distinguishable without looking —
 * the whole point in a game played at speed.
 */
export function playWrongSound(): void {
    const audio = getContext();
    if (!audio) return;
    tone(audio, 220.0, 0, 0.10, 0.10, "square");
    tone(audio, 164.8, 0.08, 0.16, 0.09, "square");
}
