import type { CodeSent, SignUpNext } from "../../api/auth";

/**
 * The TEST SIGN-UP identifiers (owner, 2026-11-15): typing the test phone number (444 444 4444)
 * or the test email (4444@4444.com) on the login screen always walks that channel's sign-up flow
 * and never creates an account, so the flow can be seen at any time without a real number or
 * inbox, Firebase, or a throwaway account.
 *
 * Both are pure client-side dry runs. The server is never told about either:
 *   - phone: IdentifierStep lets it continue even when phone sign-in is not configured;
 *     PhoneStep sends no SMS ("Text me a code" plays a pretend send) and accepts only
 *     TEST_SIGN_UP_CODE; "Sign in with password" answers with the server's wrong-credentials
 *     message, and a reset fails as it would for a number with no account;
 *   - email: CodeStep's "Send code" / "Forgot password?" play a pretend send; it accepts only
 *     TEST_SIGN_UP_CODE for sign-in, "Sign in with password" answers with the server's
 *     wrong-credentials message, and a reset always fails as for an address with no account;
 *   - DetailsStep gets testSignUpNext(channel) (a ticket the server would reject anyway) and, on
 *     "Create account", skips `completeSignUp` and hands back to LoginPage, which returns to
 *     step 1 with a "no account was created" notice.
 *   - every screen reads exactly as the real flow does (owner, 2026-11-15): a pretend "Sending…"
 *     beat (TEST_SEND_DELAY_MS), the server's own wording for every failure, and the code is
 *     never shown. The only giveaway is the notice back on step 1 after "Create account".
 * The only server call left in either flow is the read-only live username check.
 *
 * 444 is a valid-shaped NANP area code + exchange, so it passes parseUsPhoneDigits; it is not an
 * assigned area code, so no real person can be shadowed by it. 4444.com is not ours, so no real
 * mail would ever be sent to it anyway.
 *
 * Layer: page logic (pure). Used by IdentifierStep, PhoneStep, CodeStep, DetailsStep and
 * LoginPage. Docs: docs/LOGIN_REWORK.md § "Test sign-up".
 */

/** The test number in E.164 (what parseUsPhoneDigits makes of 4444444444). */
export const TEST_SIGN_UP_PHONE = "+14444444444";
/** The test email, as parseEmail stores it (trimmed, lowercase). */
export const TEST_SIGN_UP_EMAIL = "4444@4444.com";

export function isTestSignUpPhone(e164: string): boolean {
    return e164 === TEST_SIGN_UP_PHONE;
}

export function isTestSignUpEmail(email: string): boolean {
    return email.trim().toLowerCase() === TEST_SIGN_UP_EMAIL;
}

/** The one code either test identifier accepts. */
export const TEST_SIGN_UP_CODE = "444444";

/** How long a pretend send takes, so "Sending…" / the button spinner shows as it would. */
export const TEST_SEND_DELAY_MS = 700;

/** Wait like a server round-trip. */
export function testDelay(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, TEST_SEND_DELAY_MS));
}

// ── The server's own replies, copied so the dry run reads identically ──
// Keep in step with: server/services/auth/SignInService.ts → RESEND_AFTER_S, CODE_TTL_MIN,
// BAD_CODE_MESSAGE, NO_PHONE_ACCOUNT_MESSAGE; server/services/UserService.ts →
// WRONG_CREDENTIALS_MESSAGE, WRONG_PHONE_CREDENTIALS_MESSAGE.

/** What sendEmailCode answers. */
export const TEST_CODE_SENT: CodeSent = { resendAfterSeconds: 30, validMinutes: 10 };
/** A wrong / expired email code. */
export const TEST_BAD_EMAIL_CODE_MESSAGE = "That code is wrong or has expired";
/** A password for an address with no account. */
export const TEST_WRONG_CREDENTIALS_MESSAGE = "Wrong email or password";
/** A password for a number with no account (UserService.ts → WRONG_PHONE_CREDENTIALS_MESSAGE). */
export const TEST_WRONG_PHONE_CREDENTIALS_MESSAGE = "Wrong phone number or password";
/** A phone password reset for a number with no account (SignInService.ts → NO_PHONE_ACCOUNT_MESSAGE). */
export const TEST_NO_PHONE_ACCOUNT_MESSAGE = "No account uses this number. Use the code to sign up instead";

const TEST_TICKET = "test-sign-up-dry-run";

/** The stand-in for the server's "verified, no account yet" answer, per channel. */
export function testSignUpNext(channel: SignUpNext["channel"]): SignUpNext {
    // suggestedUsername: what UserService.suggestUsername derives ("4444" from the email's
    // local part; "learner" with no seed, as for a phone).
    return { status: "sign-up", signUpTicket: TEST_TICKET, suggestedUsername: channel === "email" ? "4444" : "learner", channel };
}

export function isTestSignUp(next: SignUpNext): boolean {
    return next.signUpTicket === TEST_TICKET;
}
