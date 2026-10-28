import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * IsoSpacedText — a centred, letter-spaced SVG `<text>` that sits on the same centre in
 * every engine (docs/ISO_ART_FRAMEWORK.md § "IsoSpacedText").
 *
 * Why not just `letterSpacing` + `textAnchor="middle"`: WebKit (iOS Safari) anchors the
 * run on its UNSPACED width and then adds the spacing, so a spaced word slides toward its
 * end by about half its total spacing — the Deck Tower's "LEARNING" plate sat ~8 px
 * toward its lower-right end on an iPhone while Chrome drew it centred.
 *
 * Instead the spacing is expressed as an explicit run length, which every engine anchors
 * on: the word's natural (unspaced) glyph width is measured once with
 * `getComputedTextLength`, then the text is drawn with
 * `textLength = natural + letterSpacing × (glyphs − 1)` and `lengthAdjust="spacing"`, which
 * spreads the extra length evenly between glyphs — the same look as `letterSpacing`,
 * anchored identically everywhere.
 *
 * Measuring: a render whose measure key (text, size, weight, font-load epoch) has no
 * measurement yet draws the bare text without `textLength`; the layout effect measures it
 * and re-renders with the length before paint, so no unspaced frame shows. Re-measures when
 * a web font finishes loading (`document.fonts` "loadingdone": Noto Sans SC swaps in late,
 * and a `--cjk-font` override can load another face). Where measuring yields nothing (no
 * layout, e.g. jsdom) it falls back to plain `letterSpacing`.
 *
 * Users: IsoFloorLabel (the plate), IsoCard (the head-band label), IsoModeSwitch (the paddle label).
 */
interface IsoSpacedTextProps extends Omit<React.SVGProps<SVGTextElement>, "children" | "letterSpacing" | "textLength" | "lengthAdjust" | "ref"> {
    children: string;
    /** Extra space between glyphs, in the text's own user units (world units in the iso kit). */
    letterSpacing: number;
}

/** Bumps whenever a web font finishes loading, so a measurement taken against a fallback face is retaken. */
function useFontLoadEpoch(): number {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => {
        const fonts = typeof document !== "undefined" ? document.fonts : undefined;
        if (!fonts) return;
        let cancelled = false;
        const bump = () => { if (!cancelled) setEpoch((e) => e + 1); };
        fonts.ready.then(bump).catch(() => { /* a failed load leaves the last measurement in place */ });
        fonts.addEventListener?.("loadingdone", bump);
        return () => {
            cancelled = true;
            fonts.removeEventListener?.("loadingdone", bump);
        };
    }, []);
    return epoch;
}

const IsoSpacedText: React.FC<IsoSpacedTextProps> = ({ children: text, letterSpacing, ...textProps }) => {
    const ref = useRef<SVGTextElement>(null);
    const fontEpoch = useFontLoadEpoch();
    const measureKey = `${text}|${textProps.fontSize}|${textProps.fontWeight}|${fontEpoch}`;
    const [measured, setMeasured] = useState<{ key: string; natural: number } | null>(null);
    const current = measured?.key === measureKey ? measured : null;

    // Only runs a measurement when the key has none; per-frame re-renders (the plate's press
    // spring) keep the key and cost nothing here.
    useLayoutEffect(() => {
        if (current || !ref.current) return;
        let natural = 0;
        try {
            natural = ref.current.getComputedTextLength();
        } catch {
            // Not laid out (detached / no layout engine): fall back to letterSpacing below.
        }
        setMeasured({ key: measureKey, natural });
    }, [current, measureKey]);

    // Array.from counts code points, so a surrogate-pair glyph is one gap, not two.
    const gaps = Math.max(0, Array.from(text).length - 1);
    let spacing: Pick<React.SVGProps<SVGTextElement>, "letterSpacing" | "textLength" | "lengthAdjust"> = {};
    if (current && current.natural > 0) spacing = { textLength: current.natural + letterSpacing * gaps, lengthAdjust: "spacing" };
    else if (current) spacing = { letterSpacing };

    return (
        <text ref={ref} {...textProps} {...spacing}>
            {text}
        </text>
    );
};

export default IsoSpacedText;
