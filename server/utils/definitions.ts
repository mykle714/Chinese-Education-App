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
