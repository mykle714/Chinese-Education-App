import { Navigate } from "react-router-dom";

/**
 * Legacy `/flashcards/mastered` → `/flashcards/collection/mastered`.
 *
 * The Mastered page was generalized into CollectionViewPage (docs/DECKS_FEATURE.md),
 * which serves Learn Now, Mastered and every user-authored deck. This keeps the old
 * path alive for bookmarks and any link still in the wild.
 *
 * `replace` so the dead path never lands in the history stack — otherwise the back
 * arrow from the collection page would bounce through it and forward again.
 *
 * Safe to delete once no client is expected to hold the old URL.
 */
const MasteredRedirect: React.FC = () => (
    <Navigate to="/flashcards/collection/mastered" replace />
);

export default MasteredRedirect;
