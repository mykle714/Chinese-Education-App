import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import type { VoiceOrbState } from "../../../server/contracts/voice";

/**
 * Shared `sx` fragments and constants for the voice tutor's pages (docs/VOICE_ASSISTANT.md § 8).
 *
 * PLACEHOLDER UX (owner's decision 2026-11-18): features are laid out to be reachable, the
 * look is tuned later. Every colour still comes from the framework: the pages are Tier 2
 * (useTier2Look → surfaces/ink), fills are RAMP hues.
 *
 * Orb hues (Q12, deferred to the owner's UX pass): purple / orange / teal. Chosen to avoid
 * BOTH the utcm mastery ramp (red · yellow · green · blue) and Hydra Bubbles' charcoal/gold, so
 * the orb is never read as a mastery band.
 *
 * The pill / muted / message fragments are the shared reading styles (src/reading/readerStyles.ts),
 * re-exported under voice names, as cyoaStyles does.
 *
 * Layer: feature styles (src/features/voice).
 */
export {
    readerMutedTextSx as voiceMutedTextSx,
    readerMessageSx as voiceMessageSx,
    readerPillButtonSx as voicePillButtonSx,
} from "../../reading/readerStyles";

/** The Menu row's hue and the voice pages' accent. */
export const VOICE_HUE: RampHue = "pur";

/** One orb hue per state (see the header for why these three). */
export const ORB_HUE: Record<VoiceOrbState, RampHue> = {
    listening: "pur",
    thinking: "org",
    speaking: "tea",
};

export const ORB_LABEL: Record<VoiceOrbState, string> = {
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
};

/** A flat card on the look (the Reader list's skin). */
export const voiceCardSx = (look: Tier2Look) => ({
    backgroundColor: look.surface,
    border: `1px solid ${look.line}`,
    borderRadius: "16px",
}) as const;

/** A small overline above a group ("Past conversations", "Better ways to say it"). */
export const voiceOverlineSx = (look: Tier2Look) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.bold,
    letterSpacing: "0.02em",
    color: look.muted,
}) as const;

/** Transcript prose (English runs and plain-text fallbacks). */
export const voiceLineTextSx = (look: Tier2Look) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.body,
    lineHeight: LEADING.relaxed,
    color: look.ink,
}) as const;

/** A small word chip (new words, card words, words added). `hue` = a ramp pastel fill. */
export const voiceChipSx = (hue?: RampHue) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 8px",
    borderRadius: "999px",
    fontFamily: FONTS.cjk,
    fontSize: SIZE.caption,
    lineHeight: LEADING.tight,
    color: COLORS.onSurface,
    backgroundColor: hue ? RAMP[hue].mid : COLORS.grey,
    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
    whiteSpace: "nowrap",
}) as const;

/** Format seconds as m:ss. */
export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
