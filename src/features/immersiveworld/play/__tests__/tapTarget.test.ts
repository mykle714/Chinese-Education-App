import { describe, expect, it } from 'vitest';
import { isoToScreen, screenToCell, TILE_HEIGHT } from '../../../../engine/market/isometric';
import { resolveTapTarget, type TapBody } from '../tapTarget';

/**
 * resolveTapTarget — the one answer behind both the hover highlight and the click (§ 14 Q18).
 *
 * The cases that matter most are the regressions at the bottom. A foot-anchored 48px sprite is
 * SIX rows tall in this projection (one step of `isoX + isoY` is `TILE_HEIGHT / 2` = 8px), so
 * before the priority existed it swallowed every tap aimed at furniture behind a person, and
 * before the ink profile existed its rectangle swallowed the bare floor beside one too.
 *
 * The sprite size is the real one — `PLAYER_FRAME_PX` is 48 — because the ink profile is
 * expressed as a FRACTION of it, and a fixture at some other size would be testing a figure
 * that does not exist.
 */
const SPRITE_W = 48;
const SPRITE_H = 48;

const body = (id: string, isoX: number, isoY: number): TapBody => (
  { id, isoX, isoY, spriteWidth: SPRITE_W, spriteHeight: SPRITE_H }
);

/** The point a learner aims at when they mean "that tile" — the middle of its diamond. */
const centreOf = (col: number, row: number) => {
  const { screenX, screenY } = isoToScreen(col, row);
  return { x: screenX, y: screenY - TILE_HEIGHT / 2 };
};

/** Every cell walkable unless a test says otherwise — the § 3a default (bare floor). */
const allWalkable: ReadonlySet<string> = {
  has: () => true,
} as unknown as ReadonlySet<string>;

/** Bare floor everywhere EXCEPT the listed cells, which stand for blocking decor. */
const walkableExcept = (...blocked: string[]): ReadonlySet<string> => ({
  has: (k: string) => !blocked.includes(k),
}) as unknown as ReadonlySet<string>;

const base = {
  boardWidth: 12, boardHeight: 12,
  bodies: [] as TapBody[],
  places: [] as { tag: string; cell: string }[],
  playerId: 'player',
  padPx: 8,
  walkable: allWalkable,
};

describe('resolveTapTarget', () => {
  it('resolves a bare tile to a walk', () => {
    expect(resolveTapTarget(centreOf(3, 4), base)).toEqual({ kind: 'cell', col: 3, row: 4 });
  });

  it('returns null off the board', () => {
    expect(resolveTapTarget(centreOf(99, 99), base)).toBeNull();
  });

  it('still hits a body whose head overhangs the board edge', () => {
    // A 48px figure is six rows tall in this projection, so a body on the back row draws most
    // of itself onto no cell at all. "Off the board" is no CELL, not no TARGET — otherwise the
    // companion in "Get Dinner" (row 11 of 12) answers only to the diamond under his feet.
    const foot = isoToScreen(8, 11);
    const o = { ...base, bodies: [body('michael', 8, 11)] };
    expect(screenToCell(foot.screenX, foot.screenY - 30, 12, 12)).toBeNull();
    expect(resolveTapTarget({ x: foot.screenX, y: foot.screenY - 30 }, o))
      .toMatchObject({ kind: 'body', id: 'michael', col: 8, row: 11 });
  });

  it('resolves an interactive place on the pointed-at cell', () => {
    const o = { ...base, places: [{ tag: 'menu board', cell: '3,4' }] };
    expect(resolveTapTarget(centreOf(3, 4), o)).toEqual({ kind: 'place', tag: 'menu board', col: 3, row: 4 });
  });

  it('resolves a body standing on the pointed-at cell', () => {
    const o = { ...base, bodies: [body('wang_shen', 3, 4)] };
    expect(resolveTapTarget(centreOf(3, 4), o)).toMatchObject({ kind: 'body', id: 'wang_shen' });
  });

  it('never targets the learner themselves', () => {
    const o = { ...base, bodies: [body('player', 3, 4)] };
    expect(resolveTapTarget(centreOf(3, 4), o)).toEqual({ kind: 'cell', col: 3, row: 4 });
  });

  it('a body on a place cell beats the place — you talk to the person, not the counter', () => {
    const o = {
      ...base,
      bodies: [body('wang_shen', 3, 4)],
      places: [{ tag: 'counter', cell: '3,4' }],
    };
    expect(resolveTapTarget(centreOf(3, 4), o)).toMatchObject({ kind: 'body', id: 'wang_shen' });
  });

  it('keeps Q18 near-miss tolerance: aiming at a body\'s head still selects them', () => {
    // A point most of a sprite-height above the feet — visually the character's head, which is
    // an empty tile several rows back. Rule 2 is the only thing that catches this.
    const foot = isoToScreen(5, 5);
    const head = { x: foot.screenX, y: foot.screenY - SPRITE_H + 6 };
    const o = { ...base, bodies: [body('michael', 5, 5)] };
    expect(resolveTapTarget(head, o)).toMatchObject({ kind: 'body', id: 'michael', col: 5, row: 5 });
  });

  it('picks the body drawn on top when two boxes overlap', () => {
    // ⚠️ In this projection `screenY = -(isoX + isoY) · TILE_HEIGHT/2`, so a LARGER iso sum is
    // HIGHER on screen and therefore FURTHER AWAY. (5,5) is in front of (6,6), not behind it —
    // which is also why a 48px sprite reaching up-screen covers the cells BEHIND its owner.
    const foot = isoToScreen(5, 5);
    const o = { ...base, bodies: [body('further', 6, 6), body('nearer', 5, 5)] };
    const hit = resolveTapTarget({ x: foot.screenX, y: foot.screenY - SPRITE_H + 6 }, o);
    expect(hit).toMatchObject({ kind: 'body', id: 'nearer' });
  });

  it('ignores a body whose texture has not loaded for the near-miss box', () => {
    // Rule 1 needs no picture, but rule 2 must not invent one from a zero-sized sprite.
    const foot = isoToScreen(5, 5);
    const o = { ...base, bodies: [{ id: 'ghost', isoX: 5, isoY: 5, spriteWidth: 0, spriteHeight: 0 }] };
    expect(resolveTapTarget({ x: foot.screenX, y: foot.screenY - 30 }, o)).toMatchObject({ kind: 'cell' });
  });

  it('REGRESSION: an interactive place BEHIND a person is still the place', () => {
    // The companion stands at (5,5); the place is two rows back at (7,7), well inside his
    // 48px-tall padded sprite box. Rule 1 must reach it first.
    const o = {
      ...base,
      bodies: [body('michael', 5, 5)],
      places: [{ tag: 'table', cell: '7,7' }],
    };
    const point = centreOf(7, 7);
    // Guard the premise: if this ever stops overlapping, the test stops testing anything.
    const foot = isoToScreen(5, 5);
    expect(point.y).toBeGreaterThan(foot.screenY - SPRITE_H - 8);
    expect(point.y).toBeLessThan(foot.screenY + 8);

    expect(resolveTapTarget(point, o)).toEqual({ kind: 'place', tag: 'table', col: 7, row: 7 });
  });

  it('REGRESSION: plain DECOR behind a person is the decor, not the person', () => {
    // The second half of the same report, and the harder half: most furniture carries no
    // interaction script, so `interactivePlaces` never lists it and rule 1 cannot see it. All
    // that distinguishes it from bare floor is that § 3a made the cell unwalkable.
    const o = {
      ...base,
      bodies: [body('michael', 5, 5)],
      walkable: walkableExcept('7,7'),
    };
    expect(resolveTapTarget(centreOf(7, 7), o)).toEqual({ kind: 'cell', col: 7, row: 7 });
  });

  it('bare floor behind a person still selects the person — Q18 padding survives', () => {
    // The mirror of the case above, and the reason walkability is the right discriminator:
    // nothing is drawn on an empty tile, so a pointer over one behind a character can only
    // have meant the character.
    const o = { ...base, bodies: [body('michael', 5, 5)] };
    expect(resolveTapTarget(centreOf(7, 7), o)).toMatchObject({ kind: 'body', id: 'michael' });
  });

  it('a tile clear of every sprite box is a plain walk', () => {
    const o = { ...base, bodies: [body('michael', 5, 5)] };
    expect(resolveTapTarget(centreOf(9, 9), o)).toEqual({ kind: 'cell', col: 9, row: 9 });
  });

  /**
   * The ink profile, checked at the exact geometry that exposed it.
   *
   * "Get Dinner" stands the companion at (8,11) with tables at (7,11) and (9,11), so the seats
   * across those tables are (6,11) and (10,11) — bare floor, 32 screen pixels to either side of
   * him and only 16 above. The frame rectangle was ±32 wide, so both seats sat exactly on its
   * edge and were answered as "the companion" by the click AND by the hover highlight. The
   * figure drawn at that height is ~11px wide.
   */
  describe('REGRESSION: the seat across the table from a person (2026-09-07)', () => {
    const companion = { ...base, bodies: [body('michael', 8, 11)] };

    it('selects the seat, not the person, on either side', () => {
      expect(resolveTapTarget(centreOf(10, 11), companion)).toEqual({ kind: 'cell', col: 10, row: 11 });
      expect(resolveTapTarget(centreOf(6, 11), companion)).toEqual({ kind: 'cell', col: 6, row: 11 });
    });

    it('premise: those seats really are inside the OLD frame rectangle', () => {
      // Without this the test above could pass for the wrong reason — a fixture that never
      // reached the box in the first place would prove nothing about the profile.
      const foot = isoToScreen(8, 11);
      for (const [col, row] of [[10, 11], [6, 11]] as const) {
        const p = centreOf(col, row);
        expect(Math.abs(p.x - foot.screenX)).toBeLessThanOrEqual(SPRITE_W / 2 + base.padPx);
        expect(p.y).toBeGreaterThanOrEqual(foot.screenY - SPRITE_H - base.padPx);
        expect(p.y).toBeLessThanOrEqual(foot.screenY + base.padPx);
      }
    });

    it('still selects the person when the pointer is on the figure itself', () => {
      // The other half of Q18: the taper narrows the box where the art is narrow, it does not
      // switch the near-miss off. A point up the body's centre line is still him.
      const foot = isoToScreen(8, 11);
      for (const up of [6, 16, 26, 36]) {
        expect(resolveTapTarget({ x: foot.screenX, y: foot.screenY - up }, companion))
          .toMatchObject({ kind: 'body', id: 'michael' });
      }
    });

    it('is narrow at the legs and wider at the shoulders, as the art is', () => {
      // The profile's whole point, asserted as a shape rather than as two magic numbers: the
      // same sideways offset that misses at knee height hits across the shoulders.
      const foot = isoToScreen(8, 11);
      const at = (dx: number, up: number) => resolveTapTarget({ x: foot.screenX + dx, y: foot.screenY - up }, companion);
      expect(at(22, 10)).toMatchObject({ kind: 'cell' });
      expect(at(22, 28)).toMatchObject({ kind: 'body', id: 'michael' });
    });
  });
});
