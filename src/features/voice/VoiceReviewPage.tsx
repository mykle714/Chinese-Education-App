import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import { fetchVoiceLineAudio, fetchVoiceTranscript } from "../../api/voice";
import type { VoiceSessionTranscript } from "../../../server/contracts/voice";
import VoiceTranscriptLine from "./VoiceTranscriptLine";
import { useTutorVoice } from "./useTutorVoice";
import { useTranscriptEip } from "./useTranscriptEip";
import { formatDuration, voiceMutedTextSx } from "./voiceStyles";

/**
 * VoiceReviewPage — `/voice/:sessionId`, one saved conversation (docs/VOICE_ASSISTANT.md § 9.3).
 *
 *   - READ: every line as cpcd; tap any word → eip → Add. Recasts show the learner's version
 *     next to the better one, with the tutor's new words as chips. Card words the learner used
 *     are tinted against their CURRENT cards (the server recomputes them on open, § 11).
 *   - LISTEN: a speaker on each tutor line and on each "better" version replays it in the
 *     tutor's voice, synthesized fresh (POST /api/voice/speak). There is no learner audio to
 *     replay — it is never stored.
 *   - No re-say practice (Q15).
 *
 * A node drill-in from /voice (keeps the Menu tab lit). Load effect keys on `user?.id` + the
 * route param, never `token`. Layer: feature page (src/features/voice).
 */
function VoiceReviewPage() {
    usePageTitle("Conversation");
    const look = useTier2Look();
    const { user } = useAuth();
    const { sessionId = "" } = useParams<{ sessionId: string }>();
    const [voice] = useTutorVoice();
    const words = useTranscriptEip("zh");

    const [transcript, setTranscript] = useState<VoiceSessionTranscript | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user?.id || !sessionId) return;
        let cancelled = false;
        fetchVoiceTranscript(sessionId)
            .then((t) => { if (!cancelled) { setTranscript(t); setError(null); } })
            .catch((err) => {
                if (cancelled) return;
                console.error("VoiceReviewPage: failed to load", err);
                setError("Couldn't load this conversation.");
            });
        return () => { cancelled = true; };
    }, [user?.id, sessionId]);

    // One <audio> for replays; a new tap stops the previous line.
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    useEffect(() => () => {
        audioRef.current?.pause();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    }, []);
    const listen = useCallback(async (text: string) => {
        try {
            const blob = await fetchVoiceLineAudio(text, voice);
            audioRef.current?.pause();
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
            urlRef.current = URL.createObjectURL(blob);
            const audio = new Audio(urlRef.current);
            audioRef.current = audio;
            await audio.play();
        } catch (err) {
            console.error("VoiceReviewPage: replay failed", err);
        }
    }, [voice]);

    const session = transcript?.session;
    return (
        <NodePage title="Conversation" contentClassName="voice-review-root" surfaceColor={look.ground} headerTitleColor={look.ink}>
            {session && (
                <Typography className="voice-review__meta" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted, padding: "12px 20px 0" }}>
                    {new Date(session.startedAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · "}{formatDuration(session.durationSeconds)}
                </Typography>
            )}
            {!transcript && !error && <Typography sx={voiceMutedTextSx(look)}>Loading…</Typography>}
            {error && <Typography sx={voiceMutedTextSx(look)}>{error}</Typography>}
            {transcript && (
                <Box className="voice-review__transcript" sx={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 16px 32px" }}>
                    {transcript.turns.map((t) => (
                        <VoiceTranscriptLine
                            key={t.turnIndex}
                            role={t.role}
                            text={t.text}
                            parts={t.parts}
                            matches={t.role === "user" ? pickMatches(t.parts, transcript.matches) : undefined}
                            recast={t.recast}
                            recastParts={t.recastParts}
                            lowConfidenceWords={t.lowConfidenceWords}
                            interrupted={t.interrupted}
                            look={look}
                            onWordOpen={(w) => void words.openWord(w)}
                            onListen={t.role === "assistant" ? (text) => void listen(text) : undefined}
                        />
                    ))}
                </Box>
            )}
            <EipSheet
                eip={words.eip}
                open={words.open}
                onClose={words.close}
                onSpeak={words.tts.speak}
                onSpeakSentence={words.tts.speakSentence}
                speakingKey={words.tts.speakingKey}
                showSynonymsRelated
                showWordTools
                showLearning
                sharedLearning={words.sharedLearning}
            />
        </NodePage>
    );
}

/** The transcript-wide matches restricted to the words this line actually contains. */
function pickMatches(
    parts: VoiceSessionTranscript["turns"][number]["parts"],
    matches: VoiceSessionTranscript["matches"],
): VoiceSessionTranscript["matches"] {
    const out: VoiceSessionTranscript["matches"] = {};
    for (const p of parts ?? []) {
        if (p.type !== "foreign") continue;
        for (const seg of p._segments) if (matches[seg]) out[seg] = matches[seg];
    }
    return out;
}

export default VoiceReviewPage;
