import React, { useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import Icon from "../../../../components/Icon";
import AudioModeChip from "../../../../components/AudioModeChip";
import MinutePointsFireBadge from "../../../../minutePoints/MinutePointsFireBadge";
import { useSidewaysStage } from "../../../../games/runtime/useSidewaysStage";
import {
    BACK_ARROW_ICON,
    BACK_ARROW_PX,
    BACK_GROUP_GAP_PX,
    DENSE_HEADER_PAD_TOP_PX,
    DENSE_HEADER_PAD_X_PX,
    DENSE_HEADER_RIGHT_GAP_PX,
    DENSE_HEADER_TITLE_PX,
    DENSE_HEADER_TITLE_TRACKING,
    TOWER_STUDY_BACK_ARROW_TOP_PX,
    TOWER_STUDY_ROW_PX,
} from "../../../../components/pageHeaderSizing";
import { COLORS } from "../../../../theme/colors";
import { FONTS } from "../../../../theme/fonts";
import { LEADING, WEIGHT } from "../../../../theme/scale";
import { BREAK_AREA_MOTION, circleCoverDiameter, prefersReducedMotion } from "./breakMotion";

/**
 * What the row's ink is doing, from the break's phase (GameBreakArea → `chromeWave`):
 *   in      the circle is growing: each control turns dark as the white reaches it;
 *   dark    the circle is the ground: dark ink only;
 *   out     the run ended: after the board's hold + fade, the circle shrinks and each
 *           control turns white again as the sky comes back under it;
 *   paused  Leave was tapped mid-grow: the circle froze where it was, so does the ink.
 */
export type BreakChromeWave = "in" | "dark" | "out" | "paused";

/** The row's ink on the tower's sky — the study header's (TowerStudyHeader `ON_SKY_INK`). */
const ON_SKY_INK = COLORS.white;
/** The arrow's and the chip's ink on the break's white ground — a page header's default. */
const ON_GROUND_ICON_INK = COLORS.iconColor;
/** The title's ink on the white ground — a page header title's default. */
const ON_GROUND_TITLE_INK = COLORS.onSurface;

/** The arrow's invisible tap margin, px: the glyph alone is a 24px target, and a mid-game thumb misses that. */
const LEAVE_TAP_SLOP_PX = 8;
/** The title's arrival when the row appears at the grow's start, ms. */
const TITLE_FADE_IN_MS = 150;

/** `el`'s top-left in `ancestor`'s own (untransformed) layout coordinates. */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== ancestor) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }
    return { x, y };
}

/**
 * GameBreakChrome — the flp game break's header row (docs/FLP_GAME_BREAKS.md § 2, § 6):
 * Leave's back arrow and the game's name on the left; the game's own controls (a slot),
 * the narration audio chip and the minute-points flame on the right. It is the study
 * header's row redrawn at the same spots (pageHeaderSizing.ts), and it belongs to the
 * break AREA, not to the game: it is on screen from the first frame of the circle grow,
 * replacing the study header (FlashcardsLearnPage hides it while `areaMounted`), and only
 * the game's content arrives after the grow.
 *
 * ── THE INK SWAP ────────────────────────────────────────────────────────────────────
 * Through the grow the row sits on the tower's sky first and the white circle reaches the
 * top corners last. So the arrow, the title and the chip are drawn TWICE, overlaid in one
 * grid cell: a white copy, and a dark copy CLIPPED TO THE CIRCLE — a `clip-path: circle()`
 * centred on the area's centre (converted into each copy's own box, and into the rotated
 * stage for a sideways game), animated with the circle's own duration and easing, so the
 * radius matches the circle's scale frame for frame. Each control turns dark exactly where
 * the white ground arrives under it; the shrink plays it backwards. Clip-path also clips
 * hit-testing, so a tap on the chip lands on whichever copy is showing there.
 *
 * ⚠️ THE FLAME IS DRAWN ONCE. Every `MinutePointsFireBadge` runs its own `useMinutePoints`
 * instance: its own 1-second accrual tick and its own `incrementMinutePoint` calls. A
 * second copy would count every second twice. It reads the same on sky and on white, so it
 * needs no swap. It may only exist while the study header's is unmounted: the flp hides
 * that header for exactly the phases this row is mounted (`gameBreak.areaMounted`), and
 * both follow the same phase in one render, so the two never tick together.
 *
 * Above the game (z 6): the countdown's input shield is z 5 inside the game
 * (GameCountdown.tsx), so Leave and the chip stay tappable through the 3·2·1; the count's
 * DIM portals above the whole area, so the row dims with the board. The row passes
 * presses through (a tile dragged up under it stays grabbable); only its controls take them.
 *
 * Layer: feature component (features/flashcards). Rendered by GameBreakArea.
 */
const GameBreakChrome: React.FC<{
    /** The game's name, beside the arrow as a page header's title. */
    title: string;
    showAudioChip: boolean;
    /** The game is played landscape (FlpBreakGame.sideways): the row turns with it. */
    sideways: boolean;
    wave: BreakChromeWave;
    /** The break area: the circle is centred on it and sized to cover it. */
    areaRef: React.RefObject<HTMLDivElement | null>;
    onLeave: () => void;
    /** Receives the slot element for the game's own row controls (GameFrame `exitRowTrailing`). */
    onTrailingSlot: (el: HTMLElement | null) => void;
}> = ({ title, showAudioChip, sideways, wave, areaRef, onLeave, onTrailingSlot }) => {
    const stage = useSidewaysStage();
    const stageRef = useRef<HTMLDivElement | null>(null);
    // The dark copies, clipped to the circle while it moves.
    const darkEls = useRef(new Set<HTMLElement>());
    const darkRef = (el: HTMLElement | null) => {
        if (el) darkEls.current.add(el);
    };
    const animations = useRef<Animation[]>([]);
    // When the current wave started, so a re-run for new geometry (a sideways stage's
    // first measure, a resize) resumes the clip in step with the circle instead of from 0.
    const waveStart = useRef<{ wave: BreakChromeWave; at: number } | null>(null);
    const rotated = sideways && stage.rotated;

    useLayoutEffect(() => {
        if (wave === "paused") {
            animations.current.forEach((a) => a.pause());
            return;
        }
        animations.current.forEach((a) => a.cancel());
        animations.current = [];
        const area = areaRef.current;
        const stageEl = stageRef.current;
        if (wave === "dark" || !area || !stageEl || prefersReducedMotion()) return;
        if (waveStart.current?.wave !== wave) waveStart.current = { wave, at: performance.now() };
        const elapsed = performance.now() - waveStart.current.at;

        // The circle's centre, in the stage's own coordinates (rotated for a sideways game).
        const box = area.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        let centre: { x: number; y: number };
        if (sideways) {
            centre = stage.toStageCoords(cx, cy);
        } else {
            const own = stageEl.getBoundingClientRect();
            centre = { x: cx - own.left, y: cy - own.top };
        }
        const radius = circleCoverDiameter(area) / 2;
        const { growMs, growEasing, shrinkEasing, shrinkHoldMs, shrinkFadeMs } = BREAK_AREA_MOTION;

        darkEls.current.forEach((el) => {
            if (!el.isConnected) {
                darkEls.current.delete(el);
                return;
            }
            const origin = offsetWithin(el, stageEl);
            const at = `${centre.x - origin.x}px ${centre.y - origin.y}px`;
            const covered = `circle(${radius}px at ${at})`;
            const bare = `circle(0px at ${at})`;
            const animation = el.animate(
                wave === "in" ? [{ clipPath: bare }, { clipPath: covered }] : [{ clipPath: covered }, { clipPath: bare }],
                {
                    duration: growMs,
                    // The shrink waits out the board's hold and fade, as the circle does.
                    delay: wave === "out" ? shrinkHoldMs + shrinkFadeMs : 0,
                    easing: wave === "in" ? growEasing : shrinkEasing,
                    fill: "both",
                },
            );
            animation.currentTime = elapsed;
            animations.current.push(animation);
        });
        // `stage.toStageCoords` follows `rotated`; the dimensions catch a re-measure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wave, rotated, stage.stageWidth, stage.stageHeight]);

    useLayoutEffect(() => () => animations.current.forEach((a) => a.cancel()), []);

    // Once the circle is the ground the white copies are spent: hidden, so they can never
    // peek round a dark glyph's antialiased edge or take a tap.
    const lightVisibility = wave === "dark" ? "hidden" : "visible";
    const overlay = { gridArea: "1 / 1", display: "flex", alignItems: "center" } as const;

    return (
        <Box
            ref={stage.outerRef}
            className="game-break-chrome"
            sx={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none" }}
        >
            <Box
                ref={stageRef}
                className="game-break-chrome__stage"
                style={sideways ? stage.stageStyle : { position: "absolute", inset: 0 }}
            >
                <Box
                    component="button"
                    type="button"
                    className="game-break-chrome__leave"
                    aria-label="Leave"
                    onClick={onLeave}
                    sx={{
                        position: "absolute",
                        top: `${TOWER_STUDY_BACK_ARROW_TOP_PX - LEAVE_TAP_SLOP_PX}px`,
                        left: `${DENSE_HEADER_PAD_X_PX - LEAVE_TAP_SLOP_PX}px`,
                        display: "grid",
                        padding: `${LEAVE_TAP_SLOP_PX}px`,
                        border: "none",
                        backgroundColor: "transparent",
                        cursor: "pointer",
                        pointerEvents: "auto",
                    }}
                >
                    <Box className="game-break-chrome__leave-light" sx={{ ...overlay, visibility: lightVisibility }}>
                        <Icon name={BACK_ARROW_ICON} size={BACK_ARROW_PX} color={ON_SKY_INK} />
                    </Box>
                    <Box ref={darkRef} className="game-break-chrome__leave-dark" sx={overlay}>
                        <Icon name={BACK_ARROW_ICON} size={BACK_ARROW_PX} color={ON_GROUND_ICON_INK} />
                    </Box>
                </Box>

                {/* Not part of the button: a mis-tap on the name must fall through to the
                    game, not end the run. */}
                <Box
                    className="game-break-chrome__title"
                    sx={{
                        position: "absolute",
                        top: `${TOWER_STUDY_BACK_ARROW_TOP_PX}px`,
                        left: `${DENSE_HEADER_PAD_X_PX + BACK_ARROW_PX + BACK_GROUP_GAP_PX}px`,
                        height: `${BACK_ARROW_PX}px`,
                        display: "grid",
                        fontFamily: FONTS.sans,
                        fontSize: `${DENSE_HEADER_TITLE_PX}px`,
                        fontWeight: WEIGHT.semibold,
                        letterSpacing: DENSE_HEADER_TITLE_TRACKING,
                        lineHeight: LEADING.tight,
                        whiteSpace: "nowrap",
                        // The study header has no title, so the name is the one part of the
                        // row that is new at the swap: it arrives rather than pops.
                        animation: `game-break-chrome-title-in ${TITLE_FADE_IN_MS}ms ease-out both`,
                        "@keyframes game-break-chrome-title-in": { from: { opacity: 0 }, to: { opacity: 1 } },
                    }}
                >
                    <Box className="game-break-chrome__title-light" sx={{ ...overlay, color: ON_SKY_INK, visibility: lightVisibility }}>
                        {title}
                    </Box>
                    <Box ref={darkRef} className="game-break-chrome__title-dark" sx={{ ...overlay, color: ON_GROUND_TITLE_INK }}>
                        {title}
                    </Box>
                </Box>

                {/* The study header's right slot: same row box, inset and gap. */}
                <Box
                    className="game-break-chrome__right"
                    sx={{
                        position: "absolute",
                        top: `${DENSE_HEADER_PAD_TOP_PX}px`,
                        right: `${DENSE_HEADER_PAD_X_PX}px`,
                        height: `${TOWER_STUDY_ROW_PX}px`,
                        display: "flex",
                        alignItems: "center",
                        gap: `${DENSE_HEADER_RIGHT_GAP_PX}px`,
                    }}
                >
                    {/* The game's own controls land here (GameFrame `exitRowTrailing`), each
                        owning its pointer events. Empty through the grow. */}
                    <Box ref={onTrailingSlot} className="game-break-chrome__trailing" sx={{ display: "flex", alignItems: "center", "&:empty": { display: "none" } }} />
                    {showAudioChip && (
                        <Box className="game-break-chrome__audio" sx={{ display: "grid" }}>
                            <Box className="game-break-chrome__audio-light" sx={{ ...overlay, visibility: lightVisibility }}>
                                <AudioModeChip ink={ON_SKY_INK} sx={{ pointerEvents: "auto" }} />
                            </Box>
                            <Box ref={darkRef} className="game-break-chrome__audio-dark" sx={overlay}>
                                <AudioModeChip ink={ON_GROUND_ICON_INK} sx={{ pointerEvents: "auto" }} />
                            </Box>
                        </Box>
                    )}
                    <MinutePointsFireBadge />
                </Box>
            </Box>
        </Box>
    );
};

export default GameBreakChrome;
