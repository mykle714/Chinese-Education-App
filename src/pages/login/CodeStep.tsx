import { useRef, useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { passwordSignIn, resetPassword, sendEmailCode, verifyEmailCode, type CodeSent, type SignUpNext } from "../../api/auth";
import { ACCORDION_SECTION_GAP, Accordion, CodeLinksRow, Field, FormMessage, IdentifierLine, PlateButton, StepHeading, SwapText } from "./loginUi";
import { errorMessage } from "./identifier";
import { useResendCountdown } from "./useResendCountdown";
import PasswordSignInForm from "./PasswordSignInForm";
import { passwordProblem } from "../../../server/contracts/wire";
import {
    TEST_BAD_EMAIL_CODE_MESSAGE,
    TEST_CODE_SENT,
    TEST_SIGN_UP_CODE,
    TEST_WRONG_CREDENTIALS_MESSAGE,
    isTestSignUpEmail,
    testDelay,
    testSignUpNext,
} from "./testSignUp";

/**
 * Step 2 for an email: the verification window (docs/LOGIN_REWORK.md Q8, Q11, Q16; reshaped by
 * the owner 2026-11-15). Every address comes straight here: there is no password window.
 *
 *   purpose "sign-in": nothing is sent until the learner taps "Send code" (owner: always on tap,
 *                      so a password user never triggers an email). The code signs a known
 *                      address in; an unknown one continues to the details step with a sign-up
 *                      ticket (verify first, then details: Q14). Below, the folded "Sign in with
 *                      password" section (PasswordSignInForm, in an Accordion with the code), shown for every address, with
 *                      "Forgot password?", which sends a reset code and moves to the reset window.
 *   purpose "reset":   arrives with the code already sent (`initialSent`): the code plus a new
 *                      password; success signs this device in and every other device out
 *                      (SignInService.resetPassword).
 *
 * The code field is always laid out (disabled until a code is sent) and the primary button's
 * label swaps "Send code" → "Continue", so sending moves nothing on the card.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface CodeStepProps {
    email: string;
    purpose: "sign-in" | "reset";
    /** The send that brought the learner here (reset), or null when nothing is sent yet (sign-in). */
    initialSent: CodeSent | null;
    onSignUp: (next: SignUpNext) => void;
    /** "Forgot password?" sent a reset code: LoginPage moves to the reset window. */
    onResetCodeSent: (sent: CodeSent) => void;
    onBack: () => void;
}

export default function CodeStep({ email, purpose, initialSent, onSignUp, onResetCodeSent, onBack }: CodeStepProps) {
    const { establishSession } = useAuth();
    const [sent, setSent] = useState(initialSent !== null);
    const [sending, setSending] = useState(false);
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Which way in the accordion has open: the code (default) or the password.
    const [section, setSection] = useState<"code" | "password">("code");
    const [notice, setNotice] = useState<string | null>(null);
    const { secondsLeft, restart } = useResendCountdown(initialSent?.resendAfterSeconds ?? 0);
    const codeRef = useRef<HTMLInputElement>(null);
    // The test sign-up email (testSignUp.ts): everything is answered locally, exactly as for an
    // address with no account. Sign-in takes only TEST_SIGN_UP_CODE; a reset always fails.
    const isTest = isTestSignUpEmail(email);

    const isReset = purpose === "reset";

    /** Send (or re-send) a code for this window's purpose. */
    const send = async () => {
        setSending(true);
        setError(null);
        try {
            const result = isTest ? (await testDelay(), TEST_CODE_SENT) : await sendEmailCode(email, purpose);
            restart(result.resendAfterSeconds);
            setCode("");
            if (sent) setNotice("A new code is on its way. Only the newest code works.");
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
        if (!sent) {
            await send();
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from the email");
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
                if (isReset) {
                    // The server checks the new password before the code (SignInService.resetPassword).
                    throw new Error(passwordProblem(newPassword) ?? TEST_BAD_EMAIL_CODE_MESSAGE);
                }
                if (code !== TEST_SIGN_UP_CODE) throw new Error(TEST_BAD_EMAIL_CODE_MESSAGE);
                onSignUp(testSignUpNext("email"));
                return;
            }
            if (isReset) {
                const signedIn = await resetPassword(email, code, newPassword);
                establishSession(signedIn.user, signedIn.token);
                return;
            }
            const outcome = await verifyEmailCode(email, code);
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
            throw new Error(TEST_WRONG_CREDENTIALS_MESSAGE);
        }
        const signedIn = await passwordSignIn({ email }, password);
        establishSession(signedIn.user, signedIn.token);
    };

    const forgotPassword = async () => {
        onResetCodeSent(isTest ? (await testDelay(), TEST_CODE_SENT) : await sendEmailCode(email, "reset"));
    };

    // The code flow: the status line (sign-in), the code form, the resend row. On sign-in it is
    // the accordion's first section; on reset it is the whole window.
    const codeFlow = (
        // Spaced exactly like PasswordSignInForm (ACCORDION_SECTION_GAP) and built from the same
        // pieces (field + reserved note line, button, links row), so the two accordion sections
        // are the same height. The status ("We'll email…" / "We emailed…" / "New code sent…")
        // rides in the code field's note line, where the password field keeps its error line.
        <Box className="login-code-step__code-flow" sx={{ display: "flex", flexDirection: "column", gap: ACCORDION_SECTION_GAP }}>
            <Box component="form" className="login-code-step__form" onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: ACCORDION_SECTION_GAP }}>
                <Field
                    ref={codeRef}
                    className="login-code-step__code"
                    label="Code"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                        setError(null);
                    }}
                    autoFocus={sent}
                    disabled={!sent}
                    autoComplete="one-time-code"
                    placeholder="123456"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 }}
                    sx={{ letterSpacing: "0.3em", fontWeight: 600 }}
                    // On sign-in the error and the status share the field's reserved note line
                    // (it never grows the section). Reset keeps the form message: its errors may be
                    // about the new password, not the code.
                    error={isReset ? undefined : error}
                    hint={
                        isReset ? undefined : (
                            // All wordings share one box (SwapText): a send cannot re-wrap the line.
                            <SwapText
                                className="login-code-step__status"
                                texts={["We'll email you a 6-digit code.", "We emailed you a 6-digit code.", "New code sent. Only the newest works."]}
                                active={notice ? 2 : sent ? 1 : 0}
                            />
                        )
                    }
                />
                {isReset && (
                    <Field
                        className="login-code-step__new-password"
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
                {isReset && error && <FormMessage className="login-code-step__error">{error}</FormMessage>}
                {isReset && notice && !error && (
                    <FormMessage className="login-code-step__notice" tone="notice">
                        {notice}
                    </FormMessage>
                )}
                <PlateButton className="login-code-step__submit" type="submit" busy={busy || (sending && !sent)}>
                    {!sent ? "Send code" : isReset ? "Set password" : "Continue"}
                </PlateButton>
            </Box>
            <CodeLinksRow
                className="login-code-step__links"
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
            <Box className="login-code-step login-code-step--reset" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <StepHeading title="Reset your password" sub={`If ${email} has an account, we sent it a code.`} />
                {codeFlow}
            </Box>
        );
    }

    return (
        <Box className="login-code-step login-code-step--sign-in" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <StepHeading title="Continue with email" sub={<IdentifierLine className="login-code-step__identifier" text={email} onChange={onBack} disabled={busy} />} />
            {/* A proper accordion: exactly one way in is open at a time. */}
            <Accordion
                className="login-code-step-ways"
                open={section}
                onOpen={setSection}
                items={[
                    { id: "code", label: "Email me a code", content: codeFlow },
                    {
                        id: "password",
                        label: "Sign in with password",
                        content: <PasswordSignInForm username={email} onSignIn={signInWithPassword} onForgot={forgotPassword} disabled={busy || sending} />,
                    },
                ]}
            />
        </Box>
    );
}
