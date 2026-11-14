import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import SheetPanel, { type SheetPanelBodyHandle, type SheetTelescopeHandle } from "../components/sheet/SheetPanel";
import SheetPageHeader from "../components/sheet/SheetPageHeader";
import SheetSegmentedTabs from "../components/sheet/SheetSegmentedTabs";
import { TAB_SWIPE_TRANSITION } from "../components/sheet/sheetStyled";
import { restingTabTransform, useTabSwipeTrack } from "../components/sheet/useTabSwipeTrack";
import OverlayScrollbar, { hiddenNativeScrollbarSx } from "../components/OverlayScrollbar";
import FriendsBody from "../features/friends/FriendsBody";
import AccountPane from "./account/AccountPane";
import SettingsBody from "./settings/SettingsBody";
import { COLORS } from "../theme/colors";
import { SAFE_BOTTOM } from "../theme/safeArea";

/**
 * The Account panel — a MAXIMIZABLE BOTTOM SHEET raised from the Deck Tower header's
 * avatar (src/features/deckTower/DeckTowerAvatar.tsx). It is the only way into Friends
 * (the `/friends` page was deleted 2026-11-06). It used to be the `/account`
 * footer tab; Dictionary took that slot on 2026-10-09 and the route was deleted. Its
 * Settings tab is the app's only way into Settings (the old Home header's gear went
 * with that page on 2026-11-04).
 *
 * THREE TABS on the eip's selector (SheetSegmentedTabs): Account · Friends · Settings. The
 * header title follows the tab, so a maximized panel reads as that page. A sideways swipe
 * over the panes changes tab exactly as in the eip — the same gesture (useTabSwipeTrack). Friends is the
 * ONLY home of FriendsBody since the `/friends` page was deleted (2026-11-06); Settings is
 * the same body `/settings` shows. Tapping a drill-in inside one (Send, Account &
 * security) navigates away, which unmounts this sheet. A Friends drill-in's back arrow
 * goes back one history entry (to the page under the sheet, sheet closed); Settings'
 * returns to `/settings`.
 *
 * The header is a leaf PageHeader with a down caret (SheetPageHeader, the eip's close
 * control — no ✕) under SheetPanel's grabber pill (the drag bar, added 2026-11-08), and the
 * sheet takes the page ground rather than a sheet's white, at every height so nothing
 * changes colour mid-drag. The pill stays at max, so a maximized panel reads as a page with
 * a drag bar on top.
 *
 * LAYER: app-level page surface (src/pages — not part of any one feature). This file owns
 * only the shell: the tab, the pane track and the SheetPanel wiring.
 *
 * Depended on by: DeckTowerAvatar, docs/SHELF_REDESIGN.md entry 5,
 * docs/DECK_TOWER.md, docs/UX_AND_NAVIGATION.md, docs/NAVIGATION.md,
 * docs/FRIENDS_FEATURE.md, docs/EIP_SHEET_GESTURES.md § Page-style sheet header.
 */

const TAB_LABELS = ["Account", "Friends", "Settings"] as const;

// The selector, one per panel: its segments never change, so it is built once.
const SELECTOR_TABS = TAB_LABELS.map((label) => ({
    label,
    className: `account-sheet__tab account-sheet__tab--${label.toLowerCase()}`,
}));

// Each pane is its own scroll region, so a tab keeps its scroll position. `pan-y`, NOT
// `none`: SheetPanel picks resize-vs-scroll on a gesture's first committed move and
// expresses "scroll" by NOT calling preventDefault, so the browser must be allowed to pan
// natively (same note as CompareWorkspace / InfoCardPanelBody). The bottom padding clears
// the home indicator; the sheet covers the footer, so there is no footer to clear.
const paneScrollSx = {
    height: "100%",
    overflowX: "hidden",
    overflowY: "auto",
    overscrollBehavior: "contain",
    touchAction: "pan-y",
    paddingBottom: `calc(24px + ${SAFE_BOTTOM})`,
    // NO NATIVE SCROLLBAR. A classic desktop bar takes ~15px of width only while the pane
    // overflows, so content re-flowed narrower the moment it grew past the viewport (e.g.
    // a friend row expanding) and back when it shrank (user, 2026-11-13). The pane's
    // OverlayScrollbar sibling draws a thin thumb over the content instead, so the
    // content width never depends on overflow — the eip panes' fix, shared
    // (docs/EIP_SHEET_GESTURES.md § Pane scrollbar).
    ...hiddenNativeScrollbarSx,
    // PIN THE LIGHT SCHEME. Over a night sky the Deck Tower claims its dark ground
    // (`useThemeColor` → `applyTopClaim`), which sets `color-scheme: dark` on <html>,
    // and every descendant inherits it. The sheet is always paper
    // (`surface={COLORS.background}`), so its native form controls must stay light. (This
    // first fixed the native scrollbar drawing dark at the 80% height, before that bar
    // was hidden above.)
    colorScheme: "light",
} as const;

interface AccountSheetPanesProps {
    selected: number;
    onSelect: (index: number) => void;
    /** Mount the panes either side of `index` (a swipe is about to reveal one). */
    onWarm: (index: number) => void;
    /** Which tabs have been opened; only these render (see AccountSheet). */
    visited: ReadonlySet<number>;
    panes: readonly ReactNode[];
}

/**
 * The clipping viewport over the permanent three-pane track. A tab change only moves the
 * track's transform, on the selector chip's own transition, so the two arrive together.
 * A horizontal swipe over the panes drags the track and commits/snaps back on release
 * (useTabSwipeTrack — the eip's gesture, shared).
 *
 * It publishes SheetPanel's body handle itself, because the panes are portaled and only
 * exist once this component mounts. The scroll element is the SELECTED pane, so the handle
 * is rebuilt on every tab change; AccountSheet folds `selected` into `bodyKey` to make
 * SheetPanel re-read it.
 */
const AccountSheetPanes = forwardRef<SheetPanelBodyHandle, AccountSheetPanesProps>(function AccountSheetPanes(
    { selected, onSelect, onWarm, visited, panes },
    ref,
) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
    useImperativeHandle(ref, () => ({
        root: rootRef.current,
        scroll: paneRefs.current[selected] ?? null,
    }), [selected]);

    // Swipe-to-change-tab. The clip is the gesture target. A finger landing on it mounts
    // the selected pane's NEIGHBOURS (onWarm) so a swipe drags a drawn page in, not a
    // blank one — the eip warms its off-screen panes on touch for the same reason. Merely
    // opening the panel still mounts only Account.
    useTabSwipeTrack({
        clipRef: rootRef,
        trackRef,
        tabCount: panes.length,
        selectedTab: selected,
        onTabChange: onSelect,
        onGestureStart: () => onWarm(selected),
    });

    return (
        <Box
            ref={rootRef}
            className="account-sheet__clip"
            sx={{ flex: 1, minHeight: 0, overflow: "hidden", touchAction: "pan-y" }}
        >
            <Box
                ref={trackRef}
                className="account-sheet__track"
                sx={{
                    display: "flex",
                    width: `${panes.length * 100}%`,
                    height: "100%",
                    transform: restingTabTransform(selected, panes.length),
                    // Persistent transition: a tapped tab animates purely through the
                    // declarative transform; a finger drag overrides transform/transition
                    // inline and clears them on release (useTabSwipeTrack).
                    transition: TAB_SWIPE_TRANSITION,
                    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
            >
                {panes.map((pane, index) => (
                    // Non-scrolling slot per pane: the positioning context for the
                    // OverlayScrollbar thumb, which must sit OUTSIDE the scroller so it
                    // does not scroll away with the content.
                    <Box
                        key={TAB_LABELS[index]}
                        className="account-sheet__pane-slot"
                        sx={{ flex: `0 0 ${100 / panes.length}%`, minWidth: 0, height: "100%", position: "relative" }}
                    >
                        <Box
                            ref={(node: HTMLDivElement | null) => { paneRefs.current[index] = node; }}
                            className={`account-sheet__pane account-sheet__pane--${TAB_LABELS[index].toLowerCase()}`}
                            sx={paneScrollSx}
                        >
                            {visited.has(index) && pane}
                        </Box>
                        <OverlayScrollbar
                            className="account-sheet__pane-scrollbar"
                            getScroller={() => paneRefs.current[index] ?? null}
                        />
                    </Box>
                ))}
            </Box>
        </Box>
    );
});

interface AccountSheetProps {
    // Called once the sheet has finished its dismiss animation (or immediately on
    // logout) — the host unmounts it here.
    onClose: () => void;
}

function AccountSheet({ onClose }: AccountSheetProps) {
    const bodyRef = useRef<SheetPanelBodyHandle | null>(null);
    const telescopeRef = useRef<SheetTelescopeHandle | null>(null);

    const [selected, setSelected] = useState(0);
    // A pane mounts on its first visit, then stays mounted to keep its scroll and state:
    // opening the panel to glance at the account must not fetch the friends leaderboard.
    const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
    const selectTab = (index: number) => {
        setSelected(index);
        setVisited((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
    };
    // A finger on the panes: mount both neighbours of the current tab, so whichever way
    // the swipe goes, the pane sliding in is already drawn. A no-op once they are mounted.
    const warmNeighbours = (index: number) => {
        setVisited((prev) => {
            const wanted = [index - 1, index + 1].filter((i) => i >= 0 && i < TAB_LABELS.length && !prev.has(i));
            if (wanted.length === 0) return prev;
            const next = new Set(prev);
            wanted.forEach((i) => next.add(i));
            return next;
        });
    };

    return (
        <SheetPanel
            onClose={onClose}
            bodyRef={bodyRef}
            // One scroller per pane, and SheetPanel captures it once per bodyKey.
            bodyKey={`account-${selected}`}
            telescopeRef={telescopeRef}
            surface={COLORS.background}
            // Opens at 80% of the frame (SheetPanel's default is 60%) — the same open
            // height as the Dictionary page's eip. This is also the sheet's dismiss floor:
            // a release below 80% closes it (docs/EIP_SHEET_GESTURES.md § snap stops).
            defaultHeightRatio={0.8}
            showClose={false}
            // The drag bar. SheetPageHeader is told (withGrabber) so it drops its own top
            // inset by the pill row's height and the caret stays where it was.
            edgePadding={false}
        >
            {({ bindHeaderDrag, dismiss }) => (
                <>
                    <SheetPageHeader
                        ref={telescopeRef}
                        title={TAB_LABELS[selected]}
                        onClose={dismiss}
                        bindHeaderDrag={bindHeaderDrag}
                        withGrabber
                    />
                    <SheetSegmentedTabs
                        className="account-sheet__tabs"
                        tabs={SELECTOR_TABS}
                        selected={selected}
                        onSelect={selectTab}
                        dragBind={bindHeaderDrag}
                    />
                    <AccountSheetPanes
                        ref={bodyRef}
                        selected={selected}
                        onSelect={selectTab}
                        onWarm={warmNeighbours}
                        visited={visited}
                        panes={[<AccountPane onClose={onClose} />, <FriendsBody />, <SettingsBody />]}
                    />
                </>
            )}
        </SheetPanel>
    );
}

export default AccountSheet;
