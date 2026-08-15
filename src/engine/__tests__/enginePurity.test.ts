/**
 * enginePurity.test.ts — asserts the single most valuable structural fact in the
 * codebase: NOTHING under `src/engine/` imports anything outside `src/engine/`.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION (docs/REACT_NATIVE_MIGRATION.md action
 * item 13, docs/FRONTEND_LAYERING.md § "src/engine/ imports nothing outside
 * itself"): the discipline pays out twice — the simulation is portable to any
 * renderer, and it is eligible to move into a Web Worker verbatim — but a leak is
 * INVISIBLE when it happens. Adding `import { something } from 'pixi.js'` to an
 * engine module works perfectly, ships, and silently costs both properties. The
 * first real leak (2026-08-13) was exactly that shape: a `await import('pixi.js')`
 * inside an engine *test*, which no reviewer noticed for months.
 *
 * It replaces the manual grep that docs/REACT_NATIVE_MIGRATION.md § "The Night
 * Market finding" tells you to run, and is stricter than it in three ways the grep
 * could not be: it covers subdirectories and `__tests__`, it catches DYNAMIC
 * `import()` and `require()`, and it fails CI rather than relying on someone
 * remembering to look.
 *
 * If you need a genuinely external dependency in the engine, the answer is almost
 * always to invert it: take the value as a parameter, or move the caller into
 * `src/features/`. Weakening this test is a decision to give up Web Worker
 * eligibility, so make it deliberately.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ENGINE_DIR = path.resolve(__dirname, '..');

/** Every `.ts`/`.tsx` file under src/engine, recursively. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Remove comments before scanning for imports.
 *
 * Without this, a doc comment that merely *mentions* an import — and several in
 * this codebase do, e.g. explaining why `pixi.js/unsafe-eval` is NOT imported
 * here — would fail the test for describing the rule it is documenting.
 *
 * Line comments are only stripped when the `//` starts the line (after optional
 * whitespace), so a `https://` inside a string literal survives intact.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Module specifiers this file imports, by any mechanism:
 *   `import x from 'y'` / `import 'y'` / `export … from 'y'` / `import('y')` / `require('y')`
 */
function importedSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  const patterns = [
    /(?:^|\s)(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g, // named / default / re-export
    /(?:^|\s)import\s*['"]([^'"]+)['"]/g,                        // bare side-effect import
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                    // dynamic import()
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                   // CJS require
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

/** Relative specifiers stay inside the tree; anything else is external. */
function isExternal(spec: string): boolean {
  return !spec.startsWith('.');
}

/**
 * The ONLY external specifiers tolerated, and only inside `__tests__/`: the test
 * harness itself plus Node's own fs/path (this very file needs them to walk the
 * tree).
 *
 * These are exempt because neither property the rule protects is at risk — test
 * files are not bundled into the app and are not part of what would move into a
 * Web Worker or port to another renderer. Everything else stays forbidden in
 * tests, which is what catches the real leak class: the `pixi.js` import that
 * lived in `market/__tests__/pedestrianDepth.test.ts`.
 *
 * ⚠ Do not add a renderer, React, or a DOM shim to this list. If an engine test
 * needs one, the test is verifying the renderer, not the engine — move it to
 * `src/features/…/__tests__/`, as `pedestrianDepthPixi.test.ts` was.
 */
const TEST_ONLY_ALLOWED = new Set(['vitest', 'fs', 'node:fs', 'path', 'node:path']);

function isTestFile(absPath: string): boolean {
  return absPath.split(path.sep).includes('__tests__');
}

describe('src/engine purity', () => {
  const files = collectSourceFiles(ENGINE_DIR);

  it('finds the engine sources (guards against a silently empty scan)', () => {
    // A path change that made collectSourceFiles return [] would turn every
    // assertion below into a vacuous pass — the classic way a rule-enforcing test
    // stops enforcing anything without failing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('imports nothing outside src/engine — no renderer, no React, no npm packages', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const rel = path.relative(ENGINE_DIR, file);
      const allowed = isTestFile(file) ? TEST_ONLY_ALLOWED : new Set<string>();
      for (const spec of importedSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (isExternal(spec) && !allowed.has(spec)) leaks.push(`${rel} → ${spec}`);
      }
    }
    // Listed in the failure message rather than counted, so the fix is obvious.
    expect(leaks).toEqual([]);
  });

  it('never reaches back up into src/features, src/pages or src/hooks', () => {
    // A relative path CAN escape the engine (`../../features/…`). That is a back
    // edge the purity rule forbids just as firmly as an npm import — it would drag
    // React and PIXI in transitively while looking local.
    const backEdges: string[] = [];
    for (const file of files) {
      const rel = path.relative(ENGINE_DIR, file);
      for (const spec of importedSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (isExternal(spec)) continue;
        const resolved = path.resolve(path.dirname(file), spec);
        if (!resolved.startsWith(ENGINE_DIR + path.sep)) backEdges.push(`${rel} → ${spec}`);
      }
    }
    expect(backEdges).toEqual([]);
  });
});
