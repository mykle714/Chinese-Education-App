import { useCallback, useEffect, useRef, useState } from "react";
import { loadCharData } from "./loadCharData";
import { TIMED_MS_PER_STROKE } from "../../../server/contracts/writingLevels";

/**
 * Level 8 ("Timed") — one countdown clock PER CHARACTER.
 *
 * Rules (docs/WRITING_PRACTICE_REWORK.md § 1):
 *   - budget = TIMED_MS_PER_STROKE × the character's stroke count (Hanzi Writer data);
 *   - a character's clock starts on its FIRST stroke (WritingCanvas.onStrokeStart);
 *   - Clear / Undo do NOT reset it — only `reset()` (a fresh attempt: level change,
 *     the popup's Retry, a new card) does;
 *   - when it runs out the host locks that character's canvas and grades what was
 *     drawn (`onExpire`).
 *
 * Clocks are wall-clock deadlines, so a character keeps counting down while its slot
 * is collapsed back to a grid. One shared ticker drives every running clock.
 *
 * Referenced by: PracticeWritingPopup, the Writing Grid game, the writing flp face.
 */

// Stroke counts never change; cache them across surfaces.
const strokeCountCache = new Map<string, Promise<number>>();

/** Stroke count for one character (falls back to 10 if its data cannot load). */
export function getStrokeCount(char: string): Promise<number> {
  let p = strokeCountCache.get(char);
  if (!p) {
    p = new Promise<number>((resolve) => {
      loadCharData(
        char,
        (data) => resolve(Array.isArray(data?.strokes) && data.strokes.length > 0 ? data.strokes.length : 10),
        () => resolve(10),
      );
    });
    strokeCountCache.set(char, p);
  }
  return p;
}

interface Clock {
  deadline: number;
  totalMs: number;
}

export function useStrokeClock(
  chars: string[],
  options: { enabled: boolean; onExpire?: (index: number) => void },
) {
  const { enabled, onExpire } = options;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Budgets resolved ahead of time so a first stroke can start its clock synchronously.
  const budgetsRef = useRef<number[]>([]);
  const charsKey = chars.join("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all(chars.map(getStrokeCount)).then((counts) => {
      if (!cancelled) budgetsRef.current = counts.map((n) => n * TIMED_MS_PER_STROKE);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charsKey, enabled]);

  const [clocks, setClocks] = useState<Record<number, Clock>>({});
  const [expired, setExpired] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const clocksRef = useRef(clocks);
  clocksRef.current = clocks;
  const expiredRef = useRef(expired);
  expiredRef.current = expired;

  /** Start character `i`'s clock if it has not started (called on every stroke start). */
  const start = useCallback(
    (i: number) => {
      if (!enabled || clocksRef.current[i]) return;
      // Budget not loaded yet (a stroke within ms of opening): use a generous default.
      const totalMs = budgetsRef.current[i] ?? 10 * TIMED_MS_PER_STROKE;
      const t = Date.now();
      setNow(t);
      setClocks((c) => ({ ...c, [i]: { deadline: t + totalMs, totalMs } }));
    },
    [enabled],
  );

  const reset = useCallback(() => {
    setClocks({});
    setExpired(new Set());
  }, []);

  // One ticker while any clock is running and not yet expired.
  const running = Object.keys(clocks).some((k) => !expired.has(Number(k)));
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const newlyExpired: number[] = [];
      for (const [k, clock] of Object.entries(clocksRef.current)) {
        const i = Number(k);
        if (t >= clock.deadline && !expiredRef.current.has(i)) newlyExpired.push(i);
      }
      if (newlyExpired.length > 0) {
        setExpired((prev) => {
          const next = new Set(prev);
          newlyExpired.forEach((i) => next.add(i));
          return next;
        });
        newlyExpired.forEach((i) => onExpireRef.current?.(i));
      }
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  /** Remaining/total for character `i`, or null when its clock has not started. */
  const clockFor = useCallback(
    (i: number): { remainingMs: number; totalMs: number } | null => {
      const c = clocks[i];
      if (!c) return null;
      return { remainingMs: Math.max(0, c.deadline - now), totalMs: c.totalMs };
    },
    [clocks, now],
  );

  return { start, reset, clockFor, isExpired: (i: number) => expired.has(i) };
}
