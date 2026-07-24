/**
 * Covers the Night Market VARIETY rule (docs/NIGHT_MARKET_TEMPLATES.md § "No repeated neighbours"):
 * a spawned template should not land flush against an already-placed template of the SAME NAME.
 * Exercises both halves of server/dal/shared/templatePlacement.ts:
 *   - `sharesSeam` / `sharesSeamWithSameTemplate` (the pure adjacency predicate)
 *   - `planSpawn`'s soft preference (repeats sorted last, taken only when nothing else fits)
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**`
 * (vite.config.ts) — same precedent as continentSeal.test.ts.
 *
 * ── The fixture ────────────────────────────────────────────────────────────────────────
 * All templates are 3×3 with a vertical street down the middle column ((1,0),(1,1),(1,2)), so each
 * exposes a width-1 anchor on both its north and south edge and any two of them mate. `crossA` and
 * `crossB` are geometrically IDENTICAL and differ only by name — so whichever the planner picks, it
 * picked it for the name, which is exactly what this rule is about.
 */
import { describe, it, expect } from 'vitest';
import {
  planSpawn,
  deriveAnchors,
  sharesSeam,
  sharesSeamWithSameTemplate,
  type PlacedTemplate,
  type CatalogVersion,
  type CandidatePlacement,
} from '../../server/dal/shared/templatePlacement';

const CROSS_STREET = ['1,0', '1,1', '1,2'];

const placedOf = (templateName: string, offsetCol: number, offsetRow: number): PlacedTemplate => ({
  id: `${templateName}@${offsetCol},${offsetRow}`,
  templateName,
  activeVersion: 0,
  offsetCol,
  offsetRow,
  width: 3,
  height: 3,
  street: new Set(CROSS_STREET),
});

const catalogOf = (templateName: string): CatalogVersion => ({
  templateName,
  version: 0,
  width: 3,
  height: 3,
  street: new Set(CROSS_STREET),
  anchors: deriveAnchors(new Set(CROSS_STREET), 3, 3),
});

const candidateOf = (templateName: string, offsetCol: number, offsetRow: number): CandidatePlacement => ({
  templateName,
  version: 0,
  offsetCol,
  offsetRow,
  width: 3,
  height: 3,
  street: new Set(CROSS_STREET),
});

describe('sharesSeam', () => {
  const base = placedOf('crossA', 0, 0); // occupies cols 0..2, rows 0..2

  it('is true for flush rectangles whose extents overlap', () => {
    expect(sharesSeam(base, placedOf('x', 0, 3))).toBe(true); // directly north
    expect(sharesSeam(base, placedOf('x', 3, 0))).toBe(true); // directly east
    expect(sharesSeam(base, placedOf('x', 0, -3))).toBe(true); // directly south
    expect(sharesSeam(base, placedOf('x', 2, 3))).toBe(true); // north, overlapping by 1 column
  });

  it('is false for diagonal corner contact (the ranges meet at a point, not a cell pair)', () => {
    expect(sharesSeam(base, placedOf('x', 3, 3))).toBe(false);
    expect(sharesSeam(base, placedOf('x', -3, -3))).toBe(false);
  });

  it('is false for separated rectangles', () => {
    expect(sharesSeam(base, placedOf('x', 0, 4))).toBe(false);
    expect(sharesSeam(base, placedOf('x', 9, 0))).toBe(false);
  });
});

describe('sharesSeamWithSameTemplate', () => {
  const placed = [placedOf('crossA', 0, 0)];

  it('flags a same-name candidate that abuts', () => {
    expect(sharesSeamWithSameTemplate(candidateOf('crossA', 0, 3), placed)).toBe(true);
  });

  it('ignores a different-name candidate on the same seam', () => {
    expect(sharesSeamWithSameTemplate(candidateOf('crossB', 0, 3), placed)).toBe(false);
  });

  it('ignores a same-name candidate that only touches at a corner', () => {
    expect(sharesSeamWithSameTemplate(candidateOf('crossA', 3, 3), placed)).toBe(false);
  });
});

describe('planSpawn — variety preference', () => {
  const placed = [placedOf('crossA', 0, 0)];

  it('prefers a differently-named template over repeating the neighbour', () => {
    // `crossA` is index 0 in the catalog and the rng always picks the first survivor, so a planner
    // without the rule would return crossA here.
    const { plan } = planSpawn(placed, [catalogOf('crossA'), catalogOf('crossB')], () => 0);
    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('crossB');
    expect(plan!.repeatsNeighbor).toBe(false);
  });

  it('still repeats when NO anchor offers an alternative (soft rule, never a stall)', () => {
    // A lone crossA and a catalog of nothing but crossA: both of its anchors can only repeat, so
    // the deferred fallback is used and growth continues.
    const { plan } = planSpawn(placed, [catalogOf('crossA')], () => 0);
    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('crossA');
    expect(plan!.repeatsNeighbor).toBe(true);
    // The fallback keeps the closest-anchor ordering: crossA's south edge (dist 1) beats its north.
    expect([plan!.offsetCol, plan!.offsetRow]).toEqual([0, -3]);
  });

  it('skips a nearer anchor whose only winner would repeat, in favour of a further clean one', () => {
    // Corridor crossA(0,0) — crossB(0,3), catalog = crossA only. The CLOSEST anchor is crossA's
    // south edge (dist 1), but landing there puts crossA beside crossA; the north end of crossB
    // (dist 6) takes the same template with only crossB as a neighbour, so it wins instead.
    const corridor = [placedOf('crossA', 0, 0), placedOf('crossB', 0, 3)];
    const { plan } = planSpawn(corridor, [catalogOf('crossA')], () => 0);
    expect(plan).not.toBeNull();
    expect(plan!.repeatsNeighbor).toBe(false);
    expect([plan!.offsetCol, plan!.offsetRow]).toEqual([0, 6]);
  });

  it('reports the demoted repeats in the trace', () => {
    const events: string[] = [];
    planSpawn(placed, [catalogOf('crossA'), catalogOf('crossB')], () => 0, undefined, (e) => {
      if (e.type === 'anchor-winner') {
        events.push(`repeats=${e.repeatingCandidates} forced=${e.repeatForced}`);
      }
    });
    expect(events).toContain('repeats=1 forced=false');
  });
});
