import { useLayoutEffect, useState, type RefObject } from "react";
import { GRID_CENTER_FROM_BOTTOM } from "./constants";

/** The app's phone-shaped root (`MobileDemoFrame`): the whole screen on a real phone. */
const SCREEN_SELECTOR = ".mobile-demo-frame";

/**
 * The gloss band's height (px) that centres the board on the anchor line.
 *
 * The anchor gives way upward to the hint row: a board that would run into it stops there.
 * The downward push needs no case here, since the band's content can outgrow this height.
 *
 * @param anchorY   the anchor line, in px from the panel's top
 * @param panelHeight the panel's inner height
 * @param hintHeight  the hint row's height, at the panel's bottom
 * @param boardHeight the board's natural height
 */
export function anchoredBandHeight(anchorY: number, panelHeight: number, hintHeight: number, boardHeight: number): number {
    const onLine = anchorY - boardHeight / 2;
    const againstHintRow = panelHeight - hintHeight - boardHeight;
    return Math.max(0, Math.min(onLine, againstHintRow));
}

/** Layout distance from the page's top. Ignores transforms, unlike a bounding rect. */
function layoutTop(el: HTMLElement): number {
    let top = 0;
    for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        top += node.offsetTop + node.clientTop;
    }
    return top;
}

/**
 * useGridScreenAnchor — keeps the board's centre on a fixed line of the screen, by sizing
 * the gloss band above it (docs/WORD_SEARCH_GAME.md § The play panel, top to bottom).
 *
 * The line is a fraction of the SCREEN, and the panel starts wherever its host's header
 * ends, so this has to measure; no flex ratio can express it. Layer: game hook.
 *
 * `bandEl` is state rather than a ref because the band mounts only once the deal lands.
 * The panel is its parent (`GameFrame`, which takes no ref). Used by WordSearchStage.tsx.
 */
export function useGridScreenAnchor(
    bandEl: HTMLElement | null,
    hintSlotRef: RefObject<HTMLElement | null>,
    boardHeight: number,
): number {
    const [bandHeight, setBandHeight] = useState(0);

    useLayoutEffect(() => {
        const panel = bandEl?.parentElement;
        const hintSlot = hintSlotRef.current;
        if (!panel || !hintSlot || boardHeight === 0) return;
        const screen = panel.closest<HTMLElement>(SCREEN_SELECTOR);
        const measure = () => {
            const screenHeight = screen?.clientHeight ?? window.innerHeight;
            const screenTop = screen ? layoutTop(screen) : 0;
            const anchorOnScreen = screenHeight * (1 - GRID_CENTER_FROM_BOTTOM);
            const anchorInPanel = anchorOnScreen - (layoutTop(panel) - screenTop);
            setBandHeight(anchoredBandHeight(anchorInPanel, panel.clientHeight, hintSlot.offsetHeight, boardHeight));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(panel);
        observer.observe(hintSlot);
        if (screen) observer.observe(screen);
        return () => observer.disconnect();
    }, [bandEl, hintSlotRef, boardHeight]);

    return bandHeight;
}
