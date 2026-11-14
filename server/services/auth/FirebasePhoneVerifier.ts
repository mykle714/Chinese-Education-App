import jwt from 'jsonwebtoken';

/**
 * FirebasePhoneVerifier — turns a Firebase ID token into a verified E.164 phone number
 * (docs/LOGIN_REWORK.md § 4c). The client runs Firebase Phone Auth (Google sends the SMS);
 * the server only checks the resulting ID token and then issues the app's OWN session.
 *
 * Verified by hand, following Firebase's documented rules for third-party verification,
 * rather than through `firebase-admin`: no new server dependency (the backend container's
 * node_modules is a musl volume that a host install does not reach), and the check is small:
 *   - RS256, signed by a key from Google's securetoken x509 set (`kid` in the header);
 *   - `aud` = the Firebase project id, `iss` = https://securetoken.google.com/<project>;
 *   - `exp` in the future, `iat` / `auth_time` in the past, `sub` non-empty;
 *   - a `phone_number` claim (the token came from a phone sign-in).
 * The key set is cached for as long as Google's Cache-Control allows.
 *
 * Configured by FIREBASE_PROJECT_ID. Without it `configured` is false and phone sign-in
 * reports itself unavailable.
 *
 * Layer: service adapter (external I/O).
 */

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export class PhoneVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneVerificationError';
  }
}

export interface PhoneVerifier {
  readonly configured: boolean;
  /** The verified E.164 number, or throws PhoneVerificationError. */
  verifyPhoneIdToken(idToken: string): Promise<string>;
}

export class FirebasePhoneVerifier implements PhoneVerifier {
  private certs: Record<string, string> | null = null;
  private certsExpireAt = 0;

  constructor(private readonly projectId: string | undefined) {}

  get configured(): boolean {
    return !!this.projectId;
  }

  private async publicKeys(): Promise<Record<string, string>> {
    if (this.certs && Date.now() < this.certsExpireAt) return this.certs;
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new PhoneVerificationError(`Could not fetch Google's signing keys (HTTP ${res.status})`);
    const certs = (await res.json()) as Record<string, string>;
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.certs = certs;
    this.certsExpireAt = Date.now() + maxAge * 1000;
    return certs;
  }

  async verifyPhoneIdToken(idToken: string): Promise<string> {
    if (!this.projectId) throw new PhoneVerificationError('Phone sign-in is not configured');
    if (typeof idToken !== 'string' || idToken.length < 20) throw new PhoneVerificationError('Missing ID token');

    const header = jwt.decode(idToken, { complete: true })?.header;
    if (!header || header.alg !== 'RS256' || !header.kid) throw new PhoneVerificationError('Malformed ID token');
    const cert = (await this.publicKeys())[header.kid];
    if (!cert) throw new PhoneVerificationError('ID token signed by an unknown key');

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(idToken, cert, {
        algorithms: ['RS256'],
        audience: this.projectId,
        issuer: `https://securetoken.google.com/${this.projectId}`,
      }) as jwt.JwtPayload;
    } catch (e) {
      throw new PhoneVerificationError(`ID token rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (!claims.sub) throw new PhoneVerificationError('ID token has no subject');
    if (typeof claims.auth_time !== 'number' || claims.auth_time > now + 60) {
      throw new PhoneVerificationError('ID token has a bad auth_time');
    }
    const phone = claims.phone_number;
    if (typeof phone !== 'string' || !/^\+[1-9][0-9]{6,14}$/.test(phone)) {
      throw new PhoneVerificationError('ID token carries no phone number');
    }
    return phone;
  }
}
