/**
 * Covers the Night Market CAP DEPRIORITIZATION placement key: a "cap" — a catalog version with
 * exactly ONE anchor, which terminates the road it mates onto — is ranked below every non-cap
 * candidate at the same anchor, and is chosen only when nothing else fits there.
 *
 * The key is applied as the TOP lexicographic key, above duplicate-adjacency, because ending a
 * branch is a structural loss while a same-name neighbor is only cosmetic. Like the duplicate key
 * it FILTERS rather than vetoes, so an anchor whose every legal candidate is a cap still places one
 * (`plan.isCap === true`) instead of failing — "end the road if it's the only option".
 *
 * Exercises server/dal/shared/templatePlacement.ts:
 *   - the pure predicate (`isCapVersion`)
 *   - `planSpawn`'s step-4d ranking key, ordered ABOVE `dupAdjacent`
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**`
 * (vite.config.ts) — same precedent as templateTouchPreference.test.ts.
 *
 * ── The fixture (+col = east, +row = NORTH; local (0,0) = SW corner) ──────────────────────
 * A "ownerA"   3×3 @ (0,0)   street (2,1) → its ONLY anchor: a width-1 EAST mouth at global (2,1).
 * P "throughC" 2×1 @ (3,-1)  a bare (streetless) block of the SAME NAME as the through candidate,
 *                            tucked under the landing rect so the through candidate — and only it —
 *                            scores a duplicate adjacency.
 *
 * Both candidates mate A's east mouth with a width-1 west anchor and land at exactly (3,0):
 *
 *   capC     2×3, street local (0,1) only            ⇒ 1 anchor  (west)        ⇒ CAP,  dupAdj 0
 *   throughC 2×3, street local (0,1)+(1,1) (full row)⇒ 2 anchors (west + east) ⇒ open, dupAdj 1
 *
 * So the two keys DISAGREE: dup prefers capC, cap-ness prefers throughC. throughC must win — that
 * is the whole point of ordering cap-ness above duplicate-adjacency.
 */
import { describe, it, expect } from 'vitest';
import {
  planSpawn,
  deriveAnchors,
  isCapVersion,
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

const ownerA = () => placedOf('ownerA', 0, 0, 3, 3, ['2,1']);
const placedDup = () => placedOf('throughC', 3, -1, 2, 1, []);

const capC = () => catalogOf('capC', 2, 3, ['0,1']);
const throughC = () => catalogOf('throughC', 2, 3, ['0,1', '1,1']);

describe('isCapVersion', () => {
  it('is true for a version whose street mask exposes exactly one anchor', () => {
    expect(isCapVersion(capC())).toBe(true);
  });

  it('is false for a version with a through street (two anchors)', () => {
    expect(throughC().anchors).toHaveLength(2);
    expect(isCapVersion(throughC())).toBe(false);
  });
});

describe('planSpawn — cap-ness outranks duplicate-adjacency', () => {
  it('picks the non-cap candidate even though it is the duplicate-adjacent one', () => {
    const { plan } = planSpawn([ownerA(), placedDup()], [capC(), throughC()], () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('throughC');
    expect(plan!.isCap).toBe(false);
    // ...and it won while carrying the WORSE duplicate count of the two (capC would have been 0).
    expect(plan!.dupAdjacent).toBe(1);
  });

  it('still places a cap when every legal candidate at the anchor is a cap', () => {
    const { plan } = planSpawn([ownerA()], [capC()], () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('capC');
    expect(plan!.isCap).toBe(true);
  });

  it('prefers the non-cap when nothing else distinguishes the two', () => {
    const { plan } = planSpawn([ownerA()], [capC(), throughC()], () => 0);

    expect(plan!.templateName).toBe('throughC');
  });
});
