import { apiGet, apiPost, apiPut } from './http';
import type { UserProfile, UserGender } from '../types';

/**
 * The identifier-first sign-in and account-channel API (docs/LOGIN_REWORK.md § 4; server:
 * server/controllers/SignInController.ts). The password login itself stays in
 * AuthContext.login, which predates this module.
 *
 * Every call that signs someone in returns `SignedIn`; the caller hands `user` + `token` to
 * AuthContext.establishSession. The refresh token arrives as an httpOnly cookie, never here.
 *
 * Layer: client API (all server calls go through http.ts, docs/FRONTEND_LAYERING.md).
 */

export interface SignedIn {
    status: 'signed-in';
    user: UserProfile;
    token: string;
}

/** A verified channel with no account yet: continue to the details step (Q14). */
export interface SignUpNext {
    status: 'sign-up';
    signUpTicket: string;
    suggestedUsername: string;
    channel: 'email' | 'phone';
}

export interface CodeSent {
    resendAfterSeconds: number;
    validMinutes: number;
}

/** Which sign-in methods the server can run (phone needs Firebase configured). */
export const fetchSignInMethods = () => apiGet<{ email: boolean; phone: boolean }>('/api/auth/methods');

/** "Email me a code" / "Forgot password?". Same response whether or not the address has an account. */
export const sendEmailCode = (email: string, purpose: 'sign-in' | 'reset') =>
    apiPost<CodeSent>('/api/auth/email/sendCode', { email, purpose });

export const verifyEmailCode = (email: string, code: string) =>
    apiPost<SignedIn | SignUpNext>('/api/auth/email/verifyCode', { email, code });

export const resetPassword = (email: string, code: string, newPassword: string) =>
    apiPost<SignedIn>('/api/auth/password/reset', { email, code, newPassword });

/** After Firebase's SMS step: the ID token proves the number. */
/** DEV ONLY (DevConsolePhoneVerifier): "text" a code, printed to the backend log. */
export const devSendPhoneCode = (phone: string) => apiPost<{ sent: true }>('/api/auth/phone/devSendCode', { phone });
/** DEV ONLY: the code → a token the phone endpoints accept in place of a Firebase ID token. */
export const devConfirmPhoneCode = (phone: string, code: string) =>
    apiPost<{ idToken: string }>('/api/auth/phone/devConfirmCode', { phone, code });

export const verifyPhone = (idToken: string) => apiPost<SignedIn | SignUpNext>('/api/auth/phone/verify', { idToken });

export interface SignUpDetails {
    signUpTicket: string;
    username: string;
    name: string | null;
    /** Email sign-ups only. */
    password?: string;
    gender: UserGender | null;
    birthDate: string | null;
    tz: string;
}

export const completeSignUp = (details: SignUpDetails) => apiPost<SignedIn>('/api/auth/signUp', details);

export const checkUsername = (username: string, signal?: AbortSignal) =>
    apiGet<{ available: boolean; username?: string; problem?: string }>('/api/auth/usernameAvailable', {
        params: { username },
        signal,
    });

// ── Signed in: settings (Q24) ────────────────────────────────────────────────

export const sendStepUpCode = () => apiPost<CodeSent>('/api/auth/stepUp/sendCode', {});

export type StepUpProof = { password: string } | { code: string } | { phoneIdToken: string };
export const verifyStepUp = (proof: StepUpProof) => apiPost<{ stepUpToken: string }>('/api/auth/stepUp/verify', proof);

export const startEmailChange = (email: string, stepUpToken: string) =>
    apiPost<CodeSent>('/api/auth/email/startChange', { email, stepUpToken });

export const confirmEmailChange = (email: string, code: string) =>
    apiPost<UserProfile>('/api/auth/email/confirmChange', { email, code });

export const changePhone = (idToken: string, stepUpToken: string) =>
    apiPost<UserProfile>('/api/auth/phone/change', { idToken, stepUpToken });

export const changeUsername = (username: string) => apiPut<UserProfile>('/api/users/username', { username });

export const changeName = (name: string | null) => apiPut<UserProfile>('/api/users/name', { name });
