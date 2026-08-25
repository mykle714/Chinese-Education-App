// Elevation — the design's shadow system (docs/SHELF_REDESIGN.md § A1, decision D13).
//
// Taken from `shelf-system.css`, where every shadow in the artboard set obeys three
// rules. The app's old shadows obeyed none of them, which is why a card in this app
// never quite looked like a card in the design even when its color and geometry matched:
//
//   1. ONE HUE, AND IT IS INK — `rgba(20, 18, 26, α)`, never `rgba(0, 0, 0, α)`. The
//      ground the app sits on is warm (`--paper` #FBFAF8); a pure-black shadow on a warm
//      ground reads as a grey smudge rather than as absence of light. This is the same
//      reasoning the border tokens in colors.ts already follow.
//   2. THE LIGHT IS DIRECTLY ABOVE — the offset is `0 Ypx`, never diagonal. The app's old
//      `2px 4px` cast everything to the lower-right, as if lit from the upper-left. The
//      ONE exception is the spine (and its swatch), which is a physical object standing on
//      a board rather than a plane floating above one, so it keeps a sideways offset.
//   3. BLUR IS ~3x THE OFFSET, AND ALPHA STAYS LOW — the old `2px 4px 4px @ 0.25` is a
//      tight, dark, hard-edged drop. Every shadow here is wide and faint (`0 3px 10px @
//      0.10` for the same object). Height is read from how far the shadow SPREADS, not
//      from how dark it is.
//
// The names below are ROLES, not a strict numeric ladder: `LIFTED` has a larger offset
// than `FLOAT` but a lower alpha, because it belongs to a large surface (a whole card
// face) where a `FLOAT` alpha would read as a bruise. Pick by what the thing IS.
//
// Depended on by: docs/SHELF_REDESIGN.md § A1 + § D13. Consumed through
// `theme.palette.flashcard.cardShadow` / `.cardShadowSubtle` / `.sheetShadow` where a
// call site already reads the theme, and directly otherwise.

/** The one shadow ink. Every value below is this hue at some alpha. */
const INK = (alpha: number): string => `rgba(20, 18, 26, ${alpha})`;

export const SHADOW = {
    /**
     * `.bt` — a tile RESTING on the page. Barely there: it separates the tile from the
     * ground without claiming to float above it. The bento tiles and any flat panel.
     */
    rest: `0 1px 2px ${INK(0.05)}`,

    /**
     * `.mcd` — a mini card / thumbnail. The workhorse: every 92x132 card face in the app
     * (decks previews, Quick Mark, challenge words, the sort card).
     */
    raised: `0 3px 10px ${INK(0.1)}`,

    /**
     * `.crail`, `.fan .fb i` — a small control FLOATING over content: the card-ops rail,
     * a floating action puck, a chip that sits on top of a card.
     */
    float: `0 6px 18px ${INK(0.15)}`,

    /**
     * `.hero` — the full-size flashcard face, and anything else that is a large surface
     * held above the page. Wider and softer than `float` despite being higher up: at this
     * size a stronger alpha reads as dirt under the card.
     */
    lifted: `0 8px 26px ${INK(0.12)}`,

    /**
     * `.cmenu` — a popover MENU. Opaque, small, and temporary, so it is allowed to be the
     * darkest thing on the screen apart from a scrim.
     */
    menu: `0 14px 36px ${INK(0.24)}`,

    /**
     * `.ssheet` — a floating popover SHEET (the sense picker). The deepest in the set.
     */
    popover: `0 18px 44px ${INK(0.26)}`,

    /**
     * `.fan .fb em` — a SMALL floating thing on top of a card: a 28px action button, a
     * corner badge, a floating caption pill. Between `rest` and `float`; small objects
     * need a visible edge-shadow at a size where a wide blur would just look blurry.
     */
    chip: `0 2px 8px ${INK(0.14)}`,

    /**
     * `.board` — the shelf's wooden board. A hard, close contact shadow: the board is
     * touching the page, not hovering over it.
     */
    board: `0 2px 5px ${INK(0.14)}`,

    /**
     * `.sp`, `.phd .sw` — a SPINE. The set's only diagonal shadow, and the only one with
     * an inset: a spine is a solid object standing on a board, so it casts sideways and
     * catches a highlight down its right face.
     */
    spine: `2px 3px 9px ${INK(0.14)}, inset -6px 0 12px rgba(255, 255, 255, 0.5)`,
    /** `.phd .sw` — the spine reduced to a 26x34 identity swatch. Same shape, smaller. */
    spineSwatch: `2px 2px 6px ${INK(0.14)}, inset -3px 0 7px rgba(255, 255, 255, 0.5)`,

    // ── Upward shadows ──────────────────────────────────────────────────────────
    // Anything anchored to the bottom edge casts UP onto the page it covers. Same
    // rules, negative Y.

    /** `.peek` — a resting lip peeking up from the bottom edge. Lightest of the three. */
    peekUp: `0 -9px 26px ${INK(0.1)}`,
    /** `.sheet` — a pull-up sheet at rest over its own page. */
    sheetUp: `0 -10px 30px ${INK(0.12)}`,
    /** `.eic`, `.pnl` — a raised panel covering most of the page. Deepest upward. */
    panelUp: `0 -12px 34px ${INK(0.18)}`,
} as const;

export type ShadowToken = keyof typeof SHADOW;
