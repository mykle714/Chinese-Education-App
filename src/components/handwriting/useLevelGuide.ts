import { useCallback, useEffect, useRef, useState } from "react";
import type { WritingMode } from "../../../server/contracts/writingLevels";
import { LEVEL_BEHAVIOR, type LevelBehavior } from "./levelBehavior";

/**
 * useLevelGuide — the guide / draw-lock / assist-button state machine for ONE
 * drawing surface at one Practice Writing level.
 *
 * Extracted from PracticeWritingPopup (which used to inline it for four levels) so the
 * popup, the Writing Grid game and the writing flp card share one interpreter of
 * `LEVEL_BEHAVIOR`. The host decides WHEN a surface is entered (`enter`) or left
 * (`leave`) — e.g. the popup enters on a level change in single-character mode, and on
 * focusing a slot in the 2×2 grid — and wires the outputs into `WritingStage`.
 *
 * Outputs:
 *   outlineVisible — show the grey guide now
 *   regionIndex    — which region (levels 4/6) the guide is clipped to
 *   drawLocked     — canvas refuses new strokes
 *   blocked        — Memorize's study-first lock (red "no writing" badge)
 *   loading        — a TIMED lock is running (corner spinner)
 *   cooldownSec    — assist-button cooldown, whole seconds remaining (0 = ready)
 *
 * Timers are held in refs and cleared on every enter/leave and on unmount, so a level
 * change can never leave a stale flash timer that unlocks the next level's canvas.
 *
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 1; docs/PRACTICE_WRITING.md.
 */
export function useLevelGuide(mode: WritingMode) {
  const behavior: LevelBehavior = LEVEL_BEHAVIOR[mode];
  // Live mode for the callbacks below (they are stable and must not read a stale one).
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [outlineVisible, setOutlineVisible] = useState(false);
  const [drawLocked, setDrawLocked] = useState(false);
  const [regionIndex, setRegionIndex] = useState(0);
  const [cooldownSec, setCooldownSec] = useState(0);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the flash running is the ON-ENTRY one (not an assist-button press).
  // Only that flash yields to the learner's first stroke (`blockedAttempt`).
  const entryFlashRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    entryFlashRef.current = false;
    flashTimerRef.current = null;
    cooldownTimerRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Show the guide for `ms`, optionally locking drawing for the same window. */
  const flash = useCallback((ms: number, lock: boolean) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setOutlineVisible(true);
    if (lock) setDrawLocked(true);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      entryFlashRef.current = false;
      setOutlineVisible(false);
      setDrawLocked(false);
    }, ms);
  }, []);

  /** Cooldown measured from the press; the button shows a live whole-second count. */
  const startCooldown = useCallback((ms: number) => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    if (ms <= 0) {
      setCooldownSec(0);
      return;
    }
    const endsAt = Date.now() + ms;
    setCooldownSec(Math.ceil(ms / 1000));
    cooldownTimerRef.current = setInterval(() => {
      const left = endsAt - Date.now();
      if (left <= 0) {
        if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
        setCooldownSec(0);
      } else {
        setCooldownSec(Math.ceil(left / 1000));
      }
    }, 200);
  }, []);

  /** Apply the level's on-entry behaviour (a fresh attempt on this surface). */
  const enter = useCallback(() => {
    clearTimers();
    const b = LEVEL_BEHAVIOR[modeRef.current];
    setCooldownSec(0);
    setDrawLocked(false);
    setRegionIndex(0); // levels 4/6 always open on the first (top-left) region
    switch (b.guide) {
      case "persistent":
        setOutlineVisible(true);
        break;
      case "study":
        // Study as long as you like; the first stroke unlocks (blockedAttempt).
        setOutlineVisible(true);
        setDrawLocked(true);
        break;
      case "flash":
        // The entry flash does NOT start the button's cooldown. Flagged AFTER
        // `flash` so a stroke during it can cut it short (`blockedAttempt`).
        flash(b.flashMs, b.lockWhileGuide);
        entryFlashRef.current = true;
        break;
      default:
        setOutlineVisible(false);
    }
  }, [clearTimers, flash]);

  /** The surface is no longer being drawn on (collapsed / unmounted / level left). */
  const leave = useCallback(() => {
    clearTimers();
    setCooldownSec(0);
    setDrawLocked(false);
    setOutlineVisible(false);
  }, [clearTimers]);

  /** The assist button was pressed. */
  const press = useCallback(() => {
    const m = modeRef.current;
    const b = LEVEL_BEHAVIOR[m];
    if (!b.button) return;
    if (b.regions) {
      setRegionIndex((i) => (i + 1) % (b.regions as number));
      if (b.guide === "flash") flash(b.flashMs, b.lockWhileGuide);
      else setOutlineVisible(true);
    } else if (b.guide === "flash") {
      // A Show press is a deliberate look: it is NOT cut short by a stroke.
      flash(b.flashMs, b.lockWhileGuide);
      entryFlashRef.current = false;
    }
    startCooldown(b.button.cooldownMs);
  }, [flash, startCooldown]);

  const blocked = behavior.guide === "study" && drawLocked;

  /**
   * A press landed on the locked canvas. Two locks treat that press AS the unlock —
   * hide the guide and return true so WritingCanvas lets the same pointerdown start
   * the stroke:
   *   - Memorize's study-first lock (open-ended, so the first stroke is its only end);
   *   - Step Through's ON-ENTRY flash (since 2026-10-04): a learner who already knows
   *     the character need not wait out the 1.5s. Only the flash timer is cut — the
   *     entry flash never started the Show cooldown, so there is none to clear.
   * Any other lock (a Show press's flash) swallows the press.
   */
  const blockedAttempt = useCallback((): boolean => {
    const guideKind = LEVEL_BEHAVIOR[modeRef.current].guide;
    if (guideKind === "study") {
      clearTimers();
    } else if (guideKind === "flash" && entryFlashRef.current) {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
      entryFlashRef.current = false;
    } else {
      return false;
    }
    setOutlineVisible(false);
    setDrawLocked(false);
    return true;
  }, [clearTimers]);

  return {
    behavior,
    outlineVisible,
    regionIndex,
    drawLocked,
    blocked,
    // Spinner only for a timed lock (flash levels) — Memorize's lock is open-ended.
    loading: drawLocked && behavior.guide === "flash",
    cooldownSec,
    enter,
    leave,
    press,
    blockedAttempt,
  };
}

export type LevelGuide = ReturnType<typeof useLevelGuide>;
