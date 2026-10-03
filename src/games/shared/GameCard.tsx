import { type ReactNode } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import Icon from "../../components/Icon";
import RoundPlayButton from "../../components/RoundPlayButton";
import { BentoTile, CardShell, CARD_TITLE_SX, TILE_VARIANTS } from "../../components/bento";
import { LEVEL_CONFIGS } from "../bubble-match/constants";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

/**
 * GameCard — THE game-launcher entity. Every game on every launch surface is one of
 * its two variants, and both are Bento-family members, so a style change carries
 * across all of them:
 *
 *   variant="tile" — a half-width `BentoTile`: name, ghost glyph, optional win pill
 *                    (top-left, clear of the ghost). The whole tile is the launch.
 *                    Games hub: Match Speed, Hydra Bubbles, Memory Map.
 *   variant="card" — a full-width `CardShell` (the same body BentoTile renders
 *                    through): a header (name + win pill), then a row of launch
 *                    OPTIONS and an optional corner `RoundPlayButton`. The design's `.gc`
 *                    (docs/READING_WRITING_CENTERS.md § Phase 1).
 *                    Games hub: Bubble Match, Word Search. Reading Center carousel:
 *                    Bubble Match, Word Search, Speed Reading.
 *
 * An OPTION is one of two kinds, both drawn on the shared `GameOptionTile` shell:
 *   kind="level"  — a hued tile with a name and a weekly ⭐ (Bubble Match's levels);
 *   kind="resume" — a caller-rendered node (Word Search's `WordSearchResumeTile`, which
 *                   owns its own resume / delete-confirm faces) on the same shell.
 * Every option occupies one SLOT (`SLOT_FLEX`, one Bubble Match level's width), so a
 * lone Resume box lines up with the level boxes on the card above it.
 *
 * Card data comes from the builders in games/shared/gameCards.ts
 * (`gameCardBase`, `buildPlayCard`) and the per-game ones that extend them
 * (`buildBubbleMatchCard`, `useWordSearchLauncher`). Purely presentational: every
 * launch is an `onSelect` / `to`, and the caller decides where it goes.
 *
 * Layer: shared game UI component (src/games/shared).
 * Docs: docs/GAMES_FEATURE.md § "Games hub", docs/READING_WRITING_CENTERS.md,
 *       docs/BENTO_SYSTEM.md § "CardShell".
 */

/** The gap between option slots (`.gopts`). */
const OPTION_GAP = 7;
/** A card's options row is divided into this many slots — Bubble Match's level count. */
const LEVEL_SLOTS = LEVEL_CONFIGS.length;
/** Flex basis of one option slot (one Bubble Match level tile's width). With all
 *  LEVEL_SLOTS slots filled this is exactly an even split of the row. */
const SLOT_FLEX = `0 0 calc((100% - ${OPTION_GAP * (LEVEL_SLOTS - 1)}px) / ${LEVEL_SLOTS})`;
/** An option tile's floor — also the options row's, so a play-button-only card is as
 *  tall as one carrying option tiles. */
const OPTION_MIN_HEIGHT = 62;

/** One launch target inside a `card` — the design's `.gopts > div`. */
export type GameCardOption =
    | {
        kind: "level";
        key: string;
        title: string;
        /** The tile's fill (a level hue's MID tier). Absent → translucent frost. */
        ground?: string;
        /** Cleared this week. */
        star?: boolean;
        onSelect: () => void;
    }
    | {
        kind: "resume";
        key: string;
        /** The caller's tile, drawn on `GameOptionTile` (it owns its faces + taps). */
        node: ReactNode;
    };

export interface GameCardData {
    gameId: string;
    title: string;
    glyph: string;
    /** Ramp hue of the body (its MID tier). Absent → white — Bubble Match's card, whose
     *  options carry the hues (a hued card under hued options reads as one block).
     *  Required by the `tile` variant. */
    hue?: RampHue;
    /** Lifetime win count (useGameWins `totalWins`), drawn as a `WinCountPill`.
     *  Absent → no pill (a tile for a game that does not log wins). A `card` always
     *  passes it, so every card's header keeps the same shape, zero included. */
    wins?: number;
    /** `card` only. */
    options: GameCardOption[];
    /** `card`: the corner play button (and the whole-card tap). `tile`: used as the
     *  tile's click when there is no `to`. */
    play?: { ariaLabel: string; onSelect: () => void };
    /** `card` only: draw the outer outline (default true — game cards are outlined,
     *  CLAUDE.md § "Buttons & cards"). Word Search's card sets false; its resume tile
     *  stays outlined. A `tile` is never outlined (Bento tiles are the exception). */
    outlined?: boolean;
    /** `tile` only: the tile is a router link to this path (middle-click/new-tab work). */
    to?: string;
}

/**
 * A lifetime win count as a pill badge: a trophy glyph + the number in a capsule. Frost
 * ground + a hairline so it reads on both the white Bubble Match card and the hued
 * cards/tiles without picking up either's colour. THE one win badge across game
 * launchers — card headers and tile pins both wear it.
 */
export const WinCountPill: React.FC<{ wins: number; classPrefix: string }> = ({ wins, classPrefix }) => (
    <Box
        component="span"
        className={`${classPrefix}__win-pill`}
        aria-label={`${wins} ${wins === 1 ? "win" : "wins"}`}
        sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            flexShrink: 0,
            alignSelf: "center",
            padding: "2px 8px 2px 6px",
            borderRadius: "999px",
            backgroundColor: COLORS.frost,
            border: `1px solid ${COLORS.rowBorder}`,
            fontFamily: FONTS.sans,
            fontSize: 11,
            fontWeight: WEIGHT.bold,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.4,
            color: COLORS.iconColor,
            whiteSpace: "nowrap",
        }}
    >
        <Icon name="emoji_events" size={12} sx={{ color: COLORS.iconColor }} />
        {wins}
    </Box>
);

/** An option tile's name — shared by level tiles and the resume tile's "Resume". */
export const OPTION_TITLE_SX = {
    fontFamily: FONTS.sans,
    fontSize: 12.5,
    fontWeight: 600,
    letterSpacing: "-0.018em",
    color: COLORS.onSurface,
} as const;

interface GameOptionTileProps {
    className?: string;
    /** The tile's fill. Default: translucent frost over the card. */
    ground?: string;
    /** `button` for a plain launch tile; a `div` when the content holds its own buttons. */
    component?: "button" | "div";
    onClick?: (e: React.MouseEvent) => void;
    ariaLabel?: string;
    children: ReactNode;
}

/**
 * The shell every option tile is drawn on — radius, padding, floor, outline, and
 * foot-aligned content. Fills its slot (`flex: 1` inside GameCard's slot wrapper).
 * Exported for `WordSearchResumeTile`, so the resume box is the SAME tile as a level
 * box with different contents, not a hand-copied look-alike.
 */
export const GameOptionTile: React.FC<GameOptionTileProps> = ({
    className, ground = COLORS.frost, component = "div", onClick, ariaLabel, children,
}) => (
    <Box
        component={component}
        type={component === "button" ? "button" : undefined}
        className={className}
        onClick={onClick}
        aria-label={ariaLabel}
        sx={{
            position: "relative",
            flex: 1,
            // min-width:auto (the flex default) would floor the tile at its content's
            // min-content width and break the slot grid.
            minWidth: 0,
            minHeight: OPTION_MIN_HEIGHT,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            textAlign: "left",
            font: "inherit",
            borderRadius: "13px",
            padding: "9px 10px",
            cursor: "pointer",
            border: `1px solid ${COLORS.border}`,
            backgroundColor: ground,
        }}
    >
        {children}
    </Box>
);

interface GameCardProps {
    card: GameCardData;
    variant?: "card" | "tile";
    /** BEM block for every class on the card (`<prefix>__card`, `<prefix>__option`, …),
     *  so each surface keeps its own selectable class names. */
    classPrefix: string;
    /** `card` only: sizing from the host surface (fixed width + snap, or a grid span).
     *  A `tile` is sized by the Bento grid itself. */
    sx?: SxProps<Theme>;
}

/** Keep a tap on an inner control from bubbling up to the card's whole-card play tap. */
const stopCardTap = (e: React.MouseEvent) => e.stopPropagation();

/**
 * A card WITH a play button is tappable everywhere: a tap anywhere on it that no inner
 * control claims (header, ghost, the empty stretch of the options row) acts as if the
 * play button were pressed. Option slots and the play button stop their tap from
 * bubbling so it is never handled twice.
 *
 * The card is NOT made a button (a button may not contain the option buttons); the play
 * button stays the keyboard-focusable control for the same action, so the whole-card
 * tap is a pointer convenience on top of it. A desktop drag on the Reading Center belt
 * cannot fire it: `useDragScroll` swallows the click a drag would end in.
 */
const GameCard: React.FC<GameCardProps> = ({ card, variant = "card", classPrefix, sx }) => {
    if (variant === "tile") {
        return (
            <BentoTile
                to={card.to}
                onClick={card.to ? undefined : card.play?.onSelect}
                className={`${classPrefix}__tile ${classPrefix}__tile--${card.gameId}`}
                title={card.title}
                hue={card.hue ?? "pur"}
                icon={card.glyph}
                // `pinBare`: the pill brings its own chrome. Top-LEFT, clear of the ghost.
                pin={card.wins !== undefined ? <WinCountPill wins={card.wins} classPrefix={classPrefix} /> : undefined}
                pinBare
                pinSide="left"
            />
        );
    }

    const base = TILE_VARIANTS.base;
    return (
        <CardShell
            className={`${classPrefix}__card ${classPrefix}__card--${card.gameId}`}
            onClick={card.play?.onSelect}
            background={card.hue ? RAMP[card.hue].mid : COLORS.white}
            outlined={card.outlined ?? true}
            // The base tile's ghost — a card is a tile that grew an options row.
            ghost={{ name: card.glyph, size: base.ghost, top: base.ghostTop, className: `${classPrefix}__ghost` }}
            sx={[
                {
                    gap: "12px",
                    cursor: card.play ? "pointer" : undefined,
                    // An un-outlined CARD keeps a transparent 1px frame, so its footprint
                    // matches an outlined card stacked above/beside it (Word Search under
                    // Bubble Match). Tiles do not need this — they never sit in a stack.
                    ...(card.outlined === false ? { border: "1px solid transparent" } : {}),
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {/* Title + win pill sit INLINE — the pill follows the title rather than being
                pushed to the far edge, where it would collide with the ghost glyph. */}
            <Box className={`${classPrefix}__card-header`} sx={{ position: "relative", display: "flex", alignItems: "center", gap: "8px", padding: "0 2px" }}>
                <Box component="b" className={`${classPrefix}__card-title`} sx={CARD_TITLE_SX}>
                    {card.title}
                </Box>
                {card.wins !== undefined && <WinCountPill wins={card.wins} classPrefix={classPrefix} />}
            </Box>
            <Box
                className={`${classPrefix}__options`}
                sx={{ position: "relative", display: "flex", alignItems: "flex-end", gap: `${OPTION_GAP}px`, minHeight: OPTION_MIN_HEIGHT }}
            >
                {card.options.map((opt) => (
                    // One SLOT per option. The wrapper owns the width and stops the tap
                    // from reaching the whole-card play tap; the tile inside fills it.
                    <Box
                        key={opt.key}
                        className={`${classPrefix}__slot`}
                        onClick={stopCardTap}
                        sx={{ flex: SLOT_FLEX, minWidth: 0, alignSelf: "stretch", display: "flex" }}
                    >
                        {opt.kind === "level" ? (
                            <GameOptionTile
                                component="button"
                                className={`${classPrefix}__option ${classPrefix}__option--${opt.key}`}
                                ground={opt.ground}
                                onClick={opt.onSelect}
                            >
                                {opt.star && (
                                    <Box component="span" className={`${classPrefix}__option-star`} sx={{ position: "absolute", top: 7, right: 8, fontSize: 11 }}>
                                        ⭐
                                    </Box>
                                )}
                                <Box component="b" sx={OPTION_TITLE_SX}>{opt.title}</Box>
                            </GameOptionTile>
                        ) : (
                            opt.node
                        )}
                    </Box>
                ))}
                {card.play && (
                    <RoundPlayButton
                        size="card"
                        className={`${classPrefix}__play`}
                        ariaLabel={card.play.ariaLabel}
                        onClick={(e) => { stopCardTap(e); card.play?.onSelect(); }}
                        sx={{ marginLeft: "auto" }}
                    />
                )}
            </Box>
        </CardShell>
    );
};

export default GameCard;
