import { BentoTile } from "../../components/bento";
import { COLORS, type RampHue } from "../../theme/colors";
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
 * ── The selected tile wears an INK RING ──
 * A 2px `COLORS.onSurface` outline drawn just inside the edge (`outlineOffset: -2px`) —
 * the "stronger ink ring" CLAUDE.md § "Buttons & cards" names for selected tiles. An
 * OUTLINE rather than an inset box-shadow because an outline paints above the tile's
 * content, so the ghost glyph bleeding off the top-right cannot cover the ring; and inside
 * the edge, so selecting never changes the tile's box and the row does not jog. The
 * resting `SHADOW.rest` is untouched. The fill never changes:
 * the ring alone says which tile is selected, so each tile keeps its action's valence
 * colour (blue neutral, green affirmative, red destructive) in both states.
 *
 * Layer: feature view (src/features/friends). Rendered by FriendsBody, inside its Bento grid.
 */

/** The selected tile's ring (see header). */
const SELECTED_RING_SX = { outline: `2px solid ${COLORS.onSurface}`, outlineOffset: "-2px" } as const;

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
                        sx={selected ? SELECTED_RING_SX : undefined}
                    />
                );
            })}
        </>
    );
}

export default FriendActionTiles;
