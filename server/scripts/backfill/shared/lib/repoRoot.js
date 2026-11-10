/**
 * repoRoot.js — the REPO ROOT, resolved for whichever layout the script runs in.
 *
 * ⚠️ PATHS DIFFER BETWEEN HOST AND CONTAINER. On a host checkout the repo root is
 * simply `server/..`. Inside the dev backend container (docker-compose.yml), `server/`
 * is mounted at `/app` and the repo root is mounted SEPARATELY at `/app/project-root`,
 * so `server/..` there is `/` — and a script reading the CLIENT dependency
 * `node_modules/hanzi-writer-data` or a committed `src/` asset from `/` fails.
 * Probe for the container mount first, fall back to the host layout.
 *
 * The lazy-enrichment worker (server/services/LazyEnrichmentService.ts) runs its steps
 * INSIDE the container, so a step that walks up from `__dirname` instead of using this
 * helper crashes on every spawn and never stamps — the word then stays "incomplete"
 * and re-triggers on every validator lookup (docs/DISCOVER_LAZY_ENRICHMENT.md § 5).
 *
 * Used by: chinese/backfill-superposition-groups.js, chinese/generate-stroke-counts.js,
 * chinese/generate-superposition-parts.js, chinese/generate-handwriting-lookup.js,
 * chinese/generate-handwriting-templates.js, chinese/generate-component-font.js.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The container's repo-root mount (docker-compose.yml: `.:/app/project-root`). */
export const CONTAINER_REPO_ROOT = '/app/project-root';

/** server/ — this file lives at server/scripts/backfill/shared/lib. */
export const SERVER_DIR = path.resolve(__dirname, '..', '..', '..', '..');

/** The repo root: the container mount when present, else the host's `server/..`. */
export const REPO_ROOT = fs.existsSync(CONTAINER_REPO_ROOT)
  ? CONTAINER_REPO_ROOT
  : path.resolve(SERVER_DIR, '..');
