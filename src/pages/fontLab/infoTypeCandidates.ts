// Candidate faces for the app's INFO TYPE — the overline/caption voice.
//
// This is a THROWAWAY DEV CATALOG. Unlike src/theme/cjkFontOptions.ts (which ships and
// backs a user-facing setting), nothing here reaches production: the point is to try
// faces on, pick one, and then hardcode the winner as the default stack of `FONTS.label`
// in src/theme/fonts.ts. Delete this file once that decision is made — see
// docs/INFO_TYPE_LAB.md § "When this lab is done".
//
// WHY THERE ARE SANS FACES IN A LIST THAT REPLACES A MONO: the incumbent's problem is
// not only the face. `FONTS.mono` was doing two unrelated jobs — prose set small
// ("sense 1 · to be located at") and tabular data ("×12 wins") — and mono is only right
// for the second. So the list spans both answers: "a mono that survives 10px" and "stop
// using mono for prose". `kind` is the axis to compare along, not a cosmetic tag.
//
// Consumed by src/pages/fontLab/InfoTypeLab.tsx and src/theme/labelFontOverride.ts.

export type InfoFaceKind = "mono" | "sans";

export interface InfoFaceOption {
    /** Stable key; what the dev override stores in localStorage. */
    id: string;
    /** Google Fonts family name — exact, because it is both the URL and the CSS family. */
    family: string;
    kind: InfoFaceKind;
    /**
     * Weights the family ACTUALLY ships on Google Fonts, verified by reading back the
     * css2 response (Google silently CLAMPS an unavailable weight to the nearest one it
     * has and still answers 200, so an unverified list would quietly lie in the weight
     * control). A face that cannot do 600 is a real constraint for an overline.
     */
    weights: readonly number[];
    /** One line on what it brings, and where it is likely to fail. */
    note: string;
}

/**
 * Every face here is on Google Fonts under the OFL, so any of them can ship. The
 * incumbent leads so a column always has something to be judged against.
 */
export const INFO_FACE_CATALOG: readonly InfoFaceOption[] = [
    {
        id: "jetbrains-mono",
        family: "JetBrains Mono",
        kind: "mono",
        weights: [100, 200, 300, 400, 500, 600, 700, 800],
        note: "The face this flavour used to be set in, kept as the benchmark. A coding face tuned for 13–15px; its large x-height and blunt terminals go mushy at 10px under faint ink. No longer used anywhere in the app.",
    },
    {
        id: "martian-mono",
        family: "Martian Mono",
        kind: "mono",
        weights: [100, 200, 300, 400, 500, 600, 700, 800],
        note: "Drawn for interface micro-text, not for code. Wide and open by design, so it needs LESS added tracking than JetBrains — set it near 0.04em, not 0.14em.",
    },
    {
        id: "geist-mono",
        family: "Geist Mono",
        kind: "mono",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        note: "Neutral, low-personality mono with tight apertures. The closest to 'same idea, executed better' if you want the mono look to survive.",
    },
    {
        id: "ibm-plex-mono",
        family: "IBM Plex Mono",
        kind: "mono",
        weights: [100, 200, 300, 400, 500, 600, 700],
        note: "Slab-ish terminals and a humanist skeleton. More warmth than JetBrains; the slabs can clog at 10px.",
    },
    {
        id: "azeret-mono",
        family: "Azeret Mono",
        kind: "mono",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        note: "Squarish, very even colour. Reads as deliberate at caps sizes; can look stencil-ish in long strings. ⚠ NOW SHIPPING as `FONTS.mono`, the DATA face — trying it here would put one face back on both jobs, which is what the split undid.",
    },
    {
        id: "spline-sans-mono",
        family: "Spline Sans Mono",
        kind: "mono",
        weights: [300, 400, 500, 600, 700],
        note: "A mono with sans proportions — narrower than most, so a long caption fits without shrinking.",
    },
    {
        id: "dm-mono",
        family: "DM Mono",
        kind: "mono",
        weights: [300, 400, 500],
        note: "Light and geometric. ⚠ Tops out at 500, so there is no semibold to lean on when the faint ink needs help.",
    },
    {
        id: "space-mono",
        family: "Space Mono",
        kind: "mono",
        weights: [400, 700],
        note: "High personality, retro-technical. ⚠ Only 400/700 — nothing in between. In the list to show what 'too much character' costs on a caption you see 30 times a screen.",
    },
    {
        id: "instrument-sans",
        family: "Instrument Sans",
        kind: "sans",
        weights: [400, 500, 600, 700],
        note: "THE APP'S OWN SANS. Costs ZERO new bytes — already loaded in index.html. Picking this means overlines stop being a separate face and become the UI font set small, which is the most common modern pattern.",
    },
    {
        id: "archivo",
        family: "Archivo",
        kind: "sans",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        note: "Grotesque built for high-performance small text. Its caps are unusually sturdy, which is exactly what a tracked uppercase overline needs.",
    },
    {
        id: "inter-tight",
        family: "Inter Tight",
        kind: "sans",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        note: "Inter's tighter cut. Maximally neutral — the safe answer, and the boring one.",
    },
    {
        id: "space-grotesk",
        family: "Space Grotesk",
        kind: "sans",
        weights: [300, 400, 500, 600, 700],
        note: "Space Mono's proportional sibling. Keeps a little of the technical flavour without the fixed advance.",
    },
    {
        id: "public-sans",
        family: "Public Sans",
        kind: "sans",
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        note: "SHIPPING as `FONTS.label`. Plain, wide-aperture civic grotesque: very legible at 10px, with almost no voice of its own — right for a label seen thirty times a screen.",
    },
];

/**
 * The Google Fonts stylesheet for one face, requesting every weight it ships so the
 * lab's weight control never renders a synthesized (faked) bold.
 */
export function infoFaceHref(option: InfoFaceOption): string {
    const family = option.family.replace(/ /g, "+");
    return `https://fonts.googleapis.com/css2?family=${family}:wght@${option.weights.join(";")}&display=swap`;
}

/** The full stack for one face — the app's own sans as the tail fallback. */
export function infoFaceStack(option: InfoFaceOption): string {
    return option.kind === "mono"
        ? `"${option.family}", ui-monospace, "SF Mono", Menlo, Consolas, monospace`
        : `"${option.family}", "Instrument Sans", system-ui, -apple-system, sans-serif`;
}

/** Option for an id, or the incumbent when the id is unknown. Never undefined. */
export function resolveInfoFace(id: string | null | undefined): InfoFaceOption {
    return INFO_FACE_CATALOG.find((f) => f.id === id) ?? INFO_FACE_CATALOG[0];
}

/** Stylesheets already injected, keyed by id, so each loads at most once. */
const injected = new Set<string>();

/**
 * Ensure a face's stylesheet is in the document, then resolve once its glyphs are
 * actually usable. Resolves rather than rejects on a failed load: the tail fallback
 * still renders, which is a degraded typeface, not a broken page.
 */
export async function loadInfoFace(option: InfoFaceOption): Promise<void> {
    if (!injected.has(option.id)) {
        injected.add(option.id);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = infoFaceHref(option);
        link.dataset.infoFace = option.id;
        document.head.appendChild(link);
    }
    try {
        // Ask for the two weights the specimens actually use, so `document.fonts` is
        // warm before anything is measured or screenshotted.
        await Promise.all([
            document.fonts.load(`400 12px "${option.family}"`),
            document.fonts.load(`600 12px "${option.family}"`),
        ]);
    } catch {
        // Ignore — see the note above.
    }
}
