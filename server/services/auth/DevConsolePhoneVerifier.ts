import crypto from 'crypto';
import { FirebasePhoneVerifier, PhoneVerificationError, type PhoneVerifier } from './FirebasePhoneVerifier.js';

/**
 * DevConsolePhoneVerifier — the DEV-ONLY stand-in for Firebase Phone Auth (docs/LOGIN_REWORK.md
 * § 4c), the phone twin of EmailSender.ts → ConsoleEmailSender. It lets the phone-first login be
 * used on a dev box with no Firebase project:
 *
 *   1. POST /api/auth/phone/devSendCode    { phone }       → prints "📱 [dev sms] code for …" to the log
 *   2. POST /api/auth/phone/devConfirmCode { phone, code } → { idToken } (an opaque, single-use token)
 *   3. that token goes to the real endpoints (phone/verify, stepUp/verify, phone/change) exactly
 *      as a Firebase ID token would, and `verifyPhoneIdToken` redeems it.
 *
 * NEVER ACTIVE ON PPE: `createPhoneVerifier` picks it only when FIREBASE_PROJECT_ID is unset AND
 * NODE_ENV is not 'production' (PPE's compose sets production — the same guard the email console
 * transport relies on), and authRoutes.ts mounts the two dev endpoints only when it is active.
 * The client half (src/utils/firebasePhone.ts) uses it only in the Vite dev server.
 *
 * State is in memory: a backend restart forgets pending codes, which is fine for dev.
 *
 * Layer: service adapter (dev transport).
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;
const E164 = /^\+[1-9][0-9]{6,14}$/;

export class DevConsolePhoneVerifier implements PhoneVerifier {
  readonly configured = true;
  private readonly codes = new Map<string, { code: string; expiresAt: number; tries: number }>();
  private readonly tokens = new Map<string, { phone: string; expiresAt: number }>();

  /** "Text" a code: print it to the backend log. */
  sendCode(phone: unknown): void {
    if (typeof phone !== 'string' || !E164.test(phone)) throw new PhoneVerificationError("That phone number doesn't look right");
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(phone, { code, expiresAt: Date.now() + CODE_TTL_MS, tries: 0 });
    console.log(`📱 [dev sms] code for ${phone}: ${code} (valid ${CODE_TTL_MS / 60000} min)`);
  }

  /** Check the code; on success return a single-use token standing in for a Firebase ID token. */
  confirmCode(phone: unknown, code: unknown): string {
    const entry = typeof phone === 'string' ? this.codes.get(phone) : undefined;
    if (!entry || Date.now() > entry.expiresAt) throw new PhoneVerificationError('That code has expired. Ask for a new one');
    entry.tries += 1;
    if (entry.tries > MAX_TRIES) {
      this.codes.delete(phone as string);
      throw new PhoneVerificationError('Too many attempts. Ask for a new code');
    }
    if (typeof code !== 'string' || code.replace(/\s+/g, '') !== entry.code) throw new PhoneVerificationError('That code is wrong');
    this.codes.delete(phone as string);
    const token = `dev-phone.${crypto.randomBytes(24).toString('hex')}`;
    this.tokens.set(token, { phone: phone as string, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  async verifyPhoneIdToken(idToken: string): Promise<string> {
    const entry = this.tokens.get(idToken);
    this.tokens.delete(idToken); // single use, like a fresh Firebase sign-in
    if (!entry || Date.now() > entry.expiresAt) throw new PhoneVerificationError('Dev phone token is unknown or expired');
    return entry.phone;
  }
}

/**
 * The phone verifier for this process: Firebase when FIREBASE_PROJECT_ID is set; otherwise the
 * dev console stand-in off production, and an unconfigured verifier (phone sign-in reported
 * unavailable) on production.
 */
export function createPhoneVerifier(env: NodeJS.ProcessEnv = process.env): PhoneVerifier {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (projectId) return new FirebasePhoneVerifier(projectId);
  return env.NODE_ENV === 'production' ? new FirebasePhoneVerifier(undefined) : new DevConsolePhoneVerifier();
}
