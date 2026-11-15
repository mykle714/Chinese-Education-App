import { useContext, useMemo } from "react";
import { Box } from "@mui/material";
import HintBubbleSurface from "../hintBubble/HintBubbleSurface";
import DismissCue from "../hintBubble/DismissCue";
import { HINT_MOTION } from "../hintBubble/hintMotion";
import { useHintBubblePresence, type PresenceItem } from "../hintBubble/useHintBubblePresence";
import Icon from "../Icon";
import { COLORS } from "../../theme";
import { SIZE, WEIGHT } from "../../theme/scale";
import {
    NOTIFICATION_TOP,
    NOTIFICATION_Z_INDEX,
    NotificationApiContext,
    NotificationStackContext,
    type ActiveNotification,
} from "./notificationModel";

/**
 * NotificationViewport — draws the app's notification stack (docs/NOTIFICATIONS.md).
 *
 * LAYER: shared shell presentation (src/components). Rendered by the shell, once:
 *   - `placement="frame"` — MobileDemoFrame, as a sibling of the pages and the footer, so it
 *     pins against the phone frame (`position: absolute`, the frame is the positioned host
 *     — src/components/overlayHost.ts) and on desktop stays inside the 402px phone card;
 *   - `placement="window"` — Layout's plain shell, pinned to the window (`fixed`).
 *
 * Each notification is a TAILLESS hint bubble (HintBubbleSurface `tailSide="none"`): the
 * flp hint pawn's white, outlined bubble (owner, 2026-11-14 — "styled the same way our flp
 * hints are"), growing down out of its top edge and fading away when it leaves (`exit="fade"`). A tap anywhere
 * on it dismisses it. Sticky banners (no auto-hide) carry the pawn's "Tap to dismiss" cue;
 * auto-hiding ones do not, since they leave by themselves.
 *
 * Tone is the leading icon only — every semantic ink in our framework is ink
 * (src/theme/colors.ts § "Semantic roles"), so no tone gets a hue.
 *
 * The stack column ignores the pointer; only a bubble's own body catches a tap, so a banner
 * never blocks what is beside it.
 */

/** The banners' grow/fade timing: immediate (a notification answers something that just happened). */
const PRESENCE_TIMING = { enterDelayMs: 0, staggerMs: 0, exitMs: HINT_MOTION.popMs } as const;

/** Widest a banner grows, px — about the hint pawn bubble's width on a phone. */
const BANNER_MAX_WIDTH = 360;

export default function NotificationViewport({ placement }: { placement: "frame" | "window" }) {
    const stack = useContext(NotificationStackContext);
    const api = useContext(NotificationApiContext);

    // Presence keys by id, so an in-place update (same id, new text) neither re-grows nor pops.
    const desired = useMemo<PresenceItem<ActiveNotification>[]>(
        () => stack.map((n) => ({ key: n.id, value: n })),
        [stack],
    );
    const rendered = useHintBubblePresence(desired, PRESENCE_TIMING);

    if (rendered.length === 0) return null;

    return (
        <Box
            className="notification-viewport"
            role="status"
            aria-live="polite"
            sx={{
                position: placement === "frame" ? "absolute" : "fixed",
                top: NOTIFICATION_TOP,
                left: 0,
                right: 0,
                px: 2,
                zIndex: NOTIFICATION_Z_INDEX,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                pointerEvents: "none",
            }}
        >
            {rendered.map((item) => {
                const n = item.value;
                const sticky = n.autoHideMs === null;
                return (
                    <Box
                        key={item.key}
                        className={`notification-viewport__slot notification-viewport__slot--${n.tone}`}
                        sx={{ width: "100%", maxWidth: BANNER_MAX_WIDTH }}
                    >
                        <HintBubbleSurface
                            phase={item.phase}
                            delayMs={item.delayMs}
                            className="notification-banner"
                            tailSide="none"
                            exit="fade"
                            onSelect={() => api?.tap(n.id)}
                            ariaLabel="Dismiss notification"
                            bodySx={{
                                width: "100%",
                                flexDirection: "row",
                                alignItems: "stretch",
                                justifyContent: "flex-start",
                                gap: 1,
                                px: 1.25,
                                py: 1,
                                textAlign: "left",
                            }}
                        >
                            <Icon
                                className="notification-banner__icon"
                                name={n.icon}
                                size={20}
                                color={COLORS.onSurface}
                                sx={{ flexShrink: 0, alignSelf: "flex-start", mt: "1px" }}
                            />
                            <Box
                                className="notification-banner__message"
                                sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    alignSelf: "center",
                                    fontSize: SIZE.caption,
                                    fontWeight: WEIGHT.semibold,
                                    color: COLORS.onSurface,
                                    lineHeight: 1.3,
                                }}
                            >
                                {n.message}
                            </Box>
                            {sticky && <DismissCue className="notification-banner__dismiss-cue" sx={{ mr: "-4px", mb: "-4px" }} />}
                        </HintBubbleSurface>
                    </Box>
                );
            })}
        </Box>
    );
}
