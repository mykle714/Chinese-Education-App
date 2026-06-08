/**
 * Pure utility for computing short definitions from a definitions array.
 * Deterministic — no AI, no DB, no external dependencies.
 *
 * Algorithm:
 * 1. Filter out definitions that are grammatical notes (starting with '(' or 'CL:')
 * 2. Split remaining definitions by '; ' to get individual senses
 * 3. Strip trailing parenthetical content (e.g. "(informal, ...)")
 * 4. Return the shortest surviving token
 * 5. If all definitions were filtered out, fall back to unfiltered tokens
 */
export function generateShortDefinition(definitions: string[]): string | null {
  if (!definitions || definitions.length === 0) {
    return null;
  }

  const candidates: string[] = [];

  for (const def of definitions) {
    // Skip definitions that are purely grammatical notes
    const trimmed = def.trim();
    if (trimmed.startsWith('(') || trimmed.startsWith('CL:')) {
      continue;
    }

    // Split by '; ' to get individual senses
    const senses = trimmed.split('; ');

    for (const sense of senses) {
      // Strip trailing parenthetical content
      const stripped = sense.replace(/ \([^)]+\)$/, '').trim();
      if (stripped.length > 0) {
        candidates.push(stripped);
      }
    }
  }

  // Fall back to unfiltered tokens if all definitions were filtered out
  if (candidates.length === 0) {
    for (const def of definitions) {
      const senses = def.trim().split('; ');
      for (const sense of senses) {
        const stripped = sense.replace(/ \([^)]+\)$/, '').trim();
        if (stripped.length > 0) {
          candidates.push(stripped);
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Return the token with the fewest characters
  return candidates.reduce((shortest, current) =>
    current.length < shortest.length ? current : shortest
  );
}

/**
 * The stored shape of `longDefinition`: a JSONB object keyed by part of speech
 * ({ "noun": "...", "verb": "..." }) as written by backfill-long-definitions.js.
 * Single-POS words store a one-key object.
 */
export type LongDefinitionObject = Record<string, string>;

/**
 * Read boundary for `longDefinition`. The column is JSONB (an object keyed by POS,
 * migration 70) but the rest of the app — longDefinitionParts segmentation, the API
 * payload, and the frontend renderer — consumes a single labeled string. This joins
 * the object back into the canonical "pos: ... \n\n pos: ..." form used before the
 * jsonb migration, so nothing downstream had to change.
 *
 * - Single POS  → the bare value, no label (matches the old single-POS format).
 * - Multiple POS → each sense labeled and separated by a blank line, in object-key
 *   order (the backfill inserts keys primary-POS-first).
 * - Empty values are dropped; an empty/absent object yields null.
 *
 * Accepts a string passthrough defensively in case any caller already holds the
 * hydrated string.
 */
export function longDefObjectToDisplayString(
  value: LongDefinitionObject | string | null | undefined
): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value || null;

  const segments = Object.entries(value)
    .filter(([, def]) => typeof def === 'string' && def.trim().length > 0)
    .map(([pos, def]) => ({ pos, def: def.trim() }));

  if (segments.length === 0) return null;
  if (segments.length === 1) return segments[0].def;
  return segments.map(({ pos, def }) => `${pos}: ${def}`).join('\n\n');
}

// Inline type to avoid a circular dependency with server/types/index.ts
type ShortDefinitionPronunciationOverride = { definition?: string | null; pronunciation?: string | null };

/**
 * Resolve the short definition for a dictionary entry.
 * Returns the manual override if one is set; otherwise falls back to generateShortDefinition().
 */
export function resolveShortDefinition(definitions: string[], override?: ShortDefinitionPronunciationOverride | null): string | null {
  if (override?.definition != null) return override.definition;
  return generateShortDefinition(definitions);
}
