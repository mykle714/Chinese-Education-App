/**
 * Where the login screen sends a learner once they are signed in (docs/LOGIN_REWORK.md § 2,
 * R1 + R3).
 *
 * ProtectedRoute passes `{ from }` in the router state only for a COLD-START DEEP LINK (a
 * launch that opened on a protected page while signed out). Every other way onto `/login`
 * (a session ending mid-use, logout, account deletion) passes nothing, and the learner lands
 * on `/`, the Deck Tower (owner, 2026-11-13, Q2).
 *
 * Layer: shared util. Depended on by: src/components/ProtectedRoute.tsx (writes the state),
 * src/pages/LoginPage.tsx and src/pages/RegisterPage.tsx (read it).
 */

/** The router state ProtectedRoute attaches to its redirect onto `/login`. */
export interface LoginRedirectState {
    /** The path (with search + hash) the launch opened on. */
    from: string;
}

/**
 * The destination after sign-in. Accepts only an in-app absolute path, so a crafted state
 * can never send the learner off-site or back onto an auth page.
 */
export function postLoginPath(state: unknown): string {
    const from = (state as Partial<LoginRedirectState> | null)?.from;
    if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return "/";
    if (from === "/login" || from.startsWith("/login?") || from === "/register" || from.startsWith("/register?")) return "/";
    return from;
}
