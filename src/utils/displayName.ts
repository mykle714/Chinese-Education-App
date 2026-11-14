/**
 * How another account is labelled: its optional name, else its `@username` (migration 188,
 * docs/LOGIN_REWORK.md Q19–Q20). Emails and phone numbers are never shown for another user;
 * the server stopped sending them.
 *
 * Layer: shared util. Depended on by the friends screens, the Study Challenge pages and the
 * tester-dashboard leaderboard (every place that used to fall back to `name || email`).
 */
export function displayName(person: { name?: string | null; username: string }): string {
    return person.name?.trim() || `@${person.username}`;
}
