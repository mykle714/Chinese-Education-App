import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "../Icon";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * THE BOARD — the shelf system's ranked-table primitive (docs/SHELF_REDESIGN.md § A7,
 * classes `.bd`, `.bd .r`, `.bd .zone`).
 *
 * ── WHY THIS IS A COMPONENT AND NOT A RESTYLE ────────────────────────────────────────
 * The app had ranked lists written from scratch in three unrelated places — the arena
 * board, the tester dashboard's leaderboard, and the friends velocity table — and no two
 * agreed on what a rank chip was, whether the viewer's own row was filled or outlined, or
 * how a score was set. This is the one A7 widget where the redesign is DEDUPE first and
 * a new skin second.
 *
 * ── A BOARD IS ONE CARD, NOT A STACK OF CARDS ────────────────────────────────────────
 * That is the whole shape decision. Separate rounded rows with gaps between them say
 * "these are N things"; a single outlined card with hairlines between its rows says
 * "this is ONE table and the rows are ranked against each other" — which is the only
 * thing a leaderboard is for. It is also what makes a `BoardZone` legible: a divider
 * can only cut across something continuous.
 *
 * ── WHAT A ROW MAY SHOW IS SOMETIMES A PRIVACY DECISION ──────────────────────────────
 * The five slots below (`rank`, `name`, `sublabel`, `meter`, `score`) are the whole
 * vocabulary, and that is deliberate. Arena in particular puts a learner in front of 24
 * strangers they did not choose and cannot leave, so adding a field to this component
 * means reopening docs/ARENA_FEATURE.md Q20, not adjusting a layout. If one board needs a
 * sixth slot, give that board its own row rather than widening this one for everybody.
 *
 * Sibling primitives: `Row` / `RowList` (src/components/primitives) — use those for a
 * list of ENTITIES, this for a list of RANKS.
 */

// ── The board ────────────────────────────────────────────────────────────────────────

export interface BoardProps {
    /** `BoardRow`s and `BoardZone`s, in rank order. */
    children: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

/** `.bd` — the card every row and zone divider lives inside. */
export const Board: React.FC<BoardProps> = ({ children, className, sx }) => (
    <Box
        className={className ? `board ${className}` : "board"}
        sx={[
            {
                margin: "9px 18px 0",
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
                borderRadius: "18px",
                // Clips the first and last row's tint to the card's radius. Without it a
                // tinted top row paints square corners over the rounded border.
                overflow: "hidden",
                // Separators live HERE, not on the row.
                //
                // The obvious spelling is `"& + &::before"` inside BoardRow's own `sx` —
                // and it silently half-works: `&` compiles to that row's generated class,
                // so the rule only ever matches two ADJACENT rows whose sx is byte-identical.
                // The viewer's row and any zone-tinted row get different classes, so exactly
                // the separators around the most important rows on the board would go
                // missing. Matching on the stable BEM class from the parent has no such hole.
                "& .board__row + .board__row::before": {
                    content: '""',
                    position: "absolute",
                    left: "13px",
                    right: "13px",
                    top: 0,
                    height: "1px",
                    backgroundColor: COLORS.rowBorder,
                },
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {children}
    </Box>
);

// ── Rows ─────────────────────────────────────────────────────────────────────────────

/**
 * Which promotion band a row sits in. `promote` / `relegate` tint the row; `hold` — the
 * middle of the table — is deliberately untinted, because tinting every row would make
 * the tint carry no information, and the middle is exactly where a competitor needs to
 * read "nothing happens to me this week".
 */
export type BoardZoneTone = "promote" | "relegate" | "hold";

const ZONE_ROW_BG: Record<BoardZoneTone, string | undefined> = {
    promote: COLORS.zoneUpRow,
    relegate: COLORS.zoneDownRow,
    hold: undefined,
};

export interface BoardRowProps {
    /** 1-based position. Set in mono at a fixed width so the column stays straight. */
    rank: number;
    name: React.ReactNode;
    /** Small line under the name — a language, a division, a timestamp, a message. */
    sublabel?: React.ReactNode;
    /**
     * How that line is SET, which follows what it is:
     *   `"meta"`  (default) mono 9.5, faint — a machine fact next to a name: a language
     *             code, a division number, a timestamp.
     *   `"prose"` sans 11.5, secondary ink — a sentence a PERSON wrote. Mono at 9.5 is a
     *             caption face; running a written line through it makes the competitor's
     *             own words read like a data field, and at that size it barely reads at all.
     */
    sublabelVariant?: "meta" | "prose";
    /**
     * A 0…1 bar in the row's meter column. Omit for boards where the score is the
     * whole story; a meter earns its 74px only when rows are compared at a glance.
     */
    meter?: number;
    /** The ranked figure. Set in mono; formatting (thousands, units) is the caller's. */
    score?: React.ReactNode;
    /**
     * A Material Symbols glyph drawn immediately before `score`, naming the UNIT the
     * figure is in. Not a sixth slot: it says nothing about the competitor, only what
     * the number already shown means.
     *
     * Worth its 13px when the board's currency is a thing the app draws elsewhere —
     * the arena's minutes are the flame from the minute-points badge, so the column
     * reads as "the same points I watch tick up" without a word of caption.
     */
    scoreIcon?: string;
    /** Colour for `scoreIcon`. Defaults to the score's own ink. */
    scoreIconColor?: string;
    /**
     * "This row is you". Filled with the org pastel rather than outlined, so it reads
     * even when it also sits in a tinted zone.
     *
     * No `markOutline`: this is the fill-vs-ink rule's large-and-occupied exception — a
     * full-width row carrying text, inside an already-bordered card with hairlines above
     * and below it. A ring here would be a third line in the same 40px.
     */
    highlighted?: boolean;
    /** Promotion band. Ignored when `highlighted` — the viewer's own tint wins. */
    zone?: BoardZoneTone;
    className?: string;
}

/** `.bd .r` — one ranked competitor. */
export const BoardRow: React.FC<BoardRowProps> = ({
    rank,
    name,
    sublabel,
    sublabelVariant = "meta",
    meter,
    score,
    scoreIcon,
    scoreIconColor,
    highlighted = false,
    zone = "hold",
    className,
}) => (
    <Box
        className={className ? `board__row ${className}` : "board__row"}
        sx={{
            display: "flex",
            alignItems: "center",
            gap: "11px",
            padding: "9px 13px",
            position: "relative",
            backgroundColor: highlighted ? RAMP.org.fill : ZONE_ROW_BG[zone],
            // `position: relative` is load-bearing: the separator the PARENT draws is a
            // ::before on this element (see Board), and it is absolutely positioned.
        }}
    >
        <Typography
            className="board__rank"
            sx={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                width: 17,
                flexShrink: 0,
                // Darkened on the viewer's own row: the muted grey that reads fine on
                // white is too light on the org pastel.
                color: highlighted ? COLORS.onSurface : COLORS.textSecondary,
            }}
        >
            {rank}
        </Typography>

        <Box className="board__text" sx={{ flex: 1, minWidth: 0 }}>
            <Typography
                className="board__name"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: 13.5,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: COLORS.onSurface,
                    // A long display name must never push the score off the row.
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {name}
            </Typography>
            {sublabel !== undefined && (
                <Typography
                    className="board__sublabel"
                    sx={{
                        ...(sublabelVariant === "prose"
                            ? { fontFamily: FONTS.sans, fontSize: 11.5, color: COLORS.textSecondary }
                            : { fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.textFaint }),
                        marginTop: "1px",
                        // One line, always. The board's whole legibility rests on every row
                        // being the same height, and this slot now carries text the user
                        // types — a two-line message would push every rank below it down.
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {sublabel}
                </Typography>
            )}
        </Box>

        {meter !== undefined && (
            <Box className="board__meter" sx={{ width: 74, flexShrink: 0 }}>
                <Box
                    className="board__meter-fill"
                    sx={{
                        display: "block",
                        height: "4px",
                        borderRadius: "3px",
                        backgroundColor: COLORS.iconColor,
                        width: `${Math.min(1, Math.max(0, meter)) * 100}%`,
                    }}
                />
            </Box>
        )}

        {score !== undefined && (
            <Typography
                className="board__score"
                sx={{
                    // Flex so an optional unit glyph can sit against the figure. With no
                    // icon this is a single text run and behaves exactly as a block would.
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "3px",
                    fontFamily: FONTS.mono,
                    fontSize: 11.5,
                    // The artboard fixes this at 34px, which is right for a figure that
                    // stays small (arena minutes reset weekly) and clips one that does not
                    // (a lifetime points total is five or six digits). `minWidth` keeps the
                    // column aligned for the common case and lets the rare wide figure push.
                    minWidth: 34,
                    textAlign: "right",
                    flexShrink: 0,
                    color: COLORS.onSurface,
                }}
            >
                {scoreIcon && <Icon name={scoreIcon} size={13} color={scoreIconColor ?? COLORS.onSurface} fill={1} />}
                {score}
            </Typography>
        )}
    </Box>
);

// ── Zone dividers ────────────────────────────────────────────────────────────────────

export interface BoardZoneProps {
    /** Short mono caption — "promotion", "relegation", "the cut". */
    label: React.ReactNode;
    /** Which band starts BELOW this divider. `hold` is the neutral grey rule. */
    tone?: BoardZoneTone;
    className?: string;
}

/**
 * Colours for a divider: its ground, its caption, and its rule.
 *
 * ⚠️ DEPARTURE FROM THE ARTBOARD, and a deliberate one. The design writes these captions
 * as `#0B5C46` and `#7A1024` — two dark hexes that belong to no ramp entry and exist
 * nowhere else in the stylesheet. Minting two off-ramp colours for two words of caption
 * is how a palette starts leaking, so this uses `RAMP.grn.ink` / `RAMP.red.ink` on the
 * matching pastels instead. The result is a step lighter than the artboard and still
 * clears 4.5:1. Revisit if the arena's zones ever need to shout louder than the rest of
 * the app's semantic green and red.
 */
const ZONE_DIVIDER: Record<
    BoardZoneTone,
    { bg: string; ink: string; rule: string; arrow: string | null }
> = {
    promote: { bg: RAMP.grn.fill, ink: RAMP.grn.ink, rule: "rgba(56, 125, 61, 0.32)", arrow: "arrow_upward" },
    relegate: { bg: RAMP.red.fill, ink: RAMP.red.ink, rule: "rgba(181, 66, 73, 0.30)", arrow: "arrow_downward" },
    // No arrow on the neutral rule: `hold` is the absence of a direction, and an arrow
    // that pointed nowhere would be the one piece of this divider a reader had to decode.
    hold: { bg: COLORS.background, ink: COLORS.textSecondary, rule: COLORS.wood, arrow: null },
};

/**
 * `.bd .zone` — the line across the table where something changes.
 *
 * A caption plus a rule, not a caption on its own: the rule is what turns "promotion"
 * from a label into a THRESHOLD, and a competitor's whole reading of the board is "which
 * side of that line am I on".
 *
 * ── THE ARROWS FLANK THE CAPTION, AND THEY ARE THE POINT ─────────────────────────────
 * A caption alone says WHAT the line is; the arrows say WHICH WAY IT MOVES YOU. That is
 * the fact a competitor is actually reading the board for, and it survives at a glance
 * when the word does not — the two dividers are a green rule with arrows pointing up and
 * a red rule with arrows pointing down, which is legible before anyone has read a
 * character. Both sides of the caption are flanked, so the pair reads as a direction the
 * whole ROW carries rather than as a bullet attached to the word.
 *
 * They are real Material Symbols glyphs, not literal `^` / `v` characters: a caret is a
 * circumflex sitting on the type baseline and a "v" is a letter, so both would read as
 * text next to the caption instead of as an indicator beside it.
 */
export const BoardZone: React.FC<BoardZoneProps> = ({ label, tone = "hold", className }) => {
    const { bg, ink, rule, arrow } = ZONE_DIVIDER[tone];
    // 13px against a 9.5px caption: the glyph's drawn height is well under its font size,
    // so matching the two numbers would render an arrow visibly smaller than the letters
    // it is meant to lead.
    const indicator = arrow ? <Icon name={arrow} size={13} color={ink} weight={600} /> : null;
    return (
        <Box
            className={className ? `board__zone ${className}` : "board__zone"}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "7px 13px",
                backgroundColor: bg,
            }}
        >
            <Box
                className="board__zone-caption"
                // Tighter than the row gap: the arrows belong TO the caption, and at the
                // row's 8px they would read as three separate items on the line.
                sx={{ display: "flex", alignItems: "center", gap: "5px" }}
            >
                {indicator}
                <Typography
                    className="board__zone-label"
                    sx={{
                        fontFamily: FONTS.mono,
                        fontSize: 9.5,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: ink,
                        whiteSpace: "nowrap",
                    }}
                >
                    {label}
                </Typography>
                {indicator}
            </Box>
            <Box className="board__zone-rule" sx={{ flex: 1, height: "3px", borderRadius: "2px", backgroundColor: rule }} />
        </Box>
    );
};

export default Board;
