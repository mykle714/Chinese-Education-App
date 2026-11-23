import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button, IconButton, Typography } from "@mui/material";
import Icon from "../../components/Icon";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
import { useScreenOverlayHost } from "../../hooks/useScreenOverlayHost";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SAFE_TOP } from "../../theme/safeArea";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { TutorVoiceRole } from "../../../server/contracts/voice";
import VoiceOrb from "./VoiceOrb";
import VoiceTranscriptLine from "./VoiceTranscriptLine";
import VoiceEndCard from "./VoiceEndCard";
import { useVoiceSession } from "./useVoiceSession";
import { useTutorVoice } from "./useTutorVoice";
import { useTranscriptEip } from "./useTranscriptEip";
import { formatDuration, voiceCardSx, voiceLineTextSx, voiceMutedTextSx, voicePillButtonSx, VOICE_HUE } from "./voiceStyles";

/**
 * VoiceSessionSheet — the live voice view (docs/VOICE_ASSISTANT.md § 8), raised over /voice.
 *
 * A full-height panel portaled to the phone frame (useScreenOverlayHost), above the footer
 * (z 1150) and BELOW the eip's sheets (1200+), so a tapped transcript word's eip opens on top.
 *
 *   - First launch: a one-screen explainer before the OS mic prompt (§ 8, "Permissions"),
 *     remembered in browser storage. After that, opening the sheet starts the session.
 *   - Live: the orb (listening / thinking / speaking), the rolling transcript (tap any word →
 *     eip → Add; an add tells the tutor via `cardAdded`), and a bottom bar: tutor voice
 *     (male / female, Q21), Mute mic, End.
 *   - End: the end-of-session card (§ 9.2) with Review transcript / Done.
 *   - Mic denied: a clear message pointing at the browser's site settings.
 *
 * Calls useBlockEdgeSwipe while open (CLAUDE.md). No effect keys on `token`.
 * PLACEHOLDER UX — the owner tunes the look later.
 *
 * Layer: feature component (src/features/voice). Rendered by VoicePage.
 */
const EXPLAINED_KEY = "voiceMicExplained";
const SHEET_Z = 1150;

function readExplained(): boolean {
    try {
        return localStorage.getItem(EXPLAINED_KEY) === "1";
    } catch {
        return false;
    }
}

interface VoiceSessionSheetProps {
    open: boolean;
    look: Tier2Look;
    onClose: () => void;
    /** Open the saved transcript of `sessionId` (the end card's Review transcript). */
    onReview: (sessionId: string) => void;
}

function VoiceSessionSheet({ open, look, onClose, onReview }: VoiceSessionSheetProps) {
    const { anchorRef, host } = useScreenOverlayHost(open);
    useBlockEdgeSwipe(open);
    const [voice, setVoice] = useTutorVoice();
    const session = useVoiceSession(voice);
    const { phase, orb, lines, summary, error, micDenied, muted, secondsRemaining, start, end, toggleMute, notifyCardAdded } = session;
    const words = useTranscriptEip("zh", notifyCardAdded);
    const [explained, setExplained] = useState(readExplained);

    // Opening the sheet starts the session once the explainer has been seen. A ref, not the
    // phase, guards it so a re-render never starts a second session.
    const autoStartedRef = useRef(false);
    useEffect(() => {
        if (!open) {
            autoStartedRef.current = false;
            return;
        }
        if (explained && !autoStartedRef.current) {
            autoStartedRef.current = true;
            void start();
        }
    }, [open, explained, start]);

    const handleExplainedStart = useCallback(() => {
        try {
            localStorage.setItem(EXPLAINED_KEY, "1");
        } catch {
            // Storage unavailable: the explainer shows again next time.
        }
        autoStartedRef.current = true;
        setExplained(true);
        void start(); // inside the tap: unlocks audio and prompts for the mic
    }, [start]);

    const handleClose = useCallback(() => {
        if (phase === "live") end();
        onClose();
    }, [phase, end, onClose]);

    // Keep the newest line in view.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const lastLineText = lines[lines.length - 1]?.text;
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [lines.length, lastLineText]);

    if (!open) return null;

    const live = phase === "live" || phase === "connecting" || phase === "ending";

    return (
        <>
            <Box component="span" ref={anchorRef} className="voice-sheet__anchor" sx={{ display: "none" }} />
            {host && createPortal(
                <Box
                    className="voice-sheet"
                    sx={{
                        position: "absolute",
                        inset: 0,
                        zIndex: SHEET_Z,
                        backgroundColor: look.ground,
                        display: "flex",
                        flexDirection: "column",
                        paddingTop: SAFE_TOP,
                        touchAction: "none",
                    }}
                >
                    {/* Header */}
                    <Box className="voice-sheet__header" sx={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px 6px 16px" }}>
                        <Typography className="voice-sheet__title" sx={{ flex: 1, fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, color: look.ink }}>
                            Voice tutor
                        </Typography>
                        {secondsRemaining !== null && live && (
                            <Typography className="voice-sheet__remaining" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted }}>
                                {formatDuration(secondsRemaining)} left today
                            </Typography>
                        )}
                        <IconButton className="voice-sheet__close" aria-label="Close" onClick={handleClose} sx={{ border: `1px solid ${look.outline}`, width: 34, height: 34 }}>
                            <Icon name="close" size={20} color={look.ink2} />
                        </IconButton>
                    </Box>

                    {/* Body */}
                    <Box className="voice-sheet__body" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                        {phase === "idle" && !explained && (
                            <Explainer look={look} onStart={handleExplainedStart} />
                        )}

                        {phase === "error" && (
                            <Box className="voice-sheet__error" sx={{ padding: "24px 16px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
                                <Typography sx={{ ...voiceLineTextSx(look), textAlign: "center" }}>{error ?? "Something went wrong."}</Typography>
                                {micDenied && (
                                    <Typography sx={{ ...voiceMutedTextSx(look), py: 0 }}>
                                        Allow the microphone for this site in your browser's settings (the lock icon next to the address), then try again.
                                    </Typography>
                                )}
                                <Button className="voice-sheet__retry" onClick={() => void start()} sx={voicePillButtonSx(look, RAMP[VOICE_HUE].mid)}>Try again</Button>
                            </Box>
                        )}

                        {(live || (phase === "ended" && summary)) && (
                            <>
                                {live && (
                                    <Box className="voice-sheet__orb" sx={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
                                        <VoiceOrb state={phase === "connecting" ? "thinking" : orb} look={look} muted={muted} size={lines.length ? 120 : 168} />
                                    </Box>
                                )}
                                <Box
                                    ref={scrollRef}
                                    className="voice-sheet__transcript"
                                    sx={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y", overscrollBehavior: "contain", padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}
                                >
                                    {phase === "connecting" && <Typography sx={voiceMutedTextSx(look)}>Connecting…</Typography>}
                                    {phase === "live" && lines.length === 0 && (
                                        <Typography sx={voiceMutedTextSx(look)}>Say hello! Mix in English whenever you need to.</Typography>
                                    )}
                                    {lines.map((line) => (
                                        <VoiceTranscriptLine
                                            key={line.key}
                                            role={line.role}
                                            text={line.text}
                                            parts={line.parts}
                                            matches={line.matches}
                                            recast={line.recast}
                                            partial={line.partial}
                                            interrupted={line.interrupted}
                                            look={look}
                                            onWordOpen={(w) => void words.openWord(w)}
                                        />
                                    ))}
                                    {phase === "ended" && summary && (
                                        <VoiceEndCard
                                            summary={summary}
                                            look={look}
                                            notice={error}
                                            onReview={() => onReview(summary.sessionId)}
                                            onDone={onClose}
                                        />
                                    )}
                                </Box>
                            </>
                        )}
                    </Box>

                    {/* Bottom bar */}
                    {live && (
                        <Box className="voice-sheet__bar" sx={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px calc(14px + env(safe-area-inset-bottom))", borderTop: `1px solid ${look.line}` }}>
                            <VoiceToggle look={look} voice={voice} onChange={setVoice} />
                            <Box sx={{ flex: 1 }} />
                            <Button className="voice-sheet__mute" onClick={toggleMute} sx={{ ...voicePillButtonSx(look), height: 40, px: 2 }}>
                                <Icon name={muted ? "mic_off" : "mic"} size={18} color={look.ink} />
                                <Box component="span" sx={{ ml: "6px" }}>{muted ? "Unmute" : "Mute"}</Box>
                            </Button>
                            <Button className="voice-sheet__end" onClick={end} disabled={phase === "ending"} sx={{ ...voicePillButtonSx(look, RAMP[VOICE_HUE].mid), height: 40, px: 2.5 }}>
                                {phase === "ending" ? "Ending…" : "End"}
                            </Button>
                        </Box>
                    )}
                </Box>,
                host,
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
        </>
    );
}

/** The one-screen explainer shown before the first mic prompt (§ 8). */
function Explainer({ look, onStart }: { look: Tier2Look; onStart: () => void }) {
    return (
        <Box className="voice-sheet__explainer" sx={{ padding: "24px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <Box sx={{ ...voiceCardSx(look), padding: "18px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, color: look.ink }}>
                    Talk with your Chinese tutor
                </Typography>
                <Typography sx={voiceLineTextSx(look)}>
                    Just speak — it listens hands-free and answers out loud. Mix in English words whenever you get stuck; it will show you how to say the whole thing in Chinese.
                </Typography>
                <Typography sx={voiceLineTextSx(look)}>
                    Your browser will ask to use the microphone. Only the text of what you say is saved, never your voice. The tutor reads a transcript, so it can't judge your tones.
                </Typography>
                <Typography sx={voiceLineTextSx(look)}>
                    Tap any word in the transcript to look it up and add it to your cards.
                </Typography>
            </Box>
            <Button className="voice-sheet__explainer-start" onClick={onStart} sx={{ ...voicePillButtonSx(look, RAMP[VOICE_HUE].mid), height: 44, alignSelf: "center", px: 3 }}>
                Start talking
            </Button>
        </Box>
    );
}

/** Male / female tutor voice (Q14, Q21). Applies from the tutor's next sentence. */
function VoiceToggle({ look, voice, onChange }: { look: Tier2Look; voice: TutorVoiceRole; onChange: (v: TutorVoiceRole) => void }) {
    return (
        <Box className="voice-sheet__voice-toggle" role="radiogroup" aria-label="Tutor voice" sx={{ display: "flex", border: `1px solid ${look.outline}`, borderRadius: "999px", overflow: "hidden" }}>
            {(["female", "male"] as const).map((v) => (
                <Box
                    key={v}
                    component="button"
                    type="button"
                    role="radio"
                    aria-checked={voice === v}
                    className={`voice-sheet__voice-option${voice === v ? " voice-sheet__voice-option--selected" : ""}`}
                    onClick={() => onChange(v)}
                    sx={{
                        border: "none",
                        cursor: "pointer",
                        padding: "8px 12px",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.semibold,
                        color: voice === v ? look.ink : look.muted,
                        backgroundColor: voice === v ? RAMP[VOICE_HUE].mid : look.surface,
                        touchAction: "manipulation",
                    }}
                >
                    {v === "female" ? "Female" : "Male"}
                </Box>
            ))}
        </Box>
    );
}

export default VoiceSessionSheet;
