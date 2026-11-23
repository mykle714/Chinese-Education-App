import { Box, Typography } from "@mui/material";
import { keyframes } from "@mui/system";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { VoiceOrbState } from "../../../server/contracts/voice";
import { ORB_HUE, ORB_LABEL } from "./voiceStyles";

/**
 * VoiceOrb — the one orb in three states (docs/VOICE_ASSISTANT.md § 1, § 8): listening /
 * thinking / speaking, each its own ramp hue (voiceStyles → ORB_HUE) and motion — a slow
 * breathe while listening, a quick pulse while thinking, a wide swell while speaking.
 * Placeholder visuals; the owner tunes them in the UX pass (Q12).
 *
 * Layer: feature component (src/features/voice). Rendered by VoiceSessionSheet.
 */
const breathe = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`;
const pulse = keyframes`
  0%, 100% { transform: scale(0.94); opacity: 0.85; }
  50% { transform: scale(1.0); opacity: 1; }
`;
const swell = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
`;

const MOTION: Record<VoiceOrbState, string> = {
    listening: `${breathe} 2.8s ease-in-out infinite`,
    thinking: `${pulse} 0.9s ease-in-out infinite`,
    speaking: `${swell} 1.1s ease-in-out infinite`,
};

interface VoiceOrbProps {
    state: VoiceOrbState;
    look: Tier2Look;
    /** Muted mic: the orb dims and says so. */
    muted?: boolean;
    size?: number;
}

function VoiceOrb({ state, look, muted = false, size = 168 }: VoiceOrbProps) {
    const hue = RAMP[ORB_HUE[state]];
    return (
        <Box className="voice-orb" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
            <Box
                className={`voice-orb__ball voice-orb__ball--${state}`}
                sx={{
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 30%, ${hue.tint} 0%, ${hue.mid} 55%, ${hue.mark} 100%)`,
                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                    animation: muted ? "none" : MOTION[state],
                    opacity: muted ? 0.45 : 1,
                    transition: "background 300ms ease, opacity 200ms ease",
                }}
            />
            <Typography
                className="voice-orb__label"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: look.ink2 }}
            >
                {muted ? "Mic muted" : ORB_LABEL[state]}
            </Typography>
        </Box>
    );
}

export default VoiceOrb;
