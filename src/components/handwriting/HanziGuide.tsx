/**
 * HanziGuide — the greyed character + stroke-order guide (display only).
 *
 * Wraps Hanzi Writer purely for rendering the background guide. It is NEVER used
 * for capture or grading (its quiz mode pre-grades against the target, which would
 * defeat our independent top-1 recognition). Capture is a separate transparent
 * <WritingCanvas/> overlaid on top of this. See docs/HANDWRITING_RECOGNITION.md
 * ("Stroke-order background rendering — Hanzi Writer (display only)").
 *
 * The popup drives `outlineVisible` (per-tab timers + Peek/Flash button) and
 * `loopAnimation` (Tab 1's persistent stroke-order demo).
 */
import { useEffect, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import { loadCharData } from "./loadCharData";

interface HanziGuideProps {
  character: string;
  size: number;
  /** Whether the grey outline is currently shown. */
  outlineVisible: boolean;
  /** Tab 1: continuously animate the stroke order over the outline. */
  loopAnimation?: boolean;
  /** Grey tone for the outline. */
  outlineColor?: string;
}

export default function HanziGuide({
  character,
  size,
  outlineVisible,
  loopAnimation = false,
  outlineColor = "rgba(0,0,0,0.16)",
}: HanziGuideProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  // Stroke data loads async; outline/animation calls throw if data isn't ready or
  // failed to load (e.g. a glyph missing from the dataset). Gate on this so a load
  // failure degrades to "no guide" instead of crashing the component tree.
  const [dataReady, setDataReady] = useState(false);

  // Create the writer once per character/size. showCharacter:false keeps only the
  // ghost outline (+ optional animated strokes); the filled char is never shown.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = ""; // clear any prior instance's SVG
    setDataReady(false);
    const writer = HanziWriter.create(el, character, {
      width: size,
      height: size,
      padding: Math.round(size * 0.06),
      showCharacter: false,
      showOutline: false, // applied after data loads to avoid a pre-data throw
      outlineColor,
      strokeColor: outlineColor,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 250,
      delayBetweenLoops: 1200,
      charDataLoader: loadCharData,
      onLoadCharDataSuccess: () => setDataReady(true),
      onLoadCharDataError: (reason) => {
        // Missing/failed glyph data: skip the guide rather than crash.
        console.warn(`HanziGuide: no stroke data for "${character}"`, reason);
      },
    });
    writerRef.current = writer;
    if (loopAnimation) writer.loopCharacterAnimation();
    return () => {
      // Hanzi Writer has no destroy(); dropping the SVG + ref is sufficient.
      el.innerHTML = "";
      writerRef.current = null;
    };
    // Recreate only when the target glyph or size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, size]);

  // React to outline show/hide requests from the popup (timers + button). Only
  // once data is ready; guarded so an unexpected internal throw can't bubble.
  useEffect(() => {
    const writer = writerRef.current;
    if (!writer || !dataReady) return;
    try {
      if (outlineVisible) writer.showOutline({ duration: 120 });
      else writer.hideOutline({ duration: 120 });
    } catch (err) {
      console.warn("HanziGuide: outline toggle failed", err);
    }
  }, [outlineVisible, dataReady]);

  return (
    <div
      ref={containerRef}
      className="hanzi-guide"
      style={{ width: size, height: size, position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
