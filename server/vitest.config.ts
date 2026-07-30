import { defineConfig } from 'vitest/config';

/**
 * Server test configuration.
 *
 * Scope: PURE functions only, for now. Nothing here touches PostgreSQL — the suite
 * must run with no database, no env file and no network, so it can gate a commit.
 * DAL/service tests need a fixture database and are a separate, later concern.
 *
 * `alias` maps the `.js` specifiers the server source uses (required by its NodeNext
 * module resolution) onto the `.ts` files on disk, which is what Vite must load.
 * Without it, `import ... from '../contracts/wire.js'` fails to resolve under test.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 7.
 */
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: [
      // Rewrite any relative '.js' import to its '.ts' source. Anchored on a
      // leading './' or '../' so package specifiers (e.g. 'node:fs') are untouched.
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1.ts' },
    ],
  },
});
