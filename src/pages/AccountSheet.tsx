import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import SheetPanel, { type SheetPanelBodyHandle, type SheetTelescopeHandle } from "../components/sheet/SheetPanel";
import SheetPageHeader from "../components/sheet/SheetPageHeader";
import SheetSegmentedTabs from "../components/sheet/SheetSegmentedTabs";
import { TAB_SWIPE_TRANSITION } from "../components/sheet/sheetStyled";
import FriendsBody from "../features/friends/FriendsBody";
import AccountPane from "./account/AccountPane";
import SettingsBody from "./settings/SettingsBody";
import { COLORS } from "../theme/colors";
import { SAFE_BOTTOM } from "../theme/safeArea";

/**
 * The Account panel — a MAXIMIZABLE BOTTOM SHEET raised from the Home header's avatar
 * button (HeaderAvatarButton → HomePage) and from the Deck Tower's floating avatar
 * (src/features/deckTower/DeckTowerAvatar.tsx). It used to be the `/account` footer tab;
 * Dictionary took that slot on 2026-10-09 and the route was deleted.
 *
 * THREE TABS on the eip's selector (SheetSegmentedTabs): Account · Friends · Settings. The
 * header title follows the tab, so a maximized panel reads as that page. Friends and
 * Settings are the same bodies their routes show; tapping a drill-in inside one (Send,
 * Account & security) leaves Home, which unmounts this sheet, and that page's back arrow
 * returns to `/friends` or `/settings` rather than here.
 *
 * Maximized, it is indistinguishable from a page: the header is a leaf PageHeader with a
 * down caret (SheetPageHeader, the eip's close control — no ✕, no grabber) and the sheet
 * takes the page ground rather than a sheet's white, at every height so nothing changes
 * colour mid-drag.
 *
 * LAYER: app-level page surface (src/pages — not part of any one feature). This file owns
 * only the shell: the tab, the pane track and the SheetPanel wiring.
 *
 * Depended on by: HomePage, DeckTowerAvatar, docs/SHELF_REDESIGN.md entry 5,
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
} as const;

interface AccountSheetPanesProps {
    selected: number;
    /** Which tabs have been opened; only these render (see AccountSheet). */
    visited: ReadonlySet<number>;
    panes: readonly ReactNode[];
}

/**
 * The clipping viewport over the permanent three-pane track. A tab change only moves the
 * track's transform, on the selector chip's own transition, so the two arrive together.
 *
 * It publishes SheetPanel's body handle itself, because the panes are portaled and only
 * exist once this component mounts. The scroll element is the SELECTED pane, so the handle
 * is rebuilt on every tab change; AccountSheet folds `selected` into `bodyKey` to make
 * SheetPanel re-read it.
 */
const AccountSheetPanes = forwardRef<SheetPanelBodyHandle, AccountSheetPanesProps>(function AccountSheetPanes(
    { selected, visited, panes },
    ref,
) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const paneRefs = useRef<(HTMLDivElement | null)[]>([]);
    useImperativeHandle(ref, () => ({
        root: rootRef.current,
        scroll: paneRefs.current[selected] ?? null,
    }), [selected]);

    return (
        <Box
            ref={rootRef}
            className="account-sheet__clip"
            sx={{ flex: 1, minHeight: 0, overflow: "hidden", touchAction: "pan-y" }}
        >
            <Box
                className="account-sheet__track"
                sx={{
                    display: "flex",
                    width: `${panes.length * 100}%`,
                    height: "100%",
                    transform: `translateX(${(-selected * 100) / panes.length}%)`,
                    transition: TAB_SWIPE_TRANSITION,
                    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
            >
                {panes.map((pane, index) => (
                    <Box
                        key={TAB_LABELS[index]}
                        ref={(node: HTMLDivElement | null) => { paneRefs.current[index] = node; }}
                        className={`account-sheet__pane account-sheet__pane--${TAB_LABELS[index].toLowerCase()}`}
                        sx={{ ...paneScrollSx, flex: `0 0 ${100 / panes.length}%`, minWidth: 0 }}
                    >
                        {visited.has(index) && pane}
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

    return (
        <SheetPanel
            onClose={onClose}
            bodyRef={bodyRef}
            // One scroller per pane, and SheetPanel captures it once per bodyKey.
            bodyKey={`account-${selected}`}
            telescopeRef={telescopeRef}
            surface={COLORS.background}
            showClose={false}
            showGrabber={false}
            edgePadding={false}
        >
            {({ bindHeaderDrag, dismiss }) => (
                <>
                    <SheetPageHeader
                        ref={telescopeRef}
                        title={TAB_LABELS[selected]}
                        onClose={dismiss}
                        bindHeaderDrag={bindHeaderDrag}
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
                        visited={visited}
                        panes={[<AccountPane onClose={onClose} />, <FriendsBody />, <SettingsBody />]}
                    />
                </>
            )}
        </SheetPanel>
    );
}

export default AccountSheet;
