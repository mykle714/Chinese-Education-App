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
} from '../components/hintBubble/useHintBubblePresence';

const TIMING = { enterDelayMs: 750, staggerMs: 70 };

const item = (key: string): PresenceItem<string> => ({ key, value: key });

/**
 * A `random` that makes the shuffle a no-op (Fisher–Yates swaps i with
 * floor(r·(i+1)); r just under 1 always picks i itself), so a batch keeps the
 * order it was listed in and delays are predictable.
 */
const IDENTITY_RANDOM = () => 0.999999;

function step(previous: RenderedItem<string>[], desired: PresenceItem<string>[], now: number) {
  return reconcilePresence(previous, desired, TIMING, now, IDENTITY_RANDOM);
}

describe('§ 6z-4 hint bubble presence', () => {
  it('enters a batch after the delay, one evenly spaced stagger slot per bubble', () => {
    const { next } = step([], [item('b'), item('a'), item('c')], 0);
    const delay = Object.fromEntries(next.map((bubble) => [bubble.key, bubble.delayMs]));
    expect(delay).toEqual({ b: 750, a: 820, c: 890 });
    expect(next.every((bubble) => bubble.phase === 'in')).toBe(true);
  });

  it('shuffles which bubble takes which slot, not left to right', () => {
    const batch = ['a', 'b', 'c', 'd', 'e'].map((key) => item(key));
    // A seeded LCG, so the test is deterministic but the order genuinely varies.
    let seed = 7;
    const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const orders = new Set<string>();
    for (let run = 0; run < 20; run++) {
      const { next } = reconcilePresence([], batch, TIMING, 0, lcg);
      const byDelay = [...next].sort((x, y) => x.delayMs - y.delayMs).map((bubble) => bubble.key).join('');
      orders.add(byDelay);
      // Whatever the order, the slots are the same evenly spaced set.
      expect(next.map((bubble) => bubble.delayMs).sort((x, y) => x - y)).toEqual([750, 820, 890, 960, 1030]);
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('keeps a surviving bubble without restarting it', () => {
    const first = step([], [item('a')], 0).next;
    const { next, exiting } = step(first, [item('a'), item('b')], 1000);
    // Frozen at entry: a re-derived delay would restart its CSS animation.
    expect(next.find((bubble) => bubble.key === 'a')!.delayMs).toBe(750);
    expect(exiting).toEqual([]);
    // Only the newcomer is in this batch, so it takes the first slot.
    expect(next.find((bubble) => bubble.key === 'b')!.delayMs).toBe(750);
  });

  it('pops and respawns (never slides) when a chip changes position', () => {
    // The row keys by slot, so 疋 moving from slot 0 to slot 2 is a different key.
    const first = step([], [item('0|疋|是')], 0).next;
    const { next, exiting } = step(first, [item('2|疋|是')], 1000);
    expect(exiting.map((e) => e.key)).toEqual(['0|疋|是']);
    expect(next.find((bubble) => bubble.key === '0|疋|是')!.phase).toBe('out');
    const moved = next.find((bubble) => bubble.key === '2|疋|是')!;
    expect(moved.phase).toBe('in');
    expect(moved.delayMs).toBe(750);
  });

  it('pops a bubble that has been seen, and reports it for removal', () => {
    const first = step([], [item('a')], 0).next;
    const { next, exiting } = step(first, [], 2000);
    expect(next).toHaveLength(1);
    expect(next[0].phase).toBe('out');
    expect(exiting).toEqual([{ key: 'a', exitId: next[0].exitId }]);
  });

  it('drops a bubble that never appeared instead of popping it', () => {
    const first = step([], [item('a')], 0).next;
    // 100 ms in: still inside its 750 ms entrance delay.
    const { next, exiting } = step(first, [], 100);
    expect(next).toEqual([]);
    expect(exiting).toEqual([]);
  });

  it('revives a popping bubble as a fresh entrance whose exitId no longer matches the old pop', () => {
    const shown = step([], [item('a')], 0).next;
    const popped = step(shown, [], 2000);
    const { next } = step(popped.next, [item('a')], 2100);
    expect(next).toHaveLength(1);
    expect(next[0].phase).toBe('in');
    expect(next[0].delayMs).toBe(750);
    expect(next[0].exitId).not.toBe(popped.exiting[0].exitId);
  });

  it('pops everything while scrolling (empty desired) and regrows staggered on settle', () => {
    const shown = step([], [item('a'), item('b')], 0).next;
    const scrolling = step(shown, [], 2000);
    expect(scrolling.next.every((bubble) => bubble.phase === 'out')).toBe(true);
    // The pops have played and been removed by the time the strip settles.
    const settled = step([], [item('b'), item('a')], 2500).next;
    expect(settled.map((bubble) => bubble.delayMs).sort((x, y) => x - y)).toEqual([750, 820]);
  });
});
