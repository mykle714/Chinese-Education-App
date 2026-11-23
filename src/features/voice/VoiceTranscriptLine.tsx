import { Box, IconButton, Typography } from "@mui/material";
import LongDefinitionDisplay from "../../components/LongDefinitionDisplay";
import Icon from "../../components/Icon";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { LongDefinitionPart } from "../../types";
import type { VoiceRecast, VoiceWordMatch } from "../../../server/contracts/voice";
import { voiceChipSx, voiceLineTextSx, voiceOverlineSx } from "./voiceStyles";

/**
 * One transcript line, live or saved (docs/VOICE_ASSISTANT.md § 8, § 9).
 *
 *   - The text renders as cpcd for its Chinese runs (LongDefinitionDisplay over the server's
 *     gsa parts), and any word can be tapped → its eip → Add (`onWordOpen`).
 *   - A tutor line with a recast shows the "better way to say it" and the recast's NEW words
 *     as purple chips, so the words the tutor introduced are easy to find.
 *   - A learner line lists the card words it used: known = a neutral grey chip, learning = an
 *     orange chip. Deliberately NOT the utcm hues (red/yellow/green/blue), which mean a
 *     mastery band.
 *   - Words the STT was unsure of are listed so a mishearing is not taken for a learner error
 *     (no data with chirp_3 today — it reports no word confidence).
 *   - `onListen` (review page) adds a speaker button that replays the line in the tutor's voice.
 *
 * Layer: feature component (src/features/voice). Rendered by VoiceSessionSheet and VoiceReviewPage.
 */
interface VoiceTranscriptLineProps {
    role: "user" | "assistant";
    text: string;
    parts: LongDefinitionPart[] | null;
    matches?: Record<string, VoiceWordMatch>;
    recast?: VoiceRecast | null;
    recastParts?: LongDefinitionPart[] | null;
    lowConfidenceWords?: string[];
    partial?: boolean;
    interrupted?: boolean;
    look: Tier2Look;
    onWordOpen?: (word: string) => void;
    onListen?: (text: string) => void;
}

function VoiceTranscriptLine({
    role,
    text,
    parts,
    matches,
    recast,
    recastParts,
    lowConfidenceWords,
    partial,
    interrupted,
    look,
    onWordOpen,
    onListen,
}: VoiceTranscriptLineProps) {
    const isUser = role === "user";
    const usedCardWords = isUser && matches ? Object.entries(matches) : [];
    return (
        <Box
            className={`voice-line voice-line--${role}${partial ? " voice-line--partial" : ""}`}
            sx={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: "4px" }}
        >
            <Typography className="voice-line__speaker" sx={{ ...voiceOverlineSx(look), px: "4px" }}>
                {isUser ? "You" : "Tutor"}
                {interrupted ? " · interrupted" : ""}
            </Typography>
            <Box
                className="voice-line__bubble"
                sx={{
                    maxWidth: "92%",
                    padding: "8px 12px",
                    borderRadius: "14px",
                    backgroundColor: isUser ? look.well : look.surface,
                    border: `1px solid ${look.line}`,
                    opacity: partial ? 0.6 : 1,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "6px",
                }}
            >
                <Box className="voice-line__text" sx={{ minWidth: 0, flex: 1 }}>
                    {partial || !parts?.length ? (
                        <Typography sx={voiceLineTextSx(look)}>{text || "…"}</Typography>
                    ) : (
                        <LongDefinitionDisplay
                            longDefinition={text}
                            longDefinitionParts={parts}
                            showPinyin
                            showPinyinColor
                            onSegmentOpen={onWordOpen}
                            sx={voiceLineTextSx(look)}
                        />
                    )}
                </Box>
                {onListen && text && (
                    <IconButton
                        className="voice-line__listen"
                        aria-label="Listen"
                        size="small"
                        onClick={() => onListen(text)}
                        sx={{ border: `1px solid ${look.outline}`, width: 30, height: 30, flexShrink: 0 }}
                    >
                        <Icon name="volume_up" size={18} color={look.ink2} />
                    </IconButton>
                )}
            </Box>

            {recast && (
                <Box className="voice-line__recast" sx={{ maxWidth: "92%", display: "flex", flexDirection: "column", gap: "4px", px: "4px" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Typography className="voice-line__recast-label" sx={voiceOverlineSx(look)}>Better way to say it</Typography>
                        {onListen && (
                            <IconButton
                                className="voice-line__recast-listen"
                                aria-label="Listen to the better version"
                                size="small"
                                onClick={() => onListen(recast.better)}
                                sx={{ border: `1px solid ${look.outline}`, width: 26, height: 26 }}
                            >
                                <Icon name="volume_up" size={16} color={look.ink2} />
                            </IconButton>
                        )}
                    </Box>
                    {recastParts?.length ? (
                        <LongDefinitionDisplay
                            longDefinition={recast.better}
                            longDefinitionParts={recastParts}
                            showPinyin
                            showPinyinColor
                            onSegmentOpen={onWordOpen}
                            sx={voiceLineTextSx(look)}
                        />
                    ) : (
                        <Typography sx={voiceLineTextSx(look)}>{recast.better}</Typography>
                    )}
                    {recast.newWords.length > 0 && (
                        <Box className="voice-line__new-words" sx={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                            <Typography sx={voiceOverlineSx(look)}>New:</Typography>
                            {recast.newWords.map((w) => (
                                <Box
                                    key={w}
                                    component="button"
                                    type="button"
                                    className="voice-line__new-word"
                                    onClick={() => onWordOpen?.(w)}
                                    sx={{ ...voiceChipSx("pur"), border: "none", cursor: "pointer" }}
                                >
                                    {w}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            )}

            {usedCardWords.length > 0 && (
                <Box className="voice-line__card-words" sx={{ display: "flex", flexWrap: "wrap", gap: "4px", justifyContent: "flex-end", px: "4px" }}>
                    {usedCardWords.map(([w, m]) => (
                        <Box key={w} component="span" className={`voice-line__card-word voice-line__card-word--${m}`} sx={voiceChipSx(m === "learning" ? "org" : undefined)}>
                            {w}
                        </Box>
                    ))}
                </Box>
            )}

            {lowConfidenceWords && lowConfidenceWords.length > 0 && (
                <Typography className="voice-line__unsure" sx={{ ...voiceOverlineSx(look), px: "4px" }}>
                    Not sure I heard: {lowConfidenceWords.join("、")}
                </Typography>
            )}
        </Box>
    );
}

export default VoiceTranscriptLine;
