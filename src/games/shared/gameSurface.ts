import { createContext, useContext } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";

/**
 * THE PER-GAME ACCENT SURFACE (docs/SHELF_REDESIGN.md § A6b — the design's
 * "60/30/10" blocks, `#bm{background:var(--redK)}` and friends).
 *
 * Each game screen is flooded with ONE hue, the play panel sits on it as a white
 * island, and the HUD strip takes the hue's near-white tint: 60% hued ground, 30% white
 * panel, 10% tint.
 *
 * WHY IT IS WORTH THE TROUBLE: a game is the one place in this app where the player
 * is inside a single activity for minutes at a time with no navigation. Flooding the
 * ground is what makes "I am in Word Search" a fact you cannot lose track of, and it
 * is also what makes the panel read as a board rather than as a card on a page.
 *
 * ── v2: THE GROUND IS THE MID TIER, AND THE HEADER STAYS INK ──────────────────────
 * v1 flooded the screen with the hue's dark INK (`--redA`, ~52% lightness) and flipped
 * the header to white to survive it. v2 removed the ink tier: the ground is the hue's
 * MID tier (`--{hue}K`, K = M; artboards 12–16 captions "Mid: … screen background"),
 * which is light, so the header keeps INK text, chips become a translucent-white pill
 * with a `--line2` outline, the on-state inverts to solid ink, and the panel's edge is
 * `--line2` rather than a white alpha.
 *
 * ── WHICH HUE A GAME GETS: `GameDef.hue`, which now EQUALS the artboard ─────────────
 * The ground is derived from the game's HUB hue: each game owns its hue as `GAME_HUE`
 * in its own `constants.ts`, the registry reads it for the hub row, and the page passes
 * it here — so a hub row and the screen it opens cannot drift apart.
 *
 * Since v2 the hub hues are the artboards' own (artboards 12–16): Bubble Match red,
 * Word Search purple, Match Speed blue, Speed Reading yellow, Hydra Bubbles green.
 * (Memory Map, which has no artboard, keeps orange.) (Until 2026-09-24 three of them differed — Match Speed green,
 * Speed Reading blue, Hydra teal — and this paragraph explained why the hub won. Teal
 * has since left the palette, and the three were moved onto the artboards' hues.) The
 * rule is unchanged: to repaint a game, change its `GAME_HUE`, never this file.
 *
 * ── HOW THE HEADER LEARNS ABOUT IT ────────────────────────────────────────────────
 * `gameSurfaceSx` uses DESCENDANT SELECTORS rather than prop-drilling an `onAccent`
 * flag through LeafPage → PageHeader → HeaderIconButton/HeaderToggleChip/the fire badge.
 * That is the design's own mechanism (`#bm .lhd .tg{…}`) and it keeps four shared
 * components free of a flag only games set. The selectors are all on the
 * `page-header__*` / `minute-points-fire-badge` class names those components already
 * emit, and they win on specificity over MUI's single-class `sx` rules.
 *
 * The PANEL's own pieces (`GameHud`, `GameTimer`, `GameFrame`) do not go through CSS:
 * they read the hue from context and paint themselves, because a HUD label's colour
 * is overridable per call site and a blanket descendant rule would clobber it.
 *
 * Layer: presentational. Referenced by docs/GAMES_FEATURE.md and § A6b of
 * docs/SHELF_REDESIGN.md.
 *
 * The two COMPONENTS of this mechanism (`GameSurfaceProvider`, `GameLeafPage`) live in
 * the sibling `GameSurface.tsx`, so neither file mixes component and non-component
 * exports (which Fast Refresh needs).
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

/**
 * Ink for anything drawn DIRECTLY on the accent ground — the header, a block message.
 * Plain ink in v2: the MID-tier ground is light enough to carry it (it was white on
 * v1's dark ink ground).
 */
export const ON_ACCENT_INK = COLORS.onSurface;

/** The panel's edge on the accent ground: `--line2` (`#bm .play{border-color:var(--line2)}`). */
export const ON_ACCENT_LINE = COLORS.border;

/** A toggle chip's resting fill on the accent ground (`#bm .lhd .tg`). */
const ON_ACCENT_CHIP_FILL = "rgba(255, 255, 255, 0.5)";

/**
 * The `sx` for a game's `LeafPage` surface: the accent ground plus the header
 * adjustments it needs.
 *
 * Pair it with a `GameSurfaceProvider` for the same hue — this function paints the
 * page, the provider is what lets the panel's own parts (HUD, timer, frame border)
 * match it.
 */
export function gameSurfaceSx(hue: RampHue): SxProps<Theme> {
    return {
        backgroundColor: RAMP[hue].mid,

        // ── The leaf header, in full ink ──────────────────────────────────────
        // `#bm .lhd h1,#bm .lhd .ms.dn{color:var(--ink)}` — the app's header uses the
        // softer --ink2 for icons, which reads as disabled on a coloured ground.
        "& .page-header__title": { color: ON_ACCENT_INK },
        "& .page-header__back-icon": { color: ON_ACCENT_INK },
        // Right-slot icon actions. Reached through `.ms` because Icon takes its
        // colour as a prop, and the prop is what this rule has to outrank.
        "& .page-header__btn .ms": { color: ON_ACCENT_INK },
        "& .page-header__meta": { color: ON_ACCENT_INK },

        // The streak flame keeps its own orange everywhere else in the app; on a
        // coloured ground it clashes, and the design inks it (`#bm .lhd .fire`).
        "& .minute-points-fire-badge, & .minute-points-fire-badge .ms, & .minute-points-fire-badge__count": {
            color: ON_ACCENT_INK,
        },

        // Toggle chips: OFF is a half-white pill with a `--line2` outline and ink text
        // (the app's grey fill would read as disabled on a hue); ON inverts to solid
        // ink with white text (`#bm .lhd .tg.on`).
        // ⚠️ The outline is an INSET BOX-SHADOW, not a border. A real border would add
        // 2px to each chip's width, and the leaf header is already tight enough that
        // "Hydra Bubbles" ellipsises beside two chips, a restart button and the streak
        // badge — an accent ground must not change the header's metrics.
        "& .page-header__toggle": {
            backgroundColor: ON_ACCENT_CHIP_FILL,
            boxShadow: `inset 0 0 0 1px ${COLORS.border}`,
            color: ON_ACCENT_INK,
        },
        "& .page-header__toggle .ms": { color: ON_ACCENT_INK },
        "& .page-header__toggle--active": {
            backgroundColor: COLORS.onSurface,
            boxShadow: `inset 0 0 0 1px ${COLORS.onSurface}`,
            color: COLORS.white,
        },
        "& .page-header__toggle--active .ms": { color: COLORS.white },
    };
}
