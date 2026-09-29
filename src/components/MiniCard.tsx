import { forwardRef, type ReactNode } from "react";
import { Box, Typography, useTheme, type BoxProps } from "@mui/material";
import ForeignText from "./ForeignText";
import { iconImageUrl } from "../cardIcons/cardIconLayout";
import { masteryWindowCells, PBH_FULL, BAR_LABELS, MARK_TYPE_LABELS, type MasteryBar } from "../utils/masteryCompute";
import { getBandMark } from "../utils/categoryColors";
import type { Language } from "../types";
import { COLORS } from "../theme/colors";
import { SIZE, WEIGHT } from "../theme/scale";
import { SHADOW } from "../theme/shadows";
import { miniCardFaceSx, type MiniCardSize } from "./miniCardFace";

/**
 * THE mini preview card — the one 92×132 "here is a word" tile every surface draws
 * (plus a 78×112 `compact` face the scp dock alone falls back to — see `size`).
 *
 * Rendered by `MiniVocabCard` (fdp panel, collections, search — driven by a saved
 * `VocabEntry`), `QuickMarkCard` (Quick Mark triage — a `DiscoverCard`),
 * `ChallengeWordCard` (the challenge word set — a `ChallengeReviewWord`) and the scp's
 * `DraggableCard` (`SortCardsPage.tsx` — a `DiscoverCard`). Those wrappers differ only
 * in their data source, the overlays they add (`children`), and what a tap or drag does.
 * The tile AND its contents — icon slot, word, definition, mastery strip — live here, so
 * a change reaches all four at once.
 *
 * History: the face was first written three times and drifted (only one copy kept the
 * hairline ring); `miniCardFace.ts` then unified the TILE, but each card still
 * re-declared its contents, and the scp card had never adopted either — it was a 102×150
 * flex-column card with a 44px icon. This component is the second half of that fix.
 *
 * Layering: presentation only (src/components). It takes plain display values, never a
 * domain object, so no card wrapper's type leaks into it.
 *
 * Referenced by docs/DECKS_FEATURE.md (card previews), docs/QUICK_MARK.md,
 * docs/STUDY_CHALLENGE.md § 3.2, docs/SORT_CARDS_REQUIREMENTS.md and
 * docs/MASTERY_REWORK.md § "Mini cards" (the strip).
 */
export interface MiniCardProps extends Omit<BoxProps, "children"> {
    /** Optional to match ForeignText (a legacy VocabEntry may lack it; it then falls back). */
    language?: Language;
    /** The headword, rendered through ForeignText (cpcd for zh, plain text for es). */
    entryKey: string;
    pronunciation?: string | null;
    /** The display definition, already resolved/cleaned by the caller. */
    definition: string;
    /** A single default-placed icon, drawn in the fixed icon slot. */
    iconId?: string | null;
    /**
     * A full-card custom icon arrangement drawn BEHIND the text (MiniVocabCard's
     * advanced layouts). When given, `iconId` is ignored — the layer already has it.
     */
    iconLayer?: ReactNode;
    /** Tile fill. Defaults to the theme's card face (`palette.flashcard.flashCard`). */
    background?: string;
    /** Per-card Contrast text colors (migration 89). Undefined = theme default. */
    characterColor?: string;
    definitionColor?: string;
    /** Step the elevation on hover — only for a card whose tap OPENS something. */
    hoverLift?: boolean;
    /** Staggered pop-in on mount; the grid passes `index * step`. */
    animationDelayMs?: number;
    /**
     * The bottom mastery window strip, for the lens bar the caller computed. Omit (or
     * null) to draw no strip — and to give its reserved height back to the definition.
     * Only a card that REPORTS the learner's standing passes one (MiniVocabCard on a
     * deck surface); preview/triage/sort cards opt out by omission.
     */
    masteryBar?: MasteryBar | null;
    /**
     * The face's footprint — `regular` (92×132, every surface) or `compact` (78×112,
     * only the scp dock when a 4-card pack won't fit across). See MINI_CARD_DIMENSIONS
     * in miniCardFace.ts; the contents re-lay per size via CONTENT_LAYOUT below.
     */
    size?: MiniCardSize;
    /** Absolutely-positioned overlays: corner badges, action buttons, stamps. */
    children?: ReactNode;
}

// ── Content layout per face size ─────────────────────────────────────────────────
// Where the icon slot, the word and the definition sit, and at what type size. The
// `regular` column is the original 92×132 layout, unchanged. `compact` (78×112) is a
// genuine re-layout rather than a scaled copy: every offset shrinks roughly with the
// card (~0.85×), and the type steps down ONE notch on the existing scales — the cpcd
// switches to its own `compact` variant (16px glyphs / 9px pinyin at `xs`), es plain
// text 14 → 12px, and the definition SIZE.body → SIZE.caption — so no new font sizes
// are introduced. Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 4.5 ("Compact dock").
const CONTENT_LAYOUT: Record<MiniCardSize, {
    sideInset: number;
    iconTop: number;
    iconSize: number;
    keyTop: number;
    cpcdCompact: boolean;
    plainFontSize: string;
    definitionFontSize: string;
    definitionMinHeight: number;
}> = {
    regular: { sideInset: 8, iconTop: 14, iconSize: 26, keyTop: 46, cpcdCompact: false, plainFontSize: "14px", definitionFontSize: SIZE.body, definitionMinHeight: 24 },
    compact: { sideInset: 6, iconTop: 11, iconSize: 22, keyTop: 38, cpcdCompact: true, plainFontSize: "12px", definitionFontSize: SIZE.caption, definitionMinHeight: 20 },
};

// ── Mastery window strip (docs/MASTERY_REWORK.md § "Mini cards") ────────────────
// The cdp's eight-mark window (`MasteryWindow`, the design's `.msb .cells`) shrunk to a
// hairline along the bottom of the card: **`PBH_FULL` discrete cells, one per mark**, for
// the surface's lens bar. Same shape, same `masteryWindowCells` geometry, same partial
// trailing cell — so a learner who has read the cdp already knows how to read this.
//
// Cells rather than a continuous fill because pbh IS a count, not a percentage. One bad
// mark turns a cell off; it does not drain a fraction of a tank. The thumbnail should not
// invite an estimate the detail page spent a whole component refusing to invite.
//
// COLOR is the lens bar's utcm band in the MARK tier (`getBandMark`), one hue for every
// filled cell — the same rule and the same colour as the cdp window: "mastery bars are
// colored by mastery progress, not the mark type" (2026-09-23). The per-type split
// survives in the tooltip.
//
// No small-size variant any more. Target used to take a deeper `--yelMkD` here because
// full-strength `--yelMk` dissolved into the cream face at 3.5px; the 2026-09-28 darkening
// of the whole Mark tier (5% L) made `--yelMk` itself that deep, so the strip and the cdp
// now paint identical hexes. The Mark tier is saturated enough to need no `markOutline`
// ring (the design draws these `box-shadow:none`), which is what a 3.5px cell needs.
//
// LINEAGE. Frame 17 draws this strip as cells in the MARK tier; only the strip's
// PLACEMENT (full width, 8px inset, bottom of the card) and its hue rule are the frame's.
const BAR_STRIP = {
    height: 3.5,      // v2 frame 17's hairline (`.mcd .mk`, was 3)
    cellGap: 1.5,     // the cdp's 3px gap does not survive the scale down; half of it does
    inset: 8,         // left AND right — the window spans the card
    bottom: 8,
};

/** How far (px) the definition sits below its natural anchor — see `definitionBottom`. */
const DEFINITION_DROP = 2;
/**
 * Extra bottom padding (px) inside the definition's clip box, so descenders (g, y, p)
 * on the last line are not cut off. At `lineHeight: 1.05` a glyph's descender reaches
 * ~1px past its line box, and `overflow: hidden` (required by the line clamp) clips at
 * the padding edge. The box's `bottom` is lowered by the same amount, so the text itself
 * does not move. Kept at 2px on purpose: a clamped THIRD line starts right below the
 * second, and its ascenders sit ~2px under that line's top, so more padding than this
 * would let the hidden line peek through.
 */
const DEFINITION_DESCENDER_ROOM = 2;

const MasteryStrip: React.FC<{ bar: MasteryBar }> = ({ bar }) => {
    // The same eight-cell geometry the cdp window draws, from the same helper — the two
    // surfaces must not drift on where the partial cell falls.
    const cells = masteryWindowCells(bar);
    const bandMark = getBandMark(bar.category);
    // The per-mark-type split the cells no longer show, kept on hover: "Know 4.3/8 ·
    // Comfortable · Recognition 5, Production 2". One shared `title` rather than one per
    // cell — eight native tooltips along a 3px strip would fight each other.
    const stripTitle =
        `${BAR_LABELS[bar.id]} ${Number.isInteger(bar.pbh) ? bar.pbh : bar.pbh.toFixed(1)}/${PBH_FULL} · ${bar.category}` +
        ` · ${bar.segments.map((seg) => `${MARK_TYPE_LABELS[seg.type]} ${seg.positive}`).join(", ")}`;
    return (
        <Box
            className="mini-card__mastery-window"
            title={stripTitle}
            sx={{
                position: "absolute",
                bottom: BAR_STRIP.bottom,
                left: BAR_STRIP.inset,
                right: BAR_STRIP.inset,
                display: "flex",
                gap: `${BAR_STRIP.cellGap}px`,
                zIndex: 1,
            }}
        >
            {cells.map((cell, i) => (
                <Box
                    key={i}
                    className={`mini-card__mastery-cell${cell.fill > 0 ? " mini-card__mastery-cell--filled" : ""}`}
                    sx={{
                        // Equal share of the row, so the eight cells always span the card
                        // whatever its width — no pixel math to keep in step with 92px.
                        flex: 1,
                        height: BAR_STRIP.height,
                        borderRadius: BAR_STRIP.height / 2,
                        // Frame 17's empty-track tint, `.mcd .mk i{background:var(--outline)}`.
                        // Deliberately NOT the cdp's 6% fill + 12% inset ring: at 3.5px
                        // tall that ring would be most of the cell.
                        backgroundColor: COLORS.markOutline,
                        overflow: "hidden",
                    }}
                >
                    {/* A partial trailing cell is rendered partial, not rounded — rounding
                        would make two genuinely different cards read the same. Every
                        filled cell takes the band's mark colour; `cell.type` is
                        deliberately unused (the cdp window does the same). */}
                    {cell.fill > 0 && (
                        <Box
                            className="mini-card__mastery-cell-fill"
                            sx={{
                                width: `${cell.fill * 100}%`,
                                height: "100%",
                                backgroundColor: bandMark,
                                // Color transitions too: crossing a band boundary should
                                // read as the strip changing state, not one more cell.
                                transition: "width 240ms ease, background-color 240ms ease",
                            }}
                        />
                    )}
                </Box>
            ))}
        </Box>
    );
};

/**
 * forwardRef so the scp can wrap it in react-spring's `animated()` (which drives the
 * drag transform through a ref to the DOM node) and so drag handlers / ButtonBase props
 * spread through `...rest` onto the root.
 */
const MiniCard = forwardRef<HTMLDivElement, MiniCardProps>(function MiniCard(
    {
        language,
        entryKey,
        pronunciation,
        definition,
        iconId,
        iconLayer,
        background,
        characterColor,
        definitionColor,
        hoverLift = false,
        animationDelayMs,
        masteryBar,
        size = "regular",
        children,
        className,
        sx,
        ...rest
    },
    ref,
) {
    const fc = useTheme().palette.flashcard;
    const layout = CONTENT_LAYOUT[size];
    // The definition sits just above the strip when there is one, and in the strip's
    // place when there isn't — suppressing the strip lets the card breathe.
    // `DEFINITION_DROP` nudges the whole block 2px lower than that baseline: the
    // definition grows UPWARD from this anchor, so a two-line gloss otherwise crowds
    // the cpcd row above it (2026-09-28).
    const definitionBottom = BAR_STRIP.bottom + (masteryBar ? BAR_STRIP.height + 5 : 0) - DEFINITION_DROP;
    return (
        <Box
            ref={ref}
            className={className ? `mini-card ${className}` : "mini-card"}
            {...rest}
            sx={[
                // Tile: size, radius, hairline ring, elevation, containment, pop-in.
                miniCardFaceSx({ background: background ?? fc.flashCard, hoverLift, animationDelayMs, size }),
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {/* Advanced icon arrangement, BEHIND the text (the layer sets zIndex 0; the
                word/definition below are lifted to zIndex 1). */}
            {iconLayer}

            {/* Icon slot — fixed position/height, always rendered (empty without an icon)
                so every mini card reserves identical space and the word sits at the same
                height. Absolute, so nudging it never cascades into the text below. */}
            <Box
                className="mini-card__icon-slot"
                sx={{ position: "absolute", top: layout.iconTop, left: layout.sideInset, right: layout.sideInset, height: layout.iconSize, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}
            >
                {!iconLayer && iconId && (
                    <Box
                        component="img"
                        className="mini-card__icon"
                        src={iconImageUrl(iconId)}
                        alt=""
                        draggable={false}
                        sx={{ width: layout.iconSize, height: layout.iconSize, objectFit: "contain", userSelect: "none", pointerEvents: "none" }}
                    />
                )}
            </Box>

            {/* Word + pronunciation. Foreign text ALWAYS goes through ForeignText, which
                picks cpcd vs plain Latin text per language. Items wrap so multi-character
                phrases reflow within the ~76px body. */}
            <Box
                className="mini-card__key-wrapper"
                sx={{ position: "absolute", top: layout.keyTop, left: layout.sideInset, right: layout.sideInset, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, zIndex: 1 }}
            >
                <ForeignText
                    className="mini-card__entry-key"
                    language={language}
                    size="xs"
                    compact={layout.cpcdCompact}
                    bold
                    flexWrap="wrap"
                    justifyContent="center"
                    text={entryKey}
                    pronunciation={pronunciation ?? undefined}
                    characterColor={characterColor}
                    // Latin-script (es) only: a Spanish headword is many glyphs wide where a
                    // Chinese one is 1–2, so the shared xs size (18px) overruns the 76px
                    // body. zh ignores this. (Only MiniVocabCard used to pass it, so Quick
                    // Mark / challenge / sort cards overran on long es words.)
                    plainFontSize={layout.plainFontSize}
                />
            </Box>

            {/* Definition — anchored to the bottom (clear of the strip when present),
                clamped to 2 lines, independent of the icon slot / word above. */}
            <Typography
                className="mini-card__definition"
                sx={{
                    position: "absolute",
                    bottom: definitionBottom - DEFINITION_DESCENDER_ROOM,
                    paddingBottom: `${DEFINITION_DESCENDER_ROOM}px`,
                    left: layout.sideInset,
                    right: layout.sideInset,
                    fontSize: layout.definitionFontSize,
                    color: definitionColor ?? COLORS.textSecondary,
                    textAlign: "center",
                    // Tighter than the 1.2 it used to be: at 14px the two-line clamp
                    // stood ~34px tall and its top line crowded the cpcd row. 1.05
                    // keeps the two lines distinct while buying back ~2px of headroom.
                    lineHeight: 1.05,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    minHeight: layout.definitionMinHeight,
                    zIndex: 1,
                }}
            >
                {definition}
            </Typography>

            {masteryBar && <MasteryStrip bar={masteryBar} />}

            {children}
        </Box>
    );
});

export default MiniCard;

/**
 * The conversation-frequency corner badge (1 = almost never spoken … 5 = constant in
 * daily speech) — top-left, 18px circle. Shared by QuickMarkCard and ChallengeWordCard,
 * which used to each declare it. Renders nothing for a null score (five hollow dots —
 * or a "0" — would read as a real value).
 */
export const MiniCardFrequencyBadge: React.FC<{ score: number | null | undefined; className?: string }> = ({ score, className }) => {
    if (score == null) return null;
    return (
        <Box
            className={className ? `mini-card__frequency-badge ${className}` : "mini-card__frequency-badge"}
            aria-label={`conversation frequency ${score} of 5`}
            sx={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 2,
                width: 18,
                height: 18,
                borderRadius: "50%",
                backgroundColor: COLORS.onSurface,
                color: COLORS.white,
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.bold,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: SHADOW.rest,
            }}
        >
            {score}
        </Box>
    );
};
