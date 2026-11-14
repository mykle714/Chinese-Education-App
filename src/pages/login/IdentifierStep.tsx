import { useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import AppleIcon from "@mui/icons-material/Apple";
import GoogleIcon from "@mui/icons-material/Google";
import { Field, FieldNote, OrDivider, PlateButton, StepHeading, TextAction } from "./loginUi";
import PhoneDigitsField from "./PhoneDigitsField";
import { parseEmail, parseUsPhoneDigits, type ParsedIdentifier } from "./identifier";

/**
 * Step 1 of the login screen (docs/LOGIN_REWORK.md Q10, amended by the owner 2026-11-14):
 *
 *   PHONE FIRST. The step opens on the ten-box US phone field (PhoneDigitsField) and its gold
 *   Continue. Below an "or": a "Continue with email" button that swaps the phone field for the
 *   Email box (with "Use phone instead" to swap back), then the RESERVED single-sign-on slots.
 *
 *   Until phone sign-in is set up (Firebase on both halves) the phone field and its Continue are
 *   greyed out with "Phone sign-in is coming soon." — still shown first, by the owner's call.
 *
 *   SSO_PROVIDERS are placeholders: disabled buttons with no handler, so the layout already has
 *   their room. Wiring one up means a provider, a server endpoint and an account-linking rule —
 *   none decided yet.
 *
 * Nothing here asks the server whether the account exists (Q13): an email always continues to
 * the password-or-code step, a phone to the SMS step.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */

/** What the learner typed and which box was showing, kept by LoginPage so "change" brings it back. */
export interface IdentifierDraft {
    mode: "phone" | "email";
    email: string;
    /** The ten phone boxes, "" for an empty box. */
    phoneDigits: string[];
}

/** The reserved single-sign-on slots, in display order. Placeholders: none is wired up yet. */
const SSO_PROVIDERS = [
    { id: "apple", label: "Continue with Apple", Icon: AppleIcon },
    { id: "google", label: "Continue with Google", Icon: GoogleIcon },
] as const;

interface IdentifierStepProps {
    initial: IdentifierDraft;
    /** Whether phone sign-in is available (Firebase configured on both halves). Without it the phone field is greyed out. */
    phoneEnabled: boolean;
    onContinue: (id: Extract<ParsedIdentifier, { kind: "email" | "phone" }>, draft: IdentifierDraft) => void;
}

export default function IdentifierStep({ initial, phoneEnabled, onContinue }: IdentifierStepProps) {
    const [mode, setMode] = useState(initial.mode);
    const [email, setEmail] = useState(initial.email);
    const [phoneDigits, setPhoneDigits] = useState(initial.phoneDigits);
    const [error, setError] = useState<string | null>(null);

    const switchTo = (next: IdentifierDraft["mode"]) => {
        setMode(next);
        setError(null);
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const parsed = mode === "phone" ? parseUsPhoneDigits(phoneDigits) : parseEmail(email);
        if (parsed.kind === "invalid") {
            setError(parsed.message);
            return;
        }
        onContinue(parsed, { mode, email, phoneDigits });
    };

    return (
        <Box className="login-identifier-step" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <StepHeading
                title="Welcome"
                sub={mode === "phone" ? "Sign in or create an account with your phone number." : "Sign in or create an account with your email."}
            />

            {/* The one form: phone or email, whichever is showing. Enter submits it. */}
            <Box component="form" className={`login-identifier-step__form login-identifier-step__form--${mode}`} onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {mode === "phone" ? (
                    <>
                        <PhoneDigitsField
                            digits={phoneDigits}
                            onChange={(next) => {
                                setPhoneDigits(next);
                                setError(null);
                            }}
                            disabled={!phoneEnabled}
                            autoFocus={phoneEnabled}
                            error={error}
                            hint={phoneEnabled ? "US and Canada numbers. We'll text you a code." : "Phone sign-in is coming soon."}
                        />
                        <PlateButton className="login-identifier-step__phone-continue" type="submit" disabled={!phoneEnabled}>
                            Continue
                        </PlateButton>
                    </>
                ) : (
                    <>
                        <Field
                            className="login-identifier-step__email"
                            label="Email"
                            type="email"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                setError(null);
                            }}
                            placeholder="you@example.com"
                            autoFocus
                            autoComplete="username email"
                            inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false, inputMode: "email" }}
                            error={error}
                        />
                        <PlateButton className="login-identifier-step__email-continue" type="submit">
                            Continue
                        </PlateButton>
                        <Box className="login-identifier-step__back-to-phone" sx={{ display: "flex", justifyContent: "center" }}>
                            <TextAction className="login-identifier-step__use-phone" onClick={() => switchTo("phone")}>
                                Use phone instead
                            </TextAction>
                        </Box>
                    </>
                )}
            </Box>

            <OrDivider />

            {/* The other ways in: email (when the phone field is showing), then the SSO slots. */}
            <Box className="login-identifier-step__alternatives" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {mode === "phone" && (
                    <PlateButton className="login-identifier-step__use-email" variant="secondary" onClick={() => switchTo("email")}>
                        Continue with email
                    </PlateButton>
                )}
                {SSO_PROVIDERS.map(({ id, label, Icon }) => (
                    <PlateButton key={id} className={`login-identifier-step__sso login-identifier-step__sso--${id}`} variant="secondary" disabled>
                        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                            <Icon className="login-identifier-step__sso-icon" sx={{ fontSize: 20 }} />
                            {label}
                        </Box>
                    </PlateButton>
                ))}
                <FieldNote hint="Apple and Google sign-in are coming soon." />
            </Box>
        </Box>
    );
}
