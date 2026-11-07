import { COLORS } from './colors';

// Shared "this content is AI-generated" surface treatment: the AI-provenance orange
// (COLORS.aiGenerated) border + faint tint. Single source of truth for every
// AI-content surface so they can never drift apart. Consumers include
// AiDictionaryEntryCard (the dictionary AI-fallback result), DefinitionFacts,
// LongDefinitionDisplay and SynonymsRelatedSection.
// ExampleSentenceList left it on 2026-10-29 for the est-style AI card below
// (`aiGeneratedCardSx`); the eip Definition tab followed on 2026-11-07 (DefinitionFacts'
// grouped block + LongDefinitionDisplay's `aiCard`). Still on the tinted surface:
// DefinitionFacts' per-field boxes, LongDefinitionDisplay without `aiCard` (CompareWorkspace),
// AiDictionaryEntryCard, SynonymsRelatedSection.
// The matching sparkle badge lives in src/components/AiGeneratedBadge.tsx
// (kept separate so component files only export components — react-refresh).
//
// Referenced by: docs/DICTIONARY_AI_FALLBACK_SEARCH.md, docs/DATA_VALIDATION_SYSTEM.md,
// docs/EXAMPLE_SENTENCES.md.

// Border + background tint for a container holding AI-generated content. Spread
// into the container's sx (callers keep their own radius/padding/layout).
export const aiGeneratedSurfaceSx = {
    border: '1px solid',
    borderColor: COLORS.aiGenerated,
    backgroundColor: `${COLORS.aiGenerated}14`, // ~8% tint of the same orange
} as const;

// The est-style AI CARD (Tower Tier 2 `.ex` + `.aib`, 2026-10-29): the caller's card fill
// in a 1px AI-orange inset ring, 14px radius, NO tint. Pair it with AiGeneratedBadge's
// 'tag' variant pinned by `aiGeneratedTagPositionSx`; the card reserves the 6px the tag
// hangs below its edge. The ring is an inset shadow, so the card is the same size as an
// approved one (no reflow on approve). `face` is the host palette's card fill (the eip's
// `useEipColors().card`), so the card follows the light/dark eip theme.
// Consumers: ExampleSentenceList (unapproved sentences), DefinitionFacts (the grouped
// all-unapproved block), LongDefinitionDisplay (`aiCard` prop — the eip Definition tab's
// paragraph when it stands alone).
export const aiGeneratedCardSx = (face: string) => ({
    position: 'relative',
    backgroundColor: face,
    boxShadow: `inset 0 0 0 1px ${COLORS.aiGenerated}`,
    borderRadius: '14px',
    padding: '12px',
    // Room for the tag hanging 9px below the card's edge.
    marginBottom: '6px',
}) as const;

// Where the 'tag' AiGeneratedBadge sits on an aiGeneratedCardSx card: straddling its
// bottom edge, bottom-right. zIndex keeps it above the card's own positioned children.
export const aiGeneratedTagPositionSx = { position: 'absolute', right: '10px', bottom: '-9px', zIndex: 2 } as const;

// Text color to pair with aiGeneratedSurfaceSx when a surface needs to recolor its
// own label/value text to match — e.g. overriding a solid-fill pill's white text.
// Currently unused: the last caller (the cdp HSK pill) became a meta-strip chip
// that keeps its normal onSurface text.
export const aiGeneratedTextColor = COLORS.aiGenerated;
