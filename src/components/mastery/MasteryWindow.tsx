import { useEffect, useMemo, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import Icon from "../Icon";
import { Label, Segmented } from "../primitives";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { getBandMark, getBandMid } from "../../utils/categoryColors";
import { formatCooldownRemaining } from "../../utils/formatDuration";
import {
    masteryBar,
    barCooldownRemainingMs,
    MASTERY_READY_COLOR,
    BAR_LABELS,
    masteryWindowCells,
    PBH_THRESHOLDS,
    PBH_FULL,
    type MasteryBar,
    type MasteryBarId,
} from "../../utils/masteryCompute";
import type { VocabEntry } from "../../types";

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
 * ── Colour of the fill: the BAND, not the mark type ─────────────────────────────
 * Every filled cell takes the track's current utcm band in the fluorescent MARK tier
 * (`getBandMark`) — "mastery bars are colored by mastery progress, not the mark type"
 * (2026-09-23; artboard 18: Know green, Target yellow, Write red). The app's Mark tier
 * is 5% L darker than the artboard's (2026-09-28, `theme/colors.ts`). The v1 window painted
 * the core track's cells blue-then-green by mark type; since the know merge the
 * per-type split is not drawn anywhere on the window (the cooldown row is per bar). The core pbh is fractional (the blend caps the
 * stronger track at 6 and adds a third of the weaker), so the last filled cell can be
 * a partial — rendered as a partial cell rather than rounded, because rounding would
 * make two genuinely different cards read the same.
 *
 * Beside the band pill sits the shown bar's **cooldown**: when it can next be earned,
 * as a live countdown, with a green check the moment it is ready. (It was a legend row
 * under the cells until 2026-09-28.) ONE clock per bar, because a clock belongs to a bar — the Know bar's recognition and production
 * share a single clock since 2026-09-25 (docs/MASTERY_REWORK.md § 6), so there is no
 * longer a per-track countdown to show. The window says how far along the card is; the
 * cooldown says whether you can do anything about it right now.
 *
 * Referenced by docs/MASTERY_REWORK.md and docs/SHELF_REDESIGN.md (§ A7, D6, D7).
 * Replaced `src/features/flashcards/MasteryProgressBar.tsx`, deleted with this pass.
 */

/** Height of one window cell. v2's `.msb .cells i` is 20px (v1: 15). */
const CELL_HEIGHT = 20;
/** An empty cell's fill — the design's `--hover` (6% ink). */
const MASTERY_EMPTY_CELL = COLORS.rowHoverBg;
/** How often the countdown re-renders. The clock shows seconds, so: every second. */
const COOLDOWN_TICK_MS = 1_000;

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

/** The eight-cell window itself, with the Target and Comfortable cut points ticked. */
const WindowCells: React.FC<{ bar: MasteryBar }> = ({ bar }) => (
    <Box
        className={`mastery-window__cells mastery-window__cells--${bar.id}`}
        // Ticks overhang the row vertically and are absolutely placed, so the row is
        // the positioning context and needs the top margin their captions sit in.
        sx={{ display: "flex", gap: "3px", position: "relative", marginTop: "17px" }}
    >
        {masteryWindowCells(bar).map((cell, i) => (
            <Box
                key={i}
                className={`mastery-window__cell${cell.fill > 0 ? " mastery-window__cell--filled" : ""}`}
                sx={{
                    flex: 1,
                    height: CELL_HEIGHT,
                    borderRadius: "3px",
                    // The empty cell is a flat `--hover` tint with NO outline ring —
                    // an unlit window reads as recessed slots, not outlined boxes
                    // (2026-09-25: the ring on an empty bar was ruled wrong).
                    backgroundColor: MASTERY_EMPTY_CELL,
                    overflow: "hidden",
                }}
            >
                {cell.fill > 0 && (
                    <Box
                        className="mastery-window__cell-fill"
                        sx={{
                            width: `${cell.fill * 100}%`,
                            height: "100%",
                            // The TRACK'S BAND in the fluorescent Mark tier, for every
                            // filled cell (artboard 18: "Mark: mastery band cells").
                            backgroundColor: getBandMark(bar.category),
                            transition: "width 240ms ease, background-color 240ms ease",
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
                        // Info type, not data: these are the band cut-point NAMES
                        // ("target", "comfortable"). Lowercase rather than the
                        // usual overline caps only because the tick sits under a 62px
                        // slot — the voice is the same one.
                        fontFamily: FONTS.label,
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

/**
 * The shown bar's live countdown, set inline after the band pill in the heading. The
 * clock and its window (the bar's own band) come from `barCooldownRemainingMs`, the
 * same function the mark-time gate and the flp's queue use, so the number shown here
 * is exactly when a mark will count.
 *
 * Until 2026-09-28 this was `CooldownLegend` (`.cd3`), a legend-like row UNDER the
 * cells: band swatch + bar name + countdown. The swatch and name only repeated what
 * the heading already says, so the row was dropped and the countdown moved up beside
 * the badge it belongs to.
 */
const CooldownTimer: React.FC<{ bar: MasteryBar; entry: VocabEntry; now: number }> = ({
    bar,
    entry,
    now,
}) => {
    const remainingMs = barCooldownRemainingMs(entry.typedMarkHistory, bar.id, now);
    const label = BAR_LABELS[bar.id];
    return (
        <Tooltip
            title={
                remainingMs > 0
                    ? `${label} rests for another ${formatCooldownRemaining(remainingMs)}`
                    : `${label} can be reviewed now`
            }
            placement="bottom"
        >
            <Box
                className={`mastery-window__cooldown mastery-window__cooldown--${remainingMs > 0 ? "resting" : "ready"}`}
                sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    alignSelf: "center",
                    gap: "4px",
                    color: COLORS.iconColor,
                    // A resting bar dims as a whole, so "ready" is legible from the
                    // timer's weight alone.
                    opacity: remainingMs > 0 ? 0.6 : 1,
                }}
            >
                <Typography
                    component="span"
                    className="mastery-window__cooldown-time"
                    sx={{
                        // Mono + tabular figures: the timer re-renders every second,
                        // and a proportional face makes it jitter as digits change width.
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
    );
};

export interface MasteryWindowProps {
    entry: VocabEntry;
    /**
     * The surface's mastery lens — which track the window opens on. `core` on the
     * fdp/deck/search path, `reading`/`writing` for a card opened from that Mastery
     * Center (docs/DECKS_FEATURE.md § "Mastery Centers").
     */
    lens?: MasteryBarId;
    /**
     * Render the Know / Read / Write track switch above the window. The default. Pass
     * false where the host already has a header of its own and only the window is
     * wanted (a list row, a compact panel).
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
                // Just the track switch, right-aligned on the section's gutter. The
                // `Mastery` overline + hairline (`SectionRule`) that used to lead into it
                // was dropped 2026-09-28 — the Know / Read / Write switch names the
                // section on its own. Padding matches the old rule's so the window below
                // does not shift.
                <Box
                    className="mastery-window__switch-row"
                    sx={{ display: "flex", justifyContent: "flex-end", padding: "19px 22px 0" }}
                >
                    <Segmented
                        className="mastery-window__track-switch"
                        options={TRACK_OPTIONS}
                        value={track}
                        onChange={setTrack}
                        ariaLabel="Mastery track"
                    />
                </Box>
            )}

            <Box className={`mastery-window__track mastery-window__track--${bar.id}`} sx={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {/* `.hd4` — the track's name, its band, and the raw figure. The band
                    pill is the band's MID tier (`.band3` on `--{hue}K`, K = M) — one
                    step below the cells' fluorescent Mark tier. */}
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
                            fontFamily: FONTS.label,
                            fontSize: 9.5,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            padding: "3px 7px",
                            borderRadius: "999px",
                            backgroundColor: getBandMid(bar.category),
                            color: COLORS.onSurface,
                        }}
                    >
                        {bar.category}
                    </Typography>
                    <CooldownTimer bar={bar} entry={entry} now={now} />
                    <Label className="mastery-window__count" sx={{ marginLeft: "auto", letterSpacing: "0.04em", textTransform: "none" }}>
                        {formatPbh(bar.pbh)} / {PBH_FULL}
                    </Label>
                </Box>

                <WindowCells bar={bar} />
            </Box>
        </Box>
    );
};

export default MasteryWindow;
