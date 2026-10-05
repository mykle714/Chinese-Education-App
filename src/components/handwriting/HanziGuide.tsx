/**
 * HanziGuide — the greyed character + stroke-order guide (display only).
 *
 * Wraps Hanzi Writer purely for rendering the background guide. It is NEVER used
 * for capture or grading (its quiz mode pre-grades against the target, which would
 * defeat our independent top-1 recognition). Capture is a separate transparent
 * <WritingCanvas/> overlaid on top of this. See docs/HANDWRITING_RECOGNITION.md
 * ("Stroke-order background rendering — Hanzi Writer (display only)").
 *
 * The host drives `outlineVisible` (useLevelGuide's timers + assist button),
 * `loopAnimation` (Trace's persistent stroke-order demo), `loopStrokeIndex` (Snap:
 * only the next stroke to write, animated on repeat) and `regionClip` (Quarters /
 * Eighths: clip the outline to one 田 / 米 region — `regionClipPath` in
 * levelBehavior.ts).
 *
 * Fading: Hanzi Writer's outline stays drawn once its data loads; visibility is
 * purely the container's opacity, so the outline, Trace's looping strokes and Snap's
 * next-stroke cue show / hide as one layer. Fades are opt-in per direction — the host
 * passes `fadeIn` / `fadeOut` (Step Through: both, for its flash and Show press;
 * Memorize: `fadeOut`, for the first stroke clearing the study guide). Everything else
 * is instant, and even with `fadeIn` a canvas that STARTS with the guide (mount, or a
 * redraw — another character, level via `resetKey`, or loop setting — whose target
 * shows it) is drawn at once. The Quarters / Eighths region cycle (`regionClip`) is a
 * plain clip swap. A redraw whose target hides the guide waits out a running fade-out.
 * See docs/PRACTICE_WRITING.md ("Guide fade").
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import { loadCharData } from "./loadCharData";
import { COLORS } from "../../theme/colors";
import { guidePadding } from "./strokeSnap";

/**
 * Snap's next-stroke cue. `--faint`: clearly darker than the `--line2` outline, and
 * clearly lighter than the ink a snapped stroke turns into, so the three never blur.
 */
const NEXT_STROKE_COLOR = COLORS.textFaint;
/** Rest between repeats of the next-stroke animation (ms). */
const NEXT_STROKE_PAUSE_MS = 700;
/** Fade in / out of the whole guide layer (ms), for on/off on a canvas already in use. */
export const GUIDE_FADE_MS = 220;

/**
 * Everything that, when changed, needs a new Hanzi Writer instance. Held as one
 * "applied" snapshot so a redraw that hides the guide can wait out the fade-out.
 * (`regionClip` is deliberately absent: it is only a CSS clip and swaps instantly.)
 */
interface GuideConfig {
  character: string;
  size: number;
  resetKey?: string | number;
  loopAnimation: boolean;
}

function sameConfig(a: GuideConfig, b: GuideConfig): boolean {
  return (
    a.character === b.character &&
    a.size === b.size &&
    a.resetKey === b.resetKey &&
    a.loopAnimation === b.loopAnimation
  );
}


interface HanziGuideProps {
  character: string;
  size: number;
  /** Whether the grey outline is currently shown. */
  outlineVisible: boolean;
  /** Tab 1: continuously animate the stroke order over the outline. */
  loopAnimation?: boolean;
  /** Grey tone for the outline. */
  outlineColor?: string;
  /**
   * Snap: animate ONLY this stroke (0-based), on repeat, in a darker grey than the
   * outline so it reads as "draw this next". undefined / ≥ stroke count = no animation.
   */
  loopStrokeIndex?: number;
  /** Levels 4/6: CSS clip-path limiting the guide to one region (undefined = whole glyph). */
  regionClip?: string;
  /**
   * Recreate the Hanzi Writer instance when this changes (the level, so a level's
   * loop / next-stroke colour never leaks into the next). Replaces a React `key`,
   * which would also unmount the OLD guide instantly when the new level has none.
   */
  resetKey?: string | number;
  /** Fade the guide IN when it turns on mid-use (Step Through's Show press). */
  fadeIn?: boolean;
  /** Fade the guide OUT when it turns off (Step Through's flash end, Memorize's first stroke). */
  fadeOut?: boolean;
}

export default function HanziGuide({
  character,
  size,
  outlineVisible,
  loopAnimation = false,
  outlineColor = COLORS.border, // --line2, an ink alpha
  loopStrokeIndex,
  regionClip,
  resetKey,
  fadeIn = false,
  fadeOut = false,
}: HanziGuideProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  // Stroke data loads async; outline/animation calls throw if data isn't ready or
  // failed to load (e.g. a glyph missing from the dataset). Gate on this so a load
  // failure degrades to "no guide" instead of crashing the component tree.
  const [dataReady, setDataReady] = useState(false);

  // ── Fade sequencing ─────────────────────────────────────────────────────────
  // `applied` is what is actually drawn; `incoming` is what the props ask for.
  const incoming: GuideConfig = { character, size, resetKey, loopAnimation };
  const [applied, setApplied] = useState<GuideConfig>(incoming);
  const needsSwap = !sameConfig(applied, incoming);
  const opaque = outlineVisible && dataReady;
  // Latest props for the deferred apply (the timer must not commit a stale config),
  // and for the writer-creation effect's "does this canvas start with the guide?".
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const outlineVisibleRef = useRef(outlineVisible);
  outlineVisibleRef.current = outlineVisible;
  // Whether the layer's last hide was faded (decides whether a hiding redraw waits).
  const fadeOutRef = useRef(fadeOut);
  fadeOutRef.current = fadeOut;

  // True from a writer's creation until its guide is first on screen, when the canvas
  // starts WITH the guide: that first reveal skips the transition (drawn, not faded).
  const [instantReveal, setInstantReveal] = useState(outlineVisible);

  // When the layer last went transparent (null = opaque now). Timing a hiding redraw
  // from THIS, not from the prop change, covers a change that lands in the same render
  // as a faded hide (e.g. Step Through's flash ending as the level changes): it still waits out the fade. Starts
  // at 0 ("hidden forever") so the very first config never waits. Declared before
  // the swap effect so it has run by the time that effect reads it.
  const hiddenSinceRef = useRef<number | null>(0);
  useEffect(() => {
    if (opaque) hiddenSinceRef.current = null;
    else if (hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
  }, [opaque]);

  useEffect(() => {
    if (!needsSwap) return;
    // The new canvas starts WITH the guide (e.g. Trace → Snap, next character): redraw
    // now and let `instantReveal` draw it without a fade. Otherwise, if the old guide
    // is fading out, wait for that to finish before clearing it.
    const hiddenFor = Date.now() - (hiddenSinceRef.current ?? Date.now());
    const fading = !outlineVisibleRef.current && fadeOutRef.current;
    const wait = fading ? Math.max(0, GUIDE_FADE_MS - hiddenFor) : 0;
    if (wait === 0) {
      setApplied(incomingRef.current);
      return;
    }
    const t = setTimeout(() => setApplied(incomingRef.current), wait);
    return () => clearTimeout(t);
  }, [needsSwap, character, size, resetKey, loopAnimation]);

  // Create the writer once per character/size. showCharacter:false keeps only the
  // ghost outline (+ optional animated strokes); the filled char is never shown.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = ""; // clear any prior instance's SVG
    setDataReady(false);
    setInstantReveal(outlineVisibleRef.current);
    const { character, size, loopAnimation } = applied;
    const writer = HanziWriter.create(el, character, {
      width: size,
      height: size,
      padding: guidePadding(size),
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
    // Recreate when the drawn glyph, size, level or loop setting changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied.character, applied.size, applied.resetKey, applied.loopAnimation]);

  // Draw the outline once the data is ready and leave it drawn: showing / hiding is
  // the container's opacity (below). Guarded so an unexpected internal throw can't
  // bubble.
  useEffect(() => {
    const writer = writerRef.current;
    if (!writer || !dataReady) return;
    try {
      writer.showOutline({ duration: 0 });
    } catch (err) {
      console.warn("HanziGuide: outline draw failed", err);
    }
  }, [dataReady]);

  // End the instant-reveal window. Once the guide is on screen, flush its style
  // (opacity 1 with NO transition) before turning the transition back on — without
  // the forced style read the browser could batch both renders and fade it anyway.
  // If the guide is switched off before it ever showed, there is nothing to skip.
  useLayoutEffect(() => {
    if (!instantReveal) return;
    if (opaque) {
      const el = containerRef.current;
      if (el) void getComputedStyle(el).opacity;
      setInstantReveal(false);
    } else if (!outlineVisible) {
      setInstantReveal(false);
    }
  }, [instantReveal, opaque, outlineVisible]);

  // Snap: repeat the NEXT stroke's animation. Each pass hides the whole main layer
  // first (so a stroke animated before an undo never lingers), animates the one
  // stroke, then pauses. A changed index / unmount cancels the chain via `cancelled`;
  // Hanzi Writer's own render queue drops the in-flight mutation when the next run
  // starts.
  useEffect(() => {
    const writer = writerRef.current;
    if (!writer || !dataReady || loopStrokeIndex === undefined) return;
    let cancelled = false;
    let pauseTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      writer.updateColor("strokeColor", NEXT_STROKE_COLOR);
      void writer.getCharacterData().then((data) => {
        if (cancelled || loopStrokeIndex >= data.strokes.length) {
          // Every stroke written: nothing left to cue.
          void writer.hideCharacter({ duration: 0 });
          return;
        }
        const pass = () => {
          if (cancelled) return;
          // Chained, not back-to-back: Hanzi Writer runs mutations on animation
          // frames, so the hide must land before the stroke's own state is set.
          void writer.hideCharacter({
            duration: 0,
            onComplete: () => {
              if (cancelled) return;
              void writer.animateStroke(loopStrokeIndex, {
                onComplete: () => {
                  if (!cancelled) pauseTimer = setTimeout(pass, NEXT_STROKE_PAUSE_MS);
                },
              });
            },
          });
        };
        pass();
      });
    } catch (err) {
      console.warn("HanziGuide: next-stroke animation failed", err);
    }
    return () => {
      cancelled = true;
      if (pauseTimer) clearTimeout(pauseTimer);
    };
  }, [loopStrokeIndex, dataReady]);

  return (
    <div
      ref={containerRef}
      className="hanzi-guide"
      style={{
        width: size,
        height: size,
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        clipPath: regionClip,
        WebkitClipPath: regionClip,
        opacity: opaque ? 1 : 0,
        // The transition on the NEW style governs the change, so pick it by direction.
        transition: (opaque ? fadeIn && !instantReveal : fadeOut) ? `opacity ${GUIDE_FADE_MS}ms ease` : "none",
      }}
    />
  );
}
