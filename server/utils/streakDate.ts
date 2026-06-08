/**
 * Streak-day helpers (server entry point).
 *
 * The implementation now lives in ../shared/streakDay.ts so it can be shared,
 * verbatim, with the browser client (src/utils/streakDay.ts) — guaranteeing the
 * 4 AM streak-day boundary can never drift between the two layers. This file is
 * kept as a stable import path for existing server code.
 */
export * from '../shared/streakDay.js';
