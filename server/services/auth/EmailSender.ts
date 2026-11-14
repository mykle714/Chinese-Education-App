/**
 * EmailSender — how SignInService delivers a verification code (docs/LOGIN_REWORK.md § 4a–4b).
 *
 * Two transports, picked at startup by `createEmailSender`:
 *   • ResendEmailSender  — when RESEND_API_KEY is set. Sends from EMAIL_FROM (default
 *     `no-reply@mren.me`, the owner-approved sender until the app has a product domain).
 *     The domain needs Resend's SPF + DKIM records and a DMARC record in Cloudflare.
 *   • ConsoleEmailSender — dev only (NODE_ENV !== 'production'): logs the code to the server
 *     console so the flow is testable with no account. In production a missing key makes
 *     every send fail loudly instead of silently dropping codes.
 *
 * Layer: service adapter (external I/O). No HTTP or SQL knowledge beyond the Resend call.
 */

export interface VerificationEmail {
  to: string;
  /** The 6-digit code. */
  code: string;
  /** What the code is for, to word the message. */
  purpose: 'sign-in' | 'reset' | 'verify-new-email' | 'step-up';
  /** Minutes until it expires, for the message. */
  validMinutes: number;
}

export interface EmailSender {
  /** Whether real mail goes out (false = the dev console transport). */
  readonly live: boolean;
  sendVerificationCode(email: VerificationEmail): Promise<void>;
}

/** Thrown when the transport is not configured or the provider refused the send. */
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

const SUBJECTS: Record<VerificationEmail['purpose'], string> = {
  'sign-in': 'Your sign-in code',
  reset: 'Reset your password',
  'verify-new-email': 'Confirm your email',
  'step-up': 'Confirm it’s you',
};

const LEADS: Record<VerificationEmail['purpose'], string> = {
  'sign-in': 'Use this code to sign in or finish creating your account.',
  reset: 'Use this code to set a new password.',
  'verify-new-email': 'Use this code to confirm this email address for your account.',
  'step-up': 'Use this code to confirm a change to your account.',
};

/** Plain-text + minimal HTML bodies. Kept tiny: a code email is read on a phone, once. */
function renderBodies(email: VerificationEmail): { subject: string; text: string; html: string } {
  const subject = `${SUBJECTS[email.purpose]}: ${email.code}`;
  const lead = LEADS[email.purpose];
  const tail = `It expires in ${email.validMinutes} minutes. If you didn't ask for it, you can ignore this email.`;
  const text = `${lead}\n\n${email.code}\n\n${tail}\n`;
  const html =
    `<p>${lead}</p>` +
    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">${email.code}</p>` +
    `<p style="color:#666">${tail}</p>`;
  return { subject, text, html };
}

export class ResendEmailSender implements EmailSender {
  readonly live = true;
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendVerificationCode(email: VerificationEmail): Promise<void> {
    const { subject, text, html } = renderBodies(email);
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [email.to], subject, text, html }),
      });
    } catch (e) {
      throw new EmailDeliveryError(`Resend unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      // The body names the problem (unverified domain, bad key); log it, never the code.
      const detail = await res.text().catch(() => '');
      throw new EmailDeliveryError(`Resend refused the send (HTTP ${res.status}): ${detail.slice(0, 300)}`);
    }
  }
}

export class ConsoleEmailSender implements EmailSender {
  readonly live = false;
  async sendVerificationCode(email: VerificationEmail): Promise<void> {
    // DEV ONLY. The code is printed so the flow can be tested without a mail account.
    console.log(`📧 [dev email] ${email.purpose} code for ${email.to}: ${email.code} (valid ${email.validMinutes} min)`);
  }
}

class UnconfiguredEmailSender implements EmailSender {
  readonly live = false;
  async sendVerificationCode(): Promise<void> {
    throw new EmailDeliveryError('Email is not configured (RESEND_API_KEY is missing)');
  }
}

/** The transport for this process (see the header). */
export function createEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const key = env.RESEND_API_KEY?.trim();
  if (key) return new ResendEmailSender(key, env.EMAIL_FROM?.trim() || 'no-reply@mren.me');
  return env.NODE_ENV === 'production' ? new UnconfiguredEmailSender() : new ConsoleEmailSender();
}
