import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";

/**
 * Static renderer for a single character's glyph, drawn from the stroke corpus.
 *
 * Lives beside `loadCharData.ts` because it needs the same coordinate knowledge
 * and reads the same `hanzi-writer-data` corpus.
 *
 * WHY NOT REUSE HanziGuide: that wraps a real Hanzi Writer instance — animation,
 * quiz state, and a DOM node it tears down and recreates whenever the character
 * changes. Speed Reading's options are static, need no animation, and there are
 * two on screen covering up to 8 characters at a time. This is ~40 lines of SVG
 * instead.
 *
 * COORDINATE SYSTEM: corpus glyphs live in a Y-UP box of x ∈ [0, 1024],
 * y ∈ [-124, 900] (hanzi-writer's CHARACTER_BOUNDS, verified at
 * node_modules/hanzi-writer/dist/index.esm.js:579-585). The
 * `translate(0,900) scale(1,-1)` group below is exactly `y_svg = 900 - y_font`.
 *
 * See docs/SPEED_READING_GAME.md § Rendering a glyph.
 */

/** The subset of a corpus glyph file this component needs. */
interface GlyphData {
    strokes: string[];
}

interface GlyphSvgProps {
    character: string;
    /** Rendered width/height in px (the glyph box is square). */
    size: number;
    /** Fill color for the strokes. */
    color: string;
    className?: string;
}

/**
 * Process-lifetime cache of parsed glyph files, shared across every GlyphSvg
 * instance. A run re-renders the same handful of characters many times over a
 * minute; without this each option remount would pay a dynamic-import round trip
 * and flash empty.
 */
const glyphCache = new Map<string, GlyphData>();
/** In-flight loads, so two options mounting the same character share one import. */
const glyphPromises = new Map<string, Promise<GlyphData | null>>();

/**
 * CDN fallback for the glyph corpus, PINNED to the version in package.json.
 *
 * ⚠️ The CDN is not a rare-miss path — in a PRODUCTION BUILD it is the normal
 * one. `import('hanzi-writer-data/<char>.json')` is a bare module specifier with
 * a dynamic segment, which Rollup cannot statically analyze, so it survives the
 * build as a literal runtime `import()` of a bare specifier — something a browser
 * cannot resolve without an import map. Verified in `dist/`: the emitted chunk
 * still contains the raw template literal and no per-character chunks exist.
 * It resolves in `vite dev` (which rewrites bare specifiers) and throws in prod.
 *
 * `loadCharData.ts` has always had this fallback, which is why the writing
 * drill's grey guide works in production; this component needs it for the same
 * reason. Without it Speed Reading would render blank buttons in prod while
 * looking perfect in dev.
 */
const CDN_BASE = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1";

/**
 * Load one character's stroke data, local-first with a CDN fallback. Mirrors
 * `loadCharData`'s strategy but returns a promise rather than taking Hanzi
 * Writer's callback triple, and memoizes across every GlyphSvg instance.
 */
export function loadGlyph(char: string): Promise<GlyphData | null> {
    const cached = glyphCache.get(char);
    if (cached) return Promise.resolve(cached);
    const inFlight = glyphPromises.get(char);
    if (inFlight) return inFlight;

    const p = import(`hanzi-writer-data/${char}.json`)
        .then((mod) => (mod.default ?? mod) as GlyphData)
        .catch(() =>
            // Local resolution failed (always, in a production build — see CDN_BASE).
            fetch(`${CDN_BASE}/${char}.json`).then((res) => {
                if (!res.ok) throw new Error(`CDN HTTP ${res.status}`);
                return res.json() as Promise<GlyphData>;
            })
        )
        .then((data) => {
            // A malformed payload would crash the render downstream rather than
            // here, where the cause is still obvious.
            if (!data || !Array.isArray(data.strokes)) throw new Error("malformed glyph data");
            glyphCache.set(char, data);
            return data;
        })
        .catch((err) => {
            // Corpus coverage for discoverable words was measured at 100%, so a
            // miss here means an unexpected character or an offline CDN. Resolve
            // null instead of rejecting: the caller renders nothing and the game
            // drops the card, which is recoverable; an unhandled rejection is not.
            console.warn(`[GlyphSvg] no stroke data for "${char}":`, err);
            return null;
        })
        .finally(() => {
            glyphPromises.delete(char);
        });

    glyphPromises.set(char, p);
    return p;
}

const GlyphSvg: React.FC<GlyphSvgProps> = ({ character, size, color, className }) => {
    /**
     * Resolved load, tagged with the character it belongs to. The tag is what
     * stops a stale result painting after a character change: if `loaded.char`
     * no longer matches the prop, it is ignored rather than drawn.
     */
    const [loaded, setLoaded] = useState<{ char: string; strokes: string[] | null } | null>(null);

    /**
     * ⚠️ Read the cache DURING RENDER, not in the effect.
     *
     * An already-cached glyph must paint on the FIRST frame. Going through the
     * effect (even with an instantly-resolved promise) costs a paint with no
     * strokes, i.e. a blank flash. In Speed Reading that flash lands exactly at
     * the round change and reads as lag — the next card appears empty and then
     * fills in. See docs/SPEED_READING_GAME.md § Answer feedback.
     */
    const cached = glyphCache.get(character)?.strokes ?? null;
    const strokes = cached ?? (loaded?.char === character ? loaded.strokes : null);

    useEffect(() => {
        // Cache hit already rendered above; nothing to load.
        if (glyphCache.has(character)) return;
        let cancelled = false;
        void loadGlyph(character).then((data) => {
            if (cancelled) return;
            setLoaded({ char: character, strokes: data?.strokes ?? null });
        });
        return () => {
            cancelled = true;
        };
    }, [character]);

    return (
        <Box
            component="svg"
            className={className ?? "glyph-svg"}
            viewBox="0 0 1024 1024"
            width={size}
            height={size}
            aria-hidden="true"
            sx={{ display: "block", flexShrink: 0 }}
        >
            {/* Font space is y-up; this group flips it to SVG's y-down. */}
            <g transform="translate(0, 900) scale(1, -1)">
                {strokes?.map((d, i) => (
                    <path key={i} d={d} fill={color} />
                ))}
            </g>
        </Box>
    );
};

export default GlyphSvg;
