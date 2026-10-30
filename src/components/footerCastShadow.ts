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
