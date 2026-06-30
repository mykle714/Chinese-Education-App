import React, { useEffect, useState } from "react";
import { TOOLBAR_DROPDOWN_SELECTOR } from "./toolbarDropdownSelector";

/** Which of the toolbar's five advanced-row dropdowns a toggle/anchor refers to. */
export type ToolbarDropdown = "align" | "order" | "snap" | "shift" | "contrast";

/**
 * useToolbarMenus — owns the open/close state + coordination of the card-edit
 * toolbar's five advanced-row dropdowns (align / order / snap / shift / contrast).
 *
 * Extracted from CardEditToolbar so the component is JSX + per-menu wiring while
 * this hook holds the dense, invariant-laden coordination logic:
 *  - one anchor el per dropdown,
 *  - the capture-phase document pointerdown that closes the NON-MODAL dropdowns
 *    on an outside press (the menus render with root `pointerEvents: none` so a
 *    press falls through to the canvas; MUI's backdrop onClose never fires, so we
 *    close them ourselves here),
 *  - the **sticky order** exception: the order popover stays open while the user
 *    operates other toolbar tools on the selected icon, closing only on a press
 *    fully OUTSIDE the editor UI; the other four ("transient") dropdowns dismiss
 *    on any outside press,
 *  - `toggleDropdown`, which makes the four transients mutually exclusive while
 *    leaving order independent.
 *
 * See docs/CARD_ICON_LAYOUT.md.
 */
export function useToolbarMenus() {
    // Anchors for the advanced-row dropdowns (alignment menu, order popover, snap menu,
    // and the Shift step-nudge menu).
    const [alignAnchor, setAlignAnchor] = useState<null | HTMLElement>(null);
    const [orderAnchor, setOrderAnchor] = useState<null | HTMLElement>(null);
    const [snapAnchor, setSnapAnchor] = useState<null | HTMLElement>(null);
    const [shiftAnchor, setShiftAnchor] = useState<null | HTMLElement>(null);
    const [contrastAnchor, setContrastAnchor] = useState<null | HTMLElement>(null);

    // The align/order/snap/shift/contrast dropdowns are rendered NON-MODAL (root
    // `pointerEvents: none`, paper `auto` — see their slotProps) so a press outside them is
    // NOT swallowed by a modal backdrop and falls straight through to the canvas/toolbar.
    // That means MUI's own backdrop-click `onClose` never fires, so we close them ourselves
    // here from a single capture-phase pointerdown — which still reaches the underlying
    // target, so one press both dismisses a menu and performs its action.
    //
    // The **order** popover is the exception: it is STICKY. A learner selects an icon in the
    // order list and then operates the toolbar tools (delete / mirror / lock / align / …) on
    // it, so tapping any toolbar item — or any other dropdown — must NOT close the order
    // popover. It closes only on a press fully OUTSIDE the editor UI (e.g. the card canvas).
    // The other four ("transient") dropdowns keep the dismiss-on-outside-press behaviour.
    useEffect(() => {
        if (!alignAnchor && !orderAnchor && !snapAnchor && !shiftAnchor && !contrastAnchor) return;
        const onDocPointerDown = (e: PointerEvent) => {
            const t = e.target as Element | null;

            // --- Sticky order popover. The toolbar and every dropdown menu (the menus are
            // portaled to <body>, so they are NOT inside `.card-edit-toolbar`) count as
            // "editor UI"; a press anywhere in there leaves order open. Only a press outside
            // all of it dismisses order. ---
            const insideEditorUi = t?.closest(`.card-edit-toolbar, ${TOOLBAR_DROPDOWN_SELECTOR}`);
            if (orderAnchor && !insideEditorUi) setOrderAnchor(null);

            // --- Transient dropdowns (align / snap / shift / contrast). ---
            // Presses inside an open transient menu stay (align option, snap toggle, Shift
            // nudge, Contrast setting — the snap/Shift/Contrast menus allow several changes
            // per open). Presses on a transient's OWN trigger button are also left alone so
            // the button's onClick can run its toggle (tapping an open menu's button closes
            // it); without this, pointerdown would clear the anchor before the click fired,
            // so the toggle would always read "closed" and re-open instead of closing.
            const insideTransientMenu = t?.closest(
                ".card-edit-toolbar__align-menu, .card-edit-toolbar__snap-menu, .card-edit-toolbar__shift-menu, .card-edit-toolbar__contrast-menu",
            );
            const onTransientTrigger = t?.closest(
                ".card-edit-toolbar__align, .card-edit-toolbar__snap, .card-edit-toolbar__shift, .card-edit-toolbar__contrast",
            );
            if (!insideTransientMenu && !onTransientTrigger) {
                setAlignAnchor(null);
                setSnapAnchor(null);
                setShiftAnchor(null);
                setContrastAnchor(null);
            }
        };
        document.addEventListener("pointerdown", onDocPointerDown, true);
        return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
    }, [alignAnchor, orderAnchor, snapAnchor, shiftAnchor, contrastAnchor]);

    // Toggle a dropdown from its trigger button: open it if closed, close it if it's already
    // the open one. Tapping a button while its menu is open dismisses the menu (the
    // pointerdown handler above exempts the trigger buttons so this toggle sees the true
    // open state).
    //
    // The four "transient" dropdowns (align / snap / shift / contrast) are still mutually
    // exclusive — opening one closes the other three. The **order** popover is independent:
    // opening a transient leaves order as-is (it is sticky so the user can operate tools
    // out of it), and only the order button itself toggles order (which also closes the
    // transients, since order replaces them as the active tool surface).
    const toggleDropdown = (
        which: ToolbarDropdown,
        e: React.MouseEvent<HTMLButtonElement>,
    ) => {
        const anchor = e.currentTarget;
        setAlignAnchor(which === "align" ? (a) => (a ? null : anchor) : null);
        setSnapAnchor(which === "snap" ? (a) => (a ? null : anchor) : null);
        setShiftAnchor(which === "shift" ? (a) => (a ? null : anchor) : null);
        setContrastAnchor(which === "contrast" ? (a) => (a ? null : anchor) : null);
        if (which === "order") setOrderAnchor((a) => (a ? null : anchor));
    };

    return {
        alignAnchor,
        orderAnchor,
        snapAnchor,
        shiftAnchor,
        contrastAnchor,
        setAlignAnchor,
        setOrderAnchor,
        setSnapAnchor,
        setShiftAnchor,
        setContrastAnchor,
        toggleDropdown,
    };
}
