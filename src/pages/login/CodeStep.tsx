import { useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { resetPassword, sendEmailCode, verifyEmailCode, type SignUpNext } from "../../api/auth";
import { Field, FormMessage, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";
import { useResendCountdown } from "./useResendCountdown";

/**
 * Step 3 for an email: enter the 6-digit code (docs/LOGIN_REWORK.md Q8, Q11, Q16).
 *
 *   purpose "sign-in": a known address is signed in; an unknown one continues to the details
 *                      step with a sign-up ticket (verify first, then details: Q14).
 *   purpose "reset":   the code plus a new password; success signs this device in and signs
 *                      every other device out (server: SignInService.resetPassword).
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface CodeStepProps {
    email: string;
    purpose: "sign-in" | "reset";
    resendAfterSeconds: number;
    onSignUp: (next: SignUpNext) => void;
    onBack: () => void;
}

export default function CodeStep({ email, purpose, resendAfterSeconds, onSignUp, onBack }: CodeStepProps) {
    const { establishSession } = useAuth();
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const { secondsLeft, restart } = useResendCountdown(resendAfterSeconds);

    const submit = async (e?: FormEvent) => {
        e?.preventDefault();
        if (busy) return;
        if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from the email");
            return;
        }
        if (purpose === "reset" && !newPassword) {
            setError("Choose a new password");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (purpose === "reset") {
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

    const resend = async () => {
        setError(null);
        setNotice(null);
        try {
            const sent = await sendEmailCode(email, purpose);
            restart(sent.resendAfterSeconds);
            setCode("");
            setNotice("A new code is on its way. Only the newest code works.");
        } catch (err) {
            setError(errorMessage(err));
        }
    };

    return (
        <Box component="form" className={`login-code-step login-code-step--${purpose}`} onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <StepHeading
                title={purpose === "reset" ? "Reset your password" : "Check your email"}
                sub={
                    purpose === "reset"
                        ? `If ${email} has an account, we sent it a code.`
                        : `We sent a 6-digit code to ${email}.`
                }
            />
            <Field
                className="login-code-step__code"
                label="Code"
                value={code}
                onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(digits);
                    setError(null);
                }}
                autoFocus
                autoComplete="one-time-code"
                placeholder="123456"
                inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 }}
                sx={{ letterSpacing: "0.3em", fontWeight: 600 }}
            />
            {purpose === "reset" && (
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
            {error && <FormMessage className="login-code-step__error">{error}</FormMessage>}
            {notice && !error && <FormMessage className="login-code-step__notice" tone="notice">{notice}</FormMessage>}
            <PlateButton className="login-code-step__submit" type="submit" busy={busy}>
                {purpose === "reset" ? "Set password" : "Continue"}
            </PlateButton>
            <Box className="login-code-step__links" sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <TextAction className="login-code-step__resend" onClick={resend} disabled={secondsLeft > 0 || busy}>
                    {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
                </TextAction>
                <TextAction className="login-code-step__back" onClick={onBack} disabled={busy}>
                    Back
                </TextAction>
            </Box>
        </Box>
    );
}
