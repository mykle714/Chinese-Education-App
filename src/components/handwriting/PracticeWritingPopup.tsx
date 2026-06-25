/**
 * PracticeWritingPopup — the "Practice Writing Me" modal.
 *
 * Four assistance levels over the target word. Two surfaces depending on length:
 *   • Single character → one large panel with Clear/Undo/Verify + the level bar.
 *   • 2–4 characters    → a 2×2 grid of small read-only previews (top-two for 2
 *     chars; +bottom-left for 3; all four for 4). Tapping a slot ENLARGES it into
 *     a focused drawing panel (guide + Clear/Undo + Back, no Verify/level bar).
 *     Back collapses to the grid; Verify (grid only) recognises EVERY character at
 *     once and overlays ✓/✗ per slot. The level's star is awarded only when ALL
 *     characters are correct in one Verify.
 *
 * Grading is top-1 only per character (correct iff that character === its panel's
 * #1 candidate). Full spec: docs/HANDWRITING_RECOGNITION.md ("Practice surface").
 * Layers: WritingStage/WritingCanvas (capture), HanziGuide (guide), recognize.ts
 *         (proxy), writingDraftStore (preserve-on-close).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, IconButton, Button, Tabs, Tab, Box, CircularProgress } from "@mui/material";
import { Close, DeleteOutline, Undo, ArrowBack } from "@mui/icons-material";
import { useAuth } from "../../AuthContext";
import { COLORS } from "../../theme";
import WritingStage, { type StageResult } from "./WritingStage";
import { recognizeHandwriting } from "./recognize";
import { recordCompletion } from "./completions";
import { getWritingDraft, setWritingDraft } from "./writingDraftStore";
import type { Ink, WritingCanvasHandle } from "./types";

type AssistMode = "trace" | "peek" | "flash" | "solo";

interface TabSpec {
  mode: AssistMode;
  label: string;
  /** ms the guide auto-shows on entry / button press (0 = persistent or none). */
  guideMs: number;
  /** whether drawing is locked while the guide is visible. */
  lockWhileGuide: boolean;
  /** button caption (Levels 2 & 3 only). */
  buttonLabel?: string;
}

// User-facing labels are the generic "Level N" ladder; the `mode` still carries
// the assistance semantics (trace/peek/flash/solo) used everywhere internally.
const TABS: TabSpec[] = [
  { mode: "trace", label: "Level 1", guideMs: 0, lockWhileGuide: false },
  { mode: "peek", label: "Level 2", guideMs: 3000, lockWhileGuide: false, buttonLabel: "Peek (3s)" },
  { mode: "flash", label: "Level 3", guideMs: 1000, lockWhileGuide: true, buttonLabel: "Flash (1s)" },
  { mode: "solo", label: "Level 4", guideMs: 0, lockWhileGuide: false },
];

const COOLDOWN_SECONDS = 6; // Peek/Flash button cooldown, measured from press
const FOCUS_SIZE = 300; // capture/coordinate space for every panel
const GRID_SLOT = 132; // on-screen size of a 2×2 preview slot
const GRID_GAP = 28; // px between the 2×2 cells
const GRID_SCALE = GRID_SLOT / FOCUS_SIZE; // CSS scale that fits the 300px stage into a slot
const GRID_WIDTH = GRID_SLOT * 2 + GRID_GAP; // total grid footprint (aligns the toolbar)

interface PracticeWritingPopupProps {
  open: boolean;
  /** Target word (1–4 characters). */
  character: string;
  /** Levels already completed for this word (drives the per-level star). */
  completedLevels: Set<string>;
  /** Called with the new full completed-level set when a level is freshly cleared. */
  onLevelsChange: (levels: string[]) => void;
  onClose: () => void;
}

export default function PracticeWritingPopup({
  open,
  character,
  completedLevels,
  onLevelsChange,
  onClose,
}: PracticeWritingPopupProps) {
  const { token } = useAuth();

  // Split into characters (code-point aware). One Ink + one result per character.
  const chars = useMemo(() => [...character], [character]);
  const isMulti = chars.length > 1;

  // Restore a preserved draft for this word (active level + per-char ink + focus).
  const draft = open ? getWritingDraft(character) : null;
  const [activeTab, setActiveTab] = useState(draft?.activeTabIndex ?? 0);
  const [inks, setInks] = useState<Ink[]>(() =>
    draft?.inks && draft.inks.length === chars.length
      ? draft.inks.map((s) => s.map((stroke) => ({ ...stroke })))
      : chars.map(() => []),
  );
  // Which grid slot is enlarged (null = grid view, or the single-char panel).
  const [focusedIndex, setFocusedIndex] = useState<number | null>(draft?.focusedIndex ?? null);
  const [results, setResults] = useState<StageResult[]>(() => chars.map(() => "idle"));
  const [checking, setChecking] = useState(false);

  // The active drawing canvas (single panel or the focused slot). Only one is
  // mounted at a time, so a single handle suffices.
  const canvasRef = useRef<WritingCanvasHandle>(null);
  // Whether the active drawing canvas has strokes (drives Clear/Undo/Verify enable).
  // The active surface is the focused slot (multi) or char 0 (single).
  const [activeHasInk, setActiveHasInk] = useState(() => {
    const idx = isMulti ? draft?.focusedIndex ?? null : 0;
    return idx !== null && (draft?.inks?.[idx]?.length ?? 0) > 0;
  });
  // Bumped on collapse so the grid previews remount and repaint the new ink.
  const [previewNonce, setPreviewNonce] = useState(0);

  // Guide / draw-lock / cooldown state, driven by the active level + focus.
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [drawLocked, setDrawLocked] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds remaining; 0 = ready
  const guideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevTabRef = useRef<number | null>(null);

  const spec = TABS[activeTab];
  // The drawing surface is active in single-char mode, or when a grid slot is focused.
  const drawingIndex = isMulti ? focusedIndex : 0;
  const isDrawing = drawingIndex !== null;

  const clearTimers = () => {
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    guideTimerRef.current = null;
    cooldownTimerRef.current = null;
  };

  /** Show the guide for `ms`, optionally locking drawing, optionally on cooldown. */
  const flashGuide = (ms: number, lock: boolean, startCooldown: boolean) => {
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current);
    setOutlineVisible(true);
    if (lock) setDrawLocked(true);
    guideTimerRef.current = setTimeout(() => {
      setOutlineVisible(false);
      setDrawLocked(false);
    }, ms);
    if (startCooldown) startCooldownTimer();
  };

  /** 6s countdown from press; button stays disabled+greyed with a live count. */
  const startCooldownTimer = () => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    setCooldown(COOLDOWN_SECONDS);
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  /** Apply a level's on-entry guide behavior to the active drawing surface. */
  const applyGuideForEntry = () => {
    clearTimers();
    setCooldown(0);
    setDrawLocked(false);
    if (spec.mode === "trace") {
      setOutlineVisible(true); // persistent guide (+ looped stroke order)
    } else if (spec.mode === "solo") {
      setOutlineVisible(false); // no assistance
    } else {
      // peek / flash: auto-show on entry (does NOT start the button cooldown)
      flashGuide(spec.guideMs, spec.lockWhileGuide, false);
    }
  };

  // Level change (both modes): clear the attempt and reset guide state. On a real
  // level change we wipe all ink + results (each level is a fresh attempt) and
  // collapse to the grid; the restore-mount is skipped via prevTabRef.
  useEffect(() => {
    if (!open) return;
    const isTabChange = prevTabRef.current !== null && prevTabRef.current !== activeTab;
    prevTabRef.current = activeTab;

    clearTimers();
    setCooldown(0);
    setDrawLocked(false);

    if (isTabChange) {
      setResults(chars.map(() => "idle"));
      if (isMulti) {
        setInks(chars.map(() => []));
        setPreviewNonce((n) => n + 1);
        setFocusedIndex(null);
        setActiveHasInk(false);
        setOutlineVisible(false);
        return clearTimers; // multi applies the guide on focus, not here
      }
      canvasRef.current?.clear();
      setActiveHasInk(false);
    }

    // Single character: the panel is always present, so apply the guide here.
    if (!isMulti) applyGuideForEntry();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, open]);

  // Multi-char: entering a focused slot applies the level's guide; leaving hides it.
  useEffect(() => {
    if (!open || !isMulti) return;
    if (focusedIndex === null) {
      clearTimers();
      setCooldown(0);
      setDrawLocked(false);
      setOutlineVisible(false);
      return;
    }
    applyGuideForEntry();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIndex, open]);

  // Redrawing the active surface invalidates that character's prior result.
  const handleActiveInkChange = (ink: Ink) => {
    setActiveHasInk(ink.length > 0);
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

  // Tap a grid slot → enlarge it into the focused drawing panel.
  const focusSlot = (i: number) => {
    setActiveHasInk((inks[i]?.length ?? 0) > 0);
    setResults((r) => {
      if (r[i] === "idle") return r;
      const next = r.slice();
      next[i] = "idle";
      return next;
    });
    setFocusedIndex(i);
  };

  // Back → capture the focused character's ink into `inks` and return to the grid.
  const collapseFocus = () => {
    if (focusedIndex === null) return;
    const captured = canvasRef.current?.getInk() ?? [];
    setInks((prev) => {
      const next = prev.slice();
      next[focusedIndex] = captured.map((s) => ({ ...s }));
      return next;
    });
    setPreviewNonce((n) => n + 1);
    setFocusedIndex(null);
  };

  const handleVerify = async () => {
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
    const allCorrect = settled.every((s) => s.correct);

    // Diagnostics for tuning recognition (latency is browser→proxy→Google RTT).
    console.log("✍️ handwriting verify", {
      target: character,
      level: spec.mode,
      result: allCorrect ? "✓ all correct" : "✗ incomplete",
      perChar: settled.map((s) => ({ char: chars[s.i], correct: s.correct, top1: s.top1 })),
      latencyMs: Math.round(performance.now() - startedAt),
    });

    // Award the star only when EVERY character is correct in one Verify.
    if (allCorrect && !completedLevels.has(spec.mode)) {
      recordCompletion("zh", character, spec.mode, token)
        .then(onLevelsChange)
        .catch((e) => console.warn("✍️ failed to record completion", e));
    }
  };

  // Tapping the background (the dark backdrop, or the transparent area inside the
  // phone card around the islands) means "step back one level": in a focused slot
  // it collapses to the grid; in grid / single-char it exits the popup entirely.
  const handleBackgroundTap = () => {
    if (isMulti && focusedIndex !== null) collapseFocus();
    else handleClose();
  };

  // Closing (✕ or backdrop) preserves the active level + per-char ink + focus.
  const handleClose = () => {
    const captured = inks.slice();
    if (isDrawing) captured[drawingIndex] = (canvasRef.current?.getInk() ?? captured[drawingIndex] ?? []).map((s) => ({ ...s }));
    setWritingDraft({ character, activeTabIndex: activeTab, inks: captured, focusedIndex });
    clearTimers();
    onClose();
  };

  // Shared "floating footer-style bar" look for the toolbar pills + level bar.
  const floatingBarSx = {
    bgcolor: COLORS.header,
    borderRadius: 999,
    boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
  } as const;

  // Swallow draw-gesture events so they never reach the flashcard's document-level
  // drag/flip listeners (pointer events are also stopped in WritingCanvas).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const gestureStopHandlers = {
    onPointerDown: stop,
    onPointerUp: stop,
    onMouseDown: stop,
    onMouseUp: stop,
    onClick: stop,
    onTouchStart: stop,
    onTouchEnd: stop,
  };

  const anyInk = inks.some((ink) => ink.length > 0);

  // ── Reusable chrome pieces ──────────────────────────────────────────────────
  const editBar = (
    <Box
      className="practice-writing__edit-bar"
      sx={{
        ...floatingBarSx,
        flexGrow: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-evenly",
        minHeight: 56,
        borderRadius: 3,
        px: 0.5,
      }}
    >
      <Button
        className="practice-writing__clear"
        startIcon={<DeleteOutline />}
        onClick={handleClear}
        disabled={!activeHasInk}
        sx={{ color: COLORS.textSecondary, borderRadius: 999, textTransform: "none" }}
      >
        Clear
      </Button>
      <Button
        className="practice-writing__undo"
        startIcon={<Undo />}
        onClick={handleUndo}
        disabled={!activeHasInk}
        sx={{ color: COLORS.textSecondary, borderRadius: 999, textTransform: "none" }}
      >
        Undo
      </Button>
    </Box>
  );

  const verifyButton = (disabled: boolean) => (
    <Button
      className="practice-writing__verify"
      variant="contained"
      onClick={handleVerify}
      disabled={disabled || checking}
      sx={{
        minWidth: 88,
        borderRadius: 3,
        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
        textTransform: "none",
        // Disabled = solid, clearly-visible light grey (not the faint MUI default).
        "&.Mui-disabled": { backgroundColor: COLORS.card, color: COLORS.textSecondary, opacity: 1 },
      }}
    >
      {checking ? <CircularProgress className="practice-writing__verify-spinner" size={18} color="inherit" /> : "Verify"}
    </Button>
  );

  const peekButton = spec.buttonLabel ? (
    <Button
      className="practice-writing__peek"
      variant="outlined"
      onClick={() => flashGuide(spec.guideMs, spec.lockWhileGuide, true)}
      disabled={cooldown > 0}
      sx={{ minWidth: 140 }}
    >
      {cooldown > 0 ? `${cooldown}s` : spec.buttonLabel}
    </Button>
  ) : null;

  const levelBar = (
    <Box
      className="practice-writing__tabbar"
      sx={{ ...floatingBarSx, width: FOCUS_SIZE, mx: "auto", mt: "auto", overflow: "hidden" }}
    >
      <Tabs
        className="practice-writing__tabs"
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{
          minHeight: 64,
          // Filled grey "pill" behind the active level instead of an underline.
          "& .MuiTabs-indicator": { display: "none" },
          "& .MuiTab-root": {
            minWidth: 0,
            minHeight: 56,
            m: 0.75,
            borderRadius: 2.5,
            px: { xs: 0.5, sm: 1.5 },
            fontSize: { xs: "0.72rem", sm: "0.875rem" },
            textTransform: "none",
            color: COLORS.textSecondary,
            transition: "background-color 0.15s ease, color 0.15s ease",
          },
          "& .Mui-selected": {
            color: `${COLORS.onSurface} !important`,
            fontWeight: 600,
            backgroundColor: COLORS.card,
          },
        }}
      >
        {TABS.map((t) => (
          <Tab
            key={t.mode}
            className={`practice-writing__tab practice-writing__tab--${t.mode}`}
            // A gold star prefixes the label (inline) once this level is completed.
            label={
              <span className="practice-writing__tab-label" style={{ whiteSpace: "nowrap" }}>
                {completedLevels.has(t.mode) && (
                  <span className="practice-writing__tab-star" style={{ color: "#F6B73C" }}>
                    ★&nbsp;
                  </span>
                )}
                {t.label}
              </span>
            }
          />
        ))}
      </Tabs>
    </Box>
  );

  // White writing-panel island styling, shared by single + focused panels.
  const panelSx = {
    position: "relative",
    width: FOCUS_SIZE,
    height: FOCUS_SIZE,
    borderRadius: 3,
    backgroundColor: "#fff",
    boxShadow: "0 2px 12px rgba(0,0,0,0.16)",
    overflow: "hidden",
  } as const;

  // ── Mode bodies ─────────────────────────────────────────────────────────────
  const singleBody = (
    <>
      <Box
        className="practice-writing__toolbar"
        sx={{ width: FOCUS_SIZE, mx: "auto", mt: "auto", display: "flex", alignItems: "stretch", gap: 1, mb: 1.5 }}
      >
        {editBar}
        {verifyButton(!activeHasInk)}
      </Box>

      <Box className="practice-writing__drawing-area" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
        <Box className="practice-writing__stage" {...gestureStopHandlers} sx={panelSx}>
          <WritingStage
            ref={canvasRef}
            character={chars[0]}
            size={FOCUS_SIZE}
            drawable
            showGuide={spec.mode !== "solo"}
            guideVisible={outlineVisible}
            loopAnimation={spec.mode === "trace"}
            guideKey={spec.mode}
            drawLocked={drawLocked}
            loading={drawLocked}
            initialInk={inks[0]}
            onInkChange={handleActiveInkChange}
            result={results[0]}
          />
        </Box>
        {peekButton}
      </Box>

      {levelBar}
    </>
  );

  const focusBody = focusedIndex !== null && (
    <>
      <Box className="practice-writing__focus-header" sx={{ alignSelf: "flex-start", mt: "auto" }}>
        <Button
          className="practice-writing__back"
          startIcon={<ArrowBack />}
          onClick={collapseFocus}
          sx={{ ...floatingBarSx, color: COLORS.onSurface, borderRadius: 999, textTransform: "none", px: 2, minHeight: 44 }}
        >
          Back
        </Button>
      </Box>

      <Box
        className="practice-writing__toolbar practice-writing__toolbar--focus"
        sx={{ width: FOCUS_SIZE, mx: "auto", mt: 1.5, display: "flex", alignItems: "stretch", mb: 1.5 }}
      >
        {editBar}
      </Box>

      {/* mb:auto pairs with the header's mt:auto to center the panel (no spacer div). */}
      <Box className="practice-writing__drawing-area" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, mb: "auto" }}>
        <Box className="practice-writing__stage" {...gestureStopHandlers} sx={panelSx}>
          <WritingStage
            key={`focus-${focusedIndex}`}
            ref={canvasRef}
            character={chars[focusedIndex]}
            size={FOCUS_SIZE}
            drawable
            showGuide={spec.mode !== "solo"}
            guideVisible={outlineVisible}
            loopAnimation={spec.mode === "trace"}
            guideKey={`${focusedIndex}-${spec.mode}`}
            drawLocked={drawLocked}
            loading={drawLocked}
            initialInk={inks[focusedIndex]}
            onInkChange={handleActiveInkChange}
            result="idle"
          />
        </Box>
        {peekButton}
      </Box>
    </>
  );

  const gridBody = (
    <>
      <Box
        className="practice-writing__toolbar practice-writing__toolbar--grid"
        sx={{ width: GRID_WIDTH, mx: "auto", mt: "auto", display: "flex", justifyContent: "flex-end", mb: 1.5 }}
      >
        {verifyButton(!anyInk)}
      </Box>

      {/* 2×2 grid — chars fill in order: 0→TL, 1→TR, 2→BL, 3→BR. So 2 chars use the
          top two, 3 chars add the bottom-left, 4 chars fill all four. */}
      <Box
        className="practice-writing__grid"
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(2, ${GRID_SLOT}px)`,
          gridAutoRows: `${GRID_SLOT}px`,
          gap: `${GRID_GAP}px`,
          mx: "auto",
          justifyContent: "center",
        }}
      >
        {chars.map((ch, i) => (
          <Box
            key={`slot-${i}`}
            className={`practice-writing__grid-slot practice-writing__grid-slot--${i}`}
            {...gestureStopHandlers}
            onClick={(e) => {
              e.stopPropagation();
              focusSlot(i);
            }}
            sx={{
              ...panelSx,
              width: GRID_SLOT,
              height: GRID_SLOT,
              cursor: "pointer",
            }}
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
                key={`grid-${i}-${activeTab}-${previewNonce}`}
                character={ch}
                size={FOCUS_SIZE}
                drawable={false}
                // Grid previews show the grey guide for Level 1 (trace) and Level 2
                // (peek); Level 3 (flash) and Level 4 (solo) leave previews blank.
                // The timed reveal/lock behavior is a focused-mode aid, not the preview.
                showGuide={spec.mode === "trace" || spec.mode === "peek"}
                guideVisible={spec.mode === "trace" || spec.mode === "peek"}
                loopAnimation={false}
                guideKey={`grid-${i}-${spec.mode}`}
                initialInk={inks[i]}
                result={results[i]}
                resultIconSize={Math.round(40 / GRID_SCALE)}
              />
            </Box>
          </Box>
        ))}
      </Box>

      {levelBar}
    </>
  );

  return (
    <Dialog
      className="practice-writing-dialog"
      open={open}
      onClose={handleBackgroundTap}
      // Match the phone-card geometry (full-bleed on mobile, centered 393px card on
      // desktop — same as MobileDemoFrame) so the chrome anchors to the phone's own
      // corners/bottom. Paper is transparent + shadowless: each element reads as its
      // own floating island over the dark backdrop scrim.
      PaperProps={{
        elevation: 0,
        sx: {
          backgroundColor: "transparent",
          boxShadow: "none",
          overflow: "visible",
          m: 0,
          width: { xs: "100vw", md: 393 },
          maxWidth: "100vw",
          height: { xs: "100dvh", md: "calc(100dvh - 48px)" },
          maxHeight: { xs: "100dvh", md: 932 },
        },
      }}
    >
      <Box
        className="practice-writing"
        // Taps on the transparent area around the islands (not on an island —
        // those stop propagation) step back one level, mirroring the backdrop.
        onClick={(e) => {
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
        {/* Floating close button — anchored to the top-right corner of the phone card. */}
        <IconButton
          className="practice-writing__close"
          onClick={handleClose}
          size="small"
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 3,
            bgcolor: COLORS.header,
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            "&:hover": { bgcolor: COLORS.card },
          }}
        >
          <Close fontSize="small" />
        </IconButton>

        {!isMulti ? singleBody : focusedIndex !== null ? focusBody : gridBody}
      </Box>
    </Dialog>
  );
}
