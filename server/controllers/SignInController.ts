import { Request, Response } from 'express';
import { UserService } from '../services/UserService.js';
import { SignInService, type SignInOutcome } from '../services/auth/SignInService.js';
import { DALError } from '../types/dal.js';
import type { AuthResponse } from '../types/index.js';
import { clearAuthCookies, setAuthCookies } from './authCookies.js';
import { respondWithError } from './httpErrors.js';

/**
 * SignInController — HTTP for the identifier-first sign-in and the account-channel settings
 * (docs/LOGIN_REWORK.md § 4, routes in server/routes/authRoutes.ts):
 *
 *   POST /api/auth/email/sendCode        { email, purpose: 'sign-in' | 'reset' }
 *   POST /api/auth/email/verifyCode      { email, code }            → signed-in | sign-up
 *   POST /api/auth/password/reset        { email, code, newPassword } → signed-in
 *   POST /api/auth/phone/verify          { idToken }                → signed-in | sign-up
 *   POST /api/auth/signUp                { signUpTicket, username, name?, password?, gender?, birthDate?, tz? }
 *   GET  /api/auth/usernameAvailable     ?username=
 *   GET  /api/auth/methods               → which sign-in methods this server can run
 *   (dev only, DevConsolePhoneVerifier)
 *   POST /api/auth/phone/devSendCode     { phone }                  → code printed to the backend log
 *   POST /api/auth/phone/devConfirmCode  { phone, code }            → { idToken }
 *   (authenticated)
 *   POST /api/auth/stepUp/sendCode       {}                         → code to the account's email
 *   POST /api/auth/stepUp/verify         { password } | { code } | { phoneIdToken } → { stepUpToken }
 *   POST /api/auth/email/startChange     { email, stepUpToken }
 *   POST /api/auth/email/confirmChange   { email, code }            → user
 *   POST /api/auth/phone/change          { idToken, stepUpToken }   → user
 *   PUT  /api/users/username             { username }               → user
 *   PUT  /api/users/name                 { name }                   → user
 *   DELETE /api/auth/deleteAccount       { password } | { stepUpToken }
 *
 * Every response that signs someone in sets the cookies here (authCookies.ts) and returns
 * `{ status: 'signed-in', user, token }`; a sign-up continuation returns
 * `{ status: 'sign-up', signUpTicket, suggestedUsername, channel }`.
 *
 * Layer: controller. Logic lives in SignInService / UserService.
 */
export class SignInController {
  constructor(
    private readonly signInService: SignInService,
    private readonly userService: UserService,
  ) {}


  // ── Route handlers: each runs its Impl and maps errors (httpErrors.ts) ─────────
  methods = (req: Request, res: Response): Promise<void> => this.run(req, res, this.methodsImpl);
  sendEmailCode = (req: Request, res: Response): Promise<void> => this.run(req, res, this.sendEmailCodeImpl);
  verifyEmailCode = (req: Request, res: Response): Promise<void> => this.run(req, res, this.verifyEmailCodeImpl);
  resetPassword = (req: Request, res: Response): Promise<void> => this.run(req, res, this.resetPasswordImpl);
  phoneVerify = (req: Request, res: Response): Promise<void> => this.run(req, res, this.phoneVerifyImpl);
  devSendPhoneCode = (req: Request, res: Response): Promise<void> => this.run(req, res, this.devSendPhoneCodeImpl);
  devConfirmPhoneCode = (req: Request, res: Response): Promise<void> => this.run(req, res, this.devConfirmPhoneCodeImpl);
  signUp = (req: Request, res: Response): Promise<void> => this.run(req, res, this.signUpImpl);
  usernameAvailable = (req: Request, res: Response): Promise<void> => this.run(req, res, this.usernameAvailableImpl);
  sendStepUpCode = (req: Request, res: Response): Promise<void> => this.run(req, res, this.sendStepUpCodeImpl);
  verifyStepUp = (req: Request, res: Response): Promise<void> => this.run(req, res, this.verifyStepUpImpl);
  startEmailChange = (req: Request, res: Response): Promise<void> => this.run(req, res, this.startEmailChangeImpl);
  confirmEmailChange = (req: Request, res: Response): Promise<void> => this.run(req, res, this.confirmEmailChangeImpl);
  changePhone = (req: Request, res: Response): Promise<void> => this.run(req, res, this.changePhoneImpl);
  changeUsername = (req: Request, res: Response): Promise<void> => this.run(req, res, this.changeUsernameImpl);
  changeName = (req: Request, res: Response): Promise<void> => this.run(req, res, this.changeNameImpl);
  deleteAccount = (req: Request, res: Response): Promise<void> => this.run(req, res, this.deleteAccountImpl);

  /** Run a handler, turning anything it throws into the app's JSON error response. */
  private async run(req: Request, res: Response, impl: (req: Request, res: Response) => Promise<void>): Promise<void> {
    try {
      await impl.call(this, req, res);
    } catch (error) {
      respondWithError(res, error, 'SignInController');
    }
  }

  private userIdOf(req: Request): string {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) throw new DALError('User not authenticated', 'ERR_NOT_AUTHENTICATED', 401);
    return userId;
  }

  /** Issue the refresh token, set both cookies, and send the signed-in body. */
  private async sendSignedIn(req: Request, res: Response, auth: AuthResponse): Promise<void> {
    const refresh = await this.userService.issueRefreshToken(auth.user.id, req.headers['user-agent'] ?? null);
    setAuthCookies(res, auth.token, refresh);
    res.json({ status: 'signed-in', user: auth.user, token: auth.token });
  }

  private async sendOutcome(req: Request, res: Response, outcome: SignInOutcome): Promise<void> {
    if (outcome.status === 'signed-in') {
      await this.sendSignedIn(req, res, outcome.auth);
      return;
    }
    res.json(outcome);
  }

  private async methodsImpl(_req: Request, res: Response): Promise<void> {
    res.json({ email: true, phone: this.signInService.phoneConfigured });
  }

  private async sendEmailCodeImpl(req: Request, res: Response): Promise<void> {
    const { email, purpose } = req.body ?? {};
    const kind = purpose === 'reset' ? 'reset' : 'sign-in';
    res.json(await this.signInService.sendEmailCode(email, kind));
  }

  private async verifyEmailCodeImpl(req: Request, res: Response): Promise<void> {
    const { email, code } = req.body ?? {};
    await this.sendOutcome(req, res, await this.signInService.redeemSignInCode(email, code));
  }

  private async resetPasswordImpl(req: Request, res: Response): Promise<void> {
    const { email, code, newPassword } = req.body ?? {};
    await this.sendSignedIn(req, res, await this.signInService.resetPassword(email, code, newPassword));
  }

  private async phoneVerifyImpl(req: Request, res: Response): Promise<void> {
    const { idToken } = req.body ?? {};
    await this.sendOutcome(req, res, await this.signInService.phoneSignIn(idToken));
  }

  private async devSendPhoneCodeImpl(req: Request, res: Response): Promise<void> {
    this.signInService.sendDevPhoneCode(req.body?.phone);
    res.json({ sent: true });
  }

  private async devConfirmPhoneCodeImpl(req: Request, res: Response): Promise<void> {
    const { phone, code } = req.body ?? {};
    res.json(this.signInService.confirmDevPhoneCode(phone, code));
  }

  private async signUpImpl(req: Request, res: Response): Promise<void> {
    const { signUpTicket, username, name, password, gender, birthDate, tz } = req.body ?? {};
    const auth = await this.signInService.completeSignUp({
      signUpTicket,
      username,
      name,
      password,
      gender,
      birthDate,
      timezone: tz,
    });
    await this.sendSignedIn(req, res, auth);
  }

  /** Live check for the username field. Usernames are public, so this leaks nothing. */
  private async usernameAvailableImpl(req: Request, res: Response): Promise<void> {
    const raw = typeof req.query.username === 'string' ? req.query.username : '';
    const viewerId = (req as any).user?.userId as string | undefined;
    try {
      const username = await this.userService.assertUsernameAvailable(raw, viewerId);
      res.json({ available: true, username });
    } catch (e) {
      if (e instanceof DALError && (e.statusCode === 400 || e.statusCode === 409)) {
        res.json({ available: false, problem: e.message });
        return;
      }
      throw e;
    }
  }

  private async sendStepUpCodeImpl(req: Request, res: Response): Promise<void> {
    res.json(await this.signInService.sendStepUpCode(this.userIdOf(req)));
  }

  private async verifyStepUpImpl(req: Request, res: Response): Promise<void> {
    const { password, code, phoneIdToken } = req.body ?? {};
    const proof =
      typeof password === 'string' ? { password }
      : typeof code === 'string' ? { code }
      : { phoneIdToken: String(phoneIdToken ?? '') };
    const stepUpToken = await this.signInService.verifyStepUp(this.userIdOf(req), proof);
    res.json({ stepUpToken });
  }

  private async startEmailChangeImpl(req: Request, res: Response): Promise<void> {
    const { email, stepUpToken } = req.body ?? {};
    res.json(await this.signInService.startEmailChange(this.userIdOf(req), email, stepUpToken));
  }

  private async confirmEmailChangeImpl(req: Request, res: Response): Promise<void> {
    const { email, code } = req.body ?? {};
    res.json(await this.signInService.confirmEmailChange(this.userIdOf(req), email, code));
  }

  private async changePhoneImpl(req: Request, res: Response): Promise<void> {
    const { idToken, stepUpToken } = req.body ?? {};
    res.json(await this.signInService.changePhone(this.userIdOf(req), idToken, stepUpToken));
  }

  private async changeUsernameImpl(req: Request, res: Response): Promise<void> {
    res.json(await this.userService.changeUsername(this.userIdOf(req), req.body?.username));
  }

  private async changeNameImpl(req: Request, res: Response): Promise<void> {
    const name = req.body?.name;
    res.json(await this.userService.changeName(this.userIdOf(req), typeof name === 'string' ? name : null));
  }

  /**
   * DELETE /api/auth/deleteAccount — with the password (an email account) or a step-up token
   * (any account; the only way for a phone account). The credential is checked BEFORE any
   * session is revoked: the old handler revoked every refresh token first, so a mistyped
   * password still logged the account out everywhere.
   */
  private async deleteAccountImpl(req: Request, res: Response): Promise<void> {
    const userId = this.userIdOf(req);
    const { password, stepUpToken } = req.body ?? {};
    if (typeof stepUpToken === 'string' && stepUpToken) {
      await this.signInService.deleteAccountWithStepUp(userId, stepUpToken);
    } else if (typeof password === 'string' && password) {
      await this.userService.deleteUser(userId, password);
    } else {
      throw new DALError('Please confirm it’s you to delete your account', 'ERR_STEP_UP_REQUIRED', 400);
    }
    // ON DELETE CASCADE removed the account's refresh_tokens rows with it.
    clearAuthCookies(res);
    res.json({ message: 'Account deleted successfully' });
  }
}
