// Central color palette — the single source of truth for every color in the app.
//
// ⚠️ SHELF SYSTEM v2 — the "highlighter palette" (docs/SHELF_REDESIGN.md § A1b).
// The palette is the design's `shelf-system-v2.css`. v1 gave each hue TWO members, a
// pastel surface and a dark INK (`--redA` …). v2 drops the ink tier entirely — text,
// icons, borders and the four semantic roles (danger / success / info / warn) are all
// `--ink` now — and gives each hue FOUR FILL tiers instead:
//
//   {hue}      SURFACE  large fills: cards, sheets, centers, panels
//   {hue}M     MID      mid-size fills: menu tiles, bento, spines, rows, pills,
//                       avatars, bubbles, a game's whole-screen ground
//                       (the design's `--{hue}K` is an alias of M and is not repeated)
//   {hue}Mk    MARK     fluorescent: dictionary keys, mastery cells, mini-card bars
//   {hue}Tint  TINT     near-white second tone: a game's HUD/timer strip, zone rows
//
// Colour, in v2, never carries text: every one of these is a GROUND that ink sits on.
//
// ⚠️ HOW "ship hex" IS DONE IN v2 — PER-CHANNEL CLIP, NOT GAMUT-MAP (a reversal of v1).
// Most v2 values sit OUTSIDE sRGB (and many outside Display-P3 too). The design preview
// shows them the way the browser draws an out-of-gamut oklch(): each sRGB channel is
// clamped independently. That clamp is lossy on hue, but it is what keeps the tiers
// apart — hue-preserving gamut-mapping (the v1 rule) collapses red/org/blu/pur
// Surface ≈ Mid ≈ Mark into one pastel (redMk would be #FFC8C5 against red #FFD1D3).
// The user ruled (2026-09-23) that the app matches the design PREVIEW, so every value
// below is the clamped sRGB rendering of the oklch noted beside it; `clipped` marks the
// ones where the clamp did anything. Re-derive with `oklch_to_hex` in
// docs/SHELF_REDESIGN.md § A1 (the per-channel one, NOT `gamut_map`).
//
// WHY HEX AND NOT `oklch()`: MUI's `alpha()` cannot parse an `oklch()` string and
// throws. Author in oklch, ship hex.
//
// Progress-category (bucket) colors also exist as CATEGORY_COLORS / BAND_MARK in
// utils/categoryColors.ts — use those when the color is chosen *by a card's category*.
//
// ⚠️ THIS FILE IMPORTS NOTHING. It is the palette's root: `utils/categoryColors.ts`
// derives its category and collection colours FROM the ramp below, so the dependency
// runs one way. (It once imported CATEGORY_COLORS back, which made the two modules a
// cycle that evaluated half the palette as `undefined` at startup.) The surfaces the
// `*Main` aliases share with the ramp are hoisted as constants for the same reason.
const RED_SURFACE = "#FFC9CD";   // oklch(90% 0.08    15) clipped — --red  — Unfamiliar
const YEL_SURFACE = "#FFEAAA";   // oklch(94% 0.085   92) clipped — --yel  — Target (v2: was org)
const GRN_SURFACE = "#C2F8CC";   // oklch(93% 0.08   150)         — --grn  — Comfortable
const BLU_SURFACE = "#C3E1FF";   // oklch(91% 0.09   264) clipped — --blu  — Mastered

/** --ink. Every text, icon and border in v2, and every semantic role. */
const INK = "#17161A";

export const COLORS = {
    // ── The raw ramp ──────────────────────────────────────────────
    // Named exactly as the design's CSS custom properties, so an artboard's
    // `background: var(--purM)` translates to `COLORS.purM` with no lookup table.
    // Prefer a SEMANTIC token below, or a hue KEY into RAMP, where one exists.
    //
    // grey is the achromatic rung and has only two members: `grey` (an inert filled
    // surface — tracks, empty cells) and `greyA`, a mid grey the design still keeps for
    // spent pips and the neutral bubble ring. It is the one `*A` v2 did not remove,
    // because it is a FILL (a pip), not an ink.
    grey: "#E7E7EA",     // oklch(93% 0.004 285)
    greyA: "#A4A4A9",    // oklch(72% 0.008 285)

    pur: "#EDD8FF",      // oklch(92%   0.085  300) clipped
    purM: "#F2CDFF",     // oklch(91.5% 0.1425 300) clipped
    purMk: "#F2ABFF",    // oklch(88%   0.24   300) clipped
    purTint: "#F8F4FF",  // oklch(97.5% 0.018  300) clipped

    blu: BLU_SURFACE,    // oklch(91%   0.09   264) clipped
    bluM: "#A9DFFF",     // oklch(90.5% 0.145  261.5) clipped
    bluMk: "#69D0FF",    // oklch(87%   0.24   259) clipped
    bluTint: "#F0F7FF",  // oklch(97.5% 0.018  259) clipped

    red: RED_SURFACE,    // oklch(90%   0.08    15) clipped
    redM: "#FFB8BC",     // oklch(90.5% 0.14    18.5) clipped
    redMk: "#FF888D",    // oklch(88%   0.24    22) clipped
    redTint: "#FFF2F1",  // oklch(97.5% 0.018   22) clipped

    org: "#FFDEB0",      // oklch(93%   0.08    65) clipped
    orgM: "#FFD07C",     // oklch(92%   0.14    63.5) clipped
    orgMk: "#FFA900",    // oklch(88%   0.24    62) clipped
    orgTint: "#FFF4EB",  // oklch(97.5% 0.018   62) clipped

    grn: GRN_SURFACE,    // oklch(93%   0.08   150)
    grnM: "#ABF5B4",     // oklch(90.5% 0.115  147.5)
    grnMk: "#63F06F",    // oklch(85%   0.21   145)
    grnTint: "#F0FAF0",  // oklch(97.5% 0.018  145)

    // tea has no Mark tier in the design; RAMP.tea.mark falls back to teaM.
    tea: "#B0F7F6",      // oklch(93%   0.07   195)
    teaM: "#70FAFA",     // oklch(91%   0.12   195)
    teaTint: "#EAFBFA",  // oklch(97.5% 0.018  195)

    // `--yel` — v2 promotes it from a side hue to a BAND hue: Target is yellow now
    // (artboard 18: "Target yellow"). It also still carries Study Mix / Learn Now.
    yel: YEL_SURFACE,    // oklch(94%   0.085   92) clipped
    yelM: "#FFE66E",     // oklch(92.5% 0.1425  97) clipped
    yelMk: "#F9D900",    // oklch(88%   0.24   102) clipped
    // A DEEPER yellow mark for small marks on a light face. The design draws the
    // mini-card mastery strip (artboard 17, 3.5px bars on the cream card face) with
    // this instead of `yelMk`, which at that size disappears into the cream.
    yelMkD: "#EEC900",   // oklch(84%   0.19    97) clipped
    yelTint: "#F9F7EA",  // oklch(97.5% 0.018  102)

    // ── `--gld`, the action metal ─────────────────────────────────
    // A saturated gold, the one ramp member that is NOT a pale ground. The arena flow
    // (docs/ARENA_FEATURE.md) needs a single page-level ACTION that is unmistakably the
    // one thing to tap, and a FROZEN, finished board; both wanted a metal, and every
    // other hue on that page is spoken for (green promotion, red demotion, org "you").
    //
    // ⚠️ IT BREAKS THE LIGHTNESS BANDS ON PURPOSE: 82%, not 90–94%. That is what makes it
    // read as an action instead of a surface. Do not "correct" it — a pale gold is `yel`.
    // v2 removed its ink (`--gldA`): text on gold is `--ink`, like everywhere else.
    gld: "#FFB100",      // oklch(82%   0.19    78) clipped — the action's ground
    gldTint: "#F8D9AA",  // oklch(90%   0.07    78) — the same action, disabled
    // The locked board's frame: an antique gold a step duller than the button, so a
    // finished week reads as metal rather than as something to tap.
    gldFrame: "#E0A82F", // oklch(76.5% 0.144   82) — `--gldFrame`

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
    onSurface: INK,              // --ink   — primary text, and in v2 every semantic role
    textSecondary: "#6B6873",    // --muted — secondary text, subtitles
    textFaint: "#9C98A4",        // --faint — mono overlines, metadata, placeholder text
    iconColor: "#3C3A42",        // --ink2  — icons, back chevrons, secondary controls

    // ── Lines & overlays ──────────────────────────────────────────
    // Ink-tinted alphas rather than opaque greys, so a line reads the same over
    // paper, white and any pastel surface.
    border: "rgba(23, 22, 26, 0.16)",    // --line2 — outlines that must be seen (inputs, buttons)
    rowBorder: "rgba(23, 22, 26, 0.10)", // --line  — hairlines between rows
    rowHoverBg: "rgba(23, 22, 26, 0.05)", // --hover (was 0.04, off the design by 1%)
    wood: "rgba(23, 22, 26, 0.22)",      // --wood  — the shelf BOARD. Only the shelf uses this.
    scrim: "rgba(23, 22, 26, 0.28)",     // --scrim — behind sheets
    modalScrim: "rgba(23, 22, 26, 0.45)", // heavier scrim behind blocking modals

    // ── Bucket / progress-category colors ─────────────────────────
    // The SURFACE tier of each band hue. Text on one of these is always INK
    // (`COLORS.onSurface`); white on a pale ground is unreadable.
    //
    // Small band-coloured shapes (chips, pills, cells) do NOT use these: a pill takes the
    // band's MID and a mastery cell its MARK — see BAND_MID / BAND_MARK in
    // utils/categoryColors.ts.
    //
    // `*Main` is the band's surface and `*Accent` the near-white TINT at the same hue.
    // ⚠️ The names are historical: `yellowMain` WAS the orange Target pastel until v2 made
    // Target yellow, so the name is finally accurate. `yellowAccent` and the other four
    // accents also back the fie card-fill swatches, which are PINNED to their stored hexes
    // in utils/cardColor.ts rather than read from here — see that file.
    redMain: RED_SURFACE,                   // --red     — Unfamiliar
    redAccent: "#FFF2F1",                   // --redTint
    yellowMain: YEL_SURFACE,                // --yel     — Target
    yellowAccent: "#F9F7EA",                // --yelTint
    greenMain: GRN_SURFACE,                 // --grn     — Comfortable
    greenAccent: "#F0FAF0",                 // --grnTint
    blueMain: BLU_SURFACE,                  // --blu     — Mastered
    blueAccent: "#F0F7FF",                  // --bluTint
    purpleAccent: "#F8F4FF",                // --purTint
    // --tea. Claimed by the SIXTH game's hub row (Hydra Bubbles): the five accents above
    // were each already taken by a game (`GameDef.hue` is a persistent per-game colour).
    tealAccent: "#EAFBFA",                  // --teaTint
    // "The blue surface", referenced rather than repeated so a repaint carries it.
    hskChip: BLU_SURFACE,                   // --blu (carries MARK_OUTLINE)

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

    // ── Semantic roles ────────────────────────────────────────────
    // v2 SETS ALL FOUR TO INK (`--danger:var(--ink);--success:var(--ink);…`), and the
    // artboards follow through: the Delete Account button is a black pill, the arena's
    // promotion banner is black, the swipe hints are black. Meaning is carried by WORDS,
    // ICONS and position, not by hue — the palette's hues are all pale grounds now and
    // none of them can be text.
    //
    // The four tokens are KEPT as names (the design keeps `--danger` & co. too) so a
    // call site still says what the colour is FOR, and a later revision that brings one
    // back (a red danger, say) is a one-line change here rather than a 48-site hunt.
    //
    //   Is it a FILL that something else sits on top of?      -> a ramp tier
    //   Is it TEXT, an ICON, a BORDER, or a button's ground?  -> these (= ink)
    dangerInk: INK,          // --danger  — destructive actions, errors, negative deltas
    successInk: INK,         // --success — confirmations, wins, positive deltas
    infoInk: INK,            // --info    — neutral emphasis, informational chips
    warnInk: INK,            // --warn    — cautions, pending states. NOT AI provenance
                             //             (that is `aiGenerated` below).

    // ── Zone rows (Arena promotion / relegation bands) ────────────
    // Near-white tints at the green/red hues — a row that is IN the zone, as opposed
    // to the saturated `.zone` divider above it.
    zoneUpRow: "#F0FAF0",        // --grnTint
    zoneDownRow: "#FFF2F1",      // --redTint

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
 * RAMP — each hue as its four v2 tiers {surface, mid, mark, tint}, rather than ~35 loose
 * tokens.
 *
 * WHY THIS EXISTS: a component that paints a hue in more than one place (a bento tile
 * and its ghost glyph, a game's ground and its HUD strip) must take all of them from
 * the SAME hue. Handing it a hue KEY instead of loose hexes makes that pairing
 * unbreakable at the call site.
 *
 *   surface  90–94%  large fills: cards, sheets, centers, panels
 *   mid      ~91%    tiles, spines, rows, pills, avatars, bubbles, a game's ground
 *   mark     84–88%  fluorescent: dictionary keys, mastery cells, mini-card bars
 *   tint     97.5%   the near-white second tone (HUD strips, zone rows)
 *
 * There is NO ink member any more (v2 removed the tier): text and icons on every one
 * of these are `COLORS.onSurface`.
 *
 * Degenerate entries, because the design does not define every tier for every hue:
 * `grey` has no mid (it IS the neutral mid) and its "mark" is the mid grey `greyA`;
 * its tint is the paper `background`. `tea` has no mark, so mark = mid. `gld` is an
 * action rather than a ground and has one fill for all three; its tint is the
 * DISABLED action, not a second tone.
 *
 * See docs/SHELF_REDESIGN.md § A1b.
 */
export const RAMP = {
    grey: { surface: COLORS.grey, mid: COLORS.grey, mark: COLORS.greyA, tint: COLORS.background },
    pur: { surface: COLORS.pur, mid: COLORS.purM, mark: COLORS.purMk, tint: COLORS.purTint },
    blu: { surface: COLORS.blu, mid: COLORS.bluM, mark: COLORS.bluMk, tint: COLORS.bluTint },
    red: { surface: COLORS.red, mid: COLORS.redM, mark: COLORS.redMk, tint: COLORS.redTint },
    org: { surface: COLORS.org, mid: COLORS.orgM, mark: COLORS.orgMk, tint: COLORS.orgTint },
    grn: { surface: COLORS.grn, mid: COLORS.grnM, mark: COLORS.grnMk, tint: COLORS.grnTint },
    tea: { surface: COLORS.tea, mid: COLORS.teaM, mark: COLORS.teaM, tint: COLORS.teaTint },
    yel: { surface: COLORS.yel, mid: COLORS.yelM, mark: COLORS.yelMk, tint: COLORS.yelTint },
    gld: { surface: COLORS.gld, mid: COLORS.gld, mark: COLORS.gld, tint: COLORS.gldTint },
} as const;

/** One tier of a hue — the unit a single-colour call site picks from RAMP. */
export type RampTier = keyof (typeof RAMP)["red"];

/** A hue's key in {@link RAMP} — the unit a component should take when it needs a
 *  fill and its matching ink together. */
export type RampHue = keyof typeof RAMP;
