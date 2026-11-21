import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../theme/roundedEdge";
import type { Tier2Look } from "../../timeOfDay/tier2Look";

/**
 * Shared `sx` fragments for Adventures (`/adventures` list, `/adventures/:id` reader and the
 * author editor under `/adventures/:id/edit`).
 *
 * Adventures is a TIER 2 page like the Reader (docs/CYOA_FEATURE.md § 3.7,
 * docs/SHELF_REDESIGN.md § 7b): each page calls `useTier2Look()` once and passes `look`
 * down. Surfaces, hairlines and ink come from the look; pastel fills from COLORS / RAMP.
 *
 * `cyoaMutedTextSx`, `cyoaMessageSx` and `cyoaPillButtonSx` are re-exports of the shared
 * reading styles (src/reading/readerStyles.ts) — no longer copies.
 *
 * Kept out of the components so each component file exports only its component (the
 * react-refresh lint rule).
 *
 * Layer: feature styles (src/features/cyoa). Depended on by: AdventuresPage.tsx,
 * StoryPlayPage.tsx, StoryChoiceStack.tsx, StoryEndPanel.tsx, StoryEdgeTab.tsx,
 * StoryConfirmDialog.tsx, StoryEditorPage.tsx, StoryPassageRow.tsx, PassageEditorPage.tsx,
 * StoryChoiceDraftRow.tsx.
 */

/**
 * The reading surface's shared fragments (src/reading/readerStyles.ts), under the names the
 * cyoa files already use: centred loading / empty-state copy, the inline message line, and
 * the PILL button (`fill` = a ramp MID with ink text; omitted = the look's surface + ink).
 * They were copies until the engine moved to src/reading (2026-11-21, DEFERRED_WORK item 60).
 */
export {
    readerMutedTextSx as cyoaMutedTextSx,
    readerMessageSx as cyoaMessageSx,
    readerPillButtonSx as cyoaPillButtonSx,
} from "../../reading/readerStyles";

/** The choice keycap's solid lip, px — the straight lip of the Dictionary keycaps. */
export const STORY_KEY_LIP_PX = 3;

/**
 * The box-shadow of a raised STRAIGHT-LIP key on a Tier 2 page: the face's rounded edge
 * (fillet + top rim light — CLAUDE.md § Buttons & cards, src/theme/roundedEdge.ts) over a
 * `look.surfaceEdge` lip. The 1px outline is the element's own `border`.
 * Used by the choice buttons, their inspect keys and the edge tabs.
 */
export const storyKeyShadow = (look: Tier2Look, lipPx: number = STORY_KEY_LIP_PX): string =>
    lipPx > 0
        ? `${roundedEdgeRimLightTop(look.surface)}, ${roundedEdgeFilletDown(look.surface, look.surfaceEdge)}, 0 ${lipPx}px 0 ${look.surfaceEdge}`
        : roundedEdgeRimLightTop(look.surface);

// ── Editor (docs/CYOA_FEATURE.md § 5) ─────────────────────────────────────────

/** A flat card / dialog radius (= READER_CARD_RADIUS, SectionCard's 18px). */
export const CYOA_CARD_RADIUS = "18px";

/** A flat card on the look: surface, hairline, no shadow (the Reader list's skin). */
export const cyoaFlatCardSx = (look: Tier2Look) => ({
    backgroundColor: look.surface,
    border: `1px solid ${look.line}`,
    borderRadius: CYOA_CARD_RADIUS,
}) as const;

/** A small section heading above a group ("Passages", "Choices"). */
export const cyoaSectionHeadingSx = (look: Tier2Look) => ({
    fontFamily: FONTS.sans,
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.bold,
    letterSpacing: "0.02em",
    color: look.muted,
}) as const;

/**
 * A box-less one-line text field (MUI InputBase): the look's ink on a hairline underline
 * that darkens to the outline on focus — the Reader header title field's treatment.
 * `cjk` = story text (choice labels), else UI type (titles, ending names).
 */
export const cyoaFieldSx = (look: Tier2Look, { cjk = false }: { cjk?: boolean } = {}) => ({
    width: "100%",
    fontFamily: cjk ? FONTS.cjk : FONTS.sans,
    fontSize: SIZE.body,
    color: look.ink,
    borderBottom: `1px solid ${look.line}`,
    "&.Mui-focused": { borderBottomColor: look.outline },
    "& input::placeholder, & textarea::placeholder": { color: look.muted, opacity: 1 },
}) as const;

/**
 * A small status chip ("Start", "Ending", "Draft"). `fill` = a ramp MID with ink text and
 * the inset mark ring (CLAUDE.md § Buttons & cards); omitted = outline only on the look.
 */
export const cyoaChipSx = (look: Tier2Look, fill?: string) => ({
    display: "inline-flex",
    alignItems: "center",
    fontFamily: FONTS.sans,
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.semibold,
    lineHeight: LEADING.tight,
    color: fill ? COLORS.onSurface : look.ink2,
    backgroundColor: fill ?? "transparent",
    boxShadow: `inset 0 0 0 1px ${fill ? COLORS.markOutline : look.outline}`,
    borderRadius: "999px",
    px: 0.875,
    py: "2px",
    whiteSpace: "nowrap",
}) as const;
