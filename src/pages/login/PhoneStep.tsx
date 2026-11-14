import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Box } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { verifyPhone, type SignUpNext } from "../../api/auth";
import { sendSmsCode, type PendingSms } from "../../utils/firebasePhone";
import { Field, FormMessage, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage, formatPhone } from "./identifier";
import { useResendCountdown } from "./useResendCountdown";

/** Firebase's resend window is its own; 30 s matches the email cooldown the learner already knows. */
const SMS_RESEND_SECONDS = 30;

/**
 * Step 2 for a phone (docs/LOGIN_REWORK.md Q3, Q6): passwordless. The SMS goes out on arrival
 * (Firebase sends it, behind an invisible reCAPTCHA mounted in `recaptchaRef`); the code turns
 * into a Firebase ID token, which our server checks: a known number signs in, a new one continues
 * to the details step.
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface PhoneStepProps {
    phone: string;
    onSignUp: (next: SignUpNext) => void;
    onBack: () => void;
}

export default function PhoneStep({ phone, onSignUp, onBack }: PhoneStepProps) {
    const { establishSession } = useAuth();
    const recaptchaRef = useRef<HTMLDivElement>(null);
    const pending = useRef<PendingSms | null>(null);
    const [sending, setSending] = useState(true);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { secondsLeft, restart } = useResendCountdown(SMS_RESEND_SECONDS);

    const send = useCallback(async () => {
        if (!recaptchaRef.current) return;
        setSending(true);
        setError(null);
        try {
            pending.current = await sendSmsCode(phone, recaptchaRef.current);
            restart(SMS_RESEND_SECONDS);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSending(false);
        }
        // `restart` is a fresh closure each render but only sets state; omitting it keeps the
        // first send from re-firing on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phone]);

    // Send once on arrival. The guard survives StrictMode's double effect run, which would
    // otherwise text the learner twice.
    const sentOnce = useRef(false);
    useEffect(() => {
        if (sentOnce.current) return;
        sentOnce.current = true;
        void send();
    }, [send]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy || !pending.current) return;
        if (!/^\d{6}$/.test(code)) {
            setError("Enter the 6-digit code from the text message");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const idToken = await pending.current.confirm(code);
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

    return (
        <Box component="form" className="login-phone-step" onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <StepHeading title="Check your messages" sub={sending ? `Sending a code to ${formatPhone(phone)}…` : `We texted a 6-digit code to ${formatPhone(phone)}.`} />
            <Field
                className="login-phone-step__code"
                label="Code"
                value={code}
                onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                }}
                autoFocus
                autoComplete="one-time-code"
                placeholder="123456"
                disabled={sending && !pending.current}
                inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 }}
                sx={{ letterSpacing: "0.3em", fontWeight: 600 }}
            />
            {error && <FormMessage className="login-phone-step__error">{error}</FormMessage>}
            <PlateButton className="login-phone-step__submit" type="submit" busy={busy} disabled={!pending.current}>
                Continue
            </PlateButton>
            <Box className="login-phone-step__links" sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <TextAction className="login-phone-step__resend" onClick={send} disabled={secondsLeft > 0 || sending || busy}>
                    {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
                </TextAction>
                <TextAction className="login-phone-step__back" onClick={onBack} disabled={busy}>
                    Use a different number
                </TextAction>
            </Box>
            {/* Firebase's invisible reCAPTCHA mounts here; it must outlive the confirm. */}
            <Box ref={recaptchaRef} className="login-phone-step__recaptcha" />
        </Box>
    );
}
