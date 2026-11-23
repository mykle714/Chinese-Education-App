/**
 * levelBehavior.ts — what each Practice Writing level DOES (client-only).
 *
 * The level list itself (numbers, stored `mode`s, names) is the shared contract
 * `server/contracts/writingLevels.ts`; this table adds the guide/lock/button behaviour
 * the drawing surface needs, keyed by mode. `useLevelGuide` is the only interpreter.
 *
 *   guide      — how the grey outline behaves on entry:
 *                  persistent  shown for the whole attempt
 *                  flash       shown for `flashMs`, then hidden
 *                  study       shown until the first stroke (Memorize)
 *                  none        never shown
 *   animation  — Hanzi Writer stroke-order playback: the whole character looped
 *                (Trace), or only the NEXT stroke to write, repeated (Snap).
 *   snap       — Snap: each finished stroke is matched against the next expected
 *                stroke; a match is replaced by the printed stroke shape, a miss
 *                turns red and fades out (WritingStage → strokeSnap.ts).
 *   regions    — the outline is clipped to a wedge meeting at the centre, a window
 *                of `span` out of `positions` equal-area rim stretches, stepping
 *                one stretch clockwise per Next press from the top-left corner
 *                (Sections: a ⅓ window sliding in ⅙ steps).
 *   lockWhileGuide — drawing is blocked while the outline is up.
 *   button     — the assist button under the panel, its cooldown (from press) and an
 *                optional cap on presses per panel open (`uses`; Flash: 1). A press
 *                flashes the outline for `flashMs` when the level has one, else (region
 *                levels) advances the region.
 *   timed      — Level 8: a per-character clock of TIMED_MS_PER_STROKE × strokes.
 *
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 1 (the level table), docs/PRACTICE_WRITING.md.
 */
import type { WritingMode } from "../../../server/contracts/writingLevels";

/**
 * The capture/coordinate space of every focused writing panel (the popup's FOCUS_SIZE,
 * WritingFocusEditor, the Writing Grid). One value so recognition sees the same scale
 * everywhere. Lives here (a pure module) so light importers — the game registry's
 * constants — do not pull a component in.
 */
export const WRITING_FOCUS_SIZE = 300;

/**
 * How a region level clips the outline (Sections — the only region level since Quarters
 * was replaced by Flash on 2026-11-22; the spec stays general). The rim is cut into
 * `positions` equal stretches; the visible wedge covers `span` consecutive stretches
 * and each Next press slides it ONE stretch clockwise, so there are `positions`
 * distinct windows and neighbouring windows overlap when `span > 1`.
 *   Sections  { positions: 6, span: 2 } — ⅓ of the character shown, advancing by ⅙
 *   (the retired Quarters was { positions: 4, span: 1 } — one X triangle at a time)
 */
export interface RegionSpec {
  positions: number;
  span: number;
}

export interface LevelBehavior {
  guide: "persistent" | "flash" | "study" | "none";
  animation: "loop" | "nextStroke" | null;
  regions: RegionSpec | null;
  /** How long a flash of the outline stays up (ms) — the `flash` guide's entry flash and
   *  every assist-button flash. 0 = the button does not flash. */
  flashMs: number;
  lockWhileGuide: boolean;
  /** `uses`: presses allowed per panel open (re-armed by `useLevelGuide.enter`);
   *  omitted = unlimited. Once spent the button greys out and reads `USED_LABEL`. */
  button: { label: string; cooldownMs: number; uses?: number } | null;
  timed: boolean;
  snap: boolean;
}

/** What a `uses`-capped assist button reads once its presses are spent. */
export const USED_LABEL = "Used";

export const LEVEL_BEHAVIOR: Record<WritingMode, LevelBehavior> = {
  // Outline stays up and only the next stroke to write animates, on repeat. Strokes
  // snap into place when they match it (2026-10-04, replacing Watch's slot).
  snap: {
    guide: "persistent", animation: "nextStroke", regions: null, flashMs: 0,
    lockWhileGuide: false, button: null, timed: false, snap: true,
  },
  trace: {
    guide: "persistent", animation: "loop", regions: null, flashMs: 0,
    lockWhileGuide: false, button: null, timed: false, snap: false,
  },
  walkthrough: {
    guide: "flash", animation: null, regions: null, flashMs: 1500,
    lockWhileGuide: true, button: { label: "Show", cooldownMs: 6000 }, timed: false, snap: false,
  },
  // A third of the outline visible at a time, staying up until the next press; each
  // Next slides the window a SIXTH clockwise (so consecutive windows overlap by half).
  // Drawing free and Next has no cooldown (it was 1s until 2026-10-04). Was `thirds`
  // (three disjoint ⅓ wedges) until 2026-11-22, `quarters` (four 田 squares) until
  // 2026-11-08.
  sections: {
    guide: "persistent", animation: null, regions: { positions: 6, span: 2 }, flashMs: 0,
    lockWhileGuide: false, button: { label: "Next", cooldownMs: 0 }, timed: false, snap: false,
  },
  memorize: {
    guide: "study", animation: null, regions: null, flashMs: 0,
    lockWhileGuide: true, button: null, timed: false, snap: false,
  },
  // Starts blank. The Flash button shows the WHOLE outline for half a second, ONCE per
  // panel open (reopening a slot re-arms it — decided 2026-11-22, accepting that it can be
  // reopened for another look). Drawing stays free during the flash, and the flash is cut
  // in/out instantly (no GUIDE_FADE_MS fades — a 220ms fade would eat most of 500ms).
  // Replaced `quarters` (X triangles, Next-cycled) 2026-11-22.
  flash: {
    guide: "none", animation: null, regions: null, flashMs: 500,
    lockWhileGuide: false, button: { label: "Flash", cooldownMs: 0, uses: 1 }, timed: false, snap: false,
  },
  test: {
    guide: "none", animation: null, regions: null, flashMs: 0,
    lockWhileGuide: false, button: null, timed: false, snap: false,
  },
  timed: {
    guide: "none", animation: null, regions: null, flashMs: 0,
    lockWhileGuide: false, button: null, timed: true, snap: false,
  },
};

/**
 * Does an EDITOR at this level ever show the outline — i.e. must `WritingStage` mount its
 * guide (`showGuide`)? True for every level with an on-entry guide, and for Flash, which
 * opens blank but shows the outline on its one press (`flashMs` > 0). False only for
 * Blank / Timed. Mounting up front also means the Hanzi Writer data is loaded before the
 * press, so the 500ms look is not spent waiting on it.
 * Used by PracticeWritingPopup and WritingFocusEditor (the editing surfaces).
 */
export function levelHasGuide(mode: WritingMode): boolean {
  const b = LEVEL_BEHAVIOR[mode];
  return b.guide !== "none" || b.flashMs > 0;
}

/**
 * Which guide on/off changes fade (GUIDE_FADE_MS) rather than cut, on an editing
 * surface. Only the levels whose guide comes and goes WHILE the learner works fade:
 *   Step Through (`flash`) — fades out when the flash ends, in on a Show press;
 *   Memorize (`study`)     — fades out on the first stroke (it never re-appears mid-use).
 * Everything else (the Verify reveal, level changes, the Sections region cycle, Flash's
 * one-shot flash, read-only previews) is instant. Hosts spread this onto `WritingStage`.
 * Docs: docs/PRACTICE_WRITING.md § "Guide fade".
 */
export function guideFades(mode: WritingMode): { guideFadeIn: boolean; guideFadeOut: boolean } {
  const { guide } = LEVEL_BEHAVIOR[mode];
  return { guideFadeIn: guide === "flash", guideFadeOut: guide === "flash" || guide === "study" };
}

/**
 * What a small, read-only PREVIEW of a character slot shows at a level — the 2×2 grid
 * in the Practice Writing popup and the writing flp card's cells.
 *
 * Rule: a preview shows what the learner will FIRST SEE when they expand the slot, i.e.
 * the state `useLevelGuide.enter()` opens the editor in. Reopening a slot re-enters the
 * level, so the same holds whether or not the slot already has writing in it:
 *
 *   Trace                    full outline, stroke order looping
 *   Snap / Step Through      full outline (static) — Snap's next-stroke animation is
 *                            an editor-only cue
 *   Sections                 the FIRST region (the window clockwise from the top-left
 *                            corner) of the outline
 *   Memorize / Flash /       no outline (Flash opens blank — its one flash is a press)
 *   Blank / Timed
 *
 * The one exception to "first see": MEMORIZE (decided 2026-10-04). Its editor does open
 * on the outline, but that is the STUDY phase — a deliberate look the learner enters by
 * opening the slot, ended by their first stroke. Previewing it would hand the study over
 * before they chose to study, so a Memorize preview shows nothing, like Blank.
 *
 * A post-grading reveal (the whole outline behind the learner's ink) is the host's
 * override, not part of this rule.
 */
export interface LevelPreview {
  guide: boolean;
  /** clip-path for the region levels (undefined = whole glyph). */
  regionClip?: string;
  /** Loop the stroke-order animation (Trace only). */
  loop: boolean;
  /** Snap: the slot's ink is snapped strokes — paint them as printed shapes. */
  snap: boolean;
}

export function levelPreview(mode: WritingMode): LevelPreview {
  const b = LEVEL_BEHAVIOR[mode];
  // `study` (Memorize) is excluded: its outline is the editor's study phase, never a
  // preview (see the rule above).
  const guide = b.guide !== "none" && b.guide !== "study";
  return {
    guide,
    regionClip: guide && b.regions ? regionClipPath(b.regions, 0) : undefined,
    loop: guide && b.animation === "loop",
    snap: b.snap,
  };
}

/**
 * Does a level's preview show the WHOLE character (not a region, not nothing)? True
 * exactly for Snap / Trace / Step Through — levels 1–3. Anything that already shows the
 * character can drop its other masks: the writing flp's used-in bubbles show the real
 * character instead of the circled-? mark at these levels
 * (docs/WRITING_PRACTICE_REWORK.md § 3b).
 */
export function previewShowsWholeCharacter(mode: WritingMode): boolean {
  const preview = levelPreview(mode);
  return preview.guide && !preview.regionClip;
}

/**
 * CSS `clip-path` polygon for window `index` of a region level over the square guide.
 *
 * Every region level uses one construction: a wedge meeting at the centre, the rim cut
 * into `positions` equal stretches (perimeter 4 sides ÷ positions), the first cut at
 * the top-left corner, numbered clockwise. Window `index` starts at cut `index` and
 * covers `span` stretches. Every side sits the same distance (50%) from the centre, so
 * equal rim lengths give equal areas — each window is exactly span/positions of the
 * square. A window that wraps a corner (or the top-left start) includes it as a vertex.
 *
 *   Sections {6, 2}: window 0 runs from the top-left corner to ⅓ down the right edge
 *       (the old Thirds' first wedge); window 1 starts ⅔ along the top edge, and so on —
 *       each ⅓ window advanced by ⅙.
 *   {4, 1} (the retired Quarters): the X split — top / right / bottom / left triangles.
 */
export function regionClipPath({ positions, span }: RegionSpec, index: number): string {
  const i = ((index % positions) + positions) % positions;
  const stretch = 4 / positions; // rim length of one step, in side lengths
  const start = i * stretch;
  const end = start + span * stretch; // may exceed 4 — perimeterPoint wraps
  // The rim points of this wedge: its two cut points plus every corner strictly between.
  const rim: string[] = [perimeterPoint(start)];
  for (let corner = Math.floor(start) + 1; corner < end; corner++) rim.push(perimeterPoint(corner));
  rim.push(perimeterPoint(end));
  return `polygon(50% 50%, ${rim.join(", ")})`;
}

/**
 * The point at perimeter distance `d` (in side lengths; wrapped into 0..4) clockwise
 * from the top-left corner, as a CSS "x% y%" pair. Sides: 0–1 top (→), 1–2 right (↓),
 * 2–3 bottom (←), 3–4 left (↑). A window that crosses the top-left corner passes an
 * end past 4, which wraps back onto the top edge.
 */
function perimeterPoint(raw: number): string {
  const d = raw >= 4 ? raw - 4 : raw;
  const side = Math.min(Math.floor(d), 3);
  const t = d - side; // 0..1 along that side
  const pct = (v: number) => `${Number((v * 100).toFixed(3))}%`;
  switch (side) {
    case 0: return `${pct(t)} 0%`;
    case 1: return `100% ${pct(t)}`;
    case 2: return `${pct(1 - t)} 100%`;
    default: return `0% ${pct(1 - t)}`;
  }
}
