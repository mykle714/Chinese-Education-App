import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Server test configuration.
 *
 * Scope: PURE functions only, for now. Nothing here touches PostgreSQL — the suite
 * must run with no database, no env file and no network, so it can gate a commit.
 * DAL/service tests need a fixture database and are a separate, later concern.
 *
 * The server's NodeNext module resolution means its TypeScript sources import each
 * other with a `.js` extension (`from '../contracts/wire.js'`) even though only the
 * `.ts` exists on disk, so Vite must be taught to follow that. This used to be a blunt
 * `resolve.alias` rewriting EVERY relative `.js` specifier to `.ts` — which made the
 * server's genuine plain-JS modules (the whole `scripts/backfill/` tree) untestable:
 * importing one rewrote it to a `.ts` that does not exist, and the failure surfaced as
 * "Cannot find module" pointing at a file plainly sitting on disk.
 *
 * The plugin below rewrites only when the `.ts` twin ACTUALLY EXISTS, so a real `.js`
 * module resolves to itself. See docs/ARCHITECTURE_REVIEW.md finding 7.
 */
const resolveNodeNextJs = {
  name: 'resolve-nodenext-js-to-ts',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (!importer) return null;
    if (!/^\.{1,2}\//.test(source) || !source.endsWith('.js')) return null;
    const ts = path.resolve(path.dirname(importer), source.slice(0, -3) + '.ts');
    return existsSync(ts) ? ts : null; // null → let Vite resolve the real .js
  },
};

export default defineConfig({
  plugins: [resolveNodeNextJs],
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
