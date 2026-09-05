import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, Typography } from "@mui/material";
import SheetCloseX from "../../components/sheet/SheetCloseX";
import { sheetEdgeFadeSx } from "../../components/sheet/sheetStyled";
import { nearestOverlayHost } from "../../components/overlayHost";
import { useHideFooter } from "../../hooks/useHideFooter";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";

/** The state chip's ink — one of the lexicon's five fills, or the inert grey. */
export type ChallengeSheetTone = "neutral" | "green" | "blue" | "orange" | "red";

// How long the sheet takes to arrive and to leave. Matches SheetPanel's SNAP_DURATION_MS
// so the app's two sheet families move at the same speed — a learner who has dismissed
// the eip has already learned how long a sheet takes to go away.
const EXIT_MS = 220;

const TONE_FILL: Record<ChallengeSheetTone, string> = {
    neutral: COLORS.iconBg,
    green: COLORS.grn,
    blue: COLORS.blu,
    orange: COLORS.org,
    red: COLORS.red,
};

/**
 * Imperative close, for the sheet's own OWNER. Every terminal action in the panel
 * (Send / Accept / Decline / Withdraw) consumes the sheet, and those buttons live in
 * `actions` — outside this component — so they need a way to leave the same way the ✕
 * does. Without it they would call `onClose` directly and the sheet would vanish in one
 * frame while the ✕ beside them slid away politely.
 */
export interface ChallengeSheetHandle {
    /** Play the exit, then call `onClose`. Idempotent. */
    close: () => void;
}

interface ChallengeSheetProps {
    open: boolean;
    /** The pair — "Create Challenge", "Waiting for Response", "Incoming Challenge". */
    title: string;
    /** The line under it — always "vs <name>". */
    subtitle: string;
    /** The lowercase state word in the chip: `not sent`, `waiting`, `incoming`. */
    state: string;
    tone?: ChallengeSheetTone;
    /**
     * Called once the sheet has finished LEAVING — the host unmounts it here. Every
     * close path (✕, scrim, the action bar via the ref handle) runs the exit animation
     * first, so this is a teardown callback, not a "dismiss now" one.
     */
    onClose: () => void;
    /** The pinned action bar. Sits below the scroller, never scrolls with it. */
    actions: ReactNode;
    children: ReactNode;
}

/**
 * The sheet that carries every PRE-PLAY challenge state
 * (docs/STUDY_CHALLENGE.md § 3, design F6–F9).
 *
 * ⚠️ THESE STATES ARE NOT PAGES. Issuing, withdrawing and answering are all decisions
 * ABOUT A ROW on the challenges list, so they open over that list rather than
 * navigating away from it. Three things follow from that and none of them survive a
 * routed page:
 *   * the list stays visible behind the scrim, so the decision keeps its context;
 *   * dismissing costs one tap and leaves nothing to come back from — where a routed
 *     review page had to `replace` its own history entry to stop Back returning to a
 *     Send button for a challenge that was already sent;
 *   * the pair's identity and state stay pinned in the header while the words scroll,
 *     so a scrolled sheet can never stop saying whose nine words these are.
 *
 * ⚠️ THE HEADER AND THE ACTION BAR ARE FIXED; ONLY THE MIDDLE SCROLLS. The action is
 * at the BOTTOM on purpose — it lets the words sit last, as the reference they are,
 * rather than making the reader scroll past a button to reach the thing it acts on.
 *
 * ⚠️ IT PORTALS OUT OF ITS HOST PAGE, AND IT MUST. Rendered where it is written — deep
 * inside a NodePage's scroll area — the sheet is clipped by that area's edge-fade MASK,
 * whose bottom band is transparent for the footer's height: `position: fixed` escapes
 * the scrolling but not the mask, so the pinned action bar simply does not paint and the
 * sheet appears to have no buttons. `nearestOverlayHost` (src/components/overlayHost.ts)
 * finds the first ancestor that covers the screen and can host it, and `useHideFooter`
 * clears the footer bar, which paints above that host and would cover the same strip.
 *
 * Local to this feature for now. It is a plain scrim + panel rather than a MUI Drawer
 * because the app shell never scrolls and a Drawer's portal + body-lock fights that
 * (CLAUDE.md "Touch & Scroll"). If a second feature ever needs the same frame, this is
 * the file to promote to `src/components/`.
 */
const ChallengeSheet = forwardRef<ChallengeSheetHandle, ChallengeSheetProps>(({
    open,
    title,
    subtitle,
    state,
    tone = "neutral",
    onClose,
    actions,
    children,
}, ref) => {
    /**
     * Where the sheet is WRITTEN, so the host can be found by walking up from it, and
     * where the sheet is PAINTED are two different places — see the portal note above.
     * The anchor renders nothing.
     */
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);

    // A LAYOUT effect, so the host is known and the portal committed before the browser
    // paints — a plain effect would show one frame of an unportaled (masked) sheet.
    useLayoutEffect(() => {
        if (!open) { setHost(null); return; }
        const el = anchorRef.current;
        if (el) setHost(nearestOverlayHost(el));
    }, [open]);

    // The sheet owns the screen while it is up, and the footer bar is rendered above
    // every page surface (FooterPresenter, z-index 100) — it would sit squarely on the
    // action bar. Released automatically when the sheet unmounts.
    useHideFooter(open);

    // ---- Leaving ----------------------------------------------------------
    // The sheet SLIDES OUT the way it came in; it does not blink out of existence.
    // Closing used to call the host's `onClose` straight from the ✕ and the scrim, which
    // unmounted the portal in the same frame — the one motion in the whole interaction
    // that had no motion. So the close is now a two-step: paint the exit, then tell the
    // host to unmount at the end of it.
    //
    // A STATE FLAG IS THE RIGHT TOOL HERE, unlike in SheetPanel, whose height is written
    // imperatively because it tracks a finger at 60fps. Nothing about this sheet is
    // gesture-driven — it is a fixed-height panel with no drag — so one re-render on the
    // way out costs nothing.
    const [closing, setClosing] = useState(false);
    const closeTimerRef = useRef<number | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const requestClose = useCallback(() => {
        // Idempotent: a second tap on the ✕ (or a scrim tap during the slide) must not
        // queue a second unmount.
        if (closeTimerRef.current !== null) return;
        setClosing(true);
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            onCloseRef.current();
        }, EXIT_MS);
    }, []);

    // The action bar's buttons live outside this component and consume the sheet too.
    useImperativeHandle(ref, () => ({ close: requestClose }), [requestClose]);

    // A host that drops `open` mid-flight (or unmounts the page) must not leave a timer
    // holding a stale `onClose`.
    useEffect(() => () => {
        if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    }, []);

    if (!open) return null;

    return (
        <>
            <Box component="span" ref={anchorRef} className="challenge-sheet__anchor" sx={{ display: "none" }} />
            {host && createPortal(
                <>
                    {/* The scrim. Tapping it dismisses — for a pending invitation that is
                        explicitly NOT a decline: it leaves the challenge exactly pending until
                        its deadline (§ 3.2). Only the Decline button ends one. */}
                    <Box
                        className="challenge-sheet__scrim"
                        onClick={requestClose}
                        sx={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 1200,
                            backgroundColor: COLORS.scrim,
                            // Fades in with the sheet's rise and out with its fall, so the
                            // dim and the panel arrive and leave as one object.
                            opacity: closing ? 0 : 1,
                            transition: `opacity ${EXIT_MS}ms ease-out`,
                            "@keyframes challengeSheetScrimIn": { from: { opacity: 0 }, to: { opacity: 1 } },
                            animation: closing ? "none" : `challengeSheetScrimIn ${EXIT_MS}ms ease-out both`,
                        }}
                    />

                    <Box
                        className="challenge-sheet"
                        sx={{
                            position: "fixed",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            // Never full height: the rows behind it are the context, so a strip
                            // of the list has to stay visible or the sheet reads as a page.
                            // The strip is the shared sheet system's OLD panel cap — 0.92 of the
                            // screen, i.e. an 8% band of scrim (docs/EIP_SHEET_GESTURES.md, the
                            // pre-merge `MAX_HEIGHT_RATIO`). SheetPanel itself now grows to 1
                            // and dissolves its chrome into a page header at the top of its
                            // travel; this sheet has no such merge (it is fixed-height and
                            // undraggable), so it keeps the older cap, which is also the one
                            // that leaves a tap-to-dismiss target.
                            top: "8%",
                            zIndex: 1201,
                            display: "flex",
                            flexDirection: "column",
                            backgroundColor: COLORS.white,
                            borderRadius: "26px 26px 0 0",
                            boxShadow: SHADOW.panelUp,
                            overflow: "hidden",
                            // ENTER and LEAVE are one movement in two directions: the sheet
                            // rises from the bottom edge on open and returns to it on close.
                            // The exit is a transition (it is driven by a state change we
                            // make); the entrance is a keyframe (there is no "before" state
                            // to transition from on the first paint).
                            transform: closing ? "translateY(100%)" : "translateY(0)",
                            transition: `transform ${EXIT_MS}ms ease-out`,
                            "@keyframes challengeSheetIn": {
                                from: { transform: "translateY(100%)" },
                                to: { transform: "translateY(0)" },
                            },
                            animation: closing ? "none" : `challengeSheetIn ${EXIT_MS}ms ease-out both`,
                        }}
                    >
                        {/* Grab handle — affordance only. The sheet is dismissed by the close
                            button or the scrim; there is no drag-to-dismiss, because the sheet
                            holds a nine-card scroller and the two gestures would compete. */}
                        <Box
                            className="challenge-sheet__grab"
                            sx={{
                                width: 44,
                                height: 4,
                                borderRadius: "3px",
                                backgroundColor: COLORS.border,
                                margin: "10px auto 0",
                                flexShrink: 0,
                            }}
                        />

                        <Box
                            className="challenge-sheet__header"
                            sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.25, pt: 1.5, pb: 1.6, flexShrink: 0 }}
                        >
                            <Box className="challenge-sheet__heading" sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    className="challenge-sheet__title"
                                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, color: COLORS.onSurface, letterSpacing: "-0.02em" }}
                                >
                                    {title}
                                </Typography>
                                <Typography
                                    className="challenge-sheet__subtitle"
                                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, mt: 0.25 }}
                                >
                                    {subtitle}
                                </Typography>
                            </Box>

                            <Box
                                className={`challenge-sheet__state challenge-sheet__state--${tone}`}
                                sx={{
                                    flexShrink: 0,
                                    fontFamily: FONTS.label,
                                    fontSize: SIZE.micro,
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    color: tone === "neutral" ? COLORS.textSecondary : COLORS.onSurface,
                                    backgroundColor: TONE_FILL[tone],
                                    borderRadius: 2,
                                    px: 1.1,
                                    py: 0.75,
                                }}
                            >
                                {state}
                            </Box>

                            {/* The app's one panel ✕ (SheetCloseX), the same button every
                                SheetPanel wears — this sheet used to draw a larger, grounded
                                close of its own. */}
                            <SheetCloseX className="challenge-sheet__close" onClick={requestClose} />
                        </Box>

                        {/* The one scrolling region. `touchAction: pan-y` is the opt-in the app
                            shell's global `none` requires (CLAUDE.md "Touch & Scroll"). */}
                        <Box
                            className="challenge-sheet__body"
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                overflowY: "auto",
                                touchAction: "pan-y",
                                overscrollBehavior: "contain",
                                // The words dissolve into the pinned action bar below
                                // instead of being cut off at the scroller's edge — the
                                // shared panel fade (sheetStyled § Sheet bottom edge fade).
                                ...sheetEdgeFadeSx,
                            }}
                        >
                            {children}
                        </Box>

                        <Box
                            className="challenge-sheet__actions"
                            sx={{
                                flexShrink: 0,
                                display: "flex",
                                gap: 1.2,
                                px: 2.25,
                                pt: 1.5,
                                // Clears the home indicator. The footer bar itself is
                                // gone for the sheet's lifetime (useHideFooter above),
                                // so there is nothing else down here to clear.
                                pb: "calc(20px + env(safe-area-inset-bottom))",
                                borderTop: `1px solid ${COLORS.rowBorder}`,
                                boxShadow: "0 -8px 14px rgba(20,18,26,.05)",
                            }}
                        >
                            {actions}
                        </Box>
                    </Box>
                </>,
                host
            )}
        </>
    );
});

ChallengeSheet.displayName = "ChallengeSheet";

export default ChallengeSheet;
