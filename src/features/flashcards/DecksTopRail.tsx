import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useDiscoverNavigation } from "../../hooks/useDiscoverNavigation";
import {
    MASTERY_CENTER_BUTTON_LABELS,
    MASTERY_CENTER_GLYPHS,
    MASTERY_CENTER_HUES,
    MASTERY_CENTER_PATHS,
    type MasteryCenterWorld,
} from "./masteryCenters";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { CARD_SURFACE } from "../../theme/surfaces";
import { lowSupplyGlowKeyframes, lowSupplyGlowPeak, LOW_SUPPLY_GLOW_NUDGE, LOW_SUPPLY_GLOW_PULSE_MS } from "../../theme/lowSupplyGlow";

// ── The fdp's top rail ────────────────────────────────────────────────────────
//
// The row above the card hand: the Mastery Center tiles (Reading / Writing — one per
// goal the account pursues) and, always last, the **Sort Cards** tile. Every tile is a
// DESTINATION — a place to go — rather than a session to start, which is why they sit
// above the hand and not in it.
//
// Layout: a flex row whose tiles share the width evenly (1 tile → half, 2 → halves,
// 3 → thirds) but never grow past HALF the row, so a lone Sort tile is not a full-width
// bar. The row is right-justified, so a lone Sort tile sits on the right — the same
// side it holds when Centers are present.
//
// "Cards low": while the core Learning count is under LEARN_NOW_LOW_THRESHOLD
// (server/contracts/wire.ts; the decision lives in the host) the Sort tile breathes a
// green halo (theme/lowSupplyGlow.ts — the same halo shape the sort page's Learning pill
// wears in yellow on arrival) and carries a green "Low" badge in its top-right corner,
// so the glow says WHY.
//
// Docs: docs/DECKS_FEATURE.md § "(b) The top rail" and § "Sort Cards tile".

/** Gap between tiles — also what the half-width cap subtracts. */
const TOP_RAIL_GAP_PX = 9;

// Sort Cards is a blue tile. A hue KEY, not a hex, so a re-theme is this one line.
const SORT_TILE_HUE: RampHue = "blu";
const SORT_TILE_GLYPH = "swap_vert";

// The halo is appended to the tile's resting card shadow, not swapped for it.
const sortTileLowGlow = lowSupplyGlowKeyframes(LOW_SUPPLY_GLOW_NUDGE, SHADOW.cardRest);

/** One rail tile's box: CARD_SURFACE on a pastel of `hue`. Shared by every tile. */
const railTileSx = (hue: RampHue) => ({
    // Even share of the row, capped at half of it (minus half the gap).
    flex: "1 1 0",
    minWidth: 0,
    maxWidth: `calc(50% - ${TOP_RAIL_GAP_PX / 2}px)`,
    position: "relative" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "9px",
    alignItems: "flex-start",
    textAlign: "left" as const,
    // Same object family as the hand below: a pastel card lying on the page.
    // `CARD_SURFACE` (theme/surfaces.ts) is that object — hairline + RESTING elevation
    // (never the front card's lifted one; a tile is not the played card) + the 15px card
    // radius. The hand keeps its own larger 22px radius because those cards are twice the size.
    ...CARD_SURFACE,
    cursor: "pointer",
    padding: "13px 13px 14px",
    // Filled with the ramp's PASTEL tier, not the saturated mark hue: this is a surface
    // (SHELF_REDESIGN.md D2b).
    backgroundColor: RAMP[hue].surface,
});

const RAIL_TILE_LABEL_SX = {
    fontFamily: FONTS.sans,
    fontSize: 14.5,
    fontWeight: WEIGHT.bold,
    letterSpacing: "-0.022em",
    color: COLORS.onSurface,
} as const;

interface RailTileProps {
    hue: RampHue;
    glyph: string;
    label: string;
    className: string;
    onClick: () => void;
    /** Extra sx merged over the tile box (the Sort tile's halo). */
    sx?: object;
    ariaLabel?: string;
    children?: React.ReactNode;
}

const RailTile: React.FC<RailTileProps> = ({ hue, glyph, label, className, onClick, sx, ariaLabel, children }) => (
    <Box
        component="button"
        type="button"
        className={className}
        onClick={onClick}
        aria-label={ariaLabel}
        sx={{ ...railTileSx(hue), ...sx }}
    >
        <Icon name={glyph} size={19} sx={{ opacity: 0.72 }} />
        <Box component="b" className="flashcards-decks__rail-tile-label" sx={RAIL_TILE_LABEL_SX}>
            {label}
        </Box>
        {children}
    </Box>
);

interface DecksTopRailProps {
    /** The Centers this account gets, in MASTERY_CENTER_WORLDS order (activeMasteryCenters). */
    centers: MasteryCenterWorld[];
    /** Light the Sort tile's low-supply halo + badge. */
    learningLow: boolean;
}

const DecksTopRail: React.FC<DecksTopRailProps> = ({ centers, learningLow }) => {
    const slideNavigate = useSlideNavigate();
    const { goToSort } = useDiscoverNavigation();

    return (
        <Box
            className="flashcards-decks__top-rail"
            sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: `${TOP_RAIL_GAP_PX}px`,
                flexShrink: 0,
            }}
        >
            {/* Mastery Centers — coloured by the SKILL's hue: reading green, writing
                purple, the same hue the Center it opens grounds on (MASTERY_CENTER_HUES). */}
            {centers.map((world) => (
                <RailTile
                    key={world}
                    hue={MASTERY_CENTER_HUES[world]}
                    glyph={MASTERY_CENTER_GLYPHS[world]}
                    label={MASTERY_CENTER_BUTTON_LABELS[world]}
                    className={`flashcards-decks__center-tile flashcards-decks__center-tile--${world}`}
                    onClick={() => slideNavigate(MASTERY_CENTER_PATHS[world])}
                />
            ))}

            {/* Sort Cards — always present, always last (rightmost). */}
            <RailTile
                hue={SORT_TILE_HUE}
                glyph={SORT_TILE_GLYPH}
                label="Sort Cards"
                className={[
                    "flashcards-decks__sort-tile",
                    learningLow && "flashcards-decks__sort-tile--low",
                ].filter(Boolean).join(" ")}
                onClick={goToSort}
                ariaLabel={learningLow ? "Sort Cards — card count low" : undefined}
                sx={learningLow ? {
                    animation: `${sortTileLowGlow} ${LOW_SUPPLY_GLOW_PULSE_MS}ms ease-in-out infinite`,
                    "@media (prefers-reduced-motion: reduce)": {
                        animation: "none",
                        boxShadow: lowSupplyGlowPeak(LOW_SUPPLY_GLOW_NUDGE, SHADOW.cardRest),
                    },
                } : undefined}
            >
                {learningLow && (
                    // Inside the tile's top-right corner, on the glyph's row (the tile's
                    // 13px top pad + ~1px to centre on the 19px glyph), so it sits beside
                    // the icon and clear of the label below.
                    <Box
                        component="span"
                        className="flashcards-decks__sort-tile-badge"
                        aria-hidden
                        sx={{
                            position: "absolute",
                            top: "14px",
                            right: "11px",
                            padding: "1px 7px",
                            borderRadius: "999px",
                            border: `1px solid ${COLORS.border}`,
                            backgroundColor: LOW_SUPPLY_GLOW_NUDGE,
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.micro,
                            fontWeight: WEIGHT.bold,
                            lineHeight: 1.4,
                            color: COLORS.onSurface,
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                        }}
                    >
                        Low
                    </Box>
                )}
            </RailTile>
        </Box>
    );
};

export default DecksTopRail;
