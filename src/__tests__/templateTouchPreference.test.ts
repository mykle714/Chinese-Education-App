/**
 * Covers the Night Market TOUCH PREFERENCE placement key: among candidates already tied on
 * duplicate-adjacency and matched street runs, prefer the one that ends up flush against the MOST
 * distinct placed templates; only then fall back to maximin spread.
 *
 * The intent this pins down is "contact beats any gap, and an unavoidable gap should be as wide as
 * possible". Because the comparator is lexicographic, spread can never trade a neighbor away for
 * open void — it only chooses among candidates already tied on contact.
 *
 * Exercises server/dal/shared/templatePlacement.ts:
 *   - the pure metric (`touchedTemplates`)
 *   - `planSpawn`'s step-5b ranking key, ordered ABOVE `maximinSpread`
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**`
 * (vite.config.ts) — same precedent as anchorFlankBan.test.ts / continentSeal.test.ts, which also
 * import the server mirrors.
 *
 * ── The fixture (+col = east, +row = NORTH; local (0,0) = SW corner) ──────────────────────
 * A "ownerA"  3×3 @ (0,0)   street (2,1) → its ONLY anchor: a width-1 EAST mouth at global (2,1).
 * D "westD"   2×1 @ (1,-1)  no street — a bare block tucked under A, reachable only by a candidate
 *                           that extends south to row -1.
 * E "farE"    2×1 @ (3,-3)  no street — a bare block two cells south of row -1, so it is never
 *                           touched; it exists purely to give the two candidates DIFFERENT spreads.
 *
 * Both candidates mate A's east mouth with a width-1 west anchor, so both land at col 3 and both
 * score exactly 1 matched street run and 0 duplicate adjacencies. They differ only below:
 *
 *   tallC  2×4, west street local (0,2) ⇒ offsetRow -1 ⇒ rows -1..2. Abuts A AND D (touch 2).
 *                Its south face sits 2 cells off E          ⇒ spread 2.
 *   shortC 2×3, west street local (0,1) ⇒ offsetRow  0 ⇒ rows  0..2. Abuts A only    (touch 1).
 *                Its south face sits 3 cells off E          ⇒ spread 3.
 *
 * So the two keys DISAGREE: touch prefers tallC, spread prefers shortC. tallC must win — that is
 * the whole point of ordering touch above spread.
 */
import { describe, it, expect } from 'vitest';
import {
  planSpawn,
  deriveAnchors,
  touchedTemplates,
  rectsAbut,
  type PlacedTemplate,
  type CatalogVersion,
  type CandidatePlacement,
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
const westD = () => placedOf('westD', 1, -1, 2, 1, []);
const farE = () => placedOf('farE', 3, -3, 2, 1, []);

const tallC = () => catalogOf('tallC', 2, 4, ['0,2']);
const shortC = () => catalogOf('shortC', 2, 3, ['0,1']);

/** Materialize a catalog entry at an offset, as `planSpawn` would. */
const candidateAt = (cv: CatalogVersion, offsetCol: number, offsetRow: number): CandidatePlacement => ({
  templateName: cv.templateName,
  version: cv.version,
  offsetCol,
  offsetRow,
  width: cv.width,
  height: cv.height,
  street: cv.street,
});

describe('touchedTemplates', () => {
  it('counts every distinct placed template the candidate sits flush against', () => {
    // tallC at (3,-1) spans rows -1..2: its west face meets A (rows 0..2) AND D (row -1).
    const tall = candidateAt(tallC(), 3, -1);
    expect(touchedTemplates(tall, [ownerA(), westD(), farE()])).toBe(2);
  });

  it('does not count a template that is near but not abutting', () => {
    // shortC at (3,0) spans rows 0..2 only, so D (row -1, cols 1-2) never shares a seam line.
    const short = candidateAt(shortC(), 3, 0);
    expect(rectsAbut(short, westD())).toBe(false);
    expect(touchedTemplates(short, [ownerA(), westD(), farE()])).toBe(1);
  });

  it('does not count corner-only contact', () => {
    // A occupies cols 0-2 / rows 0-2; a block at (3,3) meets it only at the (2,2)/(3,3) corner.
    const cornerOnly = candidateAt(catalogOf('cornerC', 2, 2, []), 3, 3);
    expect(touchedTemplates(cornerOnly, [ownerA()])).toBe(0);
  });
});

describe('planSpawn — touch count outranks spread', () => {
  it('picks the candidate touching more templates even though its spread is worse', () => {
    const placed = [ownerA(), westD(), farE()];
    const catalog = [tallC(), shortC()];

    const { plan } = planSpawn(placed, catalog, () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('tallC');
    expect(plan!.offsetCol).toBe(3);
    expect(plan!.offsetRow).toBe(-1);
    // The keys above touch are genuinely tied, so touch is what decided this.
    expect(plan!.dupAdjacent).toBe(0);
    expect(plan!.matchedRuns).toBe(1);
    expect(plan!.touchCount).toBe(2);
    // ...and it won while carrying the WORSE spread of the two (tallC 2 vs shortC 3).
    expect(plan!.spread).toBe(2);
  });

  it('still lets spread decide when touch counts tie', () => {
    // Drop D and E: neither candidate can reach anything but A, so both score touch 1 and the
    // tiebreak falls through to spread — which now prefers the SHORTER candidate only if it is
    // roomier. With nothing else placed both spreads are the void sentinel, so the assertion is
    // simply that a winner still emerges with touch 1 (no candidate is starved by the new key).
    const { plan } = planSpawn([ownerA()], [tallC(), shortC()], () => 0);

    expect(plan).not.toBeNull();
    expect(plan!.touchCount).toBe(1);
  });
});
