/**
 * Covers the Night Market ANCHOR FLANK BAN: a still-open street mouth (an exposed anchor) may
 * never run flush alongside another template's outer edge. Formally — step one cell along the
 * anchor's outward normal, then one cell "left" and one cell "right" along the edge axis; those
 * two diagonal cells must be void.
 *
 * Exercises both halves of server/dal/shared/templatePlacement.ts:
 *   - the pure geometry (`anchorFlankCells`, `flankedAnchorKeys`)
 *   - `planSpawn`'s step-4a candidate veto + the `anchor-all-candidates-flank` failure reason
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**`
 * (vite.config.ts) — same precedent as continentSeal.test.ts, which also imports the server
 * mirrors.
 *
 * ── The fixture ────────────────────────────────────────────────────────────────────────
 * A "mouthA"  4×3 @ (0,0)  street (1,0)(1,1)(1,2)(2,2) → a WIDTH-2 north mouth at global cols
 *                          1–2, row 2, plus a width-1 south mouth at col 1.
 * B "stubB"   3×3 @ (4,0)  street (1,2)              → a width-1 north mouth at global col 5.
 * C "hookC"   4×3 catalog  street (2,0)(2,1)         → a width-1 SOUTH anchor at local col 2;
 *                          its only anchor, so C contributes no open mouth of its own once mated.
 *
 * Mating C to B's north mouth pins C at (3,3) — which lands C's west column on cell (3,3), the
 * east flank of A's still-open north mouth. That is the banned configuration: A's road would run
 * flush along C's west face.
 */
import { describe, it, expect } from 'vitest';
import {
  planSpawn,
  deriveAnchors,
  exposedAnchors,
  anchorFlankCells,
  flankedAnchorKeys,
  type PlacedTemplate,
  type CatalogVersion,
} from '../../server/dal/shared/templatePlacement';

const placedOf = (
  templateName: string,
  offsetCol: number,
  offsetRow: number,
  width: number,
  height: number,
  street: string[],
): PlacedTemplate => ({
  id: `${templateName}@${offsetCol},${offsetRow}`,
  templateName,
  activeVersion: 0,
  offsetCol,
  offsetRow,
  width,
  height,
  street: new Set(street),
});

const catalogOf = (
  templateName: string,
  width: number,
  height: number,
  street: string[],
): CatalogVersion => ({
  templateName,
  version: 0,
  width,
  height,
  street: new Set(street),
  anchors: deriveAnchors(new Set(street), width, height),
});

/** A with a north mouth; the variant `mouthlessA` drops the mouth (street stops short of row 2). */
const mouthA = () => placedOf('mouthA', 0, 0, 4, 3, ['1,0', '1,1', '1,2', '2,2']);
const mouthlessA = () => placedOf('mouthA', 0, 0, 4, 3, ['1,0', '1,1']);
const stubB = () => placedOf('stubB', 4, 0, 3, 3, ['1,2']);
/** The candidate whose only anchor is a width-1 south run at local col 2. */
const hookC = () => catalogOf('hookC', 4, 3, ['2,0', '2,1']);
/** A second catalog entry with a width-1 NORTH anchor — mates A's south mouth instead. */
const capN4 = () => catalogOf('capN4', 4, 3, ['1,2']);

describe('anchorFlankCells', () => {
  it('returns the two diagonal cells just off each end of the mouth', () => {
    const north = exposedAnchors([mouthA()]).find((a) => a.edge === 'n')!;
    // Mouth = global cols 1–2 on row 2, facing north ⇒ outward row 3, ends at cols 0 and 3.
    expect(north.width).toBe(2);
    expect(anchorFlankCells(north).sort()).toEqual(
      [
        [0, 3],
        [3, 3],
      ].sort(),
    );
  });

  it('mirrors the geometry on an east-facing mouth (flanks vary by row)', () => {
    // A width-1 east mouth at local (2,1) of a 3×3 ⇒ global col 2, row 1; outward col 3.
    const east = exposedAnchors([placedOf('eastMouth', 0, 0, 3, 3, ['2,1'])]).find((a) => a.edge === 'e')!;
    expect(anchorFlankCells(east).sort()).toEqual(
      [
        [3, 0],
        [3, 2],
      ].sort(),
    );
  });
});

describe('flankedAnchorKeys', () => {
  it('is empty when every open mouth faces void', () => {
    expect(flankedAnchorKeys([mouthA(), stubB()]).size).toBe(0);
  });

  it('flags a mouth whose flank cell is occupied', () => {
    // hookC placed at (3,3) covers (3,3) — the east flank of A's north mouth — without covering
    // the mouth's own outward cells (1,3)/(2,3), so the mouth stays open AND flanked.
    const flanked = flankedAnchorKeys([
      mouthA(),
      stubB(),
      placedOf('hookC', 3, 3, 4, 3, ['2,0', '2,1']),
    ]);
    expect([...flanked]).toEqual(['n:2:1:2']); // edge:crossLine:alongStart:width
  });
});

describe('planSpawn — flank veto', () => {
  it('refuses the only candidate — and says why — when it would flank an open mouth', () => {
    const { plan, failures } = planSpawn([mouthA(), stubB()], [hookC()], () => 0);

    expect(plan).toBeNull();
    const flankFailure = failures.find((f) => f.reason === 'anchor-all-candidates-flank');
    expect(flankFailure).toBeDefined();
    expect(flankFailure!.flankedCandidates).toBe(1);
  });

  it('places the same candidate once the flanked mouth is gone', () => {
    // Identical geometry, except A's street stops short of its north edge — no open mouth for C
    // to flank, so the (3,3) placement is allowed.
    const { plan } = planSpawn([mouthlessA(), stubB()], [hookC()], () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('hookC');
    expect([plan!.offsetCol, plan!.offsetRow]).toEqual([3, 3]);
  });

  it('does not deadlock on a PRE-EXISTING violation — only NEW flanks veto', () => {
    // A world persisted before the ban: hookC already sits at (3,3), flanking A's north mouth.
    // A candidate that introduces no new flank must still place (here: capN4 onto A's south mouth).
    const world = [mouthA(), stubB(), placedOf('hookC', 3, 3, 4, 3, ['2,0', '2,1'])];
    expect(flankedAnchorKeys(world).size).toBe(1); // the pre-existing violation

    const { plan } = planSpawn(world, [capN4()], () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('capN4');
    expect([plan!.offsetCol, plan!.offsetRow]).toEqual([0, -3]);
  });
});
