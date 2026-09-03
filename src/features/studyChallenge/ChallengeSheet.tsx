import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { nearestOverlayHost } from "../../components/overlayHost";
import { useHideFooter } from "../../hooks/useHideFooter";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";

/** The state chip's ink — one of the lexicon's five fills, or the inert grey. */
export type ChallengeSheetTone = "neutral" | "green" | "blue" | "orange" | "red";

const TONE_FILL: Record<ChallengeSheetTone, string> = {
    neutral: COLORS.iconBg,
    green: COLORS.grn,
    blue: COLORS.blu,
    orange: COLORS.org,
    red: COLORS.red,
};

interface ChallengeSheetProps {
    open: boolean;
    /** The pair — "Create Challenge", "Waiting for Response", "Incoming Challenge". */
    title: string;
    /** The line under it — always "vs <name>". */
    subtitle: string;
    /** The lowercase state word in the chip: `not sent`, `waiting`, `incoming`. */
    state: string;
    tone?: ChallengeSheetTone;
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
function ChallengeSheet({
    open,
    title,
    subtitle,
    state,
    tone = "neutral",
    onClose,
    actions,
    children,
}: ChallengeSheetProps) {
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
                        onClick={onClose}
                        sx={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 1200,
                            backgroundColor: COLORS.scrim,
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
                            top: "18%",
                            zIndex: 1201,
                            display: "flex",
                            flexDirection: "column",
                            backgroundColor: COLORS.white,
                            borderRadius: "26px 26px 0 0",
                            boxShadow: SHADOW.panelUp,
                            overflow: "hidden",
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
                                    fontFamily: FONTS.mono,
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

                            <IconButton
                                className="challenge-sheet__close"
                                onClick={onClose}
                                aria-label="Close"
                                sx={{ flexShrink: 0, color: COLORS.onSurface, backgroundColor: COLORS.background }}
                            >
                                <CloseIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Box>

                        {/* The one scrolling region. `touchAction: pan-y` is the opt-in the app
                            shell's global `none` requires (CLAUDE.md "Touch & Scroll"). */}
                        <Box
                            className="challenge-sheet__body"
                            sx={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y", overscrollBehavior: "contain" }}
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
}

export default ChallengeSheet;
