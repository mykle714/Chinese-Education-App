import { Response } from 'express';
import type { IssuedRefreshToken } from '../services/UserService.js';

/**
 * The auth cookies, shared by every controller that starts or ends a session: UserController
 * (password login, refresh, logout, delete) and SignInController (email codes, phone, sign-up,
 * reset) (docs/TOKEN_EXPIRATION_IMPLEMENTATION.md, docs/LOGIN_REWORK.md § 4).
 *
 * The access-token cookie lives at root (sent with every API request); the refresh-token
 * cookie is scoped to /api/auth so it is only ever sent to the auth endpoints that need it
 * (refresh / logout / delete-account), shrinking its exposure. clearCookie MUST use the same
 * path or the browser keeps the cookie.
 *
 * Layer: controller helper (HTTP only).
 */
export const ACCESS_COOKIE = 'token';
export const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000; // mirrors UserService ACCESS_TOKEN_TTL

// PPE serves over HTTPS (https://mren.me), so auth cookies must never ride a
// plain-HTTP request there. Dev runs on http://localhost, where `secure: true`
// would make the browser drop the cookies entirely — hence the env switch.
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

/**
 * Set the access + refresh cookies after a login or refresh. Both are httpOnly
 * (invisible to JS — XSS can't read them) and, in PPE, `secure`
 * (HTTPS-only). The refresh cookie's lifetime tracks its DB expiry so the
 * browser drops it in lockstep with the server.
 */
export function setAuthCookies(res: Response, accessToken: string, refresh: IssuedRefreshToken): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });
  res.cookie(REFRESH_COOKIE, refresh.rawToken, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: Math.max(0, refresh.expiresAt.getTime() - Date.now()),
  });
}

/** Clear both auth cookies (logout / account deletion). Flags must match the
 *  set call (path + secure) or some browsers keep the cookie. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'lax' });
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}
