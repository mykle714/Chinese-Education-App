import { describe, it, expect } from 'vitest';
import { computePoiFromStall, buildPoisFromStalls } from '../../utils/stallPoi';
import type { NightMarketAssetDef, WalkwayDef } from '../../config/nightMarketRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWalkway(id: string, polyline: [[number, number], [number, number]]): WalkwayDef {
  return { walkwayId: id, displayName: id, polyline, traversalKind: 'linear', speedIsoPerSec: 20 };
}

function makeStall(
  id: string,
  isoX: number,
  isoY: number,
  walkwayId: string,
  side: 'north' | 'south',
): NightMarketAssetDef {
  return {
    assetId: id,
    unlockType: 'stall',
    displayName: id,
    description: '',
    layers: [],
    isoX,
    isoY,
    scale: 1,
    frontage: { walkwayId, side },
  };
}

// ---------------------------------------------------------------------------
// computePoiFromStall — t is iso distance from polyline[0]
// ---------------------------------------------------------------------------

describe('computePoiFromStall', () => {
  it('returns null for a stall with no frontage', () => {
    const walkway = makeWalkway('w', [[80, 60], [0, 60]]);
    const stall: NightMarketAssetDef = {
      assetId: 'no-frontage',
      unlockType: 'stall',
      displayName: 'X',
      description: '',
      layers: [],
      isoX: 40,
      isoY: 60,
      scale: 1,
    };
    expect(computePoiFromStall(stall, walkway)).toBeNull();
  });

  it('computes t as iso distance from polyline[0] on a horizontal walkway', () => {
    // polyline[0]=(80,60), polyline[1]=(0,60); stall at isoX=40 → t=|40-80|=40
    const walkway = makeWalkway('wk-market-row', [[80, 60], [0, 60]]);
    const stall = makeStall('s1', 40, 56.5, 'wk-market-row', 'north');
    const poi = computePoiFromStall(stall, walkway)!;
    expect(poi).not.toBeNull();
    expect(poi.t).toBe(40);
  });

  it('computes t as iso distance from polyline[0] on a vertical walkway', () => {
    // polyline[0]=(0,60), polyline[1]=(0,20); stall at isoY=40 → t=|40-60|=20
    const walkway = makeWalkway('wk-south-ext', [[0, 60], [0, 20]]);
    const stall = makeStall('s2', 0, 40, 'wk-south-ext', 'south');
    const poi = computePoiFromStall(stall, walkway)!;
    expect(poi.t).toBe(20);
  });

  it('carries side through to the resulting PoiDef', () => {
    const walkway = makeWalkway('wk-market-row', [[80, 60], [0, 60]]);
    const stallN = makeStall('north-stall', 40, 56.5, 'wk-market-row', 'north');
    const stallS = makeStall('south-stall', 40, 63.5, 'wk-market-row', 'south');
    expect(computePoiFromStall(stallN, walkway)?.side).toBe('north');
    expect(computePoiFromStall(stallS, walkway)?.side).toBe('south');
  });

  it('returns null for a zero-length walkway', () => {
    const walkway = makeWalkway('zero', [[5, 5], [5, 5]]);
    const stall = makeStall('s3', 5, 5, 'zero', 'south');
    expect(computePoiFromStall(stall, walkway)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPoisFromStalls — duplicate guard
// ---------------------------------------------------------------------------

describe('buildPoisFromStalls', () => {
  const walkway = makeWalkway('wk-market-row', [[80, 60], [0, 60]]);
  const walkwayMap = new Map([['wk-market-row', walkway]]);

  it('builds POIs for stalls with frontage', () => {
    const stalls = [
      makeStall('s1', 10, 56.5, 'wk-market-row', 'north'),
      makeStall('s2', 20, 63.5, 'wk-market-row', 'south'),
    ];
    const pois = buildPoisFromStalls(stalls, walkwayMap);
    expect(pois).toHaveLength(2);
  });

  it('skips stalls without frontage', () => {
    const stall: NightMarketAssetDef = {
      assetId: 'no-frontage',
      unlockType: 'stall',
      displayName: 'X',
      description: '',
      layers: [],
      isoX: 40,
      isoY: 60,
      scale: 1,
    };
    const pois = buildPoisFromStalls([stall], walkwayMap);
    expect(pois).toHaveLength(0);
  });

  it('allows two stalls at the same t with different sides (north + south pair)', () => {
    const stalls = [
      makeStall('lotus-tea', 40, 63.5, 'wk-market-row', 'south'),      // t=40
      makeStall('lotus-tea-north', 40, 56.5, 'wk-market-row', 'north'), // t=40
    ];
    // Should NOT throw — sides differ
    expect(() => buildPoisFromStalls(stalls, walkwayMap)).not.toThrow();
    const pois = buildPoisFromStalls(stalls, walkwayMap);
    expect(pois).toHaveLength(2);
    expect(pois.map(p => p.t)).toEqual([40, 40]);
  });

  it('throws in dev when two stalls share the same (walkwayId, t, side)', () => {
    const stalls = [
      makeStall('dup-1', 40, 56.5, 'wk-market-row', 'north'), // t=40 north
      makeStall('dup-2', 40, 56.5, 'wk-market-row', 'north'), // t=40 north — duplicate!
    ];
    expect(() => buildPoisFromStalls(stalls, walkwayMap)).toThrow(/Duplicate POI/);
  });
});
