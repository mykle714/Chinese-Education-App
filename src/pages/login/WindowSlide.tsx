import { Component, createRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../../utils/pageTransition";

/**
 * Every change of login "window" (a new step, or step 1's phone ⇄ email swap) translates the
 * card LEFT (owner, 2026-11-15): the window on screen slides off to the left while the next one
 * slides in from the right, side by side. Always leftward, back steps included.
 *
 * How: a class component, because `getSnapshotBeforeUpdate` is the one place React hands over
 * the DOM as it was BEFORE a re-render commits. When `windowKey` changes, the old card is cloned
 * there (with its on-screen rect), and in `componentDidUpdate` the clone is laid over the login
 * page at that same rect and slid out while the live (already new) card slides in. The clone is
 * appended to `.login-page`, not next to the card, so it stays put even if the new card's height
 * re-centres the column. It is inert, aria-hidden and stripped of ids (no duplicate ids, no
 * focusable copies). Off under reduced motion: the window just swaps.
 *
 * The same ease-out as the app's page slide (src/hooks/usePageSlide.ts → EASING), a touch
 * quicker, since this moves a card, not a page.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx around LoginCard.
 * Docs: docs/LOGIN_REWORK.md § 3.
 */

const SLIDE_MS = 320;
const SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface WindowSlideProps {
    /** Which window is showing. A change of key plays the slide. */
    windowKey: string;
    children: ReactNode;
}

/** What getSnapshotBeforeUpdate captures of the outgoing window. */
interface OutgoingWindow {
    clone: HTMLElement;
    page: HTMLElement;
    top: number;
    left: number;
    width: number;
    /** How far to travel: the login page's width, so each card fully clears the screen. */
    distance: number;
}

export default class WindowSlide extends Component<WindowSlideProps> {
    private readonly el = createRef<HTMLDivElement>();
    /** The slide in flight, so a fast second change can finish it before starting its own. */
    private running: { clone: HTMLElement; anims: Animation[] } | null = null;

    getSnapshotBeforeUpdate(prev: WindowSlideProps): OutgoingWindow | null {
        const el = this.el.current;
        if (prev.windowKey === this.props.windowKey || !el || prefersReducedMotion() || typeof el.animate !== "function") return null;
        const page = (el.closest(".login-page") as HTMLElement | null) ?? document.body;
        const rect = el.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        return {
            clone: el.cloneNode(true) as HTMLElement,
            page,
            top: rect.top - pageRect.top,
            left: rect.left - pageRect.left,
            width: rect.width,
            distance: pageRect.width,
        };
    }

    componentDidUpdate(_prev: WindowSlideProps, _state: unknown, out: OutgoingWindow | null) {
        const el = this.el.current;
        if (!out || !el) return;
        this.finishRunning();

        const { clone, page, top, left, width, distance } = out;
        // A static picture of the old window: no ids, no focus, no assistive-tech copy.
        clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
        clone.removeAttribute("id");
        clone.setAttribute("aria-hidden", "true");
        clone.inert = true;
        Object.assign(clone.style, {
            position: "absolute",
            top: `${top}px`,
            left: `${left}px`,
            width: `${width}px`,
            margin: "0",
            pointerEvents: "none",
            zIndex: "2",
        });
        page.appendChild(clone);

        const timing: KeyframeAnimationOptions = { duration: SLIDE_MS, easing: SLIDE_EASING };
        const outgoing = clone.animate([{ transform: "none" }, { transform: `translateX(${-distance}px)` }], { ...timing, fill: "forwards" });
        const incoming = el.animate([{ transform: `translateX(${distance}px)` }, { transform: "none" }], { ...timing, fill: "backwards" });
        this.running = { clone, anims: [outgoing, incoming] };
        outgoing.onfinish = () => {
            if (this.running?.clone === clone) this.running = null;
            clone.remove();
        };
    }

    componentWillUnmount() {
        this.finishRunning();
    }

    /** Jump any slide in flight to its end and drop its clone. */
    private finishRunning() {
        if (!this.running) return;
        this.running.anims.forEach((a) => a.cancel());
        this.running.clone.remove();
        this.running = null;
    }

    render() {
        return (
            <div ref={this.el} className="login-window-slide">
                {this.props.children}
            </div>
        );
    }
}
