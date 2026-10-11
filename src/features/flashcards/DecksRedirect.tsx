import { Navigate } from "react-router-dom";

/**
 * Legacy `/flashcards/decks` → `/`.
 *
 * The fdp became the Home tab on 2026-10-10 (Home and Menu swapped contents —
 * docs/UX_AND_NAVIGATION.md), so its page now renders at `/` inside `HomePage`, which
 * adds the account header. This keeps the old path alive for bookmarks and any link
 * still in the wild.
 *
 * `replace` so the dead path never lands in the history stack (same reasoning as
 * MasteredRedirect).
 *
 * Safe to delete once no client is expected to hold the old URL.
 */
const DecksRedirect: React.FC = () => <Navigate to="/" replace />;

export default DecksRedirect;
