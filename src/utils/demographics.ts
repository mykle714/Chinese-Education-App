import type { UserGender } from '../types';

/**
 * demographics.ts — the learner's gender / date of birth as the two forms that ask for them
 * see it (migration 164): the signup form (`RegisterPage`) and Settings (`AboutYouSections`).
 *
 * One module so the two cannot drift: the same labels, the same privacy line, and the same
 * date rule — which in turn mirrors the server's `validateDemographics`
 * (`server/services/UserService.ts`), the authority. The client check exists only so a bad
 * date is caught at the field instead of as a 400 after submit.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.5.
 */

/** The two answers, in the order both forms list them. `null` — "Prefer not to answer" — is the third. */
export const GENDER_CHOICES: readonly { value: UserGender; label: string }[] = [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
];

export const PREFER_NOT_LABEL = 'Prefer not to answer';

/** Why we ask, shown under both questions. Says who sees it, because that is the real question. */
export const DEMOGRAPHICS_PURPOSE =
    'Lets characters in Immersive World address you the way they naturally would. Never shown to other learners.';

/** Today as `YYYY-MM-DD` in the learner's own zone — the `max` for a date input. */
export function todayIsoDate(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The earliest date migration 164's CHECK accepts — the `min` for a date input. */
export const EARLIEST_BIRTH_DATE = '1900-01-01';

/**
 * What is wrong with a typed birth date, or null when it is fine.
 *
 * Mirrors `validateDemographics`: a real calendar day, on or after 1900-01-01, not in the
 * future. Native date inputs already refuse most of this, but not on every browser, and the
 * signup form must not let a learner reach the server with something it will reject.
 */
export function birthDateProblem(value: string, now: Date = new Date()): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter your date of birth';
    const [y, m, d] = value.split('-').map(Number);
    const asUtc = new Date(Date.UTC(y, m - 1, d));
    if (asUtc.getUTCFullYear() !== y || asUtc.getUTCMonth() !== m - 1 || asUtc.getUTCDate() !== d) {
        return 'That is not a real date';
    }
    if (value < EARLIEST_BIRTH_DATE) return 'Date of birth must be after 1900';
    if (value > todayIsoDate(now)) return 'Date of birth cannot be in the future';
    return null;
}
