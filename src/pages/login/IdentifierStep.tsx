import { useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import AppleIcon from "@mui/icons-material/Apple";
import GoogleIcon from "@mui/icons-material/Google";
import { Disclosure, Field, FieldNote, PlateButton, StepHeading } from "./loginUi";
import PhoneDigitsField from "./PhoneDigitsField";
import { isTestSignUpPhone } from "./testSignUp";
import { US_PHONE_DIGITS, parseEmail, parseUsPhoneDigits, type ParsedIdentifier } from "./identifier";

/**
 * Step 1 of the login screen (docs/LOGIN_REWORK.md Q10, amended by the owner 2026-11-14):
 *
 *   PHONE FIRST. The step opens on the ten-box US phone field (PhoneDigitsField) and its gold
 *   Continue, under a bare "Welcome" (no subline). Everything else is folded away behind an
 *   "Other ways to sign in" disclosure (owner, 2026-11-15: the open layout was too loud): a "Continue
 *   with email" button that swaps the phone field for the Email box (and, on the email side, a
 *   mirror "Continue with phone" that swaps back), then the RESERVED single-sign-on slots. The
 *   disclosure starts closed, and closes again when the learner switches.
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
    /** Phone ⇄ email swapped: a new window, so LoginPage slides the card (WindowSlide). */
    onModeChange?: (mode: IdentifierDraft["mode"]) => void;
}

export default function IdentifierStep({ initial, phoneEnabled, onContinue, onModeChange }: IdentifierStepProps) {
    const [mode, setMode] = useState(initial.mode);
    const [email, setEmail] = useState(initial.email);
    const [phoneDigits, setPhoneDigits] = useState(initial.phoneDigits);
    const [error, setError] = useState<string | null>(null);
    /** Whether the "Other ways to sign in" disclosure (email, SSO) is open. Starts closed. */
    const [othersOpen, setOthersOpen] = useState(false);
    // Off for the close that comes with a phone ⇄ email swap: the incoming window should arrive
    // already folded, not fold up while it slides in. Back on at the next tap of the section.
    const [othersAnimate, setOthersAnimate] = useState(true);

    const switchTo = (next: IdentifierDraft["mode"]) => {
        setMode(next);
        setError(null);
        // Switching phone ⇄ email from the disclosure is the disclosure's job done: fold it back
        // up, at once (see othersAnimate).
        setOthersAnimate(false);
        setOthersOpen(false);
        onModeChange?.(next);
    };

    // The phone Continue stays greyed out until the ten spots hold a valid number (owner,
    // 2026-11-15). With the button off, a submit can no longer surface why a number is wrong, so
    // a FULL but invalid number (most often a non-US one) shows its error live instead. A partly
    // typed number shows nothing: it is just unfinished.
    const phoneParsed = parseUsPhoneDigits(phoneDigits);
    const phoneValid = phoneParsed.kind === "phone";
    // The test sign-up number (testSignUp.ts) continues even when phone sign-in is not set up.
    const phoneIsTest = phoneParsed.kind === "phone" && isTestSignUpPhone(phoneParsed.value);
    const phoneFull = phoneDigits.filter(Boolean).length === US_PHONE_DIGITS;
    const phoneError = error ?? (phoneFull && phoneParsed.kind === "invalid" ? phoneParsed.message : null);

    // The same gate on the email Continue. An address is "unfinished" while it is being typed, so
    // its error waits until the learner leaves the box (`emailBlurred`) with something invalid in
    // it, and clears as soon as they type again.
    const [emailBlurred, setEmailBlurred] = useState(false);
    const emailParsed = parseEmail(email);
    const emailValid = emailParsed.kind === "email";
    const emailError = error ?? (emailBlurred && email.trim() && emailParsed.kind === "invalid" ? emailParsed.message : null);

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
            <StepHeading title="Welcome" />

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
                            error={phoneError}
                            hint={phoneEnabled ? undefined : "Phone sign-in is coming soon."}
                        />
                        <PlateButton className="login-identifier-step__phone-continue" type="submit" disabled={(!phoneEnabled && !phoneIsTest) || !phoneValid}>
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
                                setEmailBlurred(false);
                            }}
                            onBlur={() => setEmailBlurred(true)}
                            placeholder="you@example.com"
                            autoFocus
                            autoComplete="username email"
                            inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false, inputMode: "email" }}
                            error={emailError}
                        />
                        <PlateButton className="login-identifier-step__email-continue" type="submit" disabled={!emailValid}>
                            Continue
                        </PlateButton>
                    </>
                )}
            </Box>

            {/* The other ways in, folded: whichever of phone / email is NOT showing, then the SSO slots. */}
            <Disclosure
                className="login-identifier-step__others"
                label="Other ways to sign in"
                open={othersOpen}
                onToggle={() => {
                    setOthersAnimate(true);
                    setOthersOpen(!othersOpen);
                }}
                animate={othersAnimate}
                panelId="login-identifier-step-alternatives"
            >
                <Box className="login-identifier-step__alternatives" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                    {mode === "phone" ? (
                        <PlateButton className="login-identifier-step__use-email" variant="secondary" onClick={() => switchTo("email")}>
                            Continue with email
                        </PlateButton>
                    ) : (
                        <PlateButton className="login-identifier-step__use-phone" variant="secondary" onClick={() => switchTo("phone")}>
                            Continue with phone
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
            </Disclosure>
        </Box>
    );
}
