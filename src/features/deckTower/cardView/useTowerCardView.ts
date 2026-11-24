import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { VocabEntry } from "../../../types";
import type { TowerWorldId } from "../towerWorlds";

/**
 * useTowerCardView — open / close state for td's CARD VIEW, the card detail that opens in
 * place over the cards page (docs/DECK_TOWER.md § "The card view"). It replaced the routed
 * card detail page (`/flashcards/card/:id`, deleted 2026-11-23).
 *
 * ── The history entry ──
 * Opening PUSHES a history entry on td's own path, carrying `{ towerCard: <vet id> }` in its
 * route state beside td's `towerWorld` (useRememberTowerWorld writes that into
 * `history.state.usr`, so it is read from there, not from the stale `location.state`). A
 * browser-owned Back (the edge swipe, Android system back, the browser button) is then a
 * POP onto td's previous entry: the watcher below sees `towerCard` gone and starts the
 * close. The view's own back arrow goes through the same door (`navigate(-1)`), so there is
 * ONE close path, whichever Back was used. No route is matched or remounted: App renders a
 * plain <Routes> with no location key, so a same-path push re-renders td, nothing more.
 *
 * A reload while a card is open lands on an entry that still names `towerCard`; the card
 * is NOT restored (the cards page is not scrolled to, and there is no tile to zoom from),
 * so the stale key is stripped at mount.
 *
 * ── Lifecycle ──
 *   null → open(entry, tile, world) → { closing: false } → requestClose / POP →
 *   { closing: true } → the view's zoom-back ends → finish() → null
 * `revealHost` flips during the close, when the zoom has landed back on the tile, so the
 * tower's content fades in around it (TowerCardView → `onRevealHost`).
 *
 * `refreshKey` bumps on every close: the card may have been edited (sense, icon layout) or
 * removed from Learning in the view, and the cards page used to re-read the library by
 * remounting on its return from the routed page. TowerCardsPage hands it to
 * useCardLibrary, which re-reads quietly.
 *
 * Layer: feature hook (src/features/deckTower/cardView). Used by DeckTowerPage.
 */

export interface TowerCardViewState {
    /** The card as the grid had it — the view shows it at once and fetches the full entry. */
    entry: VocabEntry;
    /** The tapped mini card, to zoom from and back into (null: fade only). */
    tile: HTMLElement | null;
    /** The world (mastery lens) the card was opened from. */
    world: TowerWorldId;
    /** The close has started (the view runs its zoom back). */
    closing: boolean;
}

/** td's route-state key naming the open card. */
const CARD_STATE_KEY = "towerCard";

/** The route state React Router keeps on the current history entry (`history.state.usr`). */
function currentRouteState(): Record<string, unknown> {
    const usr = (window.history.state as { usr?: unknown } | null)?.usr;
    return usr && typeof usr === "object" ? { ...(usr as Record<string, unknown>) } : {};
}

export function useTowerCardView() {
    const navigate = useNavigate();
    const location = useLocation();
    const [view, setView] = useState<TowerCardViewState | null>(null);
    // The tower's content is hidden from the moment a card opens until the zoom back lands.
    const [hostHidden, setHostHidden] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    // Whether this view pushed the entry it is open on (always, today). Guards the back
    // arrow's `navigate(-1)` from popping an entry the view does not own.
    const pushedRef = useRef(false);
    // Set from `open` until the pushed entry is the location this hook renders with. React
    // Router 7 applies a navigation as a transition, so the render that first shows the view
    // can still carry the OLD location; without this the watcher would read that as a Back
    // and close the card the moment it opened.
    const awaitingPushRef = useRef(false);

    // A reload on an open card's entry: strip the stale key (see the header).
    useEffect(() => {
        const usr = currentRouteState();
        if (!(CARD_STATE_KEY in usr)) return;
        delete usr[CARD_STATE_KEY];
        window.history.replaceState({ ...(window.history.state as object), usr }, "");
    }, []);

    const open = useCallback(
        (entry: VocabEntry, tile: HTMLElement | null, world: TowerWorldId) => {
            if (view) return;
            navigate(location.pathname + location.search, {
                state: { ...currentRouteState(), [CARD_STATE_KEY]: entry.id },
            });
            pushedRef.current = true;
            awaitingPushRef.current = true;
            setHostHidden(true);
            setView({ entry, tile, world, closing: false });
        },
        [view, navigate, location.pathname, location.search]
    );

    // The POP watcher: the open card's entry is gone (any Back) → close.
    const routeCard = (location.state as Record<string, unknown> | null)?.[CARD_STATE_KEY];
    useEffect(() => {
        if (!view || view.closing) return;
        if (routeCard === view.entry.id) {
            awaitingPushRef.current = false;
            return;
        }
        if (awaitingPushRef.current) return;
        pushedRef.current = false;
        setView((v) => (v ? { ...v, closing: true } : v));
    }, [routeCard, view]);

    /** The view's back arrow (and its post-delete exit): Back, which the watcher turns into the close. */
    const requestClose = useCallback(() => {
        if (!view || view.closing) return;
        if (pushedRef.current) {
            navigate(-1);
            return;
        }
        setView((v) => (v ? { ...v, closing: true } : v));
    }, [view, navigate]);

    /** The zoom back has landed on the tile: fade the tower's content back in. */
    const revealHost = useCallback(() => setHostHidden(false), []);

    /** The close has finished: unmount the view and re-read the library. */
    const finish = useCallback(() => {
        setHostHidden(false);
        setView(null);
        setRefreshKey((k) => k + 1);
    }, []);

    return { view, hostHidden, refreshKey, open, requestClose, revealHost, finish };
}
