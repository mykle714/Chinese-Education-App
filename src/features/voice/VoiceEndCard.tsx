import { Box, Button, Typography } from "@mui/material";
import { RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { VoiceSessionSummary } from "../../../server/contracts/voice";
import { formatDuration, voiceCardSx, voiceChipSx, voiceLineTextSx, voiceOverlineSx, voicePillButtonSx, VOICE_HUE } from "./voiceStyles";

/**
 * VoiceEndCard — the end-of-session card (docs/VOICE_ASSISTANT.md § 9.2). Generic layout for
 * now (owner, 2026-11-18). Every block comes from data the session already held — no extra
 * Claude call: duration + turns, words added from the transcript, up to five "better ways to
 * say it" (note_recast), and the card words the learner used.
 *
 * Layer: feature component (src/features/voice). Rendered by VoiceSessionSheet.
 */
interface VoiceEndCardProps {
    summary: VoiceSessionSummary;
    look: Tier2Look;
    onReview: () => void;
    onDone: () => void;
    /** Shown above the card when the session ended on the daily cap. */
    notice?: string | null;
}

function VoiceEndCard({ summary, look, onReview, onDone, notice }: VoiceEndCardProps) {
    const exchanges = Math.ceil(summary.turnCount / 2);
    return (
        <Box className="voice-end-card" sx={{ ...voiceCardSx(look), padding: "18px 16px", display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
            {notice && <Typography className="voice-end-card__notice" sx={voiceLineTextSx(look)}>{notice}</Typography>}
            <Box className="voice-end-card__stats" sx={{ display: "flex", gap: "24px" }}>
                <Stat look={look} value={formatDuration(summary.durationSeconds)} label="minutes" />
                <Stat look={look} value={String(exchanges)} label={exchanges === 1 ? "exchange" : "exchanges"} />
                <Stat look={look} value={String(summary.wordsAdded.length)} label="words added" />
            </Box>

            {summary.wordsAdded.length > 0 && (
                <Section look={look} title="Words added to your cards">
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {summary.wordsAdded.map((w) => <Box key={w} component="span" className="voice-end-card__added-word" sx={voiceChipSx(VOICE_HUE)}>{w}</Box>)}
                    </Box>
                </Section>
            )}

            {summary.recasts.length > 0 && (
                <Section look={look} title="Better ways to say it">
                    <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {summary.recasts.map((r, i) => (
                            <Box key={i} className="voice-end-card__recast" sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                <Typography sx={{ ...voiceLineTextSx(look), color: look.muted, fontFamily: FONTS.cjk }}>{r.learnerSaid}</Typography>
                                <Typography sx={{ ...voiceLineTextSx(look), fontFamily: FONTS.cjk, fontWeight: WEIGHT.semibold }}>→ {r.better}</Typography>
                            </Box>
                        ))}
                    </Box>
                </Section>
            )}

            {summary.cardWordsUsed.length > 0 && (
                <Section look={look} title="Card words you used">
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {summary.cardWordsUsed.map(({ word, match }) => (
                            <Box key={word} component="span" className="voice-end-card__used-word" sx={voiceChipSx(match === "learning" ? "org" : undefined)}>{word}</Box>
                        ))}
                    </Box>
                </Section>
            )}

            <Box className="voice-end-card__actions" sx={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <Button className="voice-end-card__review" onClick={onReview} sx={voicePillButtonSx(look)}>Review transcript</Button>
                <Button className="voice-end-card__done" onClick={onDone} sx={voicePillButtonSx(look, RAMP[VOICE_HUE].mid)}>Done</Button>
            </Box>
        </Box>
    );
}

function Stat({ look, value, label }: { look: Tier2Look; value: string; label: string }) {
    return (
        <Box className="voice-end-card__stat" sx={{ display: "flex", flexDirection: "column" }}>
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.bold, color: look.ink }}>{value}</Typography>
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted }}>{label}</Typography>
        </Box>
    );
}

function Section({ look, title, children }: { look: Tier2Look; title: string; children: React.ReactNode }) {
    return (
        <Box className="voice-end-card__section" sx={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: `1px solid ${look.line}`, pt: "12px" }}>
            <Typography sx={voiceOverlineSx(look)}>{title}</Typography>
            {children}
        </Box>
    );
}

export default VoiceEndCard;
