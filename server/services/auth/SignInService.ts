import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { IUserDAL } from '../../dal/interfaces/IUserDAL.js';
import { IEmailCodeDAL, EmailCodePurpose } from '../../dal/interfaces/IEmailCodeDAL.js';
import { UserService } from '../UserService.js';
import { AuthResponse, User } from '../../types/index.js';
import { DALError, DuplicateError, NotFoundError, RateLimitError, ValidationError } from '../../types/dal.js';
import type { UserGender } from '../../contracts/wire.js';
import { EmailDeliveryError, type EmailSender } from './EmailSender.js';
import { PhoneVerificationError, type PhoneVerifier } from './FirebasePhoneVerifier.js';
import { DevConsolePhoneVerifier } from './DevConsolePhoneVerifier.js';

/**
 * SignInService — every way into an account except the plain password login, and every
 * change to how an account is reached (docs/LOGIN_REWORK.md § 4, Q3–Q24).
 *
 *   Email codes       sendEmailCode / redeemSignInCode / resetPassword
 *   Phone             phoneSignIn (a Firebase ID token → our own session)
 *   Sign-up           completeSignUp (a sign-up TICKET proves the channel; Q14)
 *   Step-up re-auth   sendStepUpCode / verifyStepUp (password, email code or phone)
 *   Channel changes   startEmailChange / confirmEmailChange / changePhone / deleteAccountWithStepUp
 *
 * ── Hidden enumeration (Q13 / Q17) ─────────────────────────────────────────────
 * No response before a code is redeemed may say whether an address has an account:
 *   - "sign-in" codes are sent to ANY valid address (a known one signs in, an unknown one
 *     continues to sign-up), with the same response either way;
 *   - "reset" codes are sent only when an account exists, but the response is identical;
 *   - the password login lives in UserService.authenticateUser (one message, timing-equalized).
 * Only REDEEMING a code (which proves the inbox) reveals "account" vs "sign-up".
 *
 * ── Codes (Q16) ────────────────────────────────────────────────────────────────
 * 6 digits from crypto.randomInt; valid CODE_TTL_MIN; CODE_MAX_ATTEMPTS wrong tries kill it;
 * a resend no sooner than RESEND_AFTER_S; at most SENDS_PER_HOUR per address (any purpose).
 * Only an HMAC (keyed off JWT_SECRET, bound to purpose + address) is stored.
 *
 * ── Tickets ────────────────────────────────────────────────────────────────────
 * Two short-lived JWTs, each signed with its OWN key derived from JWT_SECRET, so neither can
 * ever pass authMiddleware as an access token (which verifies with JWT_SECRET itself):
 *   - sign-up ticket (SIGNUP_TICKET_TTL): `{ channel, value }` — a verified email or phone
 *     with no account yet;
 *   - step-up token (STEP_UP_TTL): `{ userId }` — the account just re-proved itself.
 *
 * Layer: service. No SQL (DALs) and no HTTP (SignInController sets the cookies).
 * Docs: docs/LOGIN_REWORK.md § 4. Depends on: UserService, IUserDAL, IEmailCodeDAL,
 * EmailSender, PhoneVerifier.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MIN = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_AFTER_S = 30;
export const SENDS_PER_HOUR = 5;
const SIGNUP_TICKET_TTL = '30m';
const STEP_UP_TTL = '10m';

/** One message for every failed redemption: wrong, expired, used or unknown. */
const BAD_CODE_MESSAGE = 'That code is wrong or has expired';

const JWT_SECRET = process.env.JWT_SECRET as string;

/** A key for one purpose, derived from JWT_SECRET (never JWT_SECRET itself; see the header). */
function derivedKey(label: string): string {
  return crypto.createHmac('sha256', JWT_SECRET || 'unset').update(`cow-auth:${label}`).digest('hex');
}

export type SignUpChannel = { channel: 'email'; value: string } | { channel: 'phone'; value: string };

/** What redeeming a sign-in code / a phone token yields. */
export type SignInOutcome =
  | { status: 'signed-in'; auth: AuthResponse }
  | { status: 'sign-up'; signUpTicket: string; suggestedUsername: string; channel: 'email' | 'phone' };

export interface CodeSent {
  /** Seconds before the client may ask again. */
  resendAfterSeconds: number;
  validMinutes: number;
}

export interface CompleteSignUpInput {
  signUpTicket: string;
  username: string;
  name?: string | null;
  /** Email accounts only (Q9). */
  password?: string | null;
  gender?: UserGender | null;
  birthDate?: string | null;
  timezone?: string;
}

/** How an account re-proves itself before a sensitive change (Q24). Exactly one. */
export type StepUpProof = { password: string } | { code: string } | { phoneIdToken: string };

export class SignInService {
  constructor(
    private readonly userService: UserService,
    private readonly userDAL: IUserDAL,
    private readonly emailCodeDAL: IEmailCodeDAL,
    private readonly emailSender: EmailSender,
    private readonly phoneVerifier: PhoneVerifier,
  ) {}

  /** Whether phone sign-in can work in this process (FIREBASE_PROJECT_ID set, or the dev stand-in). */
  get phoneConfigured(): boolean {
    return this.phoneVerifier.configured;
  }

  // ── Dev phone codes (DevConsolePhoneVerifier; never on production) ──────────

  /** Whether the dev phone stand-in is this process's verifier (authRoutes mounts its endpoints only then). */
  get devPhoneCodesActive(): boolean {
    return this.phoneVerifier instanceof DevConsolePhoneVerifier;
  }

  private devPhoneVerifier(): DevConsolePhoneVerifier {
    if (!(this.phoneVerifier instanceof DevConsolePhoneVerifier)) throw new NotFoundError('Not available');
    return this.phoneVerifier;
  }

  /** Dev: "text" a code (printed to the backend log). */
  sendDevPhoneCode(phone: unknown): void {
    try {
      this.devPhoneVerifier().sendCode(phone);
    } catch (e) {
      if (e instanceof PhoneVerificationError) throw new ValidationError(e.message);
      throw e;
    }
  }

  /** Dev: check the code and return a token that stands in for a Firebase ID token. */
  confirmDevPhoneCode(phone: unknown, code: unknown): { idToken: string } {
    try {
      return { idToken: this.devPhoneVerifier().confirmCode(phone, code) };
    } catch (e) {
      if (e instanceof PhoneVerificationError) throw new ValidationError(e.message);
      throw e;
    }
  }

  // ── Email codes ─────────────────────────────────────────────────────────────

  /**
   * "Email me a code" (purpose 'sign-in') and "Forgot password?" (purpose 'reset').
   * The response is the same whether or not the address has an account (see the header).
   */
  async sendEmailCode(rawEmail: string, purpose: 'sign-in' | 'reset'): Promise<CodeSent> {
    const email = this.normalizeEmail(rawEmail);
    if (purpose === 'reset') {
      // Only a known account gets a reset code; an unknown address gets the identical
      // response and nothing in its inbox.
      const user = await this.userDAL.findByEmail(email);
      if (!user) {
        // Same limits AND the same row (a hash of a random code nobody holds), so the
        // hourly cap trips for an unknown address exactly as for a known one: a 429 on the
        // sixth try cannot reveal which addresses have accounts.
        await this.assertSendAllowed(email);
        await this.emailCodeDAL.create({
          email,
          purpose,
          codeHash: this.hashCode(email, purpose, crypto.randomBytes(16).toString('hex')),
          expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
        });
        return { resendAfterSeconds: RESEND_AFTER_S, validMinutes: CODE_TTL_MIN };
      }
    }
    return this.issueCode(email, purpose);
  }

  /**
   * Redeem a 'sign-in' code: a known address is signed in; an unknown one gets a sign-up
   * ticket (verify first, then details: Q14).
   */
  async redeemSignInCode(rawEmail: string, code: string): Promise<SignInOutcome> {
    const email = this.normalizeEmail(rawEmail);
    await this.redeemCode(email, 'sign-in', code);
    const known = await this.userDAL.findByEmail(email);
    if (known) {
      const user = await this.requireUser(known.id);
      return { status: 'signed-in', auth: this.userService.issueSession(user) };
    }
    return {
      status: 'sign-up',
      channel: 'email',
      signUpTicket: this.signSignUpTicket({ channel: 'email', value: email }),
      suggestedUsername: await this.userService.suggestUsername(email.split('@')[0]),
    };
  }

  /**
   * Forgot password: redeem a 'reset' code, set the new password, end every other session
   * (whoever knew the old password is signed out everywhere), and sign this device in.
   */
  async resetPassword(rawEmail: string, code: string, newPassword: string): Promise<AuthResponse> {
    const email = this.normalizeEmail(rawEmail);
    // Check the new password BEFORE spending the code, so a weak password does not burn it.
    if (typeof newPassword !== 'string') throw new ValidationError('New password is required');
    this.userService.validatePasswordStrength(newPassword);
    await this.redeemCode(email, 'reset', code);
    const known = await this.userDAL.findByEmail(email);
    if (!known) throw new ValidationError(BAD_CODE_MESSAGE); // the account vanished mid-flow
    await this.userService.setPassword(known.id, newPassword);
    await this.userService.revokeAllRefreshTokens(known.id);
    return this.userService.issueSession(await this.requireUser(known.id));
  }

  // ── Phone ───────────────────────────────────────────────────────────────────

  /**
   * Phone sign-in (Q3, Q6): the client finished Firebase's SMS step and sends the resulting
   * ID token. A known number signs in; a new one gets a sign-up ticket.
   */
  async phoneSignIn(idToken: string): Promise<SignInOutcome> {
    const phone = await this.verifyPhone(idToken);
    const known = await this.userDAL.findByPhone(phone);
    if (known) {
      const user = await this.requireUser(known.id);
      return { status: 'signed-in', auth: this.userService.issueSession(user) };
    }
    return {
      status: 'sign-up',
      channel: 'phone',
      signUpTicket: this.signSignUpTicket({ channel: 'phone', value: phone }),
      suggestedUsername: await this.userService.suggestUsername(null),
    };
  }

  // ── Sign-up ─────────────────────────────────────────────────────────────────

  /** Create the account a sign-up ticket was issued for, and sign it in (Q14, Q19–Q21). */
  async completeSignUp(input: CompleteSignUpInput): Promise<AuthResponse> {
    const ticket = this.verifySignUpTicket(input.signUpTicket);
    const user = await this.userService.createUser({
      email: ticket.channel === 'email' ? ticket.value : null,
      phone: ticket.channel === 'phone' ? ticket.value : null,
      password: ticket.channel === 'email' ? input.password ?? null : null,
      username: input.username,
      name: input.name ?? null,
      gender: input.gender ?? null,
      birthDate: input.birthDate ?? null,
      timezone: input.timezone,
    });
    return this.userService.issueSession(await this.requireUser(user.id));
  }

  // ── Step-up re-authentication (Q24) ─────────────────────────────────────────

  /** Email a step-up code to the account's CURRENT email (an email account's code proof). */
  async sendStepUpCode(userId: string): Promise<CodeSent> {
    const user = await this.requireUser(userId);
    if (!user.email) throw new ValidationError('This account has no email to send a code to');
    return this.issueCode(user.email, 'step-up');
  }

  /**
   * Re-prove the account with ONE of: its password, a step-up code to its email, or a fresh
   * Firebase ID token for its own phone. Returns a 10-minute step-up token for the change.
   */
  async verifyStepUp(userId: string, proof: StepUpProof): Promise<string> {
    const user = await this.requireUser(userId);
    if ('password' in proof) {
      const ok = await this.userService.checkPassword(userId, proof.password);
      if (!ok) throw new ValidationError('Password is incorrect');
    } else if ('code' in proof) {
      if (!user.email) throw new ValidationError('This account has no email');
      await this.redeemCode(user.email, 'step-up', proof.code);
    } else if ('phoneIdToken' in proof) {
      const phone = await this.verifyPhone(proof.phoneIdToken);
      if (!user.phone || phone !== user.phone) throw new ValidationError('That is not this account’s phone number');
    } else {
      throw new ValidationError('A password, code or phone token is required');
    }
    return jwt.sign({ userId }, derivedKey('step-up'), { expiresIn: STEP_UP_TTL });
  }

  /** Throws unless `token` is a live step-up token for `userId`. */
  assertStepUp(userId: string, token: unknown): void {
    if (typeof token !== 'string' || !token) {
      throw new DALError('Please confirm it’s you first', 'ERR_STEP_UP_REQUIRED', 403);
    }
    try {
      const claims = jwt.verify(token, derivedKey('step-up')) as { userId?: string };
      if (claims.userId === userId) return;
    } catch {
      // fall through
    }
    throw new DALError('Your confirmation has expired. Please confirm it’s you again', 'ERR_STEP_UP_REQUIRED', 403);
  }

  // ── Channel changes (Q24) ───────────────────────────────────────────────────

  /** Add or change the email: step-up gated; sends a 'verify-new-email' code to the NEW address. */
  async startEmailChange(userId: string, rawEmail: string, stepUpToken: unknown): Promise<CodeSent> {
    this.assertStepUp(userId, stepUpToken);
    const email = this.normalizeEmail(rawEmail);
    const user = await this.requireUser(userId);
    if (user.email === email) throw new ValidationError('That is already your email');
    // Authenticated and step-up gated, so saying "in use" here is acceptable (it is not the
    // anonymous enumeration the sign-in screen hides).
    const holder = await this.userDAL.findByEmail(email);
    if (holder && holder.id !== userId) throw new DuplicateError('That email is already in use');
    return this.issueCode(email, 'verify-new-email');
  }

  /** Finish an email change: the code proves the new inbox; the email becomes verified. */
  async confirmEmailChange(userId: string, rawEmail: string, code: string): Promise<User> {
    const email = this.normalizeEmail(rawEmail);
    await this.redeemCode(email, 'verify-new-email', code);
    const holder = await this.userDAL.findByEmail(email);
    if (holder && holder.id !== userId) throw new DuplicateError('That email is already in use');
    await this.userDAL.update(userId, { email, emailVerifiedAt: new Date() });
    return this.requireUser(userId);
  }

  /** Add or change the phone: step-up gated; the Firebase token proves the new number. */
  async changePhone(userId: string, idToken: string, stepUpToken: unknown): Promise<User> {
    this.assertStepUp(userId, stepUpToken);
    const phone = await this.verifyPhone(idToken);
    const holder = await this.userDAL.findByPhone(phone);
    if (holder && holder.id !== userId) throw new DuplicateError('That phone number is already in use');
    await this.userDAL.update(userId, { phone, phoneVerifiedAt: new Date() });
    return this.requireUser(userId);
  }

  /** Delete the account after a step-up (the only way for a phone account, which has no password). */
  async deleteAccountWithStepUp(userId: string, stepUpToken: unknown): Promise<void> {
    this.assertStepUp(userId, stepUpToken);
    await this.userService.deleteUserUnchecked(userId);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private normalizeEmail(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('Email is required');
    const email = raw.trim().toLowerCase();
    this.userService.validateEmail(email);
    return email;
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  /** The hourly cap and the resend cooldown (Q16). Throws RateLimitError. */
  private async assertSendAllowed(email: string): Promise<void> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if ((await this.emailCodeDAL.countSince(email, hourAgo)) >= SENDS_PER_HOUR) {
      throw new RateLimitError('Too many codes sent to this address. Try again in an hour');
    }
    const cooldownStart = new Date(Date.now() - RESEND_AFTER_S * 1000);
    if ((await this.emailCodeDAL.countSince(email, cooldownStart)) > 0) {
      throw new RateLimitError(`Please wait ${RESEND_AFTER_S} seconds before asking for another code`);
    }
  }

  private hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
    return crypto.createHmac('sha256', derivedKey('email-code')).update(`${purpose}:${email}:${code}`).digest('hex');
  }

  /** Generate, store and send a code. */
  private async issueCode(email: string, purpose: EmailCodePurpose): Promise<CodeSent> {
    await this.assertSendAllowed(email);
    const code = String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    await this.emailCodeDAL.create({
      email,
      purpose,
      codeHash: this.hashCode(email, purpose, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
    });
    try {
      await this.emailSender.sendVerificationCode({ to: email, code, purpose, validMinutes: CODE_TTL_MIN });
    } catch (e) {
      // The row stays (it counts toward the limits, so a failing provider cannot be used to
      // spin), but the caller hears that nothing went out.
      console.error('SignInService: email send failed:', e instanceof Error ? e.message : e);
      if (e instanceof EmailDeliveryError) {
        throw new DALError('We could not send the email right now. Please try again later', 'ERR_EMAIL_UNAVAILABLE', 503);
      }
      throw e;
    }
    return { resendAfterSeconds: RESEND_AFTER_S, validMinutes: CODE_TTL_MIN };
  }

  /**
   * Check and consume the newest code for (email, purpose). Only the NEWEST code counts, so
   * asking for a new one invalidates the old. Every failure reads the same (BAD_CODE_MESSAGE),
   * except running out of tries, which tells the learner what to do next.
   */
  private async redeemCode(email: string, purpose: EmailCodePurpose, rawCode: unknown): Promise<void> {
    const code = typeof rawCode === 'string' ? rawCode.replace(/\s+/g, '') : '';
    if (!/^\d{6}$/.test(code)) throw new ValidationError(BAD_CODE_MESSAGE);
    const row = await this.emailCodeDAL.findLatest(email, purpose);
    if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new ValidationError(BAD_CODE_MESSAGE);
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      throw new ValidationError('Too many wrong tries. Ask for a new code');
    }
    const expected = Buffer.from(row.codeHash, 'hex');
    const given = Buffer.from(this.hashCode(email, purpose, code), 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      const attempts = await this.emailCodeDAL.incrementAttempts(row.id);
      if (attempts >= CODE_MAX_ATTEMPTS) throw new ValidationError('Too many wrong tries. Ask for a new code');
      throw new ValidationError(BAD_CODE_MESSAGE);
    }
    if (!(await this.emailCodeDAL.consume(row.id))) throw new ValidationError(BAD_CODE_MESSAGE);
  }

  private async verifyPhone(idToken: string): Promise<string> {
    if (!this.phoneVerifier.configured) {
      throw new DALError('Phone sign-in is not available yet', 'ERR_PHONE_UNAVAILABLE', 503);
    }
    try {
      return await this.phoneVerifier.verifyPhoneIdToken(idToken);
    } catch (e) {
      if (e instanceof PhoneVerificationError) {
        console.error('SignInService: phone token rejected:', e.message);
        throw new ValidationError('We could not confirm that phone number. Please try again');
      }
      throw e;
    }
  }

  private signSignUpTicket(channel: SignUpChannel): string {
    return jwt.sign(channel, derivedKey('sign-up-ticket'), { expiresIn: SIGNUP_TICKET_TTL });
  }

  private verifySignUpTicket(token: unknown): SignUpChannel {
    if (typeof token !== 'string' || !token) throw new ValidationError('Your sign-up has expired. Please start again');
    try {
      const claims = jwt.verify(token, derivedKey('sign-up-ticket')) as Partial<SignUpChannel>;
      if ((claims.channel === 'email' || claims.channel === 'phone') && typeof claims.value === 'string') {
        return { channel: claims.channel, value: claims.value } as SignUpChannel;
      }
    } catch {
      // fall through
    }
    throw new ValidationError('Your sign-up has expired. Please start again');
  }
}
