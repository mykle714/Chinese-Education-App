/**
 * The voice tutor's routes (docs/VOICE_ASSISTANT.md § 9). Registered in src/routes/routeMeta.ts
 * + registry.ts behind FEATURE_FLAGS.voiceAssistant; the Menu popover row opens VOICE_PATH.
 */
export const VOICE_PATH = "/voice";
export const voiceReviewPath = (sessionId: string) => `/voice/${encodeURIComponent(sessionId)}`;
