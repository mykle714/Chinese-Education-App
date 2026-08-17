import { describe, it, expect } from 'vitest';
import { encodeGeohash, toGeoCell, isValidGeoCell, GEOCELL_LENGTH } from '../utils/geohash';

/**
 * Geohash encoding (docs/ARENA_FEATURE.md § 5.2).
 *
 * Checked against published reference values, because a subtly wrong encoder is
 * the worst possible failure here: it produces PLAUSIBLE strings that cluster
 * nonsense, and nothing downstream can detect it. Every assertion below is a
 * coordinate whose geohash is independently documented.
 */

describe('encodeGeohash — reference values', () => {
  const cases: [string, number, number, string][] = [
    // [place, lat, lon, expected 5-char cell]
    ['Trafalgar Square, London', 51.5080, -0.1281, 'gcpvj'],
    ['Empire State Building, NYC', 40.7484, -73.9857, 'dr5ru'],
    ['Sydney Opera House', -33.8568, 151.2153, 'r3gx2'],
    ['Tokyo Tower', 35.6586, 139.7454, 'xn76g'],
    ['Null Island', 0, 0, 's0000'],
  ];

  it.each(cases)('%s', (_place, lat, lon, expected) => {
    expect(encodeGeohash(lat, lon, 5)).toBe(expected);
  });

  it('extends rather than changes as precision grows', () => {
    // A geohash is a prefix code: more precision refines the same cell, it never
    // relocates it. This is the property the whole clustering scheme rests on.
    const full = encodeGeohash(51.5080, -0.1281, 9);
    for (let p = 1; p <= 9; p++) {
      expect(encodeGeohash(51.5080, -0.1281, p)).toBe(full.slice(0, p));
    }
  });
});

describe('locality — the property clustering depends on', () => {
  it('gives nearby points a shared prefix', () => {
    // Two points ~1km apart in central London.
    const a = encodeGeohash(51.5080, -0.1281, 5);
    const b = encodeGeohash(51.5145, -0.1270, 5);
    expect(a.slice(0, 3)).toBe(b.slice(0, 3));
  });

  it('gives distant points no shared prefix', () => {
    const london = encodeGeohash(51.5080, -0.1281, 5);
    const tokyo = encodeGeohash(35.6586, 139.7454, 5);
    expect(london[0]).not.toBe(tokyo[0]);
  });

  it('places Detroit and Windsor in the same neighbourhood', () => {
    // The example the design uses to reject country-based clustering: these are
    // ~3km apart across an international border.
    const detroit = encodeGeohash(42.3314, -83.0458, 5);
    const windsor = encodeGeohash(42.3149, -83.0364, 5);
    expect(detroit.slice(0, 3)).toBe(windsor.slice(0, 3));
  });

  it('separates Vancouver from Halifax despite one country', () => {
    const vancouver = encodeGeohash(49.2827, -123.1207, 5);
    const halifax = encodeGeohash(44.6488, -63.5752, 5);
    expect(vancouver[0]).not.toBe(halifax[0]);
  });
});

describe('toGeoCell — the privacy contract', () => {
  it('always returns exactly the stored precision', () => {
    const samples: [number, number][] = [
      [51.5080, -0.1281], [-33.8568, 151.2153], [0, 0],
      [89.9, 179.9], [-89.9, -179.9], [35.6586, 139.7454],
    ];
    for (const [lat, lon] of samples) {
      expect(toGeoCell(lat, lon)).toHaveLength(GEOCELL_LENGTH);
    }
  });

  it('discards precision the platform gave us — the whole point', () => {
    // Two addresses a few hundred metres apart must collapse to the same cell,
    // or the stored value would be able to name a home rather than an area.
    expect(toGeoCell(51.5080, -0.1281)).toBe(toGeoCell(51.5085, -0.1279));
  });
});

describe('input validation', () => {
  it('rejects out-of-range coordinates instead of emitting a bogus cell', () => {
    expect(() => encodeGeohash(91, 0)).toThrow(/latitude/);
    expect(() => encodeGeohash(-91, 0)).toThrow(/latitude/);
    expect(() => encodeGeohash(0, 181)).toThrow(/longitude/);
    expect(() => encodeGeohash(0, -181)).toThrow(/longitude/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => encodeGeohash(NaN, 0)).toThrow(/finite/);
    expect(() => encodeGeohash(0, Infinity)).toThrow(/finite/);
  });

  it('accepts the exact poles and antimeridian', () => {
    expect(() => encodeGeohash(90, 180)).not.toThrow();
    expect(() => encodeGeohash(-90, -180)).not.toThrow();
  });
});

describe('isValidGeoCell — mirrors the server CHECK', () => {
  it('accepts a well-formed cell', () => {
    expect(isValidGeoCell('gcpvj')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidGeoCell('gcpv')).toBe(false);
    expect(isValidGeoCell('gcpvj0')).toBe(false);
  });

  it('rejects characters outside the geohash alphabet', () => {
    // a, i, l and o are excluded from base32 geohash.
    expect(isValidGeoCell('gcpva')).toBe(false);
    expect(isValidGeoCell('gcpvi')).toBe(false);
    expect(isValidGeoCell('gcpvl')).toBe(false);
    expect(isValidGeoCell('gcpvo')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidGeoCell(null)).toBe(false);
    expect(isValidGeoCell(12345)).toBe(false);
    expect(isValidGeoCell(undefined)).toBe(false);
  });
});
