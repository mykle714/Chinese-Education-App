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
 * ONE DELIBERATE CARVE-OUT: static ASSET references into `src/assets/`, gated by
 * {@link isAllowedAssetRef}. Added 2026-09-09 alongside the `import.meta.glob` pattern
 * below — which was until then the rule's blind spot. An asset pack pulled in by a glob
 * PATH STRING slipped the scan entirely (that is how `market/freeFarmTileset.ts` has always
 * loaded its ~180 sprites), while a plain `import manifest from '../../assets/….json'` —
 * inert data, and strictly safer for both properties this rule protects — was rejected. The
 * rule was blocking the harmless case and permitting the Vite-coupled one. Both are now
 * scanned, and both are allowed on the same explicit, narrow terms.
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

  // Vite glob (asset packs) — scanned on the RAW source, NOT the comment-stripped copy.
  // A glob path contains `/**/`, and `stripComments`' block-comment regex happily eats that
  // out of the middle of a string literal: `'…/free-farm-assets/**/*.png'` came back as
  // `'…/free-farm-assetsg'`. Scanning raw is safe here because the pattern demands a quoted
  // argument immediately after the call, which prose in a doc comment does not have.
  for (const m of src.matchAll(/\bimport\.meta\.glob\s*\(\s*['"]([^'"]+)['"]/g)) {
    specs.push(m[1]);
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

const ASSETS_DIR = path.resolve(ENGINE_DIR, '../assets');

/**
 * File extensions an engine module may reference out of `src/assets/`: images, fonts, and the
 * generated JSON manifests that describe them.
 *
 * Extension-gated on purpose. `src/assets/` holds DATA, and data cannot drag in a renderer,
 * React, or the DOM — neither property this rule protects (renderer portability, Web-Worker
 * eligibility) is touched by a sprite URL or a manifest of tile footprints. An arbitrary
 * `.ts`/`.tsx` under that folder could carry anything, so it stays forbidden.
 */
const ALLOWED_ASSET_EXT = /\.(png|webp|jpe?g|svg|json|woff2?)$/;

/**
 * True for a relative specifier that resolves inside `src/assets/` AND names an asset/data file
 * (or a glob whose pattern ends in one). Two engine modules rely on it: `market/freeFarmTileset`
 * and `market/lumeishTileset` glob their sprite URLs, and the latter also statically imports
 * `lumeishManifest.json`.
 *
 * ⚠ NOT a general "engine may reach outside itself" escape hatch. It admits exactly one
 * directory and one set of extensions; `src/features`, `src/pages`, `src/hooks`, npm packages
 * and any `.ts` under assets all still fail, which is the entire point of the rule.
 */
function isAllowedAssetRef(fromFile: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), spec);
  if (!resolved.startsWith(ASSETS_DIR + path.sep)) return false;
  return ALLOWED_ASSET_EXT.test(spec);
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
        if (isAllowedAssetRef(file, spec)) continue; // src/assets data — see isAllowedAssetRef
        const resolved = path.resolve(path.dirname(file), spec);
        if (!resolved.startsWith(ENGINE_DIR + path.sep)) backEdges.push(`${rel} → ${spec}`);
      }
    }
    expect(backEdges).toEqual([]);
  });

  it('keeps the asset carve-out narrow — it must not become a general escape hatch', () => {
    // A file standing in for a real engine module, so the relative specifiers below
    // resolve the way they would from `src/engine/market/`.
    const from = path.join(ENGINE_DIR, 'market', 'someTileset.ts');

    // Allowed: sprite globs and generated manifests under src/assets.
    expect(isAllowedAssetRef(from, '../../assets/free-assets/pack/**/*.png')).toBe(true);
    expect(isAllowedAssetRef(from, '../../assets/test-assets/pack/manifest.json')).toBe(true);

    // Forbidden: code under assets, anything outside assets, and bare packages.
    expect(isAllowedAssetRef(from, '../../assets/pack/index.ts')).toBe(false);
    expect(isAllowedAssetRef(from, '../../features/nightmarket/HouseLayer.tsx')).toBe(false);
    expect(isAllowedAssetRef(from, '../../hooks/useThing.ts')).toBe(false);
    expect(isAllowedAssetRef(from, 'pixi.js')).toBe(false);
    // …including a path that merely starts with the assets dir NAME but escapes it.
    expect(isAllowedAssetRef(from, '../../assets-extra/pack/sprite.png')).toBe(false);
  });
});
