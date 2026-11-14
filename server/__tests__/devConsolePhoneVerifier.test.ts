import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevConsolePhoneVerifier, createPhoneVerifier } from '../services/auth/DevConsolePhoneVerifier.js';
import { FirebasePhoneVerifier, PhoneVerificationError } from '../services/auth/FirebasePhoneVerifier.js';

/**
 * The dev stand-in for Firebase Phone Auth (docs/LOGIN_REWORK.md § 4c). What must hold: it is
 * NEVER picked on production, a code is single-use and capped, and its token is single-use.
 */

/** Send a code and read it back from the console line, as a developer would. */
function sendAndRead(v: DevConsolePhoneVerifier, phone: string): string {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  v.sendCode(phone);
  const line = String(log.mock.calls.at(-1)?.[0] ?? '');
  log.mockRestore();
  return /: (\d{6}) /.exec(line)?.[1] ?? '';
}

afterEach(() => vi.restoreAllMocks());

describe('createPhoneVerifier', () => {
  it('uses Firebase whenever a project id is set', () => {
    expect(createPhoneVerifier({ FIREBASE_PROJECT_ID: 'p', NODE_ENV: 'development' })).toBeInstanceOf(FirebasePhoneVerifier);
  });
  it('never picks the dev stand-in on production', () => {
    const v = createPhoneVerifier({ NODE_ENV: 'production' });
    expect(v).toBeInstanceOf(FirebasePhoneVerifier);
    expect(v.configured).toBe(false);
  });
  it('picks the dev stand-in off production with no Firebase', () => {
    expect(createPhoneVerifier({ NODE_ENV: 'development' })).toBeInstanceOf(DevConsolePhoneVerifier);
  });
});

describe('DevConsolePhoneVerifier', () => {
  const phone = '+12125550123';

  it('turns the printed code into a single-use token for that number', async () => {
    const v = new DevConsolePhoneVerifier();
    const token = v.confirmCode(phone, sendAndRead(v, phone));
    await expect(v.verifyPhoneIdToken(token)).resolves.toBe(phone);
    await expect(v.verifyPhoneIdToken(token)).rejects.toBeInstanceOf(PhoneVerificationError);
  });

  it('rejects a wrong code, then a reused one', () => {
    const v = new DevConsolePhoneVerifier();
    const code = sendAndRead(v, phone);
    expect(() => v.confirmCode(phone, code === '000000' ? '111111' : '000000')).toThrow('That code is wrong');
    v.confirmCode(phone, code);
    expect(() => v.confirmCode(phone, code)).toThrow(PhoneVerificationError);
  });

  it('burns the code after too many tries', () => {
    const v = new DevConsolePhoneVerifier();
    const code = sendAndRead(v, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(() => v.confirmCode(phone, wrong)).toThrow('That code is wrong');
    expect(() => v.confirmCode(phone, code)).toThrow('Too many attempts');
  });

  it('refuses a malformed number', () => {
    expect(() => new DevConsolePhoneVerifier().sendCode('555')).toThrow(PhoneVerificationError);
  });
});
