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
 *   regions    — the outline is clipped to one of N regions at a time (4 = 田
 *                squares, 8 = 米 triangles), cycling clockwise from the top-left.
 *   lockWhileGuide — drawing is blocked while the outline is up.
 *   button     — the assist button under the panel and its cooldown (from press).
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

export interface LevelBehavior {
  guide: "persistent" | "flash" | "study" | "none";
  animation: "loop" | "nextStroke" | null;
  regions: 4 | 8 | null;
  /** How long a `flash` guide stays up (ms). */
  flashMs: number;
  lockWhileGuide: boolean;
  button: { label: string; cooldownMs: number } | null;
  timed: boolean;
  snap: boolean;
}

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
  // One quarter visible at a time, staying up until the next press; drawing free and
  // Next has no cooldown (it was 1s until 2026-10-04).
  quarters: {
    guide: "persistent", animation: null, regions: 4, flashMs: 0,
    lockWhileGuide: false, button: { label: "Next", cooldownMs: 0 }, timed: false, snap: false,
  },
  memorize: {
    guide: "study", animation: null, regions: null, flashMs: 0,
    lockWhileGuide: true, button: null, timed: false, snap: false,
  },
  // Quarters' behaviour at a finer split: one eighth visible at a time, staying up
  // until the next press; drawing free. (Until 2026-10-04 each eighth flashed for 2s
  // with drawing locked and a 6s cooldown.) No cooldown on Next, like Quarters.
  eighths: {
    guide: "persistent", animation: null, regions: 8, flashMs: 0,
    lockWhileGuide: false, button: { label: "Next", cooldownMs: 0 }, timed: false, snap: false,
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
 * Which guide on/off changes fade (GUIDE_FADE_MS) rather than cut, on an editing
 * surface. Only the levels whose guide comes and goes WHILE the learner works fade:
 *   Step Through (`flash`) — fades out when the flash ends, in on a Show press;
 *   Memorize (`study`)     — fades out on the first stroke (it never re-appears mid-use).
 * Everything else (the Verify reveal, level changes, Quarters / Eighths region cycle,
 * read-only previews) is instant. Hosts spread this onto `WritingStage`.
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
 *   Quarters / Eighths       the FIRST region (top-left) of the outline
 *   Memorize / Blank / Timed no outline
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
 * CSS `clip-path` polygon for region `index` of `count` over the square guide.
 *
 *   4 → the 田 split: four squares, clockwise from the top-left.
 *   8 → the 米 split: eight triangles meeting at the centre, clockwise starting with
 *       the upper half of the top-left square (corner → top-middle).
 */
export function regionClipPath(count: 4 | 8, index: number): string {
  const i = ((index % count) + count) % count;
  if (count === 4) {
    const squares = [
      "0% 0%, 50% 0%, 50% 50%, 0% 50%", // top-left
      "50% 0%, 100% 0%, 100% 50%, 50% 50%", // top-right
      "50% 50%, 100% 50%, 100% 100%, 50% 100%", // bottom-right
      "0% 50%, 50% 50%, 50% 100%, 0% 100%", // bottom-left
    ];
    return `polygon(${squares[i]})`;
  }
  // Perimeter points clockwise from the top-left corner; triangle k is the centre +
  // points k and k+1.
  const rim = ["0% 0%", "50% 0%", "100% 0%", "100% 50%", "100% 100%", "50% 100%", "0% 100%", "0% 50%"];
  return `polygon(50% 50%, ${rim[i]}, ${rim[(i + 1) % 8]})`;
}
