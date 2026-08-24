import { createContext, useContext } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";

/**
 * THE PER-GAME ACCENT SURFACE (docs/SHELF_REDESIGN.md § A6b — the design's
 * "60/30/10" blocks, `#bm{background:var(--redA)}` and friends).
 *
 * A6 shipped the game FRAME (`.play` / `.hud` / `.timer`) on the app's ordinary paper
 * ground. The artboards do something else with it: each game screen is flooded with
 * ONE saturated accent, the play panel sits on that accent as a white island, and the
 * header's ink flips to white to survive it. That is the 60/30/10 split — 60% accent
 * ground, 30% white panel, 10% the hue's near-white tint on the HUD strip.
 *
 * WHY IT IS WORTH THE TROUBLE: a game is the one place in this app where the player
 * is inside a single activity for minutes at a time with no navigation. Flooding the
 * ground is what makes "I am in Word Search" a fact you cannot lose track of, and it
 * is also what makes the panel read as a board rather than as a card on a page.
 *
 * ── WHICH HUE A GAME GETS: `GameDef.hue`, NOT the artboard ────────────────────────
 * The artboards paint Match Speed blue, Speed Reading yellow and Hydra green. The hub
 * rows (`GAME_REGISTRY[].hue`) call those same three games green, blue and teal, and
 * that mapping is already shipped, already visible, and already documented as
 * deliberate ("a persistent per-game color, not a random one" — see `tealAccent` in
 * theme/colors.ts). Copying the artboard would mean a green hub row opening a blue
 * screen for three of six games, so the GROUND IS DERIVED FROM THE HUB HUE and the
 * artboard's per-screen hues are treated as what they are: five screens drawn before
 * the hub had settled. Two of the artboard's five (Bubble Match red, Word Search
 * purple) agree with the hub anyway, and its yellow is not even in the app's ramp.
 *
 * Each game owns its hue as `GAME_HUE` in its own `constants.ts`, which is what the
 * registry reads — so the hub row and the game ground cannot drift apart.
 *
 * ── HOW THE HEADER LEARNS ABOUT IT ────────────────────────────────────────────────
 * `gameSurfaceSx` uses DESCENDANT SELECTORS rather than prop-drilling `onAccent`
 * through LeafPage → PageHeader → HeaderIconButton/HeaderToggleChip/the fire badge.
 * That is the design's own mechanism (`#bm .lhd h1{color:#fff}`) and it keeps four
 * shared components free of a flag that only games set. The selectors are all on the
 * `page-header__*` / `minute-points-fire-badge` class names those components already
 * emit, and they win on specificity: a two-or-three-class descendant selector beats
 * the single-class rule MUI generates for an `sx` colour.
 *
 * The PANEL's own pieces (`GameHud`, `GameTimer`, `GameFrame`) do not go through CSS:
 * they read the hue from context and paint themselves, because a HUD label's colour
 * is overridable per call site (a lives counter turning red) and a blanket descendant
 * rule would silently clobber it.
 *
 * Layer: presentational. Referenced by docs/GAMES_FEATURE.md and § A6b of
 * docs/SHELF_REDESIGN.md.
 *
 * The two COMPONENTS of this mechanism (`GameSurfaceProvider`, `GameLeafPage`) live in
 * the sibling `GameSurface.tsx`. The split is only so that neither file mixes component
 * and non-component exports, which is what Fast Refresh needs to reload either one.
 */

/**
 * The hue of the accent ground the current subtree is sitting on, or `null` when it
 * is on the ordinary paper ground.
 *
 * Null-by-default matters: `GameFrame` and friends are also rendered by surfaces with
 * no accent (and by tests, which mount them bare), so "no provider" has to mean
 * "the pre-A6b look" rather than throwing or defaulting to a colour.
 */
export const GameSurfaceContext = createContext<RampHue | null>(null);

/** The accent hue of the enclosing game surface, or null if there is none. */
export function useGameSurfaceHue(): RampHue | null {
    return useContext(GameSurfaceContext);
}

/** Ink for anything drawn DIRECTLY on the accent ground — the header, a block message. */
export const ON_ACCENT_INK = COLORS.white;

/**
 * A hairline on the accent ground. `COLORS.rowBorder` is an ink alpha and vanishes on
 * a 52%-lightness ground; the design uses a white alpha there instead
 * (`#bm .play{border-color:rgba(255,255,255,.5)}`).
 */
export const ON_ACCENT_LINE = "rgba(255, 255, 255, 0.5)";

/** The same idea one step fainter, for a chip's resting fill and its outline. */
const ON_ACCENT_CHIP_FILL = "rgba(255, 255, 255, 0.16)";
const ON_ACCENT_CHIP_LINE = "rgba(255, 255, 255, 0.45)";

/**
 * The `sx` for a game's `LeafPage` surface: the accent ground plus the header-ink
 * flips it forces.
 *
 * Pair it with a `GameSurfaceProvider` for the same hue — this function paints the
 * page, the provider is what lets the panel's own parts (HUD, timer, frame border)
 * match it.
 */
export function gameSurfaceSx(hue: RampHue): SxProps<Theme> {
    return {
        backgroundColor: RAMP[hue].ink,

        // ── The leaf header, flipped to white ink ─────────────────────────────
        // Title + back chevron (`#bm .lhd h1,#bm .lhd .ms.dn{color:#fff}`).
        "& .page-header__title": { color: ON_ACCENT_INK },
        "& .page-header__back-icon": { color: ON_ACCENT_INK },
        // Right-slot icon actions. Reached through `.ms` because Icon takes its
        // colour as a prop, and the prop is what this rule has to outrank.
        "& .page-header__btn .ms": { color: ON_ACCENT_INK },
        "& .page-header__meta": { color: ON_ACCENT_INK },

        // The streak flame keeps its own hue everywhere else in the app; on a
        // saturated ground `#E65100` is nearly invisible, and the design whites it out
        // (`.lhd .fire{color:#fff}`). Both the glyph and the count.
        "& .minute-points-fire-badge, & .minute-points-fire-badge .ms, & .minute-points-fire-badge__count": {
            color: ON_ACCENT_INK,
        },

        // Toggle chips: OFF is a translucent white pill with white text (the app's
        // grey fill would read as disabled here), ON inverts to solid white with
        // BLACK text. The design changed the on-state's text from the accent ink to
        // `#000` in its latest revision — an accent-on-white chip and an accent
        // ground are the same colour, so the chip's label was competing with the
        // thing it sits on.
        // ⚠️ The outline is an INSET BOX-SHADOW, not a border. A real border would add
        // 2px to each chip's width, and the leaf header is already tight enough that
        // "Hydra Bubbles" ellipsises beside two chips, a restart button and the streak
        // badge — an accent ground must not change the header's metrics.
        "& .page-header__toggle": {
            backgroundColor: ON_ACCENT_CHIP_FILL,
            boxShadow: `inset 0 0 0 1px ${ON_ACCENT_CHIP_LINE}`,
            color: ON_ACCENT_INK,
        },
        "& .page-header__toggle .ms": { color: ON_ACCENT_INK },
        "& .page-header__toggle--active": {
            backgroundColor: COLORS.white,
            boxShadow: `inset 0 0 0 1px ${COLORS.white}`,
            color: COLORS.onSurface,
        },
        "& .page-header__toggle--active .ms": { color: COLORS.onSurface },
    };
}
