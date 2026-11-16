import { useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { ACCORDION_SECTION_GAP, Field, PlateButton, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";

/**
 * "Sign in with password": the second section of both verification windows' Accordion (owner,
 * 2026-11-15; docs/LOGIN_REWORK.md § 3 "Verification windows"). The password moved off the
 * sign-in path: a code signs anyone in, and this is the alternative for an account that set the
 * optional password.
 *
 * It is offered for EVERY identifier, whether or not an account exists, and the server answers
 * every failure the same way (SignInService.passwordSignIn), so opening it reveals nothing.
 * "Forgot password?" lives here too (owner: keep it with the password); the window decides what
 * it does (email: a reset code; phone: the reset version of the phone window).
 *
 * Its own <form> (the code section's form is a sibling, never a parent: forms cannot nest), with
 * a hidden username input so a password manager pairs the saved password with the identifier.
 *
 * Layer: page view (src/pages/login/). Rendered by CodeStep.tsx and PhoneStep.tsx.
 */
interface PasswordSignInFormProps {
    /** The identifier as the password manager knows it (the email, or the E.164 phone). */
    username: string;
    /** Try the password. Throws with the learner-facing message on failure. */
    onSignIn: (password: string) => Promise<void>;
    /** "Forgot password?". May throw with a learner-facing message. */
    onForgot: () => Promise<void> | void;
    /** The window is busy elsewhere (sending, verifying): hold the form's actions. */
    disabled?: boolean;
}

export default function PasswordSignInForm({ username, onSignIn, onForgot, disabled }: PasswordSignInFormProps) {
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState<"sign-in" | "forgot" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        if (!password) {
            setError("Enter your password");
            return;
        }
        setBusy("sign-in");
        setError(null);
        try {
            // On success the window's handler establishes the session; LoginPage redirects.
            await onSignIn(password);
        } catch (err) {
            setError(errorMessage(err));
            setBusy(null);
        }
    };

    const forgot = async () => {
        setBusy("forgot");
        setError(null);
        try {
            await onForgot();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <Box component="form" className="login-password-form" onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: ACCORDION_SECTION_GAP }}>
            <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
            <Field
                className="login-password-form__password"
                label="Password"
                type="password"
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                }}
                autoComplete="current-password"
                error={error}
            />
            <PlateButton className="login-password-form__sign-in" type="submit" busy={busy === "sign-in"} disabled={disabled || busy !== null}>
                Sign in
            </PlateButton>
            <Box className="login-password-form__links" sx={{ display: "flex", justifyContent: "center" }}>
                <TextAction className="login-password-form__forgot" onClick={forgot} disabled={disabled || busy !== null}>
                    Forgot password?
                </TextAction>
            </Box>
        </Box>
    );
}
