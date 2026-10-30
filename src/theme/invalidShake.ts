// The app's INVALID-OPERATION SHAKE — "no, not that": a damped side-to-side wobble.
//
// One definition so every refusal reads identically:
//   - a wrong bubble pair (games/bubbles/Bubble.tsx → `.bubble__inner`, via
//     games/bubbles/constants.ts `WRONG_SHAKE_KEYFRAMES`);
//   - a wrong Bucket Drop bucket (games/bucket-drop/DropBucket.tsx);
//   - dragging an already-sorted card on the sort cards page
//     (features/discover/SortCardsPage.tsx → `DraggableCard`).
// It lives in theme/ (not games/) so features/ can use it: features/ must not import games/.
//
// Use: spread INVALID_SHAKE_KEYFRAMES into an `sx` beside `animation: INVALID_SHAKE_ANIMATION`,
// and remount (or re-key) the element to replay it.
//
// Docs: docs/GAMES_FEATURE.md (`WRONG_SHAKE_KEYFRAMES`), docs/BUCKET_DROP_GAME.md,
// docs/SORT_CARDS_REQUIREMENTS.md § 4.5 "Already-sorted cards are locked".

/** How long one shake runs, ms. (Bubble Match's wrong-pair feedback beat.) */
export const INVALID_SHAKE_MS = 420;

/** The shake's `@keyframes`, as an MUI `sx` block. Name: `invalidShake`. */
export const INVALID_SHAKE_KEYFRAMES = {
    "@keyframes invalidShake": {
        "0%, 100%": { transform: "translateX(0)" },
        "20%": { transform: "translateX(-6px)" },
        "40%": { transform: "translateX(6px)" },
        "60%": { transform: "translateX(-4px)" },
        "80%": { transform: "translateX(4px)" },
    },
} as const;

/** The `animation` value that plays one shake. */
export const INVALID_SHAKE_ANIMATION = `invalidShake ${INVALID_SHAKE_MS}ms ease-in-out`;
