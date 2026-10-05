/**
 * PracticeWritingPopup — the "Practice Writing Me" modal.
 *
 * Eight assistance levels over the target word (server/contracts/writingLevels.ts;
 * behaviour in levelBehavior.ts, run by useLevelGuide; Level 8's clock by
 * useStrokeClock). Two surfaces depending on length:
 *   • Single character → one WritingPanel: the level stepper as its header, the
 *     canvas, and Clear/Undo + assist + Verify in its footer. It grows out of the
 *     launcher the learner tapped (`origin`) and shrinks back into it on close.
 *   • 2–4 characters    → a WritingSelectorPanel: the level stepper as its header, a
 *     2×2 grid of small read-only previews (top-two for 2 chars; +bottom-left for 3;
 *     all four for 4), Verify in its footer. It projects out of the launcher (`origin`)
 *     just as the single panel does. Tapping a slot projects AGAIN, into a focused
 *     WritingPanel over the selector (level label + Clear/Undo + assist, no
 *     Verify/stepper). Tapping the scrim shrinks it back into its slot; Verify (selector only) recognises EVERY
 *     character at once and overlays ✓/✗ per slot. The level's star is awarded only
 *     when ALL characters are correct in one Verify.
 *
 * Grading is top-1 only per character (correct iff that character === its panel's
 * #1 candidate). Full spec: docs/PRACTICE_WRITING.md; the 8-level rework:
 * docs/WRITING_PRACTICE_REWORK.md.
 * Layers: WritingSelectorPanel / WritingPanel (the rectangles; useProjectionMorph = their open/close morph), WritingStage/WritingCanvas (capture), HanziGuide (guide), recognize.ts
 *         (proxy), writingDraftStore (preserve-on-close).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Button, Box, CircularProgress } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme";
import WritingStage, { type StageResult } from "./WritingStage";
import LevelStepper from "./LevelStepper";
import WritingPanel, { WritingPanelLevelLabel, type WritingPanelHandle } from "./WritingPanel";
import { WRITING_PANEL_ACTION_SX } from "./writingPanelStyles";
import WritingSelectorPanel from "./WritingSelectorPanel";
import type { ProjectionHandle } from "./useProjectionMorph";
import { recognizeHandwriting } from "./recognize";
import { recordCompletion } from "./completions";
import { getWritingDraft, setWritingDraft } from "./writingDraftStore";
import { useLevelGuide } from "./useLevelGuide";
import { useStrokeClock } from "./useStrokeClock";
import { guideFades, levelPreview, regionClipPath, WRITING_FOCUS_SIZE } from "./levelBehavior";
import type { Ink, WritingAttempt, WritingCanvasHandle } from "./types";
import { PHONE_OVERLAY_SX } from "../phoneGeometry";
import { WRITING_LEVELS } from "../../../server/contracts/writingLevels";

const FOCUS_SIZE = WRITING_FOCUS_SIZE; // capture/coordinate space for every panel
// The 2×2 grid sits inside the selector panel's FOCUS_SIZE-wide body with 16px padding
// (WritingSelectorPanel), so 2 × GRID_SLOT + GRID_GAP must stay ≤ FOCUS_SIZE − 32.
const GRID_SLOT = 124; // on-screen size of a 2×2 preview slot
const GRID_GAP = 20; // px between the 2×2 cells
const GRID_SCALE = GRID_SLOT / FOCUS_SIZE; // CSS scale that fits the 300px stage into a slot

interface PracticeWritingPopupProps {
  open: boolean;
  /** Target word (1–4 characters). */
  character: string;
  /** Levels already completed for this word (drives the per-level star). */
  completedLevels: Set<number>;
  /** Called with the new full completed-level set when a level is freshly cleared. */
  onLevelsChange: (levels: number[]) => void;
  /**
   * Fired on every Verify with the level and each character's result. The host turns
   * it into Writing mastery marks (usePracticeWriting → the per-character writing
   * result, docs/WRITING_PRACTICE_REWORK.md § 3a); absent on the read-only dictionary
   * cdp (no vet card to mark).
   */
  onWritingResult?: (attempt: WritingAttempt) => void;
  onClose: () => void;
  /**
   * The launcher the learner tapped (a word tile, the Practice Writing button). The
   * single-character panel — or, for 2–4 characters, the selector — grows out of it
   * and shrinks back into it on close.
   */
  origin?: HTMLElement | null;
}

export default function PracticeWritingPopup({
  open,
  character,
  completedLevels,
  onLevelsChange,
  onWritingResult,
  onClose,
  origin,
}: PracticeWritingPopupProps) {
  const { token } = useAuth();

  // Split into characters (code-point aware). One Ink + one result per character.
  const chars = useMemo(() => [...character], [character]);
  const isMulti = chars.length > 1;

  // Restore a preserved draft for this word (active level + per-char ink + focus).
  const draft = open ? getWritingDraft(character) : null;
  const [levelIndex, setLevelIndex] = useState(draft?.levelIndex ?? 0);
  const [inks, setInks] = useState<Ink[]>(() =>
    draft?.inks && draft.inks.length === chars.length
      ? draft.inks.map((s) => s.map((stroke) => ({ ...stroke })))
      : chars.map(() => []),
  );
  // Which grid slot is enlarged (null = grid view, or the single-char panel).
  const [focusedIndex, setFocusedIndex] = useState<number | null>(draft?.focusedIndex ?? null);
  const [results, setResults] = useState<StageResult[]>(() => chars.map(() => "idle"));
  const [checking, setChecking] = useState(false);
  // After a Verify, reveal the grey guide on EVERY panel — on all levels, even
  // Blank (which normally shows no guide) — so the user can compare their writing
  // against the correct character. Reset on any new attempt (redraw / refocus /
  // level change) so the next attempt starts from the level's normal guide rules.
  const [verifyRevealed, setVerifyRevealed] = useState(false);

  // The active drawing canvas (single panel or the focused slot). Only one is
  // mounted at a time, so a single handle suffices.
  const canvasRef = useRef<WritingCanvasHandle>(null);
  // The mounted WritingPanel (single panel or the focused slot's) — for its shrink-back.
  const panelRef = useRef<WritingPanelHandle>(null);
  // The multi-character selector — for its shrink-back into the launcher on close.
  const selectorRef = useRef<ProjectionHandle>(null);
  // The Dialog's backdrop: faded by the outermost rectangle's morph (a companion) rather
  // than by MUI's own Fade, so it dims in lockstep with the projection.
  const backdropRef = useRef<HTMLDivElement>(null);
  // The focused slot's scrim, faded in/out with the panel's morph.
  const focusScrimRef = useRef<HTMLDivElement>(null);
  // The 2×2 slot the focused panel grew out of (and shrinks back into).
  const [slotOrigin, setSlotOrigin] = useState<HTMLElement | null>(null);
  // A shrink is in flight: further background taps / Escape wait for it.
  const closingRef = useRef(false);
  // Whether the active drawing canvas has strokes (drives Clear/Undo/Verify enable).
  // The active surface is the focused slot (multi) or char 0 (single).
  const [activeHasInk, setActiveHasInk] = useState(() => {
    const idx = isMulti ? draft?.focusedIndex ?? null : 0;
    return idx !== null && (draft?.inks?.[idx]?.length ?? 0) > 0;
  });
  // Bumped on collapse so the grid previews remount and repaint the new ink.
  const [previewNonce, setPreviewNonce] = useState(0);

  const level = WRITING_LEVELS[levelIndex];
  const mode = level.mode;
  // Guide / draw-lock / assist-button state for the active drawing surface.
  const guide = useLevelGuide(mode);
  const behavior = guide.behavior;
  // What a collapsed grid slot shows at this level (docs/PRACTICE_WRITING.md, grid-preview rule).
  const preview = levelPreview(mode);
  const prevLevelRef = useRef<number | null>(null);

  // The drawing surface is active in single-char mode, or when a grid slot is focused.
  const drawingIndex = isMulti ? focusedIndex : 0;
  const isDrawing = drawingIndex !== null;

  // Level 8: one clock per character. Single character → time out = auto-Verify;
  // multi → the slot locks and is graded by the next Verify.
  const verifyRef = useRef<() => void>(() => {});
  const clock = useStrokeClock(chars, {
    enabled: behavior.timed,
    onExpire: () => {
      if (!isMulti) verifyRef.current();
    },
  });
  const activeExpired = isDrawing && clock.isExpired(drawingIndex);
  const drawLocked = guide.drawLocked || activeExpired;

  // Level change (both modes): clear the attempt and reset guide state. On a real
  // level change we wipe all ink + results (each level is a fresh attempt) and
  // collapse to the grid; the restore-mount is skipped via prevLevelRef.
  useEffect(() => {
    if (!open) return;
    const isLevelChange = prevLevelRef.current !== null && prevLevelRef.current !== levelIndex;
    prevLevelRef.current = levelIndex;

    guide.leave();
    clock.reset(); // a level change is a fresh attempt — every clock starts over
    setVerifyRevealed(false); // each level entry starts from its own guide rules

    if (isLevelChange) {
      setResults(chars.map(() => "idle"));
      if (isMulti) {
        setInks(chars.map(() => []));
        setPreviewNonce((n) => n + 1);
        setFocusedIndex(null);
        setActiveHasInk(false);
        return; // multi applies the guide on focus, not here
      }
      canvasRef.current?.clear();
      setActiveHasInk(false);
    }

    // Single character: the panel is always present, so apply the guide here.
    if (!isMulti) guide.enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelIndex, open]);

  // Multi-char: entering a focused slot applies the level's guide; leaving hides it.
  useEffect(() => {
    if (!open || !isMulti) return;
    setVerifyRevealed(false); // focusing/unfocusing a slot resets to its guide rules
    if (focusedIndex === null) {
      guide.leave();
      return;
    }
    guide.enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIndex, open]);

  // Redrawing the active surface invalidates that character's prior result.
  const handleActiveInkChange = (ink: Ink) => {
    setActiveHasInk(ink.length > 0);
    setVerifyRevealed(false); // a new stroke is a fresh attempt — drop the post-Verify reveal
    const idx = drawingIndex ?? 0;
    setResults((r) => {
      if (r[idx] === "idle") return r;
      const next = r.slice();
      next[idx] = "idle";
      return next;
    });
  };

  // Clear/Undo act on the ACTIVE character only (never the others in the word).
  const handleClear = () => {
    canvasRef.current?.clear();
    setActiveHasInk(false);
  };
  const handleUndo = () => {
    canvasRef.current?.undo();
  };

  // Tap a grid slot → grow it into the focused drawing panel.
  const focusSlot = (i: number, el: HTMLElement) => {
    setSlotOrigin(el);
    setActiveHasInk((inks[i]?.length ?? 0) > 0);
    setResults((r) => {
      if (r[i] === "idle") return r;
      const next = r.slice();
      next[i] = "idle";
      return next;
    });
    setFocusedIndex(i);
  };

  // Back → capture the focused character's ink into `inks`, shrink the panel back into
  // its slot, and return to the grid. The ink lands in the slot FIRST (the grid stays
  // mounted under the scrim), so the shrinking panel settles onto the updated preview.
  const collapseFocus = async () => {
    if (focusedIndex === null || closingRef.current) return;
    closingRef.current = true;
    const captured = canvasRef.current?.getInk() ?? [];
    setInks((prev) => {
      const next = prev.slice();
      next[focusedIndex] = captured.map((s) => ({ ...s }));
      return next;
    });
    setPreviewNonce((n) => n + 1);
    await panelRef.current?.collapse();
    closingRef.current = false;
    setFocusedIndex(null);
  };

  const handleVerify = async () => {
    if (checking) return;
    // Single char reads the live canvas; multi reads the per-slot inks (grid view).
    const inksToVerify = isMulti ? inks : [canvasRef.current?.getInk() ?? []];
    if (inksToVerify.every((ink) => ink.length === 0)) return;
    setChecking(true);
    const startedAt = performance.now();

    // Recognise every character in parallel; an empty/failed panel counts as wrong.
    const settled = await Promise.all(
      chars.map(async (ch, i) => {
        const ink = inksToVerify[i] ?? [];
        if (ink.length === 0) return { i, correct: false, top1: null as string | null, candidates: [] as string[] };
        try {
          const { candidates, top1 } = await recognizeHandwriting(ink, FOCUS_SIZE, FOCUS_SIZE, token);
          return { i, correct: top1 === ch, top1, candidates };
        } catch (err) {
          console.warn("✍️ handwriting verify failed", { target: ch, index: i, error: err });
          return { i, correct: false, top1: null as string | null, candidates: [] as string[] };
        }
      }),
    );

    const newResults: StageResult[] = chars.map((_, i) => (settled[i].correct ? "correct" : "wrong"));
    setResults(newResults);
    setChecking(false);
    setVerifyRevealed(true); // reveal the guide on every panel for comparison
    const allCorrect = settled.every((s) => s.correct);

    // Hand the per-character result to the host, which writes the Writing marks
    // (per character, behind the anti-farming gate — docs/WRITING_PRACTICE_REWORK.md § 3a).
    onWritingResult?.({ level: level.level, perChar: settled.map((s) => s.correct) });

    // Diagnostics for tuning recognition (latency is browser→proxy→Google RTT).
    console.log("✍️ handwriting verify", {
      target: character,
      level: mode,
      result: allCorrect ? "✓ all correct" : "✗ incomplete",
      perChar: settled.map((s) => ({ char: chars[s.i], correct: s.correct, top1: s.top1 })),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    // Award the star only when EVERY character is correct in one Verify.
    // Stars are keyed by level NUMBER (migration 172), not mode name.
    if (allCorrect && !completedLevels.has(level.level)) {
      recordCompletion("zh", character, level.level)
        .then(onLevelsChange)
        .catch((e) => console.warn("✍️ failed to record completion", e));
    }
  };

  verifyRef.current = () => void handleVerify();

  /** Level 8's Retry: wipe every character's ink and clock and start the attempt over. */
  const handleRetry = () => {
    clock.reset();
    canvasRef.current?.clear();
    setInks(chars.map(() => []));
    setResults(chars.map(() => "idle"));
    setPreviewNonce((n) => n + 1);
    setActiveHasInk(false);
    setVerifyRevealed(false);
    if (isDrawing) guide.enter();
  };

  // Tapping the background (the dark backdrop, or the transparent area inside the
  // phone card around the islands) means "step back one level": in a focused slot
  // it collapses to the grid; in grid / single-char it exits the popup entirely.
  const handleBackgroundTap = () => {
    if (isMulti && focusedIndex !== null) void collapseFocus();
    else void handleClose();
  };

  // Closing (backdrop / Escape) preserves the active level + per-char ink + focus. The
  // draft is taken before the outer rectangle (single panel / selector) shrinks back
  // into its launcher; the
  // guide is left only after, so the outline does not blink off mid-shrink.
  const handleClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const captured = inks.slice();
    if (isDrawing) captured[drawingIndex] = (canvasRef.current?.getInk() ?? captured[drawingIndex] ?? []).map((s) => ({ ...s }));
    setWritingDraft({ character, levelIndex, inks: captured, focusedIndex });
    await (isMulti ? selectorRef : panelRef).current?.collapse();
    closingRef.current = false;
    guide.leave();
    onClose();
  };

  // ── Single generalized lockout ──────────────────────────────────────────────
  // While the popup is open the ENTIRE writing surface is modal: every gesture is
  // absorbed at the popup root and never propagates out (to the flp flashcard's
  // drag/flip handlers, the eip sheet, etc.). This is ONE blocker here instead of
  // ad-hoc per-island `stopPropagation`. The greyed background (taps that land on
  // the root itself, not on an island) is the step-back target — handled by the
  // root onClick below — so the lock and the step-back share this one place.
  const blockGesture = (e: React.SyntheticEvent) => e.stopPropagation();
  const rootLockHandlers = {
    onPointerDown: blockGesture,
    onPointerUp: blockGesture,
    onMouseDown: blockGesture,
    onMouseUp: blockGesture,
    onTouchStart: blockGesture,
    onTouchEnd: blockGesture,
  };

  const anyInk = inks.some((ink) => ink.length > 0);

  // ── Reusable chrome pieces ──────────────────────────────────────────────────
  const verifyButton = (disabled: boolean) => (
    <Button
      className="practice-writing__verify"
      variant="contained"
      disableElevation
      onClick={handleVerify}
      disabled={disabled || checking}
      sx={WRITING_PANEL_ACTION_SX}
    >
      {checking ? <CircularProgress className="practice-writing__verify-spinner" size={18} color="inherit" /> : "Verify"}
    </Button>
  );

  // Footer assist button, from the level's behaviour (levelBehavior.ts):
  //   Step Through → Show · Quarters / Eighths → Next (cycles the region). Snap,
  //   Trace and Memorize have none (Memorize's first stroke unlocks). Timed shows Retry once
  //   the active character's clock has run out. It sits in the panel footer's
  //   footer (WritingPanel), so appearing / vanishing never moves the canvas.
  const assistLabel = behavior.timed
    ? activeExpired || (!isMulti && results[0] !== "idle") ? "Retry" : null
    : behavior.button?.label ?? null;
  const assistButton = assistLabel ? (
    <Button
      className="practice-writing__assist"
      variant="contained"
      disableElevation
      onClick={behavior.timed ? handleRetry : guide.press}
      disabled={!behavior.timed && guide.cooldownSec > 0}
      sx={WRITING_PANEL_ACTION_SX}
    >
      {!behavior.timed && guide.cooldownSec > 0 ? `${guide.cooldownSec}s` : assistLabel}
    </Button>
  ) : null;

  // Both outer rectangles (single panel, selector) carry the same embedded picker.
  const levelPicker = (
    <LevelStepper embedded index={levelIndex} onChange={setLevelIndex} completedLevels={completedLevels} width={FOCUS_SIZE} />
  );

  // Grid-slot styling (the 2×2 previews). Outlined, no shadow: they sit inside the
  // selector's white panel rather than floating over the backdrop.
  const slotSx = {
    position: "relative",
    width: GRID_SLOT,
    height: GRID_SLOT,
    borderRadius: 3,
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    overflow: "hidden",
    cursor: "pointer",
  } as const;

  // ── Mode bodies ─────────────────────────────────────────────────────────────
  // Single character: the whole surface is one WritingPanel, vertically centred.
  const singleBody = (
    <Box className="practice-writing__single" sx={{ my: "auto", mx: "auto" }}>
      <WritingPanel
        ref={panelRef}
        className="practice-writing__panel"
        size={FOCUS_SIZE}
        origin={origin}
        companions={[backdropRef]}
        header={levelPicker}
        onClear={handleClear}
        onUndo={handleUndo}
        editDisabled={!activeHasInk}
        assist={assistButton}
        verify={verifyButton(!activeHasInk)}
      >
        <WritingStage
          ref={canvasRef}
          character={chars[0]}
          size={FOCUS_SIZE}
          drawable
          // Post-Verify reveal overrides the level's normal guide gating (even Blank),
          // and shows the WHOLE glyph rather than the active region.
          showGuide={behavior.guide !== "none" || verifyRevealed}
          guideVisible={guide.outlineVisible || verifyRevealed}
          loopAnimation={behavior.animation === "loop"}
          snap={behavior.snap}
          regionClip={behavior.regions && !verifyRevealed ? regionClipPath(behavior.regions, guide.regionIndex) : undefined}
          guideKey={mode}
          // Step Through / Memorize fade their guide; the Verify reveal is instant.
          guideFadeIn={guideFades(mode).guideFadeIn && !verifyRevealed}
          guideFadeOut={guideFades(mode).guideFadeOut}
          drawLocked={drawLocked}
          loading={guide.loading}
          // Memorize study-first lock: red "no writing" badge; first stroke unlocks.
          blocked={guide.blocked}
          onBlockedAttempt={guide.blockedAttempt}
          onStrokeStart={() => clock.start(0)}
          clock={behavior.timed ? clock.clockFor(0) : null}
          initialInk={inks[0]}
          onInkChange={handleActiveInkChange}
          result={results[0]}
        />
      </WritingPanel>
    </Box>
  );

  // Multi character, a slot focused: a WritingPanel grown out of that slot, over the
  // (still-mounted) grid and its own scrim. Tapping the scrim shrinks it back.
  const focusOverlay = focusedIndex !== null && (
    <Box
      className="practice-writing__focus"
      onClick={(e) => {
        if (e.target === focusScrimRef.current) void collapseFocus();
      }}
      sx={{ position: "absolute", inset: 0, zIndex: 2 }}
    >
      <Box ref={focusScrimRef} className="practice-writing__focus-scrim" sx={{ position: "absolute", inset: 0, bgcolor: COLORS.modalScrim }} />
      <Box
        className="practice-writing__focus-column"
        sx={{
          position: "relative",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Taps around the panel fall through to the scrim (= step back).
          pointerEvents: "none",
          "& > *": { pointerEvents: "auto" },
        }}
      >
        <WritingPanel
          key={`focus-${focusedIndex}`}
          ref={panelRef}
          className="practice-writing__panel practice-writing__panel--focus"
          size={FOCUS_SIZE}
          origin={slotOrigin}
          companions={[focusScrimRef]}
          header={<WritingPanelLevelLabel level={level.level} name={level.name} />}
          onClear={handleClear}
          onUndo={handleUndo}
          editDisabled={!activeHasInk}
          assist={assistButton}
        >
          <WritingStage
            ref={canvasRef}
            character={chars[focusedIndex]}
            size={FOCUS_SIZE}
            drawable
            showGuide={behavior.guide !== "none"}
            guideVisible={guide.outlineVisible}
            loopAnimation={behavior.animation === "loop"}
            snap={behavior.snap}
            regionClip={behavior.regions ? regionClipPath(behavior.regions, guide.regionIndex) : undefined}
            guideKey={`${focusedIndex}-${mode}`}
            {...guideFades(mode)}
            drawLocked={drawLocked}
            loading={guide.loading}
            // Memorize study-first lock: red "no writing" badge; first stroke unlocks.
            blocked={guide.blocked}
            onBlockedAttempt={guide.blockedAttempt}
            onStrokeStart={() => clock.start(focusedIndex)}
            clock={behavior.timed ? clock.clockFor(focusedIndex) : null}
            initialInk={inks[focusedIndex]}
            onInkChange={handleActiveInkChange}
            result="idle"
          />
        </WritingPanel>
      </Box>
    </Box>
  );

  // Multi character: the selector rectangle, projected out of the launcher. Its slot
  // grid is the projection anchor, and each slot is in turn the origin of focusOverlay.
  const gridBody = (
    <Box className="practice-writing__selector" sx={{ my: "auto", mx: "auto" }}>
      <WritingSelectorPanel
        ref={selectorRef}
        className="practice-writing__selector-panel"
        width={FOCUS_SIZE}
        origin={origin}
        companions={[backdropRef]}
        header={levelPicker}
        verify={verifyButton(!anyInk)}
      >
        {/* 2×2 grid — chars fill in order: 0→TL, 1→TR, 2→BL, 3→BR. So 2 chars use the
            top two, 3 chars add the bottom-left, 4 chars fill all four. */}
        <Box
          className="practice-writing__grid"
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(2, ${GRID_SLOT}px)`,
            gridAutoRows: `${GRID_SLOT}px`,
            gap: `${GRID_GAP}px`,
            justifyContent: "center",
          }}
        >
          {chars.map((ch, i) => {
            // Grid-preview guide for this slot: what the learner first sees on
            // expanding it (`levelPreview`), or — post-Verify — the whole outline on
            // every level, to compare the writing against.
            const slotGuide = verifyRevealed || preview.guide;
            return (
            <Box
              key={`slot-${i}`}
              className={`practice-writing__grid-slot practice-writing__grid-slot--${i}`}
              onClick={(e: React.MouseEvent<HTMLElement>) => focusSlot(i, e.currentTarget)}
              sx={slotSx}
            >
              {/* The stage is rendered at full FOCUS_SIZE then scaled down, so its ink
                  coordinate space matches the focused panel exactly. */}
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: FOCUS_SIZE,
                  height: FOCUS_SIZE,
                  transform: `scale(${GRID_SCALE})`,
                  transformOrigin: "top left",
                  pointerEvents: "none", // taps go to the slot (enlarge), not the canvas
                }}
              >
                <WritingStage
                  key={`grid-${i}-${levelIndex}-${previewNonce}`}
                  character={ch}
                  size={FOCUS_SIZE}
                  drawable={false}
                  showGuide={slotGuide}
                  guideVisible={slotGuide}
                  loopAnimation={!verifyRevealed && preview.loop}
                  regionClip={verifyRevealed ? undefined : preview.regionClip}
                  guideKey={`grid-${i}-${mode}`}
                  snap={preview.snap}
                  initialInk={inks[i]}
                  result={results[i]}
                  resultIconSize={Math.round(40 / GRID_SCALE)}
                />
              </Box>
            </Box>
            );
          })}
        </Box>
      </WritingSelectorPanel>
    </Box>
  );

  return (
    <Dialog
      className="practice-writing-dialog"
      open={open}
      onClose={handleBackgroundTap}
      // Match the phone-card geometry (full-bleed on mobile, centered card on
      // desktop) so the chrome anchors to the phone's own corners/bottom. The box
      // comes from MobileDemoFrame so it cannot drift from the real frame. Paper is
      // transparent + shadowless: each element reads as its own floating island
      // over the dark backdrop scrim.
      PaperProps={{ elevation: 0, sx: PHONE_OVERLAY_SX }}
      // No MUI Fade on the paper or backdrop: the outer rectangle projects out of its
      // launcher (useProjectionMorph) and fades the backdrop with it as a companion —
      // a Dialog fade on its own timing would wash the projection out.
      transitionDuration={0}
      slotProps={{ backdrop: { ref: backdropRef } }}
    >
      <Box
        className="practice-writing"
        // The one generalized lockout (see rootLockHandlers): absorbs every gesture
        // so nothing leaks to the page below. The greyed background — a tap whose
        // target is the root itself, i.e. NOT on a floating island — steps back one
        // level: focused slot → 2×2 grid, and grid / single-char → close. Taps on an
        // island stop here too (lock) but skip the step-back.
        {...rootLockHandlers}
        onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) handleBackgroundTap();
        }}
        sx={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          px: 2,
          pt: 3,
          pb: 2,
          boxSizing: "border-box",
        }}
      >
        {/* No close button: tapping the greyed background exits (handleBackgroundTap). */}
        {!isMulti ? singleBody : gridBody}
        {isMulti && focusOverlay}
      </Box>
    </Dialog>
  );
}
