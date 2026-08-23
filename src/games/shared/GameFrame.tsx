import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Label } from "../../components/primitives";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * GAME SURFACE CHROME (docs/SHELF_REDESIGN.md § A6, classes `.play` / `.hud` / `.timer`).
 *
 * Every game artboard is the same frame: the leaf header (A2b, `LeafPageHeader`) over an
 * INSET ROUNDED PANEL holding the play surface, optionally preceded by a strip of mono
 * facts and/or a clock. Only the frame is shared; what goes inside it stays in each
 * game's own folder.
 *
 * WHY THE PANEL EXISTS AT ALL — it is not decoration. Before this, every game drew its
 * board edge-to-edge on the page ground, so the board's boundary and the phone's were the
 * same line and a bubble drifting to the edge looked like it had left the app. The inset
 * white panel gives the play area its own visible boundary: "inside here is the game,
 * outside is the app". It also means a physics surface can measure ONE element for its
 * bounds instead of reasoning about page padding.
 *
 * ── OBLIGATIONS THIS FRAME DOES NOT DISCHARGE ────────────────────────────────────────
 * `useBlockEdgeSwipe(true)` and `touchAction: "none"` stay the PAGE's job (CLAUDE.md,
 * docs/UX_AND_NAVIGATION.md). They are not folded in here on purpose: this component is
 * presentational and mounts inside `LeafPage`, whereas the edge-swipe block is a
 * document-level touch handler with a lifecycle, and burying it in a layout wrapper would
 * make "why can I still swipe out of this game" invisible to whoever reads the page.
 *
 * Layer: presentational. Every value below (deadline, score, fraction) is computed by the
 * owning page and passed down; nothing here holds state.
 *
 * Used by: docs/GAMES_FEATURE.md, and entries 12–16 of docs/SHELF_REDESIGN.md.
 */

export interface GameFrameProps {
    children: React.ReactNode;
    className?: string;
    sx?: SxProps<Theme>;
}

/**
 * `.play` — the inset play panel.
 *
 * The artboard positions this absolutely (`left/right:14, top:64, bottom:14`) because an
 * artboard is a fixed 402×874 rectangle. Here it is a flex child of `LeafPage`'s body
 * instead, so the header can be whatever height its title and slots make it — the 64px in
 * the CSS is the artboard's header height plus its gap, not a number the app should
 * hardcode.
 */
export const GameFrame: React.FC<GameFrameProps> = ({ children, className, sx }) => (
    <Box
        className={className ? `game-frame ${className}` : "game-frame"}
        sx={[
            {
                // Anchors any overlay a game draws over its own board (a countdown, a
                // pause veil) to the PANEL rather than to the page, so the scrim stops
                // at the panel's rounded edge instead of covering its margin.
                position: "relative",
                flex: 1,
                minHeight: 0,
                margin: "14px",
                borderRadius: "24px",
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {children}
    </Box>
);

export interface GameHudProps {
    /** Typically two or three `GameHudLabel`s. Spread apart, first left, last right. */
    children: React.ReactNode;
    /**
     * Draw the hairline under the strip. Default true. Pass `false` when the HUD sits
     * DIRECTLY under a `GameTimer`, which already draws one: two hairlines a row apart
     * read as an empty table row rather than as a divider (artboard 14 sets
     * `border-bottom:none` on that HUD for exactly this reason).
     */
    divider?: boolean;
    className?: string;
}

/**
 * `.hud` — the bordered strip of mono facts at the top of the panel: score, lives,
 * round, cards left.
 *
 * It is `justify-content: space-between`, so the number of children is load-bearing —
 * two children pin to the edges, three put one in the middle. A HUD needing four facts
 * is a HUD that should be showing fewer.
 */
export const GameHud: React.FC<GameHudProps> = ({ children, divider = true, className }) => (
    <Box
        className={className ? `game-hud ${className}` : "game-hud"}
        sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            padding: "12px 15px",
            borderBottom: divider ? `1px solid ${COLORS.rowBorder}` : "none",
        }}
    >
        {children}
    </Box>
);

export interface GameHudLabelProps {
    children: React.ReactNode;
    /** Overrides the faint default — e.g. a lives counter turning red on the last life. */
    color?: string;
    className?: string;
}

/** `.hud .lab` — one fact. A `Label` that refuses to wrap; the strip is one line. */
export const GameHudLabel: React.FC<GameHudLabelProps> = ({ children, color, className }) => (
    <Label className={className} color={color} sx={{ whiteSpace: "nowrap" }}>
        {children}
    </Label>
);

export interface GameHudBarProps {
    /** 0…1. Clamped here — a caller dividing by a total that can be 0 must not NaN the bar. */
    fraction: number;
    /** Fill colour. Each game passes its own accent so the bar reads as that game's. */
    color: string;
    className?: string;
}

/**
 * `.hud` progress bar — the third slot of a HUD strip, taking whatever width the two
 * labels leave (`flex: 1`).
 *
 * It always states the same thing the labels beside it already do, and that is the
 * point: the count is what you read when you look, the bar is what you see when you
 * don't. Games where progress is a fraction of a KNOWN whole use it; a game with no
 * end (Hydra's endless board) points it at whatever else is filling up.
 */
export const GameHudBar: React.FC<GameHudBarProps> = ({ fraction, color, className }) => (
    <Box
        className={className ? `game-hud-bar ${className}` : "game-hud-bar"}
        sx={{
            flex: 1,
            height: "4px",
            borderRadius: "2px",
            backgroundColor: COLORS.card,
            overflow: "hidden",
        }}
    >
        <Box
            className="game-hud-bar__fill"
            sx={{
                display: "block",
                height: "100%",
                borderRadius: "2px",
                width: `${Math.min(1, Math.max(0, fraction || 0)) * 100}%`,
                backgroundColor: color,
                transition: "width 250ms ease-out, background-color 300ms linear",
            }}
        />
    </Box>
);

export interface GameHintProps {
    children: React.ReactNode;
    className?: string;
}

/**
 * The one-line instruction at the FOOT of the play panel — "tap a pair · they float
 * upward", "tap a word, then its meaning".
 *
 * Three artboards (12, 14, 15) draw the same line in the same place, so it is chrome
 * rather than per-game copy. It is deliberately a `.lab`: mono, uppercase, faint. A rule
 * you need on your first run and never read again should be legible on request and
 * invisible the rest of the time — rendering it as body text would make the panel look
 * like it is explaining itself every round.
 *
 * `flexShrink: 0` so it survives a board that wants all the height.
 */
export const GameHint: React.FC<GameHintProps> = ({ children, className }) => (
    <Label
        className={className ? `game-hint ${className}` : "game-hint"}
        sx={{ flexShrink: 0, display: "block", textAlign: "center", padding: "8px 12px 11px" }}
    >
        {children}
    </Label>
);

export interface GameTimerProps {
    /** The clock, already formatted — "0:24", "18s", "3 / 20". The frame does no math. */
    value: React.ReactNode;
    /** Track fill, 0…1. Clamped here, because a deadline clock can overshoot a tick past zero. */
    fraction: number;
    /** Fill colour of the track. Defaults to the ink ramp; pass a hue's ink to signal urgency. */
    fillColor?: string;
    /** Colour of the numerals. Defaults to the primary ink. */
    valueColor?: string;
    /**
     * Fade the whole block. For a run that has ENDED and left the board up as a cleanup
     * surface — a frozen 0:00 at full strength reads as broken rather than finished.
     */
    dimmed?: boolean;
    /**
     * Pulse the numerals. The design draws no pulse — but a colour change plus a nearly
     * drained track is easy to miss in peripheral vision, which is exactly where a clock
     * is read mid-game, so the app keeps the motion. Opt-in per game.
     */
    pulse?: boolean;
    className?: string;
}

/**
 * `.timer` — the run clock, inside the panel rather than in the page header.
 *
 * It sits here because it is GAME STATE, not chrome: the player's eyes are on the board,
 * and a countdown they have to look away to read is a countdown they stop reading. The
 * track underneath is the part that actually works — it makes the last seconds legible
 * peripherally, so the run's ending can be felt without parsing digits.
 *
 * The numerals are `tabular-nums`. Without that the digits shift horizontally once a
 * second and the whole panel reads as twitching.
 */
export const GameTimer: React.FC<GameTimerProps> = ({
    value,
    fraction,
    fillColor = COLORS.onSurface,
    valueColor = COLORS.onSurface,
    dimmed = false,
    pulse = false,
    className,
}) => (
    <Box
        className={className ? `game-timer ${className}` : "game-timer"}
        sx={{
            flexShrink: 0,
            textAlign: "center",
            padding: "13px 15px 11px",
            borderBottom: `1px solid ${COLORS.rowBorder}`,
            opacity: dimmed ? 0.35 : 1,
            transition: "opacity 200ms linear",
        }}
    >
        <Box
            className="game-timer__value"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: 28,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.1,
                color: valueColor,
                transition: "color 300ms linear",
                animation: pulse ? "game-timer-pulse 1s ease-in-out infinite" : "none",
                "@keyframes game-timer-pulse": {
                    "0%, 100%": { opacity: 1 },
                    "50%": { opacity: 0.45 },
                },
            }}
        >
            {value}
        </Box>
        <Box
            className="game-timer__track"
            sx={{
                height: "4px",
                borderRadius: "2px",
                backgroundColor: COLORS.card,
                marginTop: "7px",
                overflow: "hidden",
            }}
        >
            <Box
                className="game-timer__fill"
                sx={{
                    display: "block",
                    height: "100%",
                    borderRadius: "2px",
                    // Width is driven by the owner's clock tick; the transition only
                    // smooths between samples.
                    width: `${Math.min(1, Math.max(0, fraction)) * 100}%`,
                    backgroundColor: fillColor,
                    transition: "width 200ms linear, background-color 300ms linear",
                }}
            />
        </Box>
    </Box>
);

export default GameFrame;
