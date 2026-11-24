import { useEffect, useMemo, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { COLORS } from "../../../theme/colors";
import { keycapPressSx } from "../../../theme/keycapPress";
import { PLATE_WALL_PX, TOWER_PLATE_PRINT, TOWER_STUDY_FONT, towerPlateShadow } from "../../../theme/towerPlate";
import { getBandMark } from "../../../utils/categoryColors";
import { bandMaterial } from "../iso";
import { formatCooldownRemaining } from "../../../utils/formatDuration";
import {
    masteryBar,
    barCooldownRemainingMs,
    masteryFillFraction,
    WORLD_LABELS,
    type MasteryBar,
    type MasteryWorldId,
} from "../../../utils/masteryCompute";
import type { VocabEntry } from "../../../types";

/**
 * TowerMasteryPanel — the card view's mastery section, in the Deck Tower's raised style
 * (docs/DECK_TOWER.md § "The card view" → "Mastery").
 *
 *   [Read]              3h 12m     ONE track keycap: names the track shown, faced in its
 *                                  track's colour (blue / green / pink); a press steps it to the next track
 *                                  (Know → Read → Write → Know, goals that are on only);
 *                                  hidden entirely when only Know is on
 *                                  the cooldown at the top RIGHT ("Ready to mark!" once it
 *                                  is up). No track name or band pill — the keycap and
 *                                  the bar's colour say both
 *   ██████··········               the raised bar: ITSELF a plate in the band's Mark tier,
 *                                  as long as pbh says, over a faded dashed outline of
 *                                  the full bar
 *
 * Replaced `components/mastery/MasteryWindow` (deleted 2026-11-23 with the cdp route), whose
 * flat recessed track, band cut-point ticks ("target" / "comfortable") and `n / 8` count
 * were dropped by the owner. What survived: one track on screen at a time, sized by
 * `masteryFillFraction` exactly (a fractional Know pbh is drawn, not rounded), coloured by
 * the BAND rather than the mark type, with the per-bar cooldown at its top right. The track name
 * and band pill went too (owner, 2026-11-23): the track keycap names the track, the bar's
 * colour the band.
 *
 * ── The bar GROWS, it does not fill (owner, 2026-11-23) ──
 * There is no track for it to fill: the bar is the whole object, and its length IS the
 * progress. An empty bar is the smallest bar there can be — a short red bar
 * (`BAR_MIN_WIDTH_PX`, Unfamiliar's Mark tier) — and it lengthens toward the full row width as pbh climbs,
 * repainting as it crosses each band: red → yellow → green → a maxed-out blue bar. The
 * colour is the band's (stepped, not blended), so it agrees with the mini card's strip.
 * Behind it a faded DASHED outline (long, heavy, round-capped) traces the perimeter of the full bar, so a short bar
 * still reads as a bar — part of a known whole — rather than a stray pill.
 *
 * ── Raised, like the session's plates ──
 * Everything here is the flp session's plate (theme/towerPlate.ts): a STRAIGHT-DOWN wall,
 * not the cards page's diagonal one, because the card view is read the way the study
 * session is — straight down onto the card — and its Compare / Customize / More Info plates
 * are already straight-walled. Each plate's walls are its face stepped down the way the
 * scene's floor plates are (`bandMaterial`), so a coloured plate keeps a wall of its own hue.
 *   - The bar is a plate at rest (`towerPlateShadow(tones, 0)`) in its band's Mark tier: it
 *     does not press.
 *   - The track keycap is ONE narrow raised plate, faced in the shown track's colour
 *     (`TRACK_KEYCAP_COLORS`: Know blue, Read green, Write pink — deliberately NOT the worlds'
 *     skies, which it camouflaged into). It presses like any plate and springs back up; each
 *     press steps to the next offered track, and the keycap's label and colour change with
 *     it. (It replaced a row of one latching key per track, owner 2026-11-23.)
 * *
 * ── Which tracks are offered ──
 * Know always; Read / Write only while the account has that goal on (`users.readingGoal` /
 * `writingGoal`) — the same rule as the tower's worlds (DeckTowerPage → `worldEnabled`).
 * This reverses MasteryWindow's "all three tracks, whatever the goals" (owner, 2026-11-23).
 * The panel opens on the world the card was opened from.
 *
 * Layer: feature view (src/features/deckTower/cardView). Rendered by TowerCardView.
 * Docs: docs/DECK_TOWER.md § "The card view"; docs/MASTERY_REWORK.md (pbh, bands, cooldown).
 */

/** The bar's height, px (face only; its wall hangs below). */
const BAR_HEIGHT_PX = 18;
/**
 * The EMPTY bar's length, px: the shortest bar there is. A little over two bar-heights, so
 * even at zero it reads as a short bar rather than a dot (owner, 2026-11-23).
 */
const BAR_MIN_WIDTH_PX = 42;
/**
 * The full-bar outline: a heavy stroke broken into long rounded dashes, faded against the sky
 * ink. An SVG stroke rather than a CSS `dotted`/`dashed` border, because a border's dash
 * length is the browser's to pick (≈ 2–3× the width) and cannot be lengthened.
 */
const BAR_OUTLINE_PX = 2.5;
/** Dash, gap (px) — the round caps add BAR_OUTLINE_PX to each dash's visible length. */
const BAR_OUTLINE_DASH = "9 8";
const BAR_OUTLINE_OPACITY = 0.4;
/** The outline's stroke sits this much further inside the silhouette than flush. */
const BAR_OUTLINE_TUCK_PX = 1;
/**
 * The outline at NIGHT: the framework's muted grey (`--muted`), unfaded. The day outline is
 * the sky ink faded, and at night that ink is the washed white, which read too bright on the
 * dark sky (owner, 2026-11-23).
 */
const BAR_OUTLINE_NIGHT = COLORS.textSecondary;
/** The track keycap's width, px — narrow, sized to the longest label ("Write") so it does not resize as it cycles. */
const KEY_WIDTH_PX = 58;
/** How long the bar takes to grow and repaint after a mark. */
const BAR_GROW_MS = 320;
/**
 * The track keycap's face per track: blue, green, pink. NOT the world's own sky — the keycap
 * stood on the sky of the world it was opened from and, faced in that same sky, vanished
 * into it (owner, 2026-11-23). Each is a framework token chosen to stand off its own world's
 * sky: Know's pale blue (bluM, 90.5% L) over main's saturated bluMk; Read's pale green (grnM,
 * 90.5% L, chroma 0.115) over reading's deeper grnSky (83% L, 0.15); Write's salmon pink (redM, chroma 0.14) over writing's pale, near-grey
 * pnkSky (chroma 0.05) — `pnk` (orchid) was too close to that sky to use.
 */
const TRACK_KEYCAP_COLORS: Record<MasteryWorldId, string> = {
    core: COLORS.bluM,
    reading: COLORS.grnM,
    writing: COLORS.redM,
};
/** The countdown re-renders every second (it shows seconds). */
const COOLDOWN_TICK_MS = 1_000;

export interface TowerMasteryPanelProps {
    entry: VocabEntry;
    /** The world the card was opened from: the track the panel opens on. */
    initialTrack: MasteryWorldId;
    /** The tracks offered, in order (Know first). One track → no keys. */
    tracks: readonly MasteryWorldId[];
    /** Ink on the sky — the cooldown, and the bar outline by day (DeckTowerPage `skyInk`). */
    ink: string;
    /** Night outweighs day in td's light — the bar outline turns dark grey. */
    night: boolean;
    className?: string;
}

/**
 * A 1px `COLORS.border` ring around a plate's WHOLE silhouette — face and the `wallPx` of
 * wall showing under it — so the track keycap and the bar hold their edges on any sky
 * (owner, 2026-11-23; their pale faces were too close to the skies behind them). Two spread-1px shadows, one on the
 * face's box and one on the wall's: appended AFTER the plate's own shadows, they paint
 * beneath them, so the wall covers the face ring's bottom and no seam line is drawn between
 * face and wall — only the outer perimeter. Outside the box: no layout change. Pressed
 * (wall 0) the two coincide into a ring round the face alone.
 */
const plateOutline = (wallPx: number) => `0 0 0 1px ${COLORS.border}, 0 ${wallPx}px 0 1px ${COLORS.border}`;

/**
 * The SEAM between a plate's face and its wall: the face's box shifted 1px down in
 * `COLORS.border`. Listed FIRST, so it paints over the wall — a 1px crescent along the face's
 * lower edge. For the bar, whose band walls are only a 7–15% step down from the face
 * (`bandMaterial`) and ran into it on the paler bands.
 */
const PLATE_SEAM = `0 1px 0 0 ${COLORS.border}`;

/**
 * The track keycap: one narrow raised plate naming the shown track, in its track's colour.
 * A press steps to the next offered track (`onNext`); label and colour follow.
 */
const TrackKeycap: React.FC<{ track: MasteryWorldId; onNext: () => void }> = ({ track, onNext }) => {
    const tones = useMemo(() => bandMaterial(TRACK_KEYCAP_COLORS[track]), [track]);
    return (
        <Box
            component="button"
            type="button"
            className={`tower-mastery-panel__track-keycap tower-mastery-panel__track-keycap--${track}`}
            aria-label={`Showing ${WORLD_LABELS[track]} mastery. Show the next track`}
            onClick={onNext}
            sx={{
                alignSelf: "flex-start",
                width: KEY_WIDTH_PX,
                padding: "7px 0",
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                backgroundColor: tones.top,
                color: COLORS.onSurface,
                WebkitTapHighlightColor: "transparent",
                ...TOWER_PLATE_PRINT,
                fontFamily: TOWER_STUDY_FONT,
                fontSize: 11,
                ...keycapPressSx({
                    restShadow: `${towerPlateShadow(tones, 0)}, ${plateOutline(PLATE_WALL_PX)}`,
                    pressedShadow: `${towerPlateShadow(tones, PLATE_WALL_PX)}, ${plateOutline(0)}`,
                    restY: 0,
                    pressedY: PLATE_WALL_PX,
                }),
            }}
        >
            {WORLD_LABELS[track]}
        </Box>
    );
};

/**
 * The raised bar: a plate in the band's Mark tier whose LENGTH is the progress, laid over a
 * faded dashed outline of the full bar. Empty, the plate is `BAR_MIN_WIDTH_PX` long;
 * full (pbh 8), it fills the outline. In between it is that minimum plus the fraction of
 * the rest — `calc()`, so it never shrinks below the minimum.
 */
const RaisedBar: React.FC<{ bar: MasteryBar; ink: string; night: boolean }> = ({ bar, ink, night }) => {
    const color = getBandMark(bar.category);
    const tones = useMemo(() => bandMaterial(color), [color]);
    // Exact, not rounded: a fractional Know pbh ends part-way between marks.
    const fraction = masteryFillFraction(bar);
    // The plate's length, as a CSS length of the bar's box — shared by the plate and the
    // outline's clip, so the two can never disagree about where the plate ends.
    const plateWidth = `calc(${BAR_MIN_WIDTH_PX}px + (100% - ${BAR_MIN_WIDTH_PX}px) * ${fraction})`;
    // How far the outline's stroke CENTRE sits inside the silhouette.
    const outlineInset = BAR_OUTLINE_PX / 2 + BAR_OUTLINE_TUCK_PX;
    return (
        <Box
            className={`tower-mastery-panel__bar tower-mastery-panel__bar--${bar.id} tower-mastery-panel__bar--${bar.category.toLowerCase()}`}
            role="meter"
            aria-label={`${WORLD_LABELS[bar.id]} mastery`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={fraction}
            sx={{ position: "relative", height: BAR_HEIGHT_PX }}
        >
            {/* The whole bar's perimeter, traced in the sky's ink and faded: what the plate grows into. */}
            {/* The FULL keycap's silhouette — face plus the PLATE_WALL_PX wall under it — traced
                with the stroke kept INSIDE it: the svg is inset half a stroke plus
                BAR_OUTLINE_TUCK_PX on every side and the corner radius shrunk to match.
                The wrapper then CLIPS the outline to the part past the plate: everything left of
                the plate's right end (less its end radius, so the dashes still meet the round
                end) is cut away. Covering alone was not enough — the antialiased stroke edge
                and the plate's own edge left dashes peeking over the plate's top and round its
                left end (owner, 2026-11-23). The clip rides the plate's width transition. */}
            <Box
                className="tower-mastery-panel__bar-outline-clip"
                aria-hidden
                sx={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: BAR_HEIGHT_PX + PLATE_WALL_PX,
                    clipPath: `inset(-${BAR_OUTLINE_PX}px -${BAR_OUTLINE_PX}px -${BAR_OUTLINE_PX}px calc(${plateWidth} - ${BAR_HEIGHT_PX / 2}px))`,
                    transition: `clip-path ${BAR_GROW_MS}ms ease`,
                    opacity: night ? 1 : BAR_OUTLINE_OPACITY,
                    pointerEvents: "none",
                }}
            >
                <Box
                    component="svg"
                    className="tower-mastery-panel__bar-outline"
                    sx={{
                        position: "absolute",
                        left: outlineInset,
                        top: outlineInset,
                        width: `calc(100% - ${outlineInset * 2}px)`,
                        height: BAR_HEIGHT_PX + PLATE_WALL_PX - outlineInset * 2,
                        overflow: "visible",
                    }}
                >
                    <rect
                        x={0}
                        y={0}
                        width="100%"
                        height="100%"
                        rx={BAR_HEIGHT_PX / 2 - outlineInset}
                        fill="none"
                        stroke={night ? BAR_OUTLINE_NIGHT : ink}
                        strokeWidth={BAR_OUTLINE_PX}
                        strokeDasharray={BAR_OUTLINE_DASH}
                        strokeLinecap="round"
                    />
                </Box>
            </Box>
            <Box
                className="tower-mastery-panel__bar-plate"
                sx={{
                    position: "relative",
                    height: "100%",
                    width: plateWidth,
                    borderRadius: "999px",
                    // Outlined (the app's 1px --line2): the seam between face and wall, then the
                    // plate, then a ring round the whole silhouette. All shadows, so nothing
                    // changes the bar's box — it still fits the dashed whole exactly. An exception to
                    // the plates' "the edge is the wall" rule (theme/towerPlate.ts), owner 2026-11-23.
                    backgroundColor: tones.top,
                    boxShadow: `${PLATE_SEAM}, ${towerPlateShadow(tones, 0)}, ${plateOutline(PLATE_WALL_PX)}`,
                    transition: `width ${BAR_GROW_MS}ms ease, background-color ${BAR_GROW_MS}ms ease, box-shadow ${BAR_GROW_MS}ms ease`,
                }}
            />
        </Box>
    );
};

/**
 * The shown bar's live countdown — `barCooldownRemainingMs`, the same clock the mark-time
 * gate reads, so the figure is exactly when a mark will count. Set larger than the old
 * 10px mono figure, because with the track name and band pill gone it is the panel's only
 * line of text; once the cooldown
 * runs out it reads "Ready to mark!" instead of a zero.
 */
const CooldownTimer: React.FC<{ bar: MasteryBar; entry: VocabEntry; now: number; ink: string }> = ({ bar, entry, now, ink }) => {
    const remainingMs = barCooldownRemainingMs(entry.typedMarkHistory, bar.id, now, entry.writingMastery);
    const resting = remainingMs > 0;
    return (
        <Tooltip
            title={resting ? `${WORLD_LABELS[bar.id]} rests for another ${formatCooldownRemaining(remainingMs)}` : `${WORLD_LABELS[bar.id]} can be reviewed now`}
            placement="bottom"
        >
            <Typography
                component="span"
                className={`tower-mastery-panel__cooldown tower-mastery-panel__cooldown--${resting ? "resting" : "ready"}`}
                sx={{
                    flex: "none",
                    marginLeft: "auto",
                    whiteSpace: "nowrap",
                    color: ink,
                    fontFamily: TOWER_STUDY_FONT,
                    fontSize: 15,
                    lineHeight: 1.1,
                    // Tabular: the clock re-renders every second and must not jitter.
                    fontVariantNumeric: "tabular-nums",
                    opacity: resting ? 0.8 : 1,
                }}
            >
                {resting ? formatCooldownRemaining(remainingMs) : "Ready to mark!"}
            </Typography>
        </Tooltip>
    );
};

const TowerMasteryPanel: React.FC<TowerMasteryPanelProps> = ({ entry, initialTrack, tracks, ink, night, className }) => {
    // The track on screen. Re-seeded when the opening world changes; if the opening world is
    // not an offered track (its goal was switched off), Know.
    const startTrack = tracks.includes(initialTrack) ? initialTrack : "core";
    const [track, setTrack] = useState<MasteryWorldId>(startTrack);
    useEffect(() => { setTrack(startTrack); }, [startTrack]);

    // One interval for the panel, so a card left open runs its cooldown down to ready.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
        return () => window.clearInterval(id);
    }, []);

    const bar = useMemo(
        () => masteryBar(entry.typedMarkHistory, track, entry.writingMastery),
        [entry.typedMarkHistory, track, entry.writingMastery]
    );

    return (
        <Box
            className={className ? `tower-mastery-panel ${className}` : "tower-mastery-panel"}
            sx={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
            {/* The top row: the track keycap at the left (only when there is more than one
                track), the cooldown at the top RIGHT, above the bar's end. No track name and no
                band pill (owner, 2026-11-23): the keycap says which track is shown and the bar's
                colour says its band. The bottom padding is the keycap's wall, which paints
                outside its box. */}
            <Box
                className="tower-mastery-panel__top-row"
                sx={{ display: "flex", alignItems: "center", gap: "12px", pb: tracks.length > 1 ? `${PLATE_WALL_PX}px` : 0 }}
            >
                {tracks.length > 1 && (
                    <TrackKeycap
                        track={track}
                        onNext={() => setTrack((t) => tracks[(tracks.indexOf(t) + 1) % tracks.length] ?? "core")}
                    />
                )}
                <CooldownTimer bar={bar} entry={entry} now={now} ink={ink} />
            </Box>

            {/* The slab's wall hangs PLATE_WALL_PX below its box; the wrapper reserves it. */}
            <Box className="tower-mastery-panel__bar-row" sx={{ pb: `${PLATE_WALL_PX}px` }}>
                <RaisedBar bar={bar} ink={ink} night={night} />
            </Box>
        </Box>
    );
};

export default TowerMasteryPanel;
