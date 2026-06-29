/**
 * SQL predicate matching a vet row (aliased `ve`) whose `iconLayout` is an ADVANCED arrangement
 * — i.e. one the owner saved while in the flashcard editor's *advanced* mode. This is the exact
 * server-side mirror of the client's `isAdvancedLayout` / `isDefaultPlacement`
 * (src/pages/FlashcardsLearnPage/cardIconLayout.ts).
 *
 * Why geometry, not a stored flag: the editor has no persisted "mode" — Save writes exactly the
 * active draft, and basic mode always writes a single icon at the canonical default placement.
 * So "advanced" == "not a single default-placed icon":
 *   - 2+ icons, OR
 *   - 1 icon that has been moved / resized / rotated / mirrored.
 *
 * The default placement (must stay in sync with cardIconLayout.ts constants):
 *   x = 0.5, y = 0.3333, scale ∈ DEFAULT_PLACEMENT_SCALES, rotation = 0, flipX falsy.
 *
 * Used by the Community feeds to surface only genuinely-decorated designs and to exclude
 * layouts the owner is actually seeing in basic mode. Reference: docs/COMMUNITY_PAGE.md.
 */

/** Scales that count as a "default placement" — the current default (1.25) plus legacy
 *  basic-save defaults (1.2, then 1.0). Mirror of `DEFAULT_PLACEMENT_SCALES` in the client's
 *  `src/pages/FlashcardsLearnPage/cardIconLayout.ts`; the two must stay in sync. */
export const DEFAULT_PLACEMENT_SCALES = [1.25, 1.2, 1] as const;

export function isAdvancedLayout(layout: unknown): boolean {
  if (!Array.isArray(layout) || layout.length === 0) return false;
  if (layout.length > 1) return true;
  const it = layout[0] as any;
  const defaultScale = (DEFAULT_PLACEMENT_SCALES as readonly number[]).includes(it?.scale);
  const isDefaultPlacement =
    defaultScale &&
    (it?.rotation ?? 0) === 0 &&
    !it?.flipX &&
    it?.x === 0.5 &&
    it?.y === 0.3333;
  return !isDefaultPlacement;
}

export const IS_ADVANCED_LAYOUT = `(
  ve."iconLayout" IS NOT NULL
  AND jsonb_array_length(ve."iconLayout") >= 1
  AND (
    jsonb_array_length(ve."iconLayout") > 1
    OR NOT (
          (ve."iconLayout"->0->>'x')::float = 0.5
      AND (ve."iconLayout"->0->>'y')::float = 0.3333
      AND (ve."iconLayout"->0->>'scale')::float IN (${DEFAULT_PLACEMENT_SCALES.join(", ")})
      AND COALESCE((ve."iconLayout"->0->>'rotation')::float, 0) = 0
      AND COALESCE((ve."iconLayout"->0->>'flipX')::boolean, false) = false
    )
  )
)`;
