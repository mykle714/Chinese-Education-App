/**
 * usageFormat.ts — display helpers shared by the User Usage dashboard's cards
 * (docs/USAGE_DASHBOARD.md § UI).
 */

/**
 * A `wins.game` key → display copy: 'wordSearch' → "Word Search". The key is opaque
 * and written by each game page (`useGameWins(GAME_KEY)`), so this splits the
 * camelCase rather than looking it up — a new game needs no entry here.
 */
export function gameLabel(gameKey: string): string {
    const spaced = gameKey.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
    return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}
