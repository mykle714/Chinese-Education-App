import { describe, it, expect, vi } from 'vitest';
import { WeatherService, weatherFromWmoCode, type FetchLike } from '../services/WeatherService.js';
import { geohashCenter } from '../utils/geohashCenter.js';

/**
 * WeatherService + geohashCenter (docs/DECK_TOWER.md § "Weather").
 */

const okFetch = (code: number, cloud = 50): FetchLike =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ current: { weather_code: code, cloud_cover: cloud } }) }));

describe('geohashCenter', () => {
  it('decodes a known cell to its centre', () => {
    // "u4pru" covers part of Jutland, Denmark (the geohash Wikipedia example "u4pruydqqvj").
    const c = geohashCenter('u4pru');
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(57.65, 1);
    expect(c!.lon).toBeCloseTo(10.41, 1);
  });

  it('rejects characters outside the alphabet', () => {
    expect(geohashCenter('u4pra')).toBeNull();
    expect(geohashCenter('')).toBeNull();
  });
});

describe('weatherFromWmoCode', () => {
  it('folds the WMO families into kinds', () => {
    expect(weatherFromWmoCode(0, 0).kind).toBe('clear');
    expect(weatherFromWmoCode(3, 100)).toEqual({ kind: 'cloudy', intensity: 1, wmoCode: 3, cloudCover: 1 });
    expect(weatherFromWmoCode(45, null).kind).toBe('fog');
    expect(weatherFromWmoCode(53, null).kind).toBe('drizzle');
    expect(weatherFromWmoCode(82, null)).toEqual({ kind: 'rain', intensity: 1, wmoCode: 82, cloudCover: null });
    expect(weatherFromWmoCode(73, null).kind).toBe('snow');
    expect(weatherFromWmoCode(99, null).kind).toBe('storm');
  });

  it('reads an unknown code as clear', () => {
    expect(weatherFromWmoCode(12345, 80).kind).toBe('clear');
  });
});

describe('WeatherService', () => {
  it('answers no-location without calling upstream when no cell is stored', async () => {
    const fetchFn = okFetch(61);
    const svc = new WeatherService({ getGeoCell: async () => null }, fetchFn);
    expect(await svc.weatherFor('u1')).toEqual({ status: 'no-location' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('caches one reading per cell and shares it between users', async () => {
    const fetchFn = okFetch(63);
    const svc = new WeatherService({ getGeoCell: async () => 'dr5ru' }, fetchFn);
    const a = await svc.weatherFor('u1');
    const b = await svc.weatherFor('u2');
    expect(a).toEqual({ status: 'ok', weather: { kind: 'rain', intensity: 0.65, wmoCode: 63, cloudCover: 0.5 } });
    expect(b).toEqual(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the reading is stale', async () => {
    let t = 0;
    const fetchFn = okFetch(0);
    const svc = new WeatherService({ getGeoCell: async () => 'dr5ru' }, fetchFn, () => t);
    await svc.weatherFor('u1');
    t = 31 * 60_000;
    await svc.weatherFor('u1');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses into one request', async () => {
    const fetchFn = okFetch(0);
    const svc = new WeatherService({ getGeoCell: async () => 'dr5ru' }, fetchFn);
    await Promise.all([svc.weatherFor('u1'), svc.weatherFor('u2'), svc.weatherFor('u3')]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable on upstream failure and backs off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t = 0;
    const fetchFn: FetchLike = vi.fn(async () => { throw new Error('boom'); });
    const svc = new WeatherService({ getGeoCell: async () => 'dr5ru' }, fetchFn, () => t);
    expect(await svc.weatherFor('u1')).toEqual({ status: 'unavailable' });
    t = 60_000; // inside the retry window
    await svc.weatherFor('u1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t = 6 * 60_000; // past it
    await svc.weatherFor('u1');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
