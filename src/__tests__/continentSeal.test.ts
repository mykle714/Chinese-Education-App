/**
 * Covers the Night Market GROWTH-SAFETY invariant: a template placement may never leave the
 * continent SEALED (zero open border-street conditions across every placement's FINAL rendered
 * version). Exercises both halves:
 *   - server/dal/shared/continentSeal.ts   (the version-resimulating detector)
 *   - server/dal/shared/templatePlacement.ts (planSpawn's `sealCheck` veto + failure reason)
 *
 * Lives under `src/__tests__` because the vitest `include` glob only spans `src/**` (vite.config.ts)
 * — same precedent as placeholderAreaSync.test.ts, which also imports the server mirrors.
 *
 * ── The fixture ────────────────────────────────────────────────────────────────────────
 * All templates are 3×3 (so every border cell sits on exactly ONE outer edge — no corner
 * ambiguity) with a vertical street down the middle column:
 *   cross → street (1,0),(1,1),(1,2)  ⇒ border-street islands on BOTH the south and north edges
 *   capS  → street (1,0),(1,1)        ⇒ a single border-street island on the SOUTH edge
 *   capN  → street (1,1),(1,2)        ⇒ a single border-street island on the NORTH edge
 * A cap therefore consumes one open stub and contributes none of its own — two caps around a
 * cross is the canonical sealed continent.
 */
import { describe, it, expect } from 'vitest';
import {
  openStreetConditions,
  sealsContinent,
  type SealPlacement,
} from '../../server/dal/shared/continentSeal';
import {
  planSpawn,
  deriveAnchors,
  type PlacedTemplate,
  type CatalogVersion,
} from '../../server/dal/shared/templatePlacement';

const STREETS: Record<string, string[]> = {
  cross: ['1,0', '1,1', '1,2'],
  capS: ['1,0', '1,1'],
  capN: ['1,1', '1,2'],
};

/** A 3×3 single-version placement of one fixture template at an offset. */
function seal(templateName: keyof typeof STREETS | string, offsetCol: number, offsetRow: number): SealPlacement {
  return {
    key: `${templateName}@${offsetCol},${offsetRow}`,
    templateName,
    offsetCol,
    offsetRow,
    width: 3,
    height: 3,
    placeholderAreas: [],
    versions: [{ version: 0, street: new Set(STREETS[templateName]), condition: new Set<string>() }],
    availableVersions: [0],
    filledPlaceholderIds: new Set<string>(),
  };
}

describe('openStreetConditions', () => {
  it('reports both stubs of a lone cross (nothing abuts it)', () => {
    const open = openStreetConditions([seal('cross', 0, 0)]);
    expect(open).toHaveLength(2);
    expect(open.every((o) => o.templateName === 'cross')).toBe(true);
  });

  it('drops a stub once a neighbour abuts that edge', () => {
    // capS sits north of the cross and mates with its north stub; the cross's SOUTH stub and
    // nothing else remains open (capS's own street reaches only its south edge).
    const open = openStreetConditions([seal('cross', 0, 0), seal('capS', 0, 3)]);
    expect(open).toHaveLength(1);
    expect(open[0].templateName).toBe('cross');
  });
});

describe('sealsContinent', () => {
  it('is false while any stub is still open', () => {
    expect(sealsContinent([seal('cross', 0, 0)])).toBe(false);
    expect(sealsContinent([seal('cross', 0, 0), seal('capS', 0, 3)])).toBe(false);
  });

  it('is true when caps close every stub', () => {
    expect(sealsContinent([seal('capN', 0, -3), seal('cross', 0, 0), seal('capS', 0, 3)])).toBe(true);
  });
});

describe('planSpawn — seal veto', () => {
  /** The same fixture as a placed/catalog template for the geometry engine. */
  const placedOf = (name: string, offsetCol: number, offsetRow: number): PlacedTemplate => ({
    id: `${name}@${offsetCol},${offsetRow}`,
    templateName: name,
    activeVersion: 0,
    offsetCol,
    offsetRow,
    width: 3,
    height: 3,
    street: new Set(STREETS[name]),
  });

  const catalogOf = (name: string): CatalogVersion => ({
    templateName: name,
    version: 0,
    width: 3,
    height: 3,
    street: new Set(STREETS[name]),
    anchors: deriveAnchors(new Set(STREETS[name]), 3, 3),
  });

  // World with exactly ONE open stub (the cross's south edge) and a catalog whose only match is
  // the cap that would close it — i.e. every legal placement seals the continent.
  const placed = [placedOf('cross', 0, 0), placedOf('capS', 0, 3)];
  const catalog = [catalogOf('capN')];

  it('places the sealing candidate when no guard is supplied (pre-constraint behaviour)', () => {
    const { plan } = planSpawn(placed, catalog, () => 0);
    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('capN');
    expect([plan!.offsetCol, plan!.offsetRow]).toEqual([0, -3]);
  });

  it('refuses the placement — and says why — when the guard is supplied', () => {
    const sealCheck = (candidate: { templateName: string; offsetCol: number; offsetRow: number }) =>
      sealsContinent([
        seal('cross', 0, 0),
        seal('capS', 0, 3),
        seal(candidate.templateName, candidate.offsetCol, candidate.offsetRow),
      ]);

    const { plan, failures } = planSpawn(placed, catalog, () => 0, sealCheck);
    expect(plan).toBeNull();
    const sealFailure = failures.find((f) => f.reason === 'anchor-all-candidates-seal');
    expect(sealFailure).toBeDefined();
    expect(sealFailure!.sealedCandidates).toBe(1);
  });

  it('still places a candidate that leaves a stub open', () => {
    // A second cross keeps growing the corridor: it closes the south stub but opens its own.
    const { plan } = planSpawn(placed, [catalogOf('cross')], () => 0, (candidate) =>
      sealsContinent([
        seal('cross', 0, 0),
        seal('capS', 0, 3),
        seal(candidate.templateName, candidate.offsetCol, candidate.offsetRow),
      ]),
    );
    expect(plan).not.toBeNull();
    expect(plan!.templateName).toBe('cross');
  });
});
