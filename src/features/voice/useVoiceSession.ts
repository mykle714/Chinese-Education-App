import { useCallback, useEffect, useRef, useState } from "react";
import { openVoiceSocket, sendVoiceMessage } from "../../api/voiceSocket";
import {
    VOICE_AUDIO_HEADER_BYTES,
    type TutorVoiceRole,
    type VoiceOrbState,
    type VoiceRecast,
    type VoiceServerEvent,
    type VoiceSessionSummary,
    type VoiceWordMatch,
} from "../../../server/contracts/voice";
import type { LongDefinitionPart } from "../../types";
import { MicPermissionError, startMicCapture, type MicCapture } from "./micCapture";
import { VoicePlayback } from "./voicePlayback";

/**
 * useVoiceSession — the client half of a live voice conversation
 * (docs/VOICE_ASSISTANT.md § 3, § 4, § 8).
 *
 *   start()  → one user gesture creates the shared AudioContext (unlocks playback), opens the
 *              mic and the socket. Mic frames stream as binary as soon as the server is ready.
 *   Server events drive the orb (`state`), the live transcript (userPartial → userFinal,
 *              assistantText sentences grouped by turnIndex, recast) and the end card (`ended`).
 *   Audio    → each binary frame is [turnId u32][sentenceIndex u32][mp3]; VoicePlayback plays
 *              them in order. When the turn is complete (`turnEnd`) AND drained, the hook sends
 *              `playbackEnded` so the server starts listening again.
 *   Barge-in → while the orb is thinking/speaking, a LOCAL VAD watches mic loudness. Sustained
 *              speech (BARGE_IN_FRAMES) outside the per-sentence echo guard stops playback
 *              and sends `interrupt` (§ 4.4).
 *
 * No effect here keys on `token` (CLAUDE.md ⛔): the socket authenticates once at `start`, so
 * a silent token refresh during a session changes nothing. The unmount effect tears down.
 *
 * Layer: feature hook (src/features/voice). Used by VoiceSessionSheet.
 */

export interface VoiceTranscriptLine {
    /** Stable React key: `u<turnIndex>` / `a<turnIndex>` / `partial`. */
    key: string;
    role: "user" | "assistant";
    turnIndex: number;
    text: string;
    /** Segmented runs for cpcd (one entry per received sentence for the tutor). */
    parts: LongDefinitionPart[];
    matches: Record<string, VoiceWordMatch>;
    recast: VoiceRecast | null;
    /** The learner's still-being-spoken line (plain text, not yet segmented). */
    partial?: boolean;
    interrupted?: boolean;
}

export type VoicePhase = "idle" | "connecting" | "live" | "ending" | "ended" | "error";

/** Consecutive loud frames (20 ms each) that count as a barge-in. */
const BARGE_IN_FRAMES = 10;
/** Absolute loudness floor for the barge-in VAD (RMS, −1…1 samples). */
const BARGE_IN_MIN_RMS = 0.035;

export function useVoiceSession(voice: TutorVoiceRole) {
    const [phase, setPhase] = useState<VoicePhase>("idle");
    const [orb, setOrb] = useState<VoiceOrbState>("listening");
    const [lines, setLines] = useState<VoiceTranscriptLine[]>([]);
    const [summary, setSummary] = useState<VoiceSessionSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [micDenied, setMicDenied] = useState(false);
    const [muted, setMuted] = useState(false);
    const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const micRef = useRef<MicCapture | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const playbackRef = useRef<VoicePlayback | null>(null);
    const readyRef = useRef(false);
    const orbRef = useRef<VoiceOrbState>("listening");
    // The newest tutor turn the server has spoken for, and the turns whose `turnEnd` arrived.
    const currentTurnRef = useRef(0);
    const endedTurnsRef = useRef(new Set<number>());
    const loudFramesRef = useRef(0);
    const noiseFloorRef = useRef(0.01);
    const voiceRef = useRef(voice);

    // ── Teardown ────────────────────────────────────────────────────────────
    const teardown = useCallback(() => {
        micRef.current?.stop();
        micRef.current = null;
        playbackRef.current?.stop(Number.MAX_SAFE_INTEGER - 1);
        playbackRef.current = null;
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
        void ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        readyRef.current = false;
    }, []);

    useEffect(() => teardown, [teardown]);

    // ── Tutor-voice toggle mid-session ──────────────────────────────────────
    useEffect(() => {
        voiceRef.current = voice;
        sendVoiceMessage(wsRef.current, { type: "setVoice", voice });
    }, [voice]);

    const maybeReportPlaybackEnded = useCallback((turnId: number) => {
        const playback = playbackRef.current;
        if (!playback) return;
        if (endedTurnsRef.current.has(turnId) && playback.isTurnDrained(turnId) && !playback.playing) {
            sendVoiceMessage(wsRef.current, { type: "playbackEnded", turnId });
        }
    }, []);

    // ── Server events ───────────────────────────────────────────────────────
    const handleEvent = useCallback((event: VoiceServerEvent) => {
        switch (event.type) {
            case "ready":
                readyRef.current = true;
                setSecondsRemaining(event.secondsRemaining);
                setPhase("live");
                break;
            case "state":
                orbRef.current = event.state;
                setOrb(event.state);
                loudFramesRef.current = 0;
                break;
            case "userPartial":
                setLines((prev) => {
                    const rest = prev.filter((l) => !l.partial);
                    return [...rest, { key: "partial", role: "user", turnIndex: -1, text: event.text, parts: [], matches: {}, recast: null, partial: true }];
                });
                break;
            case "userFinal":
                setLines((prev) => [
                    ...prev.filter((l) => !l.partial),
                    {
                        key: `u${event.turnIndex}`,
                        role: "user",
                        turnIndex: event.turnIndex,
                        text: event.text,
                        parts: event.parts ?? [{ type: "text", value: event.text }],
                        matches: event.matches,
                        recast: null,
                    },
                ]);
                break;
            case "assistantText":
                currentTurnRef.current = event.turnId;
                setLines((prev) => {
                    const sentenceParts: LongDefinitionPart[] = event.parts ?? [{ type: "text", value: event.text }];
                    const idx = prev.findIndex((l) => l.key === `a${event.turnIndex}`);
                    if (idx === -1) {
                        return [
                            ...prev,
                            { key: `a${event.turnIndex}`, role: "assistant", turnIndex: event.turnIndex, text: event.text, parts: sentenceParts, matches: event.matches, recast: null },
                        ];
                    }
                    const line = prev[idx];
                    const next = [...prev];
                    next[idx] = {
                        ...line,
                        text: line.text + event.text,
                        parts: [...line.parts, ...sentenceParts],
                        matches: { ...line.matches, ...event.matches },
                    };
                    return next;
                });
                break;
            case "recast":
                setLines((prev) => prev.map((l) => (l.key === `a${event.turnIndex}` ? { ...l, recast: event.recast } : l)));
                break;
            case "turnEnd":
                endedTurnsRef.current.add(event.turnId);
                if (event.interrupted) {
                    setLines((prev) => prev.map((l) => (l.role === "assistant" && l === prev[prev.length - 1] ? { ...l, interrupted: true } : l)));
                } else {
                    maybeReportPlaybackEnded(event.turnId);
                }
                break;
            case "ended":
                setSummary(event.summary);
                setPhase("ended");
                teardown();
                break;
            case "error":
                setError(event.message);
                // capReached is followed by `ended` (the end card) on the same socket — keep it open.
                if (event.fatal && event.code !== "capReached") {
                    setPhase((p) => (p === "ended" ? p : "error"));
                    teardown();
                }
                break;
        }
    }, [maybeReportPlaybackEnded, teardown]);

    const handleAudio = useCallback((data: ArrayBuffer) => {
        if (data.byteLength <= VOICE_AUDIO_HEADER_BYTES) return;
        const view = new DataView(data);
        const turnId = view.getUint32(0);
        playbackRef.current?.enqueue(turnId, data.slice(VOICE_AUDIO_HEADER_BYTES));
    }, []);

    // ── Local barge-in VAD ──────────────────────────────────────────────────
    const onMicLevel = useCallback((rms: number) => {
        const playback = playbackRef.current;
        if (orbRef.current === "listening") {
            noiseFloorRef.current = noiseFloorRef.current * 0.98 + rms * 0.02;
            loudFramesRef.current = 0;
            return;
        }
        if (playback?.isRecentSentenceStart()) return;
        const loud = rms > Math.max(BARGE_IN_MIN_RMS, noiseFloorRef.current * 4);
        loudFramesRef.current = loud ? loudFramesRef.current + 1 : 0;
        if (loudFramesRef.current >= BARGE_IN_FRAMES) {
            loudFramesRef.current = 0;
            playback?.stop(currentTurnRef.current);
            orbRef.current = "listening";
            setOrb("listening");
            sendVoiceMessage(wsRef.current, { type: "interrupt" });
        }
    }, []);

    // ── Public actions ──────────────────────────────────────────────────────
    const start = useCallback(async () => {
        if (phase === "connecting" || phase === "live") return;
        setPhase("connecting");
        setError(null);
        setMicDenied(false);
        setSummary(null);
        setLines([]);
        endedTurnsRef.current = new Set();
        currentTurnRef.current = 0;

        // Created inside the tap handler so the browser allows it to play.
        const context = new AudioContext();
        ctxRef.current = context;
        void context.resume();
        playbackRef.current = new VoicePlayback(context, (turnId) => maybeReportPlaybackEnded(turnId));

        try {
            micRef.current = await startMicCapture(context, ({ pcm, rms }) => {
                onMicLevel(rms);
                const ws = wsRef.current;
                if (readyRef.current && ws && ws.readyState === WebSocket.OPEN) ws.send(pcm);
            });
        } catch (err) {
            teardown();
            if (err instanceof MicPermissionError) setMicDenied(true);
            setError(err instanceof Error ? err.message : "Could not open the microphone.");
            setPhase("error");
            return;
        }

        const ws = openVoiceSocket(voiceRef.current);
        wsRef.current = ws;
        ws.onmessage = (e: MessageEvent) => {
            if (typeof e.data === "string") {
                try {
                    handleEvent(JSON.parse(e.data) as VoiceServerEvent);
                } catch (err) {
                    console.error("useVoiceSession: bad event", err);
                }
            } else if (e.data instanceof ArrayBuffer) {
                handleAudio(e.data);
            }
        };
        ws.onclose = () => {
            if (wsRef.current !== ws) return;
            setPhase((p) => (p === "live" || p === "connecting" || p === "ending" ? (p === "ending" ? "ended" : "error") : p));
            setError((prev) => prev ?? "The voice connection closed.");
            teardown();
        };
    }, [phase, handleEvent, handleAudio, onMicLevel, maybeReportPlaybackEnded, teardown]);

    const end = useCallback(() => {
        if (phase !== "live") {
            teardown();
            setPhase((p) => (p === "connecting" ? "idle" : p));
            return;
        }
        setPhase("ending");
        micRef.current?.stop();
        micRef.current = null;
        playbackRef.current?.stop(Number.MAX_SAFE_INTEGER - 1);
        sendVoiceMessage(wsRef.current, { type: "end" });
    }, [phase, teardown]);

    const toggleMute = useCallback(() => {
        setMuted((m) => {
            micRef.current?.setMuted(!m);
            return !m;
        });
    }, []);

    /** The learner added a word from the transcript: let the tutor know (§ 6.3). */
    const notifyCardAdded = useCallback((word: string) => {
        sendVoiceMessage(wsRef.current, { type: "cardAdded", word });
    }, []);

    return { phase, orb, lines, summary, error, micDenied, muted, secondsRemaining, start, end, toggleMute, notifyCardAdded };
}
