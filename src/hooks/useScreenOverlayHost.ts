import { useLayoutEffect, useRef, useState } from "react";
import { frameOverlayHost } from "../components/overlayHost";

/**
 * SCREEN OVERLAY HOST — where a background DIM portals to so it covers the entire screen.
 *
 * Every dim in the app (popup scrims, modal sheets, the stepped explainer, the challenge
 * scoreboard…) must darken the WHOLE screen: status band, page header and footer bar
 * included. Written in place it cannot — it dims only its nearest positioned ancestor, or
 * gets sealed inside a transformed page Surface that the frame-level footer paints over.
 * So it portals to the phone frame (`frameOverlayHost`, src/components/overlayHost.ts —
 * the full rule and its history are in that file's header).
 *
 * Usage:
 *     const { anchorRef, host } = useScreenOverlayHost(open);
 *     return <>
 *         <span ref={anchorRef} hidden />
 *         {host && createPortal(<Scrim sx={{ position: "absolute", inset: 0, zIndex: 200 }} />, host)}
 *     </>;
 *
 * The anchor is a never-painted element rendered IN PLACE; the frame is found by walking
 * up from it, so a dim opened inside something that is not in the frame at all (a page on
 * the plain shell) falls back to `document.body`. Resolved in a layout effect — the state
 * write is flushed before paint, so the overlay never flashes unportaled. `host` is null
 * while `active` is false, so callers can gate the portal on it alone.
 *
 * The portaled overlay must be `position: absolute; inset: 0` (not `fixed`) with a
 * z-index above the footer's 100.
 *
 * Callers: MinimizablePopup, SteppedHelpPopup, ChallengeSheet, ChallengeRoundScoreboard,
 * ProvisionalCardsNotice, IWSceneIntroCard, IWPlayPage (interaction popup).
 * Docs: docs/UX_AND_NAVIGATION.md § Dimming the background.
 *
 * LAYER: shared UI hook — knows about the phone frame, nothing about any feature.
 */
export function useScreenOverlayHost<T extends HTMLElement = HTMLSpanElement>(active = true) {
    const anchorRef = useRef<T>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        if (!active) { setHost(null); return; }
        const el = anchorRef.current;
        if (el) setHost(frameOverlayHost(el));
    }, [active]);
    return { anchorRef, host: active ? host : null };
}
