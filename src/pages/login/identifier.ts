/**
 * The login screen's Email and Phone fields (docs/LOGIN_REWORK.md Q9–Q10), and the settings
 * page's change-email / change-phone field: check and normalize what the learner typed.
 *
 *   - an email is trimmed and lowercased;
 *   - a phone number may carry spaces / dashes / dots / parentheses, and must start with "+" and
 *     a country code (E.164: 7–15 digits). There is no default country: guessing one would text
 *     the wrong number. (The settings field.)
 *   - the login screen's Phone box is ten single-digit boxes for a US / Canada (+1) number
 *     (owner, 2026-11-14; docs/LOGIN_REWORK.md Q10): `spreadDigits` fills them from typing,
 *     pasting or autofill, and `parseUsPhoneDigits` turns the ten into E.164.
 *
 * Layer: page logic (pure). Tested by src/pages/login/__tests__/identifier.test.ts.
 * Used by src/pages/login/IdentifierStep.tsx and src/pages/account/AccountIdentitySection.tsx.
 */

export type ParsedIdentifier =
    | { kind: "email"; value: string }
    | { kind: "phone"; value: string }
    | { kind: "invalid"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

export function parseEmail(raw: string): Extract<ParsedIdentifier, { kind: "email" | "invalid" }> {
    const email = raw.trim().toLowerCase();
    if (!email) return { kind: "invalid", message: "Enter your email" };
    return EMAIL_PATTERN.test(email) ? { kind: "email", value: email } : { kind: "invalid", message: "That email doesn't look right" };
}

export function parsePhone(raw: string): Extract<ParsedIdentifier, { kind: "phone" | "invalid" }> {
    const compact = raw.trim().replace(/[\s\-().]/g, "");
    if (!compact) return { kind: "invalid", message: "Enter your phone number" };
    if (!/^\+?\d+$/.test(compact)) return { kind: "invalid", message: "That phone number doesn't look right" };
    if (!compact.startsWith("+")) return { kind: "invalid", message: "Start with + and your country code, e.g. +1 555 123 4567" };
    return E164_PATTERN.test(compact) ? { kind: "phone", value: compact } : { kind: "invalid", message: "That phone number doesn't look right" };
}

/** How many boxes the login Phone box has: a NANP number without its +1. */
export const US_PHONE_DIGITS = 10;

/** Ten empty phone boxes. */
export function emptyPhoneDigits(): string[] {
    return Array<string>(US_PHONE_DIGITS).fill("");
}

/**
 * Put `input` (one typed key, or a pasted / autofilled number) into the digit boxes starting at
 * box `at`, and say which box should take focus next.
 *
 * A whole number (10 digits, or 11 starting with the country code 1, with any separators) always
 * fills from the first box, whichever box it landed in: that is what iOS / Android autofill and a
 * paste of "+1 (555) 123-4567" look like. Anything shorter fills forward from `at`.
 */
export function spreadDigits(boxes: readonly string[], at: number, input: string): { boxes: string[]; focus: number } {
    let digits = input.replace(/\D/g, "");
    let start = at;
    if (digits.length === US_PHONE_DIGITS + 1 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length >= US_PHONE_DIGITS) start = 0;
    const next = [...boxes];
    let i = start;
    for (const d of digits) {
        if (i >= US_PHONE_DIGITS) break;
        next[i++] = d;
    }
    return { boxes: next, focus: Math.min(i, US_PHONE_DIGITS - 1) };
}

/**
 * The ten boxes → an E.164 US / Canada number. NANP area codes and exchanges never start with 0
 * or 1, which catches the commonest slip (typing the leading 1 into the first box).
 */
export function parseUsPhoneDigits(boxes: readonly string[]): Extract<ParsedIdentifier, { kind: "phone" | "invalid" }> {
    const digits = boxes.join("");
    if (!digits) return { kind: "invalid", message: "Enter your phone number" };
    if (digits.length < US_PHONE_DIGITS || !/^\d+$/.test(digits)) return { kind: "invalid", message: "Enter all 10 digits" };
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { kind: "invalid", message: "That phone number doesn't look right" };
    return { kind: "phone", value: `+1${digits}` };
}

/** An E.164 number for display: a +1 number as "+1 (212) 555-0123", any other one as stored. */
export function formatPhone(e164: string): string {
    const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
    return us ? `+1 (${us[1]}) ${us[2]}-${us[3]}` : e164;
}

/** A thrown value → the learner-facing line (ApiError carries the server's `error`). */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again"): string {
    return e instanceof Error && e.message ? e.message : fallback;
}
