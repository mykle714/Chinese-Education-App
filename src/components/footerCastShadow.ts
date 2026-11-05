/**
 * The slab footer's cast-shadow colour channel (MobileFooter `slab` style).
 *
 * The colour is a CSS custom property on the document root, not a prop: it must be the
 * sky behind the footer darkened one iso step, and that sky is owned by the page under
 * the footer (the Deck Tower repaints it imperatively every scroll frame as a tall tower
 * climbs into space — SpaceBackdrop). The footer is rendered at frame level, outside that
 * page, so the page writes the colour here and the slab's box-shadow reads it — no React
 * re-render on scroll. Unset, the slab casts no shadow.
 *
 * Lives in its own module (not MobileFooter.tsx) so that file exports only components
 * and constants (react-refresh/only-export-components).
 *
 * LAYER: shared UI. Knows nothing about the tower — any page behind a slab may set it.
 * Docs: docs/DECK_TOWER.md § Footer.
 */
export const SLAB_CAST_SHADOW_VAR = "--footer-slab-cast-shadow";

/**
 * A TRANSLUCENT black that darkens `ground` to (about) `shaded` — for a cast shadow that
 * must fall on whatever passes under it, not just on the ground it was tuned on. An opaque
 * `shaded` reads right on that ground but paints a solid ground-coloured patch over
 * anything else (the Deck Tower's cards page scrolling under the slab, 2026-11-04). Black
 * at alpha `a` scales every channel by `1 − a`, so `a` is taken from the channel sums: the
 * hue keeps, the darkening matches to within the HSL shade's small saturation shift.
 */
export function translucentShadow(ground: string, shaded: string): string {
    const sum = (hex: string) => {
        const n = parseInt(hex.replace("#", ""), 16);
        return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    const groundSum = sum(ground);
    if (!(groundSum > 0)) return "transparent";
    const alpha = Math.max(0, Math.min(1, 1 - sum(shaded) / groundSum));
    return `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
}

/** Sets (or, with null, clears) the colour of the slab footer's cast shadow. */
export function setFooterCastShadow(color: string | null): void {
    setRootProperty(SLAB_CAST_SHADOW_VAR, color);
}

/**
 * Sets (or, with null, removes) a custom property on the document root — only when the value
 * actually changes. Any write to the root's style re-checks the styles of the WHOLE document
 * (every element inherits from it), and the Deck Tower calls these every scroll frame, where
 * the colour usually has not changed since the last frame (it is quantised to hex, and is
 * constant outside the sky → space band). Reading the inline value back is cheap: it reads
 * the root's own style declaration, not computed style.
 */
function setRootProperty(name: string, value: string | null): void {
    const root = document.documentElement.style;
    const current = root.getPropertyValue(name);
    if (value) {
        if (current !== value) root.setProperty(name, value);
    } else if (current !== "") {
        root.removeProperty(name);
    }
}
