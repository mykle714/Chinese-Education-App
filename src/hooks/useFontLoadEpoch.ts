import { useEffect, useState } from "react";

/**
 * A counter that bumps whenever a web font finishes loading (`document.fonts.ready`, then
 * every "loadingdone"), so text measured against a fallback face on first paint is
 * re-measured with the real one. Noto Sans SC / 975 Maru SC swap in late, and a
 * `--cjk-font` override (useChineseFont, the font lab) can load another face later still.
 *
 * Put the epoch in the measurement's memo/effect key; the value itself means nothing.
 *
 * Users: IsoSpacedText and IsoFloorPrint (iso labels), SortBins (the speech bubble),
 * MiniCardSvg (the SVG mini card face).
 */
export function useFontLoadEpoch(): number {
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
