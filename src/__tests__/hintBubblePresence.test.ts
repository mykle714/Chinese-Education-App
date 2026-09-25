/**
 * The § 6z-4 hint bubbles' presence rules — when a bubble enters, how the stagger
 * is assigned, when it pops, and when it may skip the pop.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-4 ("Motion").
 */
import { describe, it, expect } from 'vitest';
import {
  reconcilePresence,
  type PresenceItem,
  type RenderedItem,
} from '../features/beginnerKeyboard/useHintBubblePresence';

const TIMING = { enterDelayMs: 750, staggerMs: 70 };

const item = (key: string, order: number): PresenceItem<string> => ({ key, order, value: key });

function step(previous: RenderedItem<string>[], desired: PresenceItem<string>[], now: number) {
  return reconcilePresence(previous, desired, TIMING, now);
}

describe('§ 6z-4 hint bubble presence', () => {
  it('enters a batch after the delay, staggered left to right regardless of list order', () => {
    const { next } = step([], [item('b', 120), item('a', 20), item('c', 220)], 0);
    const delay = Object.fromEntries(next.map((bubble) => [bubble.key, bubble.delayMs]));
    expect(delay).toEqual({ a: 750, b: 820, c: 890 });
    expect(next.every((bubble) => bubble.phase === 'in')).toBe(true);
  });

  it('keeps a surviving bubble without restarting it', () => {
    const first = step([], [item('a', 20)], 0).next;
    const { next, exiting } = step(first, [item('a', 20), item('b', 90)], 1000);
    // Frozen at entry: a re-derived delay would restart its CSS animation.
    expect(next.find((bubble) => bubble.key === 'a')!.delayMs).toBe(750);
    expect(exiting).toEqual([]);
    // Only the newcomer is in this batch, so it takes the first slot.
    expect(next.find((bubble) => bubble.key === 'b')!.delayMs).toBe(750);
  });

  it('pops and respawns (never slides) when a chip changes position', () => {
    // The row keys by slot, so 疋 moving from slot 0 to slot 2 is a different key.
    const first = step([], [item('0|疋|是', 20)], 0).next;
    const { next, exiting } = step(first, [item('2|疋|是', 124)], 1000);
    expect(exiting.map((e) => e.key)).toEqual(['0|疋|是']);
    expect(next.find((bubble) => bubble.key === '0|疋|是')!.phase).toBe('out');
    const moved = next.find((bubble) => bubble.key === '2|疋|是')!;
    expect(moved.phase).toBe('in');
    expect(moved.delayMs).toBe(750);
  });

  it('pops a bubble that has been seen, and reports it for removal', () => {
    const first = step([], [item('a', 20)], 0).next;
    const { next, exiting } = step(first, [], 2000);
    expect(next).toHaveLength(1);
    expect(next[0].phase).toBe('out');
    expect(exiting).toEqual([{ key: 'a', exitId: next[0].exitId }]);
  });

  it('drops a bubble that never appeared instead of popping it', () => {
    const first = step([], [item('a', 20)], 0).next;
    // 100 ms in: still inside its 750 ms entrance delay.
    const { next, exiting } = step(first, [], 100);
    expect(next).toEqual([]);
    expect(exiting).toEqual([]);
  });

  it('revives a popping bubble as a fresh entrance whose exitId no longer matches the old pop', () => {
    const shown = step([], [item('a', 20)], 0).next;
    const popped = step(shown, [], 2000);
    const { next } = step(popped.next, [item('a', 20)], 2100);
    expect(next).toHaveLength(1);
    expect(next[0].phase).toBe('in');
    expect(next[0].delayMs).toBe(750);
    expect(next[0].exitId).not.toBe(popped.exiting[0].exitId);
  });

  it('pops everything while scrolling (empty desired) and regrows staggered on settle', () => {
    const shown = step([], [item('a', 20), item('b', 80)], 0).next;
    const scrolling = step(shown, [], 2000);
    expect(scrolling.next.every((bubble) => bubble.phase === 'out')).toBe(true);
    // The pops have played and been removed by the time the strip settles.
    const settled = step([], [item('b', 40), item('a', 140)], 2500).next;
    expect(settled.map((bubble) => [bubble.key, bubble.delayMs])).toEqual([
      ['b', 750],
      ['a', 820],
    ]);
  });
});
