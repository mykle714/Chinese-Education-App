import type { MasteryWorldId } from "../../../server/contracts/wire";

/**
 * autoFocusNotice — the owed "focus mode was turned on for you" popups
 * (docs/FOCUS_MODE.md § 1a).
 *
 * When a Reading / Writing goal is switched on and its world's pile is already past the
 * lever's threshold, the server turns focus on (`PUT /api/users/goals` →
 * `focusAutoEnabled`). The popup explaining it is owed until the learner first visits
 * that world on the Deck Tower. The debt lives here, in localStorage on THIS device (a
 * product decision, 2026-11-08: no new column), keyed per (user, language) because focus
 * is per (user, language, world).
 *
 *   Writer   src/pages/account/AccountPane.tsx → `handleToggleGoal` (owe on a goal turned
 *            on with focus auto-enabled; forgive on a goal turned back off).
 *   Reader   src/features/deckTower/useFocusLever.tsx (shows the popup, then forgives).
 *
 * Every access is wrapped: storage may be unavailable (private window, blocked site data),
 * in which case the popup is simply never shown. Focus itself is still on.
 *
 * Layer: feature utility (features/focusMode). No React.
 */

const storageKey = (userId: string, language: string) => `focusAutoOnNotice:${userId}:${language}`;

function read(userId: string, language: string): MasteryWorldId[] {
    try {
        const raw = window.localStorage.getItem(storageKey(userId, language));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed.filter((w) => typeof w === "string") as MasteryWorldId[]) : [];
    } catch {
        return [];
    }
}

function write(userId: string, language: string, worlds: MasteryWorldId[]): void {
    try {
        if (worlds.length === 0) window.localStorage.removeItem(storageKey(userId, language));
        else window.localStorage.setItem(storageKey(userId, language), JSON.stringify(worlds));
    } catch {
        /* storage unavailable — the popup is best-effort */
    }
}

/** Owe the popup for each of these worlds. */
export function oweAutoFocusNotice(userId: string, language: string, worlds: MasteryWorldId[]): void {
    if (worlds.length === 0) return;
    write(userId, language, [...new Set([...read(userId, language), ...worlds])]);
}

/** The popup is owed for this world. */
export function isAutoFocusNoticeOwed(userId: string, language: string, world: MasteryWorldId): boolean {
    return read(userId, language).includes(world);
}

/** The popup was shown, or is no longer relevant (the goal went back off). */
export function forgiveAutoFocusNotice(userId: string, language: string, world: MasteryWorldId): void {
    write(userId, language, read(userId, language).filter((w) => w !== world));
}
