import { useRef, useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { passwordSignIn, resetPasswordWithPhone, verifyPhone, type SignUpNext } from "../../api/auth";
import { sendSmsCode, type PendingSms } from "../../utils/firebasePhone";
import { ACCORDION_SECTION_GAP, Accordion, CodeLinksRow, Field, FormMessage, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";
import { useResendCountdown } from "./useResendCountdown";
import PasswordSignInForm from "./PasswordSignInForm";
import { passwordProblem } from "../../../server/contracts/wire";
import {
    TEST_NO_PHONE_ACCOUNT_MESSAGE,
    TEST_SIGN_UP_CODE,
    TEST_WRONG_PHONE_CREDENTIALS_MESSAGE,
    isTestSignUpPhone,
    testDelay,
    testSignUpNext,
} from "./testSignUp";

/** Firebase's resend window is its own; 30 s matches the email cooldown the learner already knows. */
const SMS_RESEND_SECONDS = 30;
/** Firebase's wording for a wrong SMS code (src/utils/firebasePhone.ts), reused by the test number. */
const WRONG_SMS_CODE_MESSAGE = "That code is wrong";

/**
 * Step 2 for a phone: the verification window (docs/LOGIN_REWORK.md Q3, Q6; reshaped by the
 * owner 2026-11-15). The SMS goes out only when the learner taps "Text me a code" (owner: always
 * on tap; a text costs money, and a password user should not trigger one). Firebase sends it
 * behind an invisible reCAPTCHA mounted in `recaptchaRef`; the code becomes a Firebase ID token.
 *
 *   purpose "sign-in": our server checks the token: a known number signs in, a new one continues
 *                      to the details step. Below, the folded "Sign in with password" section
 *                      (PasswordSignInForm, in an Accordion with the code; a phone account may have a password since
 *                      migration 191), whose "Forgot password?" moves to the reset window.
 *   purpose "reset":   the code plus a new password (SignInService.resetPasswordWithPhone):
 *                      success signs this device in and every other device out.
 *
 * As on the email window, the code field is always laid out (disabled until a code is sent) and
 * the primary button's label swaps, so sending moves nothing on the card.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface PhoneStepProps {
    phone: string;
    purpose: "sign-in" | "reset";
    onSignUp: (next: SignUpNext) => void;
    /** "Forgot password?": LoginPage moves to the reset window. */
    onForgotPassword: () => void;
    onBack: () => void;
}

export default function PhoneStep({ phone, purpose, onSignUp, onForgotPassword, onBack }: PhoneStepProps) {
    const { establishSession } = useAuth();
    const recaptchaRef = useRef<HTMLDivElement>(null);
    const codeRef = useRef<HTMLInputElement>(null);
    const pending = useRef<PendingSms | null>(null);
    const [sent, setSent] = useState(false);
    const [sending, setSending] = useState(false);
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Which way in the accordion has open: the code (default) or the password.
    const [section, setSection] = useState<"code" | "password">("code");
    const { secondsLeft, restart } = useResendCountdown(0);
    // The test sign-up number (testSignUp.ts): nothing is sent and nothing reaches the server;
    // TEST_SIGN_UP_CODE continues to the details step, everything else fails as for a number
    // with no account.
    const isTest = isTestSignUpPhone(phone);

    const isReset = purpose === "reset";

    /** Text (or re-text) a code. */
    const send = async () => {
        if (!isTest && !recaptchaRef.current) return;
        setSending(true);
        setError(null);
        try {
            if (isTest) {
                // A pretend send: the same "Sending a code…" beat as a real one.
                await testDelay();
                pending.current = { confirm: async () => "" };
            } else {
                pending.current = await sendSmsCode(phone, recaptchaRef.current as HTMLDivElement);
            }
            restart(SMS_RESEND_SECONDS);
            setCode("");
            setSent(true);
            // The field was disabled until now: hand it the caret once it is enabled.
            window.setTimeout(() => codeRef.current?.focus(), 0);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSending(false);
        }
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy || sending) return;
        if (!sent || !pending.current) {
            await send();
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from the text message");
            return;
        }
        if (isReset && !newPassword) {
            setError("Choose a new password");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (isTest) {
                await testDelay();
                if (code !== TEST_SIGN_UP_CODE) throw new Error(WRONG_SMS_CODE_MESSAGE);
                if (isReset) {
                    // The server checks the new password before looking for the account.
                    throw new Error(passwordProblem(newPassword) ?? TEST_NO_PHONE_ACCOUNT_MESSAGE);
                }
                onSignUp(testSignUpNext("phone"));
                return;
            }
            const idToken = await pending.current.confirm(code);
            if (isReset) {
                const signedIn = await resetPasswordWithPhone(idToken, newPassword);
                establishSession(signedIn.user, signedIn.token);
                return;
            }
            const outcome = await verifyPhone(idToken);
            if (outcome.status === "signed-in") {
                establishSession(outcome.user, outcome.token);
            } else {
                onSignUp(outcome);
            }
        } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
        }
    };

    const signInWithPassword = async (password: string) => {
        if (isTest) {
            await testDelay();
            throw new Error(TEST_WRONG_PHONE_CREDENTIALS_MESSAGE);
        }
        const signedIn = await passwordSignIn({ phone }, password);
        establishSession(signedIn.user, signedIn.token);
    };

    // Firebase's invisible reCAPTCHA mounts here; it must outlive the confirm, so it sits outside
    // the accordion (a folded section would not unmount it, but keep it plainly stable). Out of
    // the flow (absolute, zero-size): no gap, and the accordion stays the card's last child.
    const recaptcha = <Box ref={recaptchaRef} className="login-phone-step__recaptcha" sx={{ position: "absolute", width: 0, height: 0 }} />;

    // The code flow: the code form, then the resend row (no status line: the header says it all,
    // owner 2026-11-15; the button's spinner covers "sending"). On sign-in it is
    // the accordion's first section; on reset it is the whole window.
    const codeFlow = (
        // Spaced exactly like PasswordSignInForm (ACCORDION_SECTION_GAP) and built from the same
        // pieces (field + reserved note line, button, links row), so the two accordion sections
        // are the same height.
        <Box className="login-phone-step__code-flow" sx={{ display: "flex", flexDirection: "column", gap: ACCORDION_SECTION_GAP }}>
            <Box component="form" className="login-phone-step__form" onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: ACCORDION_SECTION_GAP }}>
                <Field
                    ref={codeRef}
                    className="login-phone-step__code"
                    label="Code"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                        setError(null);
                    }}
                    disabled={!sent}
                    autoComplete="one-time-code"
                    placeholder="123456"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 }}
                    sx={{ letterSpacing: "0.3em", fontWeight: 600 }}
                    // On sign-in the error sits in the field's reserved note line (as the password
                    // field's does), so it never grows the section. Reset keeps the form message:
                    // its errors may be about the new password, not the code.
                    error={isReset ? undefined : error}
                />
                {isReset && (
                    <Field
                        className="login-phone-step__new-password"
                        label="New password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => {
                            setNewPassword(e.target.value);
                            setError(null);
                        }}
                        autoComplete="new-password"
                        hint="At least 8 characters, with a letter and a number."
                    />
                )}
                {isReset && error && <FormMessage className="login-phone-step__error">{error}</FormMessage>}
                <PlateButton className="login-phone-step__submit" type="submit" busy={busy || (sending && !sent)}>
                    {!sent ? "Text me a code" : isReset ? "Set password" : "Continue"}
                </PlateButton>
            </Box>
            <CodeLinksRow
                className="login-phone-step__links"
                secondsLeft={secondsLeft}
                resendDisabled={!sent || secondsLeft > 0 || sending || busy}
                onResend={send}
                // On sign-in the way back lives in the heading ("Change"), reachable from both sections.
                {...(isReset ? { backLabel: "Back", onBack, backDisabled: busy } : {})}
            />
        </Box>
    );

    if (isReset) {
        return (
            <Box className="login-phone-step login-phone-step--reset" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* No number on screen (owner, 2026-11-15); Back returns to the sign-in window. */}
                <StepHeading title="Reset your password" />
                {codeFlow}
                {recaptcha}
            </Box>
        );
    }

    return (
        <Box className="login-phone-step login-phone-step--sign-in" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* The number is not shown (owner, 2026-11-15): just a way back to step 1, under the
                heading so it is reachable whichever accordion section is open. */}
            <StepHeading title="Continue with phone" />
            <Box className="login-phone-step__change" sx={{ display: "flex", mt: -1.5, ml: -0.5 }}>
                <TextAction className="login-phone-step__use-different-number" onClick={onBack} disabled={busy}>
                    Use a different phone number
                </TextAction>
            </Box>
            {recaptcha}
            {/* A proper accordion: exactly one way in is open at a time. */}
            <Accordion
                className="login-phone-step-ways"
                open={section}
                onOpen={setSection}
                items={[
                    { id: "code", label: "Text me a 6-digit code", content: codeFlow },
                    {
                        id: "password",
                        label: "Sign in with password",
                        content: <PasswordSignInForm username={phone} onSignIn={signInWithPassword} onForgot={onForgotPassword} disabled={busy || sending} />,
                    },
                ]}
            />
        </Box>
    );
}
