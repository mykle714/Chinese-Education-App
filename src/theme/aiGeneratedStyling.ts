import { COLORS } from './colors';

// Shared "this content is AI-generated" surface treatment: the app's orange
// (COLORS.yellowMain) border + faint tint. Single source of truth for every
// AI-content surface so they can never drift apart:
//   - AiDictionaryEntryCard (the dictionary AI-fallback result), and
//   - ExampleSentenceList (est sentences without a valid human approval —
//     sentence.humanApproved, docs/DATA_VALIDATION_SYSTEM.md).
// The matching sparkle badge lives in src/components/AiGeneratedBadge.tsx
// (kept separate so component files only export components — react-refresh).
//
// Referenced by: docs/DICTIONARY_AI_FALLBACK_SEARCH.md, docs/DATA_VALIDATION_SYSTEM.md,
// docs/EXAMPLE_SENTENCES.md.

// Border + background tint for a container holding AI-generated content. Spread
// into the container's sx (callers keep their own radius/padding/layout).
export const aiGeneratedSurfaceSx = {
    border: '1px solid',
    borderColor: COLORS.yellowMain,
    backgroundColor: `${COLORS.yellowMain}14`, // ~8% orange tint
} as const;

// Text color to pair with aiGeneratedSurfaceSx when a surface needs to recolor its
// own label/value text to match (e.g. overriding a solid-fill pill's white text —
// see the HSK/difficulty pill in VocabCardBadges).
export const aiGeneratedTextColor = COLORS.yellowMain;
