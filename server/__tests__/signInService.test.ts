import { describe, expect, it, beforeEach } from 'vitest';
import { SignInService, CODE_MAX_ATTEMPTS, SENDS_PER_HOUR } from '../services/auth/SignInService.js';
import type { IEmailCodeDAL, EmailCodeRow, EmailCodePurpose } from '../dal/interfaces/IEmailCodeDAL.js';
import type { EmailSender, VerificationEmail } from '../services/auth/EmailSender.js';
import type { PhoneVerifier } from '../services/auth/FirebasePhoneVerifier.js';
import { DALError, RateLimitError, ValidationError } from '../types/dal.js';

/**
 * SignInService policy (docs/LOGIN_REWORK.md § 4, Q13–Q17, Q24). Every rule here fails
 * SILENTLY if broken: a leaked "account exists", a reusable code, a ticket that works as a
 * session. DALs, the mail transport and the phone verifier are hand-stubbed (no DB, no network).
 */

/** In-memory email_codes with a controllable clock offset per row. */
class FakeEmailCodeDAL implements IEmailCodeDAL {
  rows: EmailCodeRow[] = [];
  private seq = 0;
  async create(p: { email: string; purpose: EmailCodePurpose; codeHash: string; expiresAt: Date }) {
    const row: EmailCodeRow = { id: String(++this.seq), ...p, attempts: 0, consumedAt: null, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async countSince(email: string, since: Date) {
    return this.rows.filter((r) => r.email === email && r.createdAt >= since).length;
  }
  async findLatest(email: string, purpose: EmailCodePurpose) {
    return [...this.rows].reverse().find((r) => r.email === email && r.purpose === purpose) ?? null;
  }
  async incrementAttempts(id: string) {
    const r = this.rows.find((x) => x.id === id)!;
    r.attempts += 1;
    return r.attempts;
  }
  async consume(id: string) {
    const r = this.rows.find((x) => x.id === id)!;
    if (r.consumedAt) return false;
    r.consumedAt = new Date();
    return true;
  }
  /** Age every row past the resend cooldown (and optionally the hour). */
  age(seconds: number) {
    for (const r of this.rows) r.createdAt = new Date(r.createdAt.getTime() - seconds * 1000);
  }
}

class CapturingSender implements EmailSender {
  readonly live = false;
  sent: VerificationEmail[] = [];
  async sendVerificationCode(e: VerificationEmail) {
    this.sent.push(e);
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

const ACCOUNT = { id: 'u1', email: 'known@example.com', username: 'known', phone: null as string | null };

function makeService(opts: { phone?: Partial<PhoneVerifier> } = {}) {
  const codes = new FakeEmailCodeDAL();
  const sender = new CapturingSender();
  const created: unknown[] = [];
  const userDAL = {
    findByEmail: async (email: string) => (email === ACCOUNT.email ? { id: ACCOUNT.id } : null),
    findByPhone: async (phone: string) => (phone === '+15550001111' ? { id: ACCOUNT.id } : null),
    findById: async (id: string) => (id === ACCOUNT.id ? { ...ACCOUNT } : created.length ? { id, ...(created[0] as object) } : null),
    update: async () => ({}),
  };
  const passwords: Record<string, string> = {};
  const userService = {
    issueSession: (user: { id: string }) => ({ user, token: `session-for-${user.id}` }),
    suggestUsername: async (seed: string | null) => `${seed ?? 'learner'}_s`,
    validateEmail: (e: string) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('Invalid email format');
    },
    validatePasswordStrength: (p: string) => {
      if (p.length < 8) throw new ValidationError('Password must be at least 8 characters long');
    },
    setPassword: async (id: string, p: string) => {
      passwords[id] = p;
    },
    revokeAllRefreshTokens: async () => {},
    checkPassword: async (_id: string, p: string) => p === 'right-password1',
    createUser: async (input: object) => {
      created.push(input);
      return { id: 'new-user', ...input };
    },
    deleteUserUnchecked: async () => {},
  };
  const phone: PhoneVerifier = {
    configured: true,
    verifyPhoneIdToken: async (t: string) => (t === 'tok-known' ? '+15550001111' : '+15550002222'),
    ...opts.phone,
  };
  const service = new SignInService(userService as any, userDAL as any, codes, sender, phone);
  return { service, codes, sender, created, passwords };
}

describe('SignInService — hidden enumeration (Q13/Q17)', () => {
  it('answers a sign-in code request identically for a known and an unknown address', async () => {
    const { service, sender } = makeService();
    const a = await service.sendEmailCode('known@example.com', 'sign-in');
    const b = await service.sendEmailCode('stranger@example.com', 'sign-in');
    expect(a).toEqual(b);
    // Both get a code: the unknown one continues to sign-up after redeeming it.
    expect(sender.sent.map((s) => s.to)).toEqual(['known@example.com', 'stranger@example.com']);
  });

  it('sends a reset code only to a known account, with the same response', async () => {
    const { service, sender } = makeService();
    const known = await service.sendEmailCode('known@example.com', 'reset');
    const unknown = await service.sendEmailCode('stranger@example.com', 'reset');
    expect(known).toEqual(unknown);
    expect(sender.sent.map((s) => s.to)).toEqual(['known@example.com']);
  });

  it('trips the hourly cap for an unknown reset address exactly like a known one', async () => {
    const { service, codes } = makeService();
    for (const email of ['known@example.com', 'stranger@example.com']) {
      for (let i = 0; i < SENDS_PER_HOUR; i++) {
        await service.sendEmailCode(email, 'reset');
        codes.age(31); // past the resend cooldown, inside the hour
      }
      await expect(service.sendEmailCode(email, 'reset')).rejects.toBeInstanceOf(RateLimitError);
    }
  });
});

describe('SignInService — codes (Q16)', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('signs a known address in with its code', async () => {
    await ctx.service.sendEmailCode('Known@Example.com', 'sign-in');
    const outcome = await ctx.service.redeemSignInCode('known@example.com', ctx.sender.last().code);
    expect(outcome.status).toBe('signed-in');
  });

  it('turns an unknown address into a sign-up ticket with a suggested username', async () => {
    await ctx.service.sendEmailCode('new.person@example.com', 'sign-in');
    const outcome = await ctx.service.redeemSignInCode('new.person@example.com', ctx.sender.last().code);
    expect(outcome.status).toBe('sign-up');
    if (outcome.status !== 'sign-up') return;
    expect(outcome.channel).toBe('email');
    expect(outcome.suggestedUsername).toBe('new.person_s');
    expect(typeof outcome.signUpTicket).toBe('string');
  });

  it('redeems a code once only', async () => {
    await ctx.service.sendEmailCode('known@example.com', 'sign-in');
    const code = ctx.sender.last().code;
    await ctx.service.redeemSignInCode('known@example.com', code);
    await expect(ctx.service.redeemSignInCode('known@example.com', code)).rejects.toThrow('wrong or has expired');
  });

  it('kills a code after the allowed wrong tries, even if the right one follows', async () => {
    await ctx.service.sendEmailCode('known@example.com', 'sign-in');
    const right = ctx.sender.last().code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      await expect(ctx.service.redeemSignInCode('known@example.com', wrong)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(ctx.service.redeemSignInCode('known@example.com', right)).rejects.toThrow('Too many wrong tries');
  });

  it('does not accept a code issued for another purpose', async () => {
    await ctx.service.sendEmailCode('known@example.com', 'reset');
    await expect(ctx.service.redeemSignInCode('known@example.com', ctx.sender.last().code)).rejects.toThrow('wrong or has expired');
  });

  it('enforces the resend cooldown', async () => {
    await ctx.service.sendEmailCode('known@example.com', 'sign-in');
    await expect(ctx.service.sendEmailCode('known@example.com', 'sign-in')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('checks the new password before spending a reset code', async () => {
    await ctx.service.sendEmailCode('known@example.com', 'reset');
    const code = ctx.sender.last().code;
    await expect(ctx.service.resetPassword('known@example.com', code, 'short')).rejects.toThrow('at least 8');
    const auth = await ctx.service.resetPassword('known@example.com', code, 'a-good-password1');
    expect(auth.token).toBe('session-for-u1');
    expect(ctx.passwords.u1).toBe('a-good-password1');
  });
});

describe('SignInService — sign-up tickets (Q14)', () => {
  it('creates the account the ticket was issued for, with that channel', async () => {
    const { service, sender, created } = makeService();
    await service.sendEmailCode('fresh@example.com', 'sign-in');
    const outcome = await service.redeemSignInCode('fresh@example.com', sender.last().code);
    if (outcome.status !== 'sign-up') throw new Error('expected sign-up');
    await service.completeSignUp({ signUpTicket: outcome.signUpTicket, username: 'fresh', password: 'pw-123456' });
    expect(created[0]).toMatchObject({ email: 'fresh@example.com', phone: null, username: 'fresh', password: 'pw-123456' });
  });

  it('never gives a phone account a password', async () => {
    const { service, created } = makeService();
    const outcome = await service.phoneSignIn('tok-new');
    if (outcome.status !== 'sign-up') throw new Error('expected sign-up');
    await service.completeSignUp({ signUpTicket: outcome.signUpTicket, username: 'phoney', password: 'ignored-1' });
    expect(created[0]).toMatchObject({ phone: '+15550002222', email: null, password: null });
  });

  it('rejects a forged or foreign ticket', async () => {
    const { service } = makeService();
    await expect(service.completeSignUp({ signUpTicket: 'not-a-ticket', username: 'x_y_z' })).rejects.toThrow('expired');
  });

  it('signs a known phone straight in', async () => {
    const { service } = makeService();
    expect((await service.phoneSignIn('tok-known')).status).toBe('signed-in');
  });

  it('reports phone sign-in unavailable when Firebase is not configured', async () => {
    const { service } = makeService({ phone: { configured: false } });
    await expect(service.phoneSignIn('tok-known')).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('SignInService — step-up (Q24)', () => {
  it('issues a step-up token for the right password and accepts it for that account only', async () => {
    const { service } = makeService();
    const token = await service.verifyStepUp('u1', { password: 'right-password1' });
    expect(() => service.assertStepUp('u1', token)).not.toThrow();
    expect(() => service.assertStepUp('someone-else', token)).toThrow(DALError);
  });

  it('refuses a wrong password and a missing token', async () => {
    const { service } = makeService();
    await expect(service.verifyStepUp('u1', { password: 'nope' })).rejects.toThrow('incorrect');
    expect(() => service.assertStepUp('u1', undefined)).toThrow(DALError);
  });

  it('gates an email change on a step-up token', async () => {
    const { service } = makeService();
    await expect(service.startEmailChange('u1', 'next@example.com', 'bogus')).rejects.toMatchObject({ statusCode: 403 });
  });
});
