import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import Icon from "../../components/Icon";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { fetchVoiceSessions, fetchVoiceUsage, type VoiceUsage } from "../../api/voice";
import type { VoiceSessionListItem } from "../../../server/contracts/voice";
import VoiceSessionSheet from "./VoiceSessionSheet";
import { voiceReviewPath } from "./voicePaths";
import { formatDuration, voiceCardSx, voiceMutedTextSx, voiceOverlineSx, voicePillButtonSx, VOICE_HUE } from "./voiceStyles";

/**
 * VoicePage — `/voice`, the voice tutor's home (docs/VOICE_ASSISTANT.md § 8–9, Q2).
 *
 * A NODE page reached from the Menu popover's Voice Tutor row (the feature's only entry
 * point, behind FEATURE_FLAGS.voiceAssistant): keeps the footer (Menu tab lit), slides in from
 * the right, Tier 2 time-of-day look — the Adventures list's archetype.
 *
 *   - **Start talking** raises VoiceSessionSheet (the live conversation).
 *   - Today's voice time against the daily cap; a server without VOICE_AI_API_KEY / Google
 *     credentials says the tutor is unavailable instead of failing mid-start.
 *   - Past conversations, newest first; a tap opens `/voice/:sessionId` (review).
 *
 * Load effects key on `user?.id`, never `token` (CLAUDE.md ⛔ rule). Closing the sheet
 * reloads the list so the conversation just held appears.
 *
 * PLACEHOLDER UX. Layer: feature page (src/features/voice). Data: src/api/voice.ts.
 */
function VoicePage() {
    usePageTitle("Voice Tutor");
    const look = useTier2Look();
    const slideNavigate = useSlideNavigate();
    const { user } = useAuth();

    const [sessions, setSessions] = useState<VoiceSessionListItem[]>([]);
    const [usage, setUsage] = useState<VoiceUsage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        setLoading(true);
        Promise.all([fetchVoiceSessions(), fetchVoiceUsage()])
            .then(([list, use]) => {
                if (cancelled) return;
                setSessions(list);
                setUsage(use);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("VoicePage: failed to load", err);
                setError("Couldn't load your conversations. Please try again later.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity, not `token` (CLAUDE.md ⛔ rule).
    }, [user?.id, reloadKey]);

    const closeSheet = useCallback(() => {
        setSheetOpen(false);
        setReloadKey((k) => k + 1);
    }, []);

    const openReview = useCallback((sessionId: string) => {
        setSheetOpen(false);
        slideNavigate(voiceReviewPath(sessionId));
    }, [slideNavigate]);

    const capSpent = !!usage && usage.secondsUsed >= usage.secondsLimit;
    const unavailable = !!usage && !usage.available;

    return (
        <NodePage title="Voice Tutor" contentClassName="voice-page-root" surfaceColor={look.ground} headerTitleColor={look.ink}>
            <Box className="voice-page__hero" sx={{ ...voiceCardSx(look), margin: "13px 16px 0", padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <Box
                    className="voice-page__hero-mark"
                    sx={{ width: 64, height: 64, borderRadius: "50%", backgroundColor: RAMP[VOICE_HUE].mid, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                    <Icon name="graphic_eq" size={32} color={look.ink} />
                </Box>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, lineHeight: LEADING.normal, color: look.ink2, textAlign: "center" }}>
                    Practice speaking Chinese out loud. Mixing in English is fine.
                </Typography>
                <Button
                    className="voice-page__start"
                    onClick={() => setSheetOpen(true)}
                    disabled={capSpent || unavailable}
                    sx={{ ...voicePillButtonSx(look, RAMP[VOICE_HUE].mid), height: 44, px: 3, fontSize: SIZE.body }}
                >
                    Start talking
                </Button>
                {usage && (
                    <Typography className="voice-page__usage" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted }}>
                        {unavailable
                            ? usage.reason ?? "The voice tutor is unavailable right now."
                            : capSpent
                                ? "You've used today's voice time. Come back tomorrow!"
                                : `${formatDuration(usage.secondsLimit - usage.secondsUsed)} of voice time left today`}
                    </Typography>
                )}
            </Box>

            <Typography className="voice-page__history-title" sx={{ ...voiceOverlineSx(look), padding: "20px 20px 6px" }}>
                Past conversations
            </Typography>
            {loading && <Typography sx={voiceMutedTextSx(look)}>Loading…</Typography>}
            {!loading && error && <Typography sx={voiceMutedTextSx(look)}>{error}</Typography>}
            {!loading && !error && sessions.length === 0 && (
                <Typography sx={voiceMutedTextSx(look)}>No conversations yet.</Typography>
            )}
            <Box className="voice-page__history" sx={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 16px" }}>
                {sessions.map((s) => (
                    <Box
                        key={s.id}
                        component="button"
                        type="button"
                        className="voice-page__session"
                        onClick={() => slideNavigate(voiceReviewPath(s.id))}
                        sx={{ ...voiceCardSx(look), padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit", touchAction: "manipulation" }}
                    >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.body, fontWeight: WEIGHT.medium, color: look.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.preview ?? "(no speech)"}
                            </Typography>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted }}>
                                {new Date(s.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                {" · "}{formatDuration(s.durationSeconds)}
                            </Typography>
                        </Box>
                        <Icon name="chevron_right" size={20} color={look.muted} />
                    </Box>
                ))}
            </Box>
            <FooterSpacer />

            <VoiceSessionSheet open={sheetOpen} look={look} onClose={closeSheet} onReview={openReview} />
        </NodePage>
    );
}

export default VoicePage;
