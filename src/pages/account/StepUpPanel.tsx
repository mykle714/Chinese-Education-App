import { useRef, useState } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { sendStepUpCode, verifyStepUp } from "../../api/auth";
import { phoneAuthConfigured, sendSmsCode, type PendingSms } from "../../utils/firebasePhone";
import { formatPhone } from "../login/identifier";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * "Confirm it's you" — step-up re-authentication before a sensitive change (docs/LOGIN_REWORK.md
 * Q24): adding or changing the email or phone, and deleting an account with no password.
 *
 * Offers whichever proofs the account HAS, in this order: its password, a code to its email,
 * a text to its phone (Firebase). Success yields a 10-minute step-up token from the server
 * (SignInService.verifyStepUp), handed to `onConfirmed` for the change itself.
 *
 * Layer: page view (src/pages/account/). Used by AccountIdentitySection and AccountSecurityPage.
 */
type Method = "password" | "email" | "phone";

interface StepUpPanelProps {
    onConfirmed: (stepUpToken: string) => void;
    onCancel: () => void;
}

export default function StepUpPanel({ onConfirmed, onCancel }: StepUpPanelProps) {
    const { user } = useAuth();
    const methods: Method[] = [
        ...(user?.hasPassword ? (["password"] as const) : []),
        ...(user?.email ? (["email"] as const) : []),
        ...(user?.phone && phoneAuthConfigured() ? (["phone"] as const) : []),
    ];
    const [method, setMethod] = useState<Method | undefined>(methods[0]);
    const [value, setValue] = useState("");
    const [codeSent, setCodeSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recaptchaRef = useRef<HTMLDivElement>(null);
    const pendingSms = useRef<PendingSms | null>(null);

    const pick = (next: Method) => {
        setMethod(next);
        setValue("");
        setCodeSent(false);
        setError(null);
    };

    const sendCode = async () => {
        setBusy(true);
        setError(null);
        try {
            if (method === "email") {
                await sendStepUpCode();
            } else if (method === "phone" && user?.phone && recaptchaRef.current) {
                pendingSms.current = await sendSmsCode(user.phone, recaptchaRef.current);
            }
            setCodeSent(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not send the code");
        } finally {
            setBusy(false);
        }
    };

    const confirm = async () => {
        setBusy(true);
        setError(null);
        try {
            let proof: Parameters<typeof verifyStepUp>[0];
            if (method === "password") proof = { password: value };
            else if (method === "email") proof = { code: value.trim() };
            else {
                if (!pendingSms.current) throw new Error("Send the code first");
                proof = { phoneIdToken: await pendingSms.current.confirm(value.trim()) };
            }
            const { stepUpToken } = await verifyStepUp(proof);
            onConfirmed(stepUpToken);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not confirm");
            setBusy(false);
        }
    };

    if (!method) {
        return (
            <Typography className="step-up-panel__none" sx={{ fontFamily: FONTS.sans, fontSize: 13, color: COLORS.textSecondary }}>
                This account has no way to confirm it's you from this device.
            </Typography>
        );
    }

    const needsSend = method !== "password" && !codeSent;
    const labels: Record<Method, string> = { password: "Password", email: "Email code", phone: "Text code" };

    return (
        <Box className="step-up-panel" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            <Typography className="step-up-panel__title" sx={{ fontFamily: FONTS.sans, fontSize: 15, fontWeight: 700, color: COLORS.onSurface }}>
                Confirm it's you
            </Typography>
            {methods.length > 1 && (
                <Box className="step-up-panel__methods" sx={{ display: "flex", gap: 1 }}>
                    {methods.map((m) => (
                        <Button
                            key={m}
                            className={`step-up-panel__method step-up-panel__method--${m}`}
                            size="small"
                            variant={m === method ? "contained" : "outlined"}
                            onClick={() => pick(m)}
                            disabled={busy}
                            sx={{ borderRadius: "999px", textTransform: "none" }}
                        >
                            {labels[m]}
                        </Button>
                    ))}
                </Box>
            )}
            {needsSend ? (
                <Button className="step-up-panel__send" variant="outlined" onClick={sendCode} disabled={busy} sx={{ borderRadius: "14px" }}>
                    {method === "email" ? `Email a code to ${user?.email}` : `Text a code to ${formatPhone(user?.phone ?? "")}`}
                </Button>
            ) : (
                <TextField
                    className="step-up-panel__value"
                    autoFocus
                    fullWidth
                    size="small"
                    label={method === "password" ? "Your password" : "6-digit code"}
                    type={method === "password" ? "password" : "text"}
                    autoComplete={method === "password" ? "current-password" : "one-time-code"}
                    inputProps={method === "password" ? undefined : { inputMode: "numeric", maxLength: 6 }}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && value) void confirm();
                    }}
                />
            )}
            {error && (
                <Typography className="step-up-panel__error" role="alert" sx={{ fontFamily: FONTS.sans, fontSize: 12.5, fontWeight: 600, color: COLORS.dangerInk }}>
                    {error}
                </Typography>
            )}
            <Box sx={{ display: "flex", gap: 1 }}>
                <Button className="step-up-panel__cancel" variant="outlined" onClick={onCancel} disabled={busy} sx={{ flex: 1, borderRadius: "14px" }}>
                    Cancel
                </Button>
                <Button
                    className="step-up-panel__confirm"
                    variant="contained"
                    onClick={confirm}
                    disabled={busy || needsSend || !value}
                    sx={{ flex: 1, borderRadius: "14px" }}
                >
                    Confirm
                </Button>
            </Box>
            {/* Firebase's invisible reCAPTCHA for the text-code proof. */}
            <Box ref={recaptchaRef} className="step-up-panel__recaptcha" />
        </Box>
    );
}
