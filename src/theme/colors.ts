// Central color palette — the single source of truth for every color in the app.
//
// ⚠️ REWRITTEN for the shelf redesign (docs/SHELF_REDESIGN.md, decisions D1 + D2).
// The palette is now the design's OKLCH ramp from `shelf-system.css`. Every KEY
// below is unchanged so the ~150 call sites keep compiling; only the VALUES moved.
//
// WHY HEX AND NOT `oklch()`: the source of truth for these values IS oklch (each is
// noted in a comment), but MUI's `alpha()` — used on COLORS.successInk and
// COLORS.warnInk in ValidateFlagButtonsView, and on tone colors in the flp — cannot
// parse an `oklch()` string and throws. The hex here is the exact sRGB rendering of
// the oklch value; convert with the formula in docs/SHELF_REDESIGN.md § A1 if a value
// ever needs re-deriving. Author in oklch, ship hex.
//
// The ramp is built from PAIRS: a pastel SURFACE and a saturated ACCENT at the same
// hue. Surfaces fill spines, bento tiles and zone rows; accents draw bars, cells,
// dots and text on top of them. Every semantic color below resolves to one of the
// pair members — nothing here is a free-floating hue.
//
// Progress-category (bucket) colors also exist as CATEGORY_COLORS in
// utils/categoryColors.ts — use getCategoryColor() when the color is chosen
// *by a card's category*. The main/accent aliases below are for static UI
// (bucket headers, the discover-page buckets) that name a color directly.
//
// ⚠️ THIS FILE IMPORTS NOTHING. It is the palette's root: `utils/categoryColors.ts`
// derives its category and collection pairs FROM the ramp below, so the dependency
// runs one way. It used to import `CATEGORY_COLORS` back for the four `*Main` aliases,
// which made the two modules a CYCLE — harmless only while neither needed the other's
// values at module-evaluation time. The moment categoryColors did (deriving a pair
// from `RAMP`), whichever module loaded second saw `undefined` and every importer of
// it died at import time. The four pastels are hoisted out of the object literal
// instead, so an alias and its ramp member are one constant rather than an import.
const RED_PASTEL = "#FFDDDB";    // oklch(93% 0.045  20) — --red  — Unfamiliar
const ORG_PASTEL = "#FFE6C8";    // oklch(94% 0.05   70) — --org  — Target
const GRN_PASTEL = "#D9F4D9";    // oklch(94% 0.045 145) — --grn  — Comfortable
const BLU_PASTEL = "#D2EBFF";    // oklch(93% 0.045 250) — --blu  — Mastered

export const COLORS = {
    // ── The raw ramp ──────────────────────────────────────────────
    // Named exactly as the design's CSS custom properties, so an artboard's
    // `background: var(--pur)` translates to `COLORS.pur` with no lookup table.
    // Prefer a SEMANTIC token below where one exists; reach for these only when
    // building a shelf/bento surface that has no semantic meaning.
    grey: "#E7E7EA",     // oklch(93% 0.004 285)
    greyA: "#A4A4A9",    // oklch(72% 0.008 285)
    pur: "#ECE2FF",      // oklch(93% 0.045 300)
    purA: "#7652AC",     // oklch(52% 0.14  300)
    blu: BLU_PASTEL,     // oklch(93% 0.045 250)
    bluA: "#1F6CB0",     // oklch(52% 0.13  250)
    red: RED_PASTEL,     // oklch(93% 0.045  20)
    redA: "#B54249",     // oklch(54% 0.15   20)
    org: ORG_PASTEL,     // oklch(94% 0.05   70)
    orgA: "#A46400",     // oklch(56% 0.13   70)
    grn: GRN_PASTEL,     // oklch(94% 0.045 145)
    grnA: "#387D3D",     // oklch(53% 0.12  145)
    tea: "#C6F2F1",      // oklch(93% 0.045 195)
    teaA: "#007C7C",     // oklch(52% 0.11  195)
    // `--yel` — the SEVENTH hue, and the one the base ramp in `shelf-system.css` does
    // NOT define. The artboards add it in their own `:root` because two surfaces need a
    // gold that is not Target's orange: Speed Reading's game chrome and the decks
    // page's Study Mix card (`.fc.f`, artboard 2, whose fill is the slightly deeper
    // oklch(94.5% 0.075 100)). It sits between `org` (70) and `grn` (145) at hue 92–100
    // — far enough off the org axis that a gold card beside a Target-orange chip does
    // not read as a second Target. Added as a ramp member rather than inlined at those
    // two call sites so the next surface that wants gold has somewhere to take it from.
    yel: "#F5E7B4",      // oklch(94% 0.055  92)
    yelA: "#96751A",     // oklch(56% 0.12   92)
    yelTint: "#FDF8E9",  // oklch(97.5% 0.018 92)

    // A THIRD tier at oklch(97.5% 0.018 H) — a near-white tint of each hue.
    // The design uses it for the Arena zone rows (`.bd .r.up` / `.r.dn`); it is
    // promoted to a full tier here because the app fills shapes with a BODY and an
    // INNER FILL (deck tiles, spines, band tiles), and once the body is the 93%
    // pastel the inner fill needs somewhere lighter to go.
    redTint: "#FFF2F2",  // oklch(97.5% 0.018  20)
    orgTint: "#FFF5EA",  // oklch(97.5% 0.018  70)
    grnTint: "#F0FAF0",  // oklch(97.5% 0.018 145)
    bluTint: "#EEF8FF",  // oklch(97.5% 0.018 250)
    purTint: "#F8F4FF",  // oklch(97.5% 0.018 300)
    teaTint: "#EAFBFA",  // oklch(97.5% 0.018 195)

    // ── Surfaces ──────────────────────────────────────────────────
    // The app runs on ONE light palette during the redesign (decision D4); the
    // Dark / Ocean / Nature themes in ThemeContext are not derived yet.
    background: "#FBFAF8",       // --paper — the app's ground. Warm, not neutral grey.
    header: "#F2F2F4",           // --header — unchanged; the design uses this exact value
    white: "#FFFFFF",            // --white — cards, rows, sheets sit ON the paper ground
    card: "#E7E7EA",             // --grey — inert filled surfaces (tracks, empty cells)
    // THE CARD FACE. Every flashcard face, mini card and card preview that has no
    // per-card `cardColor` override lands here, via the light theme's
    // `flashcard.flashCard` (ThemeContext). It is the design's own card fill: the
    // artboards paint `.hero` (the full flashcard face) AND `.mgrid .mcd` (frame 17's
    // mini card previews) with this exact value, so the big face and its thumbnails are
    // literally the same surface — which is the point of frame 17's caption, "the
    // preview is literally the card".
    //
    // Warm cream, not the grey it used to be (`COLORS.card`, #E7E7EA). The ground the
    // app runs on is warm (`--paper` #FBFAF8) and a neutral grey card sitting on it read
    // as slightly dead — and it also made the fie's `auto` swatch indistinguishable from
    // its explicit `grey` swatch in the light theme, which is the one place those two are
    // supposed to differ.
    cardFace: "#FBF7EC",         // the design's `.hero` / `.mgrid .mcd` fill
    // A SECOND, DEEPER beige. NOT the card face — the artboards use it for the base
    // `.mcd` before `.mgrid` overrides it, and the app uses it for eip/info panels and a
    // couple of hub tiles. Named for its colour rather than its role because it has no
    // single role; `cardFace` above is the one with a role.
    cardBeige: "#F5EBE0",        // the design's bare `.mcd` fill
    infoCard: "#F5EBE0",         // same beige — kept as a distinct token for eip surfaces
    sectionCard: "#FFFFFF",      // was a beige; the design puts sections on white over paper
    iconBg: "#E7E7EA",           // --grey — the tinted square behind a leading icon

    // ── Text (the ink ramp) ───────────────────────────────────────
    onSurface: "#17161A",        // --ink   — primary text
    textSecondary: "#6B6873",    // --muted — secondary text, subtitles
    textFaint: "#9C98A4",        // --faint — mono overlines, metadata, placeholder text
    iconColor: "#3C3A42",        // --ink2  — icons, back chevrons, secondary controls

    // ── Lines & overlays ──────────────────────────────────────────
    // Ink-tinted alphas rather than opaque greys, so a line reads the same over
    // paper, white and any pastel surface.
    border: "rgba(23, 22, 26, 0.16)",    // --line2 — outlines that must be seen (inputs, buttons)
    rowBorder: "rgba(23, 22, 26, 0.10)", // --line  — hairlines between rows
    rowHoverBg: "rgba(23, 22, 26, 0.04)",
    wood: "rgba(23, 22, 26, 0.22)",      // --wood  — the shelf BOARD. Only the shelf uses this.
    scrim: "rgba(23, 22, 26, 0.28)",     // --scrim — behind sheets
    modalScrim: "rgba(23, 22, 26, 0.45)", // heavier scrim behind blocking modals

    // ── Bucket / progress-category colors ─────────────────────────
    // ⚠️ THESE ARE PASTELS, AND THEY ARE NOT SELF-SUFFICIENT.
    //
    // Every one of them sits at roughly 1.15:1 against the paper ground — invisible on
    // its own. They only read as a shape when they carry `MARK_OUTLINE` below, which is
    // the design's own device (`.msb .cells i` fills at 6% ink and still draws a 12%
    // inset ring). A pastel fill WITHOUT that ring is a bug, not a subtle style.
    //
    // Corollary: text on one of these must be INK (`COLORS.onSurface`), never white.
    // White on a pastel is ~1.1:1 and unreadable. If you find `color: 'white'` over a
    // category fill, it predates this palette.
    //
    // `*Main` is the pastel BODY and `*Accent` the near-white INNER FILL at the same
    // hue. They are a PAIR — never mix a main from one hue with an accent from another.
    // For ink sitting ON one of these, use the `*A` ramp member (redA/orgA/grnA/bluA).
    redMain: RED_PASTEL,                    // #FFDDDB — --red     — Unfamiliar
    redAccent: "#FFF2F2",                   // --redTint
    yellowMain: ORG_PASTEL,                 // #FFE6C8 — --org     — Target
    yellowAccent: "#FFF5EA",                // --orgTint
    greenMain: GRN_PASTEL,                  // #D9F4D9 — --grn     — Comfortable
    greenAccent: "#F0FAF0",                 // --grnTint
    blueMain: BLU_PASTEL,                   // #D2EBFF — --blu     — Mastered
    blueAccent: "#EEF8FF",                  // --bluTint
    purpleAccent: "#F8F4FF",                // --purTint
    // --tea. Claimed by the SIXTH game's hub row: the five accents above were each
    // already taken by a game (`GameDef.bgColor` is a persistent per-game color, not a
    // random one), so Hydra Bubbles needed a hue no other row was using.
    tealAccent: "#EAFBFA",                  // --teaTint
    hskChip: "#D2EBFF",                     // --blu (pastel; carries MARK_OUTLINE)

    /**
     * The inset ring every pastel-filled mark must carry, from the design's
     * `.msb .cells i`. Apply as an inset 1px box-shadow of this color (or as a plain
     * `outline`, where the shape already uses box-shadow for elevation).
     *
     * This is what makes a 1.15:1 fill legible. It is not optional decoration — see
     * the warning on the category block above.
     */
    markOutline: "rgba(23, 22, 26, 0.12)",

    // ── Highlights on a DARK ground (the design's --hlR / --hlY / --hlG / --hlB) ──
    // The pastel ramp above is tuned for the paper ground and disappears on charcoal.
    // These four are its counterpart: saturated, mid-lightness values whose only job
    // is to make a NUMBER read as a value rather than as body text when the surface
    // behind it is near-black.
    //
    // The only dark surfaces in the app are the challenge round scoreboard and the
    // running-total card on View Challenge (docs/STUDY_CHALLENGE.md § 5.5, § 6), so
    // that is where these are used — do NOT reach for them on the paper ground, where
    // they are loud and fail against the pastel ramp they are not part of.
    hlRed: "oklch(66% 0.24 25)",            // --hlR
    hlYellow: "oklch(84% 0.19 92)",         // --hlY — a per-round figure
    hlGreen: "oklch(78% 0.22 148)",         // --hlG
    hlBlue: "oklch(70% 0.19 252)",          // --hlB — the total

    // ── Semantic ink ──────────────────────────────────────────────
    // TEXT, ICONS, BORDERS and SOLID BUTTON GROUNDS that carry a meaning — danger,
    // success, info, warning. Saturated on purpose: these are read against the paper
    // ground with nothing behind them, so they need 4.5:1+, and white text on one of
    // them is legible.
    //
    // WHY THIS EXISTS: before the redesign, `redMain` was doing two unrelated jobs —
    // "the Unfamiliar band's fill" and "the app's semantic red". One hex served both
    // because the palette had only one red, so nothing forced them apart. The pastel
    // ramp forces them apart: a band FILL must be pale enough to sit under text, and
    // semantic ink must be dark enough to BE text. 51 call sites across 40 files were
    // silently relying on the overload.
    //
    // The rule, when picking between these and `*Main`:
    //   - Is it a FILL that something else sits on top of?      -> `*Main` (pastel)
    //   - Is it TEXT, an ICON, a BORDER, or a button's ground?  -> the ink below
    dangerInk: "#B54249",    // --redA — destructive actions, errors, negative deltas
    successInk: "#387D3D",   // --grnA — confirmations, wins, positive deltas
    infoInk: "#1F6CB0",      // --bluA — neutral emphasis, informational chips
    warnInk: "#A46400",      // --orgA — cautions, pending states. NOT AI provenance: that is
                             // `aiGenerated` below, which this token briefly and wrongly absorbed.

    // ── Zone rows (Arena promotion / relegation bands) ────────────
    // Near-white tints at the green/red hues — a row that is IN the zone, as opposed
    // to the saturated `.zone` divider above it.
    zoneUpRow: "#F0FAF0",        // oklch(97.5% 0.018 145)
    zoneDownRow: "#FFF2F2",      // oklch(97.5% 0.018  20)

    // ── Streak / activity ─────────────────────────────────────────
    // Deliberately OUTSIDE the ramp and unchanged by the redesign: the design's
    // `.hd .fire` specifies this exact value. The streak flame is the one place the
    // app is allowed a hue the palette does not own.
    fireActive: "#E65100",

    // ── Provenance: AI-generated content ──────────────────────────
    // ALSO deliberately outside the ramp, and its OWN token rather than an alias.
    //
    // This marks "a machine wrote this, a human has not approved it" — a provenance
    // flag, not a category, not a severity. It briefly rode `COLORS.warnInk` (--orgA
    // `#A46400`) during the redesign because both were loosely "the orange one"; that
    // was wrong twice over. `warnInk` means "caution" and is a dark gold, so the
    // treatment went muddy AND started reading as a warning about the content rather
    // than a note about where it came from.
    //
    // The value is the app's original AI-highlight orange, restored. It is oklch(78.6%
    // 0.143 54) — hue 54, which sits BETWEEN the ramp's `--red` (20) and `--org` (70)
    // on purpose. That gap is what keeps it from being confused with the Unfamiliar or
    // Target band fills when an AI-flagged surface appears next to banded content, and
    // it is why snapping it onto the hue-70 axis (which would give `#F3A744`) would be
    // a regression rather than a tidy-up.
    //
    // Used as a 1px border + an ~8% tint of itself; see theme/aiGeneratedStyling.ts,
    // which is the only place that composition is written down.
    aiGenerated: "#FF9E5A",
} as const;

export type ColorToken = keyof typeof COLORS;

/**
 * RAMP — the seven hues as {fill, ink, tint} TRIPLES rather than 21 loose tokens.
 *
 * WHY THIS EXISTS: the three tiers of a hue are only correct TOGETHER. A pastel fill
 * with the wrong hue's ink on it is the one palette mistake that typechecks, looks
 * deliberate, and is invisible in review — and the redesign's ghost glyphs, two-tone
 * tiles and outlined chips all need the fill and its ink at the same time. Handing a
 * component a hue KEY instead of two hex strings makes the pairing unbreakable at the
 * call site, which is where it was previously only a comment.
 *
 * Reach for `COLORS.red` / `COLORS.redA` directly when a site genuinely needs ONE
 * tier. Reach for `RAMP.red` when it needs two, and never destructure a fill from one
 * entry beside an ink from another.
 *
 *   fill  93–94%  the pastel a thing sits ON (needs an outline unless large + occupied)
 *   ink   52–56%  text, icons, borders, a button's ground
 *   tint  97.5%   the second tone of a two-tone tile
 *
 * `grey` has no tint: it is the achromatic rung, and at 97.5% lightness with no chroma
 * it would be indistinguishable from `background`. Use `background` where a grey tint
 * is what you mean.
 *
 * See docs/SHELF_REDESIGN.md § A1/D2 for the derivation and § A4 for the first caller.
 */
export const RAMP = {
    grey: { fill: COLORS.grey, ink: COLORS.greyA, tint: COLORS.background },
    pur: { fill: COLORS.pur, ink: COLORS.purA, tint: COLORS.purTint },
    blu: { fill: COLORS.blu, ink: COLORS.bluA, tint: COLORS.bluTint },
    red: { fill: COLORS.red, ink: COLORS.redA, tint: COLORS.redTint },
    org: { fill: COLORS.org, ink: COLORS.orgA, tint: COLORS.orgTint },
    grn: { fill: COLORS.grn, ink: COLORS.grnA, tint: COLORS.grnTint },
    tea: { fill: COLORS.tea, ink: COLORS.teaA, tint: COLORS.teaTint },
    yel: { fill: COLORS.yel, ink: COLORS.yelA, tint: COLORS.yelTint },
} as const;

/** A hue's key in {@link RAMP} — the unit a component should take when it needs a
 *  fill and its matching ink together. */
export type RampHue = keyof typeof RAMP;
