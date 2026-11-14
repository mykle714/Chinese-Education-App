import { useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { sendEmailCode, type CodeSent } from "../../api/auth";
import { Field, FormMessage, OrDivider, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";

/**
 * Step 2 for an email (docs/LOGIN_REWORK.md Q17): the SAME screen for every address, known or
 * not — a password field, "Email me a code" (how a new learner signs up), and "Forgot password?".
 * A wrong password and an unknown account read identically (the server sends one message);
 * the hint points a new learner at the code.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface EmailPasswordStepProps {
    email: string;
    onCodeSent: (purpose: "sign-in" | "reset", sent: CodeSent) => void;
    onChangeIdentifier: () => void;
}

export default function EmailPasswordStep({ email, onCodeSent, onChangeIdentifier }: EmailPasswordStepProps) {
    const { login } = useAuth();
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState<"password" | "sign-in" | "reset" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const signIn = async (e: FormEvent) => {
        e.preventDefault();
        if (!password) {
            setError("Enter your password, or get a code instead");
            return;
        }
        setBusy("password");
        setError(null);
        try {
            // On success AuthContext holds the session and LoginPage redirects (R3).
            await login(email, password);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(null);
        }
    };

    const requestCode = async (purpose: "sign-in" | "reset") => {
        setBusy(purpose);
        setError(null);
        try {
            onCodeSent(purpose, await sendEmailCode(email, purpose));
        } catch (err) {
            setError(errorMessage(err));
            setBusy(null);
        }
    };

    const wrongCredentials = error?.startsWith("Wrong email or password");

    return (
        <Box component="form" className="login-email-password-step" onSubmit={signIn} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <StepHeading title="Continue with email" sub={email} />
            {/* The browser's password manager pairs the saved password with this hidden username. */}
            <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
            <Field
                className="login-email-password-step__password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                }}
                autoFocus
                autoComplete="current-password"
            />
            {error && (
                <FormMessage className="login-email-password-step__error">
                    {wrongCredentials ? "Wrong email or password. New here? Email yourself a code below to create your account." : error}
                </FormMessage>
            )}
            <PlateButton className="login-email-password-step__sign-in" type="submit" busy={busy === "password"} disabled={busy !== null}>
                Sign in
            </PlateButton>
            <OrDivider />
            <PlateButton
                className="login-email-password-step__email-code"
                variant="secondary"
                onClick={() => requestCode("sign-in")}
                busy={busy === "sign-in"}
                disabled={busy !== null}
            >
                Email me a code
            </PlateButton>
            <Box className="login-email-password-step__links" sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <TextAction className="login-email-password-step__forgot" onClick={() => requestCode("reset")} disabled={busy !== null}>
                    Forgot password?
                </TextAction>
                <TextAction className="login-email-password-step__change" onClick={onChangeIdentifier} disabled={busy !== null}>
                    Use a different email
                </TextAction>
            </Box>
        </Box>
    );
}
