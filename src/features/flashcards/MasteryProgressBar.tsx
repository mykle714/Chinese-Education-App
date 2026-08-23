import { useEffect, useState } from "react";
import { Box, Typography, Tooltip } from "@mui/material";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import type { MarkType, VocabEntry } from "../../types";
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
import { SIZE, WEIGHT } from "../../theme/scale";
import { FC_FONT } from "./constants";

/**
 * cdp mastery progress bars (docs/MASTERY_REWORK.md § "Three bars").
 *
 * ONE VERTICAL BAR — the bar of the SURFACE'S LENS (the `lens` prop): `core` on the
 * fdp/deck/search path, `reading` or `writing` on a card opened from that Mastery
 * Center. Its FILLED height is that bar's pbh on the 0..PBH_FULL scale, against the
 * shared Target/Comfortable benchmark lines.
 *
 * It renders one COLUMN, not three. A card is a different thing under each bar and can
 * be full in one while empty in another, so showing all of an account's bars at once
 * made the page answer a question the learner had not asked; each skill now has a
 * Center of its own that asks it (docs/DECKS_FEATURE.md § "Mastery Centers"). The
 * layout below is still written as a map over a list — nothing in it needs to know the
 * list is now always length 1.
 *
 * The core bar's fill is composed of its two mark types in the ratio of their
 * positive marks (blue = Recognition, green = Production); a skill bar is one solid
 * color. Before migration 143 there was ONE bar composed of all four types
 * whose height was goal-weighted — which meant enabling a goal visibly shrank a card
 * the learner had already finished.
 *
 * Under the bar sits its PER-TYPE COOLDOWN — one row per mark type in the bar (the
 * core bar therefore shows two, a skill bar one), as a live `4m 1w 3d 5h 37m 26s` countdown to the
 * moment that track can next be marked. A ready track keeps that shape — it reads
 * `0s` — and gains a small green check beside it, so "can I drill this now?" is
 * answerable at a glance without parsing digits. See § "Per-type cooldown"; the table
 * itself is `server/contracts/cooldown.ts`.
 *
 * The bar's utcm BAND is deliberately not printed here — the benchmark lines already
 * show it, and the card's band is on the badge row at the top of the page.
 */
const BAR_HEIGHT = 132;
const BAR_WIDTH = 26;
/** Column width under a bar. The longest countdown ("6m 0w 0d 0h 0m 0s") wraps to a
 *  second line rather than pushing the columns apart — it only occurs on a Mastered
 *  track, where the exact number matters least. */
const COOLDOWN_COL_WIDTH = 104;
/** How often the countdown rows re-render. The clock shows seconds, so: every second. */
const COOLDOWN_TICK_MS = 1_000;

/**
 * Display order of the cooldown rows, which is NOT the bar's segment order.
 *
 * The core bar STACKS recognition below production (BAR_TYPE_ORDER, so the fill paints
 * bottom-up in a stable order), but its cooldown rows read production first. Kept as
 * an explicit list rather than a reverse of the segments: the two orders answer
 * different questions and a `.reverse()` would silently re-order any bar that later
 * grows a third track.
 */
const COOLDOWN_ROW_ORDER: readonly MarkType[] = ['production', 'recognition', 'reading', 'writing'];

/**
 * Remaining cooldown per mark type of one bar, in COOLDOWN_ROW_ORDER.
 *
 * WINDOW CATEGORY: the card's PER-TYPE category (`computeTypeCategory`), which is
 * what every game uses. The flp instead widens the window to the card's CORE
 * category because one flp card shows two mark types at once — so for a card whose
 * recognition and core bands differ, the flp will hold a track back slightly longer
 * than the number shown here. Flagged rather than papered over: the display can only
 * name one window, and the per-type one is the track's own.
 */
function cooldownRows(bar: MasteryBar, entry: VocabEntry, now: number): Array<{ type: MarkType; remainingMs: number }> {
    const ordered = [...bar.segments].sort(
        (a, b) => COOLDOWN_ROW_ORDER.indexOf(a.type) - COOLDOWN_ROW_ORDER.indexOf(b.type)
    );
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

/** One vertical track: fill, per-type segments, and the two benchmark lines. */
const BarTrack: React.FC<{ bar: MasteryBar }> = ({ bar }) => {
    const filledSegments = bar.segments.filter((s) => s.positive > 0);

    return (
        <Box
            className={`mastery-progress-bar__bar mastery-progress-bar__bar--${bar.id}`}
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}
        >
            {/* Track wrapper: NOT clipped, so the benchmark lines can extend past
                the bar's edges. Holds the (clipped) track + the overhanging lines. */}
            <Box
                className="mastery-progress-bar__track-wrap"
                sx={{ position: "relative", width: BAR_WIDTH, height: BAR_HEIGHT, flexShrink: 0 }}
            >
                {/* The vertical track + fill (outlined, rounded, clips the fill) */}
                <Box
                    className="mastery-progress-bar__track"
                    sx={{
                        position: "absolute",
                        inset: 0,
                        boxSizing: "border-box",
                        borderRadius: `${BAR_WIDTH / 2}px`,
                        backgroundColor: "rgba(0,0,0,0.06)",
                        border: "1.5px solid rgba(0,0,0,0.35)",
                        overflow: "hidden",
                    }}
                >
                    <Box
                        className="mastery-progress-bar__fill"
                        sx={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: `${bar.heightFraction * 100}%`,
                            display: "flex",
                            flexDirection: "column-reverse", // first type stacks at the bottom
                            transition: "height 240ms ease",
                        }}
                    >
                        {filledSegments.map((seg) => (
                            <Tooltip
                                key={seg.type}
                                title={`${MARK_TYPE_LABELS[seg.type]}: ${seg.positive}/${PBH_FULL}`}
                                placement="right"
                            >
                                <Box
                                    className={`mastery-progress-bar__segment mastery-progress-bar__segment--${seg.type}`}
                                    sx={{
                                        height: `${seg.fraction * 100}%`,
                                        backgroundColor: MARK_TYPE_COLORS[seg.type],
                                    }}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>

                {/* Benchmark lines at the Target (pbh 3) and Comfortable (pbh 6)
                    band boundaries. pbh = PBH_FULL fills the track, so each line
                    sits at (pbh / PBH_FULL) of the height from the bottom. Solid and
                    extended past both edges; rendered in the unclipped wrapper. */}
                {PBH_THRESHOLDS.map((t) => (
                    <Tooltip key={t.label} title={`${t.label} at ${t.pbh}/${PBH_FULL}`} placement="right">
                        <Box
                            className={`mastery-progress-bar__benchmark mastery-progress-bar__benchmark--${t.label.toLowerCase()}`}
                            sx={{
                                position: "absolute",
                                left: -5,
                                right: -5,
                                bottom: `${(t.pbh / PBH_FULL) * 100}%`,
                                height: 0,
                                borderTop: "2px solid rgba(0,0,0,0.55)",
                                pointerEvents: "auto",
                            }}
                        />
                    </Tooltip>
                ))}
            </Box>
        </Box>
    );
};

/** One bar COLUMN: the track, the bar's name, and its per-track cooldown clocks. */
const BarColumn: React.FC<{ bar: MasteryBar; entry: VocabEntry; now: number }> = ({ bar, entry, now }) => (
    <Box
        className={`mastery-progress-bar__column mastery-progress-bar__column--${bar.id}`}
        sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            width: COOLDOWN_COL_WIDTH,
        }}
    >
        <BarTrack bar={bar} />

        {/* Which bar this is. Always labelled, even when core is the only one:
            the label is what tells a learner the bar is about recognition and
            production rather than everything they have ever done with the card. */}
        <Typography
            className="mastery-progress-bar__bar-label"
            sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.bold, fontFamily: FC_FONT, lineHeight: 1.1 }}
        >
            {BAR_LABELS[bar.id]}
        </Typography>

        {/* Per-type cooldown: a countdown per mark type, colored by that type's swatch
            so the row reads against the segment it belongs to. Every row keeps the same
            shape (a ready track still shows 0s, not a word) and a ready one adds a small
            green check — the color is what carries the answer, so the columns are
            scannable without reading any digits. */}
        <Box
            className="mastery-progress-bar__cooldowns"
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", width: "100%" }}
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
                        className={`mastery-progress-bar__cooldown-row mastery-progress-bar__cooldown-row--${type}`}
                        // flex-start (not center): the countdown wraps to two lines on a
                        // long window, and a centered swatch would float mid-paragraph.
                        sx={{ display: "flex", alignItems: "flex-start", gap: "4px", maxWidth: "100%" }}
                    >
                        <Box
                            className="mastery-progress-bar__cooldown-swatch"
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "2px",
                                backgroundColor: MARK_TYPE_COLORS[type],
                                flexShrink: 0,
                                marginTop: "3px", // optically centers on the first text line
                                // A resting track's swatch is dimmed so "ready" reads at a glance.
                                opacity: remainingMs > 0 ? 0.4 : 1,
                            }}
                        />
                        <Typography
                            className="mastery-progress-bar__cooldown-text"
                            sx={{
                                fontSize: SIZE.micro,
                                // Monospace + tabular figures: the countdown re-renders
                                // every second, and a proportional font would make the row
                                // jitter as digits change width.
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                fontVariantNumeric: "tabular-nums",
                                // Wraps rather than overflowing: the longest string is
                                // the freshly-Mastered "6m 0w 0d 0h 0m 0s".
                                textAlign: "center",
                                lineHeight: 1.25,
                                opacity: remainingMs > 0 ? 0.7 : 1,
                                fontWeight: remainingMs > 0 ? WEIGHT.regular : WEIGHT.bold,
                            }}
                        >
                            {formatCooldownRemaining(remainingMs)}
                        </Typography>

                        {/* Ready marker — only at 0s. A 12px green check rather than a
                            word or a pill: it sits at the end of a row that is already
                            a swatch plus a countdown, and there can be up to six of
                            these rows in the section, so the state has to read as a
                            glyph. The tooltip on the row carries the wording. */}
                        {remainingMs <= 0 && (
                            <CheckCircleRoundedIcon
                                className="mastery-progress-bar__ready-icon"
                                // The design fixes the ready-check green at #05C793 (`.msb .cd3 .ms`).
                                sx={{ fontSize: 12, color: MASTERY_READY_COLOR, flexShrink: 0, marginTop: "1px" }}
                            />
                        )}
                    </Box>
                </Tooltip>
            ))}
        </Box>
    </Box>
);

export const MasteryProgressBar: React.FC<{
    entry: VocabEntry;
    className?: string;
    /**
     * The surface's mastery LENS (docs/DECKS_FEATURE.md § "Mastery Centers").
     *
     * ALWAYS exactly one column — this section shows the lens's bar and its cooldown
     * rows, nothing else. Defaults to `core`, so a card opened from the fdp, a deck or
     * a search result reports recognition and production; a card opened from inside a
     * Mastery Center carries `?bar=` and reports that skill instead.
     *
     * It used to render one column per goal the account pursued. A learner arriving
     * from a recognition/production surface was then shown three bars for a page that
     * had asked one question — and the two skills now have pages of their own.
     */
    lens?: MasteryBarId;
}> = ({ entry, className, lens = "core" }) => {
    // The countdown ticks on its own so a card left open runs down to 0s without
    // a reload. One interval for the whole section (not one per row), and it re-renders
    // only this component — the hero card and info boxes above are untouched.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
        return () => window.clearInterval(id);
    }, []);

    // The account's goals are deliberately NOT consulted: the surface decides which
    // question is being asked, and every bar is computed for every learner whatever
    // their goals say (migration 143). A single-element list rather than a bare bar so
    // the column/legend rendering below stays a plain map.
    const bars = [masteryBar(entry.typedMarkHistory, lens)];
    // Legend rows cover only the types actually on screen, so a learner with no
    // writing goal is not shown a color they will never see in a bar.
    const shownTypes = bars.flatMap((b) => b.segments.map((s) => s.type));

    return (
        <Box
            className={`mastery-progress-bar ${className ?? ""}`}
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", width: "100%" }}
        >
            <Box
                className="mastery-progress-bar__bars"
                sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    // Spacing kept from when this row held up to three columns; it is a
                    // single centered column now, so the gap only matters if a second
                    // bar is ever shown here again.
                    gap: "20px",
                    width: "100%",
                }}
            >
                {bars.map((bar) => (
                    <BarColumn key={bar.id} bar={bar} entry={entry} now={now} />
                ))}
            </Box>

            {/* Color legend: one swatch + label per mark type on screen (no counts).
                Horizontal now that the group is a full-width section rather than a
                column squeezed beside the bars. */}
            <Box
                className="mastery-progress-bar__legend"
                sx={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 14px" }}
            >
                {shownTypes.map((type) => (
                    <Box
                        key={type}
                        className={`mastery-progress-bar__legend-row mastery-progress-bar__legend-row--${type}`}
                        sx={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                        <Box
                            className="mastery-progress-bar__legend-swatch"
                            sx={{ width: 10, height: 10, borderRadius: "3px", backgroundColor: MARK_TYPE_COLORS[type], flexShrink: 0 }}
                        />
                        <Typography sx={{ fontSize: SIZE.micro, fontFamily: FC_FONT, opacity: 0.85 }}>
                            {MARK_TYPE_LABELS[type]}
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default MasteryProgressBar;
