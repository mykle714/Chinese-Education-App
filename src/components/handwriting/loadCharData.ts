/**
 * Local-first character-data loader for Hanzi Writer.
 *
 * Hanzi Writer defaults to fetching stroke data from a CDN. Per
 * docs/HANDWRITING_RECOGNITION.md we prefer the bundled `hanzi-writer-data`
 * package so the grey guide has no external runtime dependency, falling back to
 * the CDN only if the local import fails (e.g. a character not in the package).
 *
 * Shape matches Hanzi Writer's `charDataLoader(char, onComplete, onError)`.
 */
import type { CharDataLoaderFn } from "hanzi-writer";

const CDN_BASE = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest";

// Typed as Hanzi Writer's own CharDataLoaderFn (char, onLoad, onError).
export const loadCharData: CharDataLoaderFn = (char, onComplete, onError) => {
  // Vite turns this template-literal dynamic import into per-character chunks.
  import(`hanzi-writer-data/${char}.json`)
    .then((mod) => onComplete(mod.default ?? mod))
    .catch(() => {
      // Local miss → CDN fallback so a rare/missing glyph still renders.
      fetch(`${CDN_BASE}/${char}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`CDN HTTP ${res.status}`);
          return res.json();
        })
        .then(onComplete)
        .catch((err) => onError(err));
    });
};
