/**
 * markArpeggio.ts — the app's answer-feedback sound.
 *
 * ── WHAT IT PLAYS ───────────────────────────────────────────────────────────
 * Four marimba notes forming a C-major arpeggio (C · E · G · C↑). Consecutive
 * CORRECT marks walk up the ladder; the fifth correct mark starts again on the
 * low C. A WRONG mark plays a separate, truncated low C and resets the ladder,
 * so the next correct answer is audibly back at the bottom.
 *
 * The rising line is the point: a single blip tells you only "right", whereas
 * the pitch says "right, and this is your fourth in a row" without the learner
 * having to look at anything. Dropping back to the bottom is the cost of a miss.
 *
 * ── WHY SAMPLES, WHERE THE OLD BLIPS WERE SYNTHESIZED ───────────────────────
 * This module replaces `src/games/runtime/gameSounds.ts`, which built two
 * oscillator blips precisely so it would not have to ship assets or pay a fetch
 * before the first sound. That argument does not survive a real instrument —
 * an oscillator cannot be a marimba. The cost is paid down instead:
 *
 *   - the five clips are mono 128kbps mp3, ~22KB each, ~108KB in total (the
 *     source .wav masters were 24-bit stereo with bit-identical channels, i.e.
 *     30x larger for no information),
 *   - the bytes are fetched at MODULE LOAD, long before a learner can answer
 *     anything, and decoded on the first user gesture,
 *   - a call that arrives before its note is ready plays as soon as the decode
 *     resolves rather than being dropped.
 *
 * ── MOBILE AUTOPLAY POLICY ──────────────────────────────────────────────────
 * A browser only lets an AudioContext produce sound if it was created or resumed
 * inside a user gesture, and iOS re-suspends the context every time it takes
 * audio focus (a call, an app switch, the screen locking). So, exactly as
 * docs/AUDIO_PLAYBACK.md § 5 requires:
 *
 *   ⛔ the pointerdown listener is PERSISTENT, not `{ once: true }`, and the
 *      unlock is REPEATABLE, not latched.
 *
 * A single spent unlock is the 2026-08-28 narration bug; do not reintroduce it
 * here. The fast path is one `ctx.state` read per tap.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * Like the blips it replaces, this is OUT OF SCOPE of the narration setting
 * (`AudioModeChip` / `useTTSSettings`): it always uses media semantics, so it
 * honors the iOS silent switch and never disturbs other audio. It owns a second
 * AudioContext, separate from CloudTTSProvider's, with its own unlock state —
 * see docs/AUDIO_PLAYBACK.md § 7.
 *
 * Called from: `src/api/flashcards.ts` -> `markFlashcard` (the single chokepoint
 * every mark surface goes through), and only for the surfaces in its
 * `ARPEGGIO_SURFACES` whitelist: Match Speed and Bubble Match.
 * Reset by: `src/hooks/useMarkArpeggio.ts`.
 * Documented in: docs/AUDIO_PLAYBACK.md § 7.
 */
import cLowUrl from "../../assets/Marimba/Arp/C.mp3";
import eUrl from "../../assets/Marimba/Arp/E.mp3";
import gUrl from "../../assets/Marimba/Arp/G.mp3";
import cHighUrl from "../../assets/Marimba/Arp/C-high.mp3";
import wrongUrl from "../../assets/Marimba/wrong.mp3";

/** The rising ladder, low to high. Index = how many correct marks precede this one. */
const ARPEGGIO_URLS = [cLowUrl, eUrl, gUrl, cHighUrl];

/** How many notes before the ladder starts over from the low C. */
const LADDER_LENGTH = ARPEGGIO_URLS.length;

/**
 * Playback gain. The clips are peak-normalized to -1.5 dBFS so the four notes are
 * even with each other; that is deliberately hot as a master, and this pulls the
 * result back to sit under narration rather than over it.
 */
const PLAYBACK_GAIN = 0.5;

/** Index of the note the NEXT correct mark plays. Reset by a wrong mark or a page leave. */
let ladderIndex = 0;

// ── The context ─────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;

/** Set once a context fails to construct, so we stop retrying on every tap. */
let audioUnavailable = false;

/**
 * The shared AudioContext, created on first use. Returns null when WebAudio is
 * unavailable (an older browser, or a locked-down webview) — every caller then
 * silently no-ops, because the sound is an enhancement and never a requirement.
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
    // A suspended context stays silent until resumed, and WebKit only accepts the
    // resume from inside a gesture's call stack. Attempted on EVERY call, never
    // latched — see the docblock.
    if (ctx.state === "suspended") void ctx.resume().catch(() => { /* stays silent */ });
    return ctx;
}

// ── Loading ─────────────────────────────────────────────────────────────────

/** Raw bytes per URL, fetched once at module load. */
const byteCache = new Map<string, Promise<ArrayBuffer>>();

/** Decoded PCM per URL, produced once a context exists. */
const bufferCache = new Map<string, Promise<AudioBuffer>>();

/**
 * Start the download for one clip. Kicked off for all five at module load, so the
 * network half is finished long before a learner can answer anything.
 *
 * The rejection is swallowed into a never-settling failure rather than left to
 * bubble: an unhandled rejection at module scope is a console error on every page
 * load for a feature that is meant to degrade to silence.
 */
function fetchBytes(url: string): Promise<ArrayBuffer> {
    const cached = byteCache.get(url);
    if (cached) return cached;
    const pending = fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error(`marimba clip ${url} -> HTTP ${res.status}`);
            return res.arrayBuffer();
        })
        .catch((err) => {
            // Drop the cache entry so a later play can retry the download.
            byteCache.delete(url);
            throw err;
        });
    byteCache.set(url, pending);
    return pending;
}

/**
 * Decode one clip, caching the PCM.
 *
 * `decodeAudioData` DETACHES the ArrayBuffer it is handed, so the cached bytes are
 * copied with `slice(0)` first — otherwise one failed decode would consume the
 * download and no retry could ever succeed. The copies are ~22KB, which is not
 * worth optimizing away.
 */
function getBuffer(audio: AudioContext, url: string): Promise<AudioBuffer> {
    const cached = bufferCache.get(url);
    if (cached) return cached;
    const pending = fetchBytes(url)
        .then((bytes) => audio.decodeAudioData(bytes.slice(0)))
        .catch((err) => {
            bufferCache.delete(url);
            throw err;
        });
    bufferCache.set(url, pending);
    return pending;
}

// ── Playback ────────────────────────────────────────────────────────────────

/**
 * Notes currently ringing. Marimba notes decay over ~1.4s, so a fast streak
 * deliberately lets them overlap — that overlap is what makes the four notes read
 * as one arpeggio rather than four unrelated beeps. A wrong answer stops them
 * (see `playMarkArpeggio`), because a happy chord still ringing under the wrong
 * note muddies the one signal that has to be unambiguous.
 */
const ringing = new Set<AudioBufferSourceNode>();

function play(url: string): void {
    const audio = getContext();
    if (!audio) return;
    void getBuffer(audio, url)
        .then((buffer) => {
            // The decode may have taken a moment on the very first note; play it
            // late rather than dropping it, but not if the context died meanwhile.
            if (!ctx || ctx.state === "closed") return;
            const source = audio.createBufferSource();
            const gain = audio.createGain();
            source.buffer = buffer;
            gain.gain.value = PLAYBACK_GAIN;
            source.connect(gain);
            gain.connect(audio.destination);
            source.onended = () => { ringing.delete(source); };
            ringing.add(source);
            source.start();
        })
        .catch(() => { /* no sound; never a user-visible failure */ });
}

/** Cut every ringing note short. Used only by the wrong note. */
function stopRinging(): void {
    for (const source of ringing) {
        try { source.stop(); } catch { /* already stopped */ }
    }
    ringing.clear();
}

/**
 * Play the feedback for one mark and advance the ladder.
 *
 * Called from `markFlashcard` BEFORE the request is sent, so the sound is
 * immediate and still inside the tap's gesture. That also means it follows the
 * learner's ANSWER, not the server's bookkeeping: a mark the server drops for
 * cooldown (`suppressed`, docs/HYDRA_BUBBLES.md § 8) still sounds correct,
 * because the learner did get it right and suppression is invisible to them.
 */
export function playMarkArpeggio(isCorrect: boolean): void {
    if (!isCorrect) {
        ladderIndex = 0;
        stopRinging();
        play(wrongUrl);
        return;
    }
    play(ARPEGGIO_URLS[ladderIndex]);
    ladderIndex = (ladderIndex + 1) % LADDER_LENGTH;
}

/**
 * Drop back to the low C. Called when a mark surface unmounts, so a streak never
 * carries from one page into the next — the ladder describes a run of answers on
 * one screen, and resuming mid-arpeggio somewhere else would be meaningless.
 */
export function resetMarkArpeggio(): void {
    ladderIndex = 0;
}

// ── Warm-up ─────────────────────────────────────────────────────────────────

/**
 * Prime the context and decode every clip on any tap.
 *
 * ⛔ PERSISTENT AND REPEATABLE BY CONTRACT. iOS suspends the context whenever it
 * takes audio focus and will not resume it outside a gesture, so this listener is
 * the app's only recovery path for this sink. `{ once: true }` here would spend
 * the session's single recovery on whatever the user tapped first — the exact
 * shape of the 2026-08-28 narration bug (docs/AUDIO_PLAYBACK.md § 5).
 */
function warmUp(): void {
    const audio = getContext();
    if (!audio) return;
    for (const url of [...ARPEGGIO_URLS, wrongUrl]) void getBuffer(audio, url).catch(() => { /* silent */ });
}

// Guarded so the module is importable outside a browser (the vitest suite pulls in
// src/api/flashcards.ts, which imports this).
if (typeof window !== "undefined" && typeof fetch === "function") {
    for (const url of [...ARPEGGIO_URLS, wrongUrl]) void fetchBytes(url).catch(() => { /* silent */ });
    window.addEventListener("pointerdown", warmUp, { passive: true });
}
