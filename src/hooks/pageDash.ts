import { armSkipNextEnter, freezeClone } from "./usePageSlide";
import { DASH_MOTION, prefersReducedMotion } from "../utils/pageTransition";
import { speedLineField } from "../utils/speedLineField";
import { COLORS } from "../theme/colors";

/**
 * pageDash.ts — the DASH transition between two routes: the Deck Tower's camera dash between
 * worlds (src/features/deckTower/useWorldPan.ts), played from one page to another.
 *
 * Layer: shared navigation plumbing (beside usePageSlide / useSlideNavigate). Imperative
 * DOM, no React: like usePageSlide's exit, it works on a CLONE of the leaving page, so the
 * destination can mount underneath at once.
 *
 * One dash, on DASH_MOTION's clock (src/utils/pageTransition.ts):
 *
 *   0 ──── outMs ────── +cruiseMs ────── +inMs
 *   leaving clone       empty sky; it      the arriving page (LIVE, not a
 *   whips off           blends into the    clone) slides in and brakes;
 *   (ease-in)           arriving ground    lines die away
 *   speed lines gather  lines at full
 *        ▲
 *        └ navigation happens HERE, at t = 0: the destination mounts beneath the sky
 *
 * Three stacking layers in the phone frame (`.mobile-demo-frame`), all under the footer
 * pill (FooterPresenter, z 100), which never moves — the same as the world pan:
 *   z 50  the sky (the ground colour) holding the leaving clone. Blocks taps on the
 *         hidden destination until it slides in.
 *   z 51  the arriving page, raised for the in phase only (its own root, restored after).
 *   z 52  the speed lines, over both — the pan draws its lines over the arriving scene too.
 *
 * Colours: the sky starts as the `--surface-ground` the leaving page claims
 * (src/hooks/useThemeColor.ts) and blends into the one the arriving page claims, read once
 * the out phase is over (the arriving page's claim effect has run by then). The streaks are
 * the caller's (the launching page's washed `ISO.wind`).
 *
 * Entrances held until seen: the arriving page mounts at t = 0, hidden under the sky, so its
 * own CSS entrance animations (acp's card dock slide-in, its bins and toolbar) would finish
 * unseen. While hidden, the frame carries `HOLD_CLASS`, whose rule in src/index.css pauses
 * every CSS animation in the frame's first child (the route page) — delays included, and
 * elements that mount mid-dash too. A paused `backwards`-fill animation sits on its first
 * frame, so released at the in phase they all play as the page slides in. JS-driven motion
 * (td's tower build-up) is not held.
 *
 * Fallback: reduced motion, no Web Animations, or no phone frame → a plain navigation.
 *
 * Used by: src/hooks/useSlideNavigate.ts (`dash`, the enter) and src/components/NodePage.tsx
 * (`exitDash`, the way back). Today the Deck Tower's mini sort platform ↔ Add Cards.
 * Docs: docs/LEAF_NODE_PAGES.md § "The dash transition", docs/DECK_TOWER.md § "The sort platform".
 */

export interface PageDashRun {
    /** Any element inside the leaving page (its root is the phone frame's child that holds it). */
    leaving: Element;
    /** The camera's travel: +1 right (the leaving page exits LEFT, the new one enters from the right), −1 left. */
    direction: 1 | -1;
    /** The streaks' colour. */
    lineColor: string;
    /** Performs the route change. Called once, at the start (or alone, on the fallback). */
    navigate: () => void;
}

/** Stacking order inside the frame (the footer pill is z 100, above all three). */
const Z_SKY = "50";
const Z_ARRIVING = "51";
const Z_LINES = "52";

/** On the frame while the arriving page is hidden: pauses its CSS animations (src/index.css). */
const HOLD_CLASS = "page-dash-hold";

/** The ground colour the topmost page currently claims (useThemeColor), or paper. */
function claimedGround(): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--surface-ground").trim();
    return v || COLORS.background;
}

/** The phone frame's direct child containing `el` — the page's root. */
function frameChildOf(frame: HTMLElement, el: Element): HTMLElement | null {
    let node: Element | null = el;
    while (node && node.parentElement !== frame) node = node.parentElement;
    return node as HTMLElement | null;
}

/** A full-frame absolutely-positioned layer. */
function layer(className: string, zIndex: string): HTMLDivElement {
    const div = document.createElement("div");
    div.className = className;
    Object.assign(div.style, { position: "absolute", inset: "0", overflow: "hidden", zIndex } satisfies Partial<CSSStyleDeclaration>);
    return div;
}

export function runPageDash({ leaving, direction, lineColor, navigate }: PageDashRun): void {
    const frame = leaving.closest(".mobile-demo-frame") as HTMLElement | null;
    const leavingRoot = frame ? frameChildOf(frame, leaving) : null;
    if (!frame || !leavingRoot || prefersReducedMotion() || typeof frame.animate !== "function") {
        navigate();
        return;
    }
    const { outMs, cruiseMs, inMs, outEasing, inEasing, colourEasing } = DASH_MOTION;
    const totalMs = outMs + cruiseMs + inMs;
    const frameWidth = frame.getBoundingClientRect().width;
    const fromGround = claimedGround();

    // ── The sky, holding the leaving page's clone ───────────────────────────────────
    const sky = layer("page-dash__sky", Z_SKY);
    sky.style.backgroundColor = fromGround;
    const clone = leavingRoot.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
        position: "absolute",
        inset: "0",
        margin: "0",
        transform: "none",
        transition: "none",
        pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    sky.appendChild(clone);

    // ── The speed lines (the world pan's field, speedLineField) ─────────────────────
    const lines = layer("page-dash__speed-lines", Z_LINES);
    Object.assign(lines.style, { pointerEvents: "none", opacity: "0" } satisfies Partial<CSSStyleDeclaration>);
    lines.setAttribute("aria-hidden", "true");
    // The streaks race OPPOSITE to the camera: travelling right, they cross right → left.
    const offRight = `translateX(${(frameWidth * 1.1).toFixed(1)}px)`;
    const offLeft = "translateX(-110%)";
    const [streakFrom, streakTo] = direction > 0 ? [offRight, offLeft] : [offLeft, offRight];
    for (const l of speedLineField()) {
        const bar = document.createElement("div");
        bar.className = "page-dash__speed-line";
        Object.assign(bar.style, {
            position: "absolute",
            left: "0",
            top: `${l.topPct}%`,
            width: `${l.widthPct}%`,
            height: `${l.heightPx}px`,
            borderRadius: `${l.heightPx}px`,
            backgroundColor: lineColor,
            opacity: String(l.opacity),
        } satisfies Partial<CSSStyleDeclaration>);
        lines.appendChild(bar);
        bar.animate([{ transform: streakFrom }, { transform: streakTo }], {
            duration: l.durationMs,
            delay: l.delayMs,
            iterations: Infinity,
            easing: "linear",
        });
    }

    frame.appendChild(sky);
    frame.appendChild(lines);
    // Hold the clone on the frame the live page was showing (animations, canvases, scroll).
    freezeClone(leavingRoot, clone);

    // Mount the destination NOW, beneath the sky. The latch keeps a leaf/node destination
    // from playing its own slide-in under the sky (usePageSlide).
    armSkipNextEnter();
    frame.classList.add(HOLD_CLASS);
    navigate();

    // Out: the clone whips off the side the camera is leaving.
    clone.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-direction * 100}%)` }], {
        duration: outMs,
        easing: outEasing,
        fill: "forwards",
    });
    // Lines: gather with the out phase (the pan's `speed` = the out distance), full through
    // the cruise, die away linearly with the in phase.
    lines.animate(
        [
            { opacity: 0, offset: 0, easing: outEasing },
            { opacity: 1, offset: outMs / totalMs },
            { opacity: 1, offset: (outMs + cruiseMs) / totalMs },
            { opacity: 0, offset: 1 },
        ],
        { duration: totalMs, fill: "forwards" },
    );

    // Cruise: the sky turns the arriving page's ground (claimed by now).
    window.setTimeout(() => {
        sky.animate([{ backgroundColor: fromGround }, { backgroundColor: claimedGround() }], {
            duration: cruiseMs,
            easing: colourEasing,
            fill: "forwards",
        });
    }, outMs);

    // In: the arriving page — the route element, the frame's FIRST child (overlays, exit
    // clones and these layers are all appended after it) — slides in over the sky.
    window.setTimeout(() => {
        const arriving = frame.firstElementChild as HTMLElement | null;
        // Release the held entrances: they play as the page slides in.
        frame.classList.remove(HOLD_CLASS);
        const cleanup = () => {
            sky.remove();
            lines.remove();
        };
        if (!arriving || arriving === sky || arriving === leavingRoot) {
            // The navigation went nowhere new (blocked, or another tap took over): just
            // clear the sky away.
            sky.animate([{ opacity: 1 }, { opacity: 0 }], { duration: inMs, fill: "forwards" })
                .finished.catch(() => {})
                .finally(cleanup);
            return;
        }
        const prevZ = arriving.style.zIndex;
        arriving.style.zIndex = Z_ARRIVING;
        const slideIn = arriving.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: "translateX(0)" }], {
            duration: inMs,
            easing: inEasing,
        });
        slideIn.finished
            .catch(() => {})
            .finally(() => {
                arriving.style.zIndex = prevZ;
                cleanup();
            });
    }, outMs + cruiseMs);
}
