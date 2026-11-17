import { BentoTile, CARD_SHELL } from "../../components/bento";
import { RAMP, type RampHue } from "../../theme/colors";
import { mixHex } from "../../theme/shadeHex";
import { KEYCAP_POP_TRANSITION } from "../../theme/keycapPress";
import type { FriendsView } from "./friendsView";

/**
 * FriendActionTiles — the Friends tab's Send / Accept / Remove tiles
 * (docs/FRIENDS_FEATURE.md § "The action tiles"): the 3-up `compact` bento tiles (hue,
 * ghost glyph, one-word title, Accept's alert pin), acting as a toggle group instead of
 * navigating.
 *
 * Contract: at most one tile selected. Tapping the selected tile deselects it (back to the
 * leaderboard); tapping another moves the selection across. The host (FriendsBody) owns
 * the state and the slide; this file only draws it.
 *
 * ── Each tile is a TWO-STATE BUTTON: state by COLOUR, press by SIZE ──
 *   none selected   all three wear the hue's MID tier (BentoTile's body)
 *   one selected    the selected tile KEEPS its MID fill; the other two fade to a blend
 *                   halfway between their hue's SURFACE and TINT tiers (DIM_TOWARD_TINT),
 *                   so the selected tile reads as lit and its siblings recede. Their
 *                   ghost glyphs fade with them (DIMMED_GHOST_OPACITY). Both are tiers of the tile's own hue, so the
 *                   state stays inside the colour framework and each tile keeps its
 *                   action's valence colour (blue neutral, green affirmative, red
 *                   destructive)
 *   held            scale(0.76), from any state; the fill does not change while held
 * Size never encodes the state: every tile rests at full size. Pressing sinks the tile
 * quickly (PRESS_IN_TRANSITION); releasing fires the click (a button's click lands on
 * release), which flips the view, while the tile springs back to full size with a small
 * overshoot (KEYCAP_POP_TRANSITION, ease-out-back) and the fills fade to the new state.
 * (History: until 2026-11-16 the selected tile wore a 2px ink outline; on 2026-11-16 it
 * was briefly shown by a latched smaller scale, then by a MARK-tier fill on the selected
 * tile — judged too loud — then by fading the siblings to TINT — too drastic — and
 * then to SURFACE — not strong enough — and finally to the SURFACE↔TINT midpoint, all on
 * 2026-11-17.)
 *
 * ── `:active` only, deliberately NOT the keycap delegate ──
 * The app-wide keycap delegate (src/utils/keycapPressDelegate.ts) holds a press for a
 * minimum KEYCAP_MIN_HELD_MS so even the quickest tap paints. On these tiles that floor
 * read as lag — the tile sat at its smallest size after the finger lifted (user,
 * 2026-11-16) — so the held look is plain `:active` and ends the instant the finger does.
 *
 * Layer: feature view (src/features/friends). Rendered by FriendsBody, inside its Bento grid.
 */

/** Scale while the finger is down, from either state. */
const HELD_SCALE = 0.76;
/** The press-in: quick and settling, like the tower plate's 80 ms sink. */
const PRESS_IN_TRANSITION = "90ms cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The fill's fade between states. A plain ease-out: the spring's overshoot is for size,
 *  and a colour that overshoots just flickers. */
const FILL_TRANSITION = "220ms cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * How far a dimmed sibling's fill sits from SURFACE toward TINT (0 = surface, 1 = tint).
 * The ramp has no tier between the two: SURFACE alone was too faint a difference and
 * TINT too drastic, so the fill is a blend of the two framework tiers — both from the
 * tile's own hue, so it never leaves that hue. Tune this one number.
 */
const DIM_TOWARD_TINT = 0.5;
/**
 * A dimmed sibling's ghost-glyph opacity (rest: CARD_SHELL.ghostOpacity, 0.15). The glyph
 * is ink at a FIXED opacity, so on the lighter dimmed fill it would hold its weight and
 * end up the most emphasized thing on a tile meant to recede. Fading it with the fill
 * keeps the glyph's contrast against its tile roughly where it was.
 */
const DIMMED_GHOST_OPACITY = 0.07;

/**
 * A tile's press + selection styles (see header). `dimmed` = ANOTHER tile is selected.
 */
function pressScaleSx(dimmed: boolean, hue: RampHue) {
    return {
        // A sibling of the selected tile fades MID → the SURFACE↔TINT blend. `backgroundColor` overrides the
        // colour that CardShell's `background` shorthand set, since this sx merges after it.
        ...(dimmed ? { backgroundColor: mixHex(RAMP[hue].surface, RAMP[hue].tint, DIM_TOWARD_TINT) } : {}),
        // The ghost glyph fades with the fill (see DIMMED_GHOST_OPACITY). Parent + child
        // class out-specifies the glyph's own single-class opacity from CardShell.
        "& .bento-tile__ghost": {
            opacity: dimmed ? DIMMED_GHOST_OPACITY : CARD_SHELL.ghostOpacity,
            transition: `opacity ${FILL_TRANSITION}`,
        },
        transform: "scale(1)",
        // The transition on the RESTING state is the one that runs on release, so it
        // carries the spring; the held state's own transition runs on the press-in.
        transition: `transform ${KEYCAP_POP_TRANSITION}, background-color ${FILL_TRANSITION}`,
        "&:active": {
            transform: `scale(${HELD_SCALE})`,
            transition: `transform ${PRESS_IN_TRANSITION}, background-color ${FILL_TRANSITION}`,
        },
        "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
            "&:active": { transition: "none" },
            "& .bento-tile__ghost": { transition: "none" },
        },
    } as const;
}

interface ActionTile {
    view: Exclude<FriendsView, "board">;
    title: string;
    hue: RampHue;
    icon: string;
}

const TILES: ActionTile[] = [
    { view: "send", title: "Send", hue: "blu", icon: "send" },
    { view: "accept", title: "Accept", hue: "grn", icon: "mark_email_unread" },
    { view: "remove", title: "Remove", hue: "red", icon: "person_remove" },
];

interface FriendActionTilesProps {
    /** The selected view, or "board" when no tile is selected. */
    view: FriendsView;
    /** Select a tile, or deselect it when it is the selected one. */
    onToggle: (view: Exclude<FriendsView, "board">) => void;
    /** Incoming request count — the Accept tile's alert pin (hidden at 0). */
    incomingCount: number;
}

/** A fragment, not a wrapper: the tiles are cells of the host's Bento grid. */
function FriendActionTiles({ view, onToggle, incomingCount }: FriendActionTilesProps) {
    return (
        <>
            {TILES.map((tile) => {
                const selected = view === tile.view;
                return (
                    <BentoTile
                        key={tile.view}
                        className={`friends-page__action-tile friends-page__${tile.view}-tile${selected ? " friends-page__action-tile--selected" : ""}`}
                        title={tile.title}
                        hue={tile.hue}
                        icon={tile.icon}
                        variant="compact"
                        pin={tile.view === "accept" && incomingCount > 0 ? incomingCount : undefined}
                        pinTone="alert"
                        pressed={selected}
                        onClick={() => onToggle(tile.view)}
                        sx={pressScaleSx(view !== "board" && !selected, tile.hue)}
                    />
                );
            })}
        </>
    );
}

export default FriendActionTiles;
