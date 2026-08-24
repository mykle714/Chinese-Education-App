import { useEffect, useMemo, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import Icon from "../Icon";
import { Label, SectionRule, Segmented } from "../primitives";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { BAND_COLORS } from "../../utils/categoryColors";
import { formatCooldownRemaining } from "../../utils/formatDuration";
import {
    masteryBar,
    computeTypeCategory,
    cooldownRemainingMs,
    MARK_TYPE_COLORS,
    MASTERY_READY_COLOR,
    MARK_TYPE_LABELS,
    BAR_LABELS,
    PBH_THRESHOLDS,
    PBH_FULL,
    type MasteryBar,
    type MasteryBarId,
} from "../../utils/masteryCompute";
import type { MarkType, VocabEntry } from "../../types";

/**
 * `MasteryWindow` — the app's ONE rendering of a mastery value (`.msb` in
 * `shelf-system.css`; docs/SHELF_REDESIGN.md decision **D7**, artboard 18).
 *
 * ── What the shape says, and why it replaced the thermometer ──────────────────
 * pbh is not a percentage. It is a position in an **eight-mark window** — the last
 * eight marks of a track are what the number is computed from, and the two band cut
 * points (Target at 3, Comfortable at 6) are counts inside that window, not
 * milestones on a continuum. A vertical bar with two lines across it (the old
 * `MasteryProgressBar`, the design's `.mst`) drew that as a liquid level, which
 * invites "89% of the way to mastered" and is the wrong mental model: one bad mark
 * does not evaporate a fraction of a tank, it turns one cell off.
 *
 * So the window is drawn as what it is: **`PBH_FULL` discrete cells, one per mark**,
 * with the two cut points ticked between them. Reading a card's state is counting,
 * not estimating.
 *
 * ── Which track is on screen (this reverses D6) ───────────────────────────────
 * D6 originally ruled that the cdp shows exactly ONE bar — the lens the surface was
 * asking about — because rendering all three at once "made the page answer a question
 * the learner had not asked". Artboard 18 later added a `Know / Read / Write`
 * segmented control, and that control satisfies D6's own rationale rather than
 * breaking it: only one track is ever on screen, and the learner is the one who says
 * which. The default is still the surface's lens, so an untouched page reports exactly
 * what D6 said it should.
 *
 * All three tracks are always offered, whatever the account's goals say. Reading and
 * writing marks accrue whether or not their goal is set (migration 143), so a track
 * hidden behind a goal switch would hide marks the learner has actually earned. The
 * GOAL decides what gets surfaced, sorted and counted elsewhere; it does not decide
 * whether this card's history exists.
 *
 * ── Composition of the fill ───────────────────────────────────────────────────
 * A skill track (`reading` / `writing`) is one mark type, so its cells are one color.
 * The `core` track blends recognition and production, so its filled cells are painted
 * in the ratio of their positive marks (blue then green, `MARK_TYPE_COLORS` — these
 * are the SATURATED hues on purpose, see D2b). The core pbh is fractional (the blend
 * caps the stronger track at 6 and adds a third of the weaker), so the last filled
 * cell can be a partial — rendered as a partial cell rather than rounded, because
 * rounding it would make two genuinely different cards read the same.
 *
 * Under the window sit the per-track **cooldowns** (`.cd3`): when each mark type of
 * the shown track can next be earned, as a live countdown, with a green check the
 * moment it is ready. The window says how far along the card is; the cooldown says
 * whether you can do anything about it right now.
 *
 * Referenced by docs/MASTERY_REWORK.md and docs/SHELF_REDESIGN.md (§ A7, D6, D7).
 * Replaced `src/features/flashcards/MasteryProgressBar.tsx`, deleted with this pass.
 */

/** Height of one window cell. The design's `.msb .cells i` is 15px. */
const CELL_HEIGHT = 15;
/** How often the countdown rows re-render. The clock shows seconds, so: every second. */
const COOLDOWN_TICK_MS = 1_000;

/**
 * Display order of the cooldown rows, which is NOT the window's paint order.
 *
 * The core window paints recognition before production (so the fill's colour order is
 * stable), but its cooldown rows read production first — that is the track a learner
 * is most often waiting on. Kept as an explicit list rather than a `.reverse()` of the
 * segments: the two orders answer different questions, and a reverse would silently
 * re-order any bar that later grows a third track.
 */
const COOLDOWN_ROW_ORDER: readonly MarkType[] = ["production", "recognition", "reading", "writing"];

/** The three tracks, in the order the segmented control offers them. */
const TRACK_OPTIONS = (["core", "reading", "writing"] as const).map((id) => ({
    value: id,
    label: BAR_LABELS[id],
}));

/**
 * pbh as a printed figure. Integer tracks print bare ("6"); the core blend prints one
 * decimal ("4.3") because its thirds are the whole reason the number is not an integer
 * — printing "4" for both 4.0 and 4.3 would hide the weaker track's contribution,
 * which is the one piece of information the blend adds.
 */
function formatPbh(pbh: number): string {
    return Number.isInteger(pbh) ? String(pbh) : pbh.toFixed(1);
}

/**
 * Per-cell fill for one window: how much of each cell is filled (0..1) and which mark
 * type colours it.
 *
 * Cell `i` covers the pbh interval [i, i+1), so its fill is `clamp(pbh - i, 0, 1)`.
 * Its colour is the segment covering the MIDPOINT of the filled part — the midpoint
 * rather than the left edge so a partial cell straddling a segment boundary takes the
 * colour of the half that is actually painted.
 */
function windowCells(bar: MasteryBar): Array<{ fill: number; color: string | null }> {
    // Segment extents in pbh units. `fraction` is each type's share of the FILLED
    // length, so scaling by pbh turns shares into positions on the 0..PBH_FULL axis.
    let cursor = 0;
    const extents = bar.segments.map((seg) => {
        const start = cursor;
        cursor += seg.fraction * bar.pbh;
        return { type: seg.type, start, end: cursor };
    });

    return Array.from({ length: PBH_FULL }, (_, i) => {
        const fill = Math.min(1, Math.max(0, bar.pbh - i));
        if (fill <= 0) return { fill: 0, color: null };
        const midpoint = i + fill / 2;
        // `end` is exclusive except on the last segment, where the midpoint of the
        // final partial cell can land exactly on the boundary — hence the fallback to
        // the last extent rather than returning null on a filled cell.
        const owner =
            extents.find((e) => midpoint >= e.start && midpoint < e.end) ??
            extents[extents.length - 1];
        return { fill, color: owner ? MARK_TYPE_COLORS[owner.type] : null };
    });
}

/** Remaining cooldown per mark type of one track, in COOLDOWN_ROW_ORDER. */
function cooldownRows(
    bar: MasteryBar,
    entry: VocabEntry,
    now: number
): Array<{ type: MarkType; remainingMs: number }> {
    const ordered = [...bar.segments].sort(
        (a, b) => COOLDOWN_ROW_ORDER.indexOf(a.type) - COOLDOWN_ROW_ORDER.indexOf(b.type)
    );
    // WINDOW CATEGORY: the card's PER-TYPE category (`computeTypeCategory`), which is
    // what every game uses. The flp instead widens the window to the card's CORE
    // category because one flp card shows two mark types at once — so for a card whose
    // recognition and core bands differ, the flp holds a track back slightly longer
    // than the number shown here. Flagged rather than papered over: the display can
    // only name one window, and the per-type one is the track's own.
    return ordered.map((seg) => ({
        type: seg.type,
        remainingMs: cooldownRemainingMs(
            entry.typedMarkHistory,
            seg.type,
            now,
            computeTypeCategory(entry.typedMarkHistory, seg.type)
        ),
    }));
}

/** The eight-cell window itself, with the Target and Comfortable cut points ticked. */
const WindowCells: React.FC<{ bar: MasteryBar }> = ({ bar }) => (
    <Box
        className={`mastery-window__cells mastery-window__cells--${bar.id}`}
        // Ticks overhang the row vertically and are absolutely placed, so the row is
        // the positioning context and needs the top margin their captions sit in.
        sx={{ display: "flex", gap: "3px", position: "relative", marginTop: "17px" }}
    >
        {windowCells(bar).map((cell, i) => (
            <Box
                key={i}
                className={`mastery-window__cell${cell.fill > 0 ? " mastery-window__cell--filled" : ""}`}
                sx={{
                    flex: 1,
                    height: CELL_HEIGHT,
                    borderRadius: "3px",
                    // The empty cell is a hairline-inset tint, not a border: a real
                    // border would make the filled and empty cells different sizes.
                    backgroundColor: "rgba(23,22,26,0.06)",
                    boxShadow: cell.fill > 0 ? "none" : "inset 0 0 0 1px rgba(23,22,26,0.12)",
                    overflow: "hidden",
                }}
            >
                {cell.fill > 0 && cell.color && (
                    <Box
                        className="mastery-window__cell-fill"
                        sx={{
                            width: `${cell.fill * 100}%`,
                            height: "100%",
                            backgroundColor: cell.color,
                            transition: "width 240ms ease",
                        }}
                    />
                )}
            </Box>
        ))}

        {/* Band cut points. A tick sits BETWEEN cells — at `pbh / PBH_FULL` of the
            row — because the band changes when a cell turns on, not part-way through
            one. Its caption hangs above the row, centred on the tick. */}
        {PBH_THRESHOLDS.map((t) => (
            <Box
                key={t.label}
                className={`mastery-window__tick mastery-window__tick--${t.label.toLowerCase()}`}
                sx={{
                    position: "absolute",
                    left: `${(t.pbh / PBH_FULL) * 100}%`,
                    top: "-5px",
                    bottom: "-5px",
                    width: "1.5px",
                    backgroundColor: "rgba(23,22,26,0.5)",
                }}
            >
                <Typography
                    component="span"
                    className="mastery-window__tick-label"
                    sx={{
                        position: "absolute",
                        top: "-16px",
                        left: "-31px",
                        width: "62px",
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        fontFamily: FONTS.mono,
                        fontSize: 8,
                        letterSpacing: "0.06em",
                        color: COLORS.textSecondary,
                    }}
                >
                    {t.label.toLowerCase()}
                </Typography>
            </Box>
        ))}
    </Box>
);

/** `.cd3` — one live countdown per mark type of the shown track. */
const CooldownLegend: React.FC<{ bar: MasteryBar; entry: VocabEntry; now: number }> = ({
    bar,
    entry,
    now,
}) => (
    <Box
        className="mastery-window__cooldowns"
        sx={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", paddingTop: "2px" }}
    >
        {cooldownRows(bar, entry, now).map(({ type, remainingMs }) => (
            <Tooltip
                key={type}
                title={
                    remainingMs > 0
                        ? `${MARK_TYPE_LABELS[type]} rests for another ${formatCooldownRemaining(remainingMs)}`
                        : `${MARK_TYPE_LABELS[type]} can be reviewed now`
                }
                placement="bottom"
            >
                <Box
                    className={`mastery-window__cooldown-row mastery-window__cooldown-row--${type}`}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: 10.5,
                        color: COLORS.iconColor,
                        // A resting track dims as a whole rather than only its swatch,
                        // so "ready" is legible from the row's weight alone.
                        opacity: remainingMs > 0 ? 0.6 : 1,
                    }}
                >
                    <Box
                        className="mastery-window__cooldown-swatch"
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "2px",
                            flexShrink: 0,
                            backgroundColor: MARK_TYPE_COLORS[type],
                        }}
                    />
                    <Typography component="em" sx={{ fontStyle: "normal", fontWeight: WEIGHT.semibold, fontSize: "inherit" }}>
                        {MARK_TYPE_LABELS[type]}
                    </Typography>
                    <Typography
                        component="span"
                        sx={{
                            // Mono + tabular figures: the row re-renders every second,
                            // and a proportional face makes it jitter as digits change
                            // width.
                            fontFamily: FONTS.mono,
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 10,
                        }}
                    >
                        {formatCooldownRemaining(remainingMs)}
                    </Typography>
                    {remainingMs <= 0 && (
                        <Icon name="check_circle" size={12} color={MASTERY_READY_COLOR} fill={1} />
                    )}
                </Box>
            </Tooltip>
        ))}
    </Box>
);

export interface MasteryWindowProps {
    entry: VocabEntry;
    /**
     * The surface's mastery lens — which track the window opens on. `core` on the
     * fdp/deck/search path, `reading`/`writing` for a card opened from that Mastery
     * Center (docs/DECKS_FEATURE.md § "Mastery Centers").
     */
    lens?: MasteryBarId;
    /**
     * Render the `Mastery` section rule and the track switcher above the window. The
     * default. Pass false where the host already has a header of its own and only the
     * window is wanted (a list row, a compact panel).
     */
    showHeader?: boolean;
    className?: string;
}

export const MasteryWindow: React.FC<MasteryWindowProps> = ({
    entry,
    lens = "core",
    showHeader = true,
    className,
}) => {
    // Which track is on screen. Seeded from the lens and re-seeded if the lens itself
    // changes (a card re-opened from a different Center), but NOT keyed on the entry:
    // paging between cards should keep the track the learner chose.
    const [track, setTrack] = useState<MasteryBarId>(lens);
    useEffect(() => { setTrack(lens); }, [lens]);

    // The countdown ticks on its own so a card left open runs down to 0s without a
    // reload. One interval for the whole section, not one per row.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
        return () => window.clearInterval(id);
    }, []);

    const bar = useMemo(() => masteryBar(entry.typedMarkHistory, track), [entry.typedMarkHistory, track]);

    return (
        <Box className={className ? `mastery-window ${className}` : "mastery-window"}>
            {showHeader && (
                <SectionRule
                    className="mastery-window__rule"
                    label="Mastery"
                    right={
                        <Segmented
                            className="mastery-window__track-switch"
                            options={TRACK_OPTIONS}
                            value={track}
                            onChange={setTrack}
                            ariaLabel="Mastery track"
                        />
                    }
                />
            )}

            <Box className={`mastery-window__track mastery-window__track--${bar.id}`} sx={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {/* `.hd4` — the track's name, its band, and the raw figure. The band
                    chip is the PASTEL fill (CATEGORY_COLORS via BAND_COLORS), not the
                    saturated mark hue: it is a surface, and the cells beside it are
                    the saturated ones. See D2b. */}
                <Box
                    className="mastery-window__heading"
                    sx={{ display: "flex", alignItems: "baseline", gap: "8px" }}
                >
                    <Typography
                        component="b"
                        className="mastery-window__track-label"
                        sx={{ fontSize: 14.5, fontWeight: WEIGHT.bold, letterSpacing: "-0.012em" }}
                    >
                        {BAR_LABELS[bar.id]}
                    </Typography>
                    <Typography
                        component="span"
                        className={`mastery-window__band mastery-window__band--${bar.category.toLowerCase()}`}
                        sx={{
                            fontFamily: FONTS.mono,
                            fontSize: 9.5,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            padding: "3px 7px",
                            borderRadius: "999px",
                            backgroundColor: BAND_COLORS[bar.category].main,
                            color: COLORS.onSurface,
                        }}
                    >
                        {bar.category}
                    </Typography>
                    <Label className="mastery-window__count" sx={{ marginLeft: "auto", letterSpacing: "0.04em", textTransform: "none" }}>
                        {formatPbh(bar.pbh)} / {PBH_FULL}
                    </Label>
                </Box>

                <WindowCells bar={bar} />
                <CooldownLegend bar={bar} entry={entry} now={now} />
            </Box>
        </Box>
    );
};

export default MasteryWindow;
