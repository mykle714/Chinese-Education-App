import { useState, type FormEvent } from "react";
import { Alert, Box, Button, TextField } from "@mui/material";
import { SettingsSection } from "../../components/primitives";
import { useAuth } from "../../AuthContext";
import { setPassword } from "../../api/auth";
import { passwordProblem } from "../../../server/contracts/wire";
import StepUpPanel from "./StepUpPanel";

/**
 * Settings → "Set a password", for an account that has none (owner, 2026-11-15). The password
 * is optional at sign-up (docs/LOGIN_REWORK.md Q19), so without this an account that skipped it
 * could never add one. Flow: "Set a password" → confirm it's you (StepUpPanel, a fresh code to
 * the account's email or phone) → new password twice → POST /api/auth/password/set
 * (SignInService.setPassword). On success AuthContext's user gets `hasPassword: true`, so
 * AccountSecurityPage swaps this section for its "Change password" form.
 *
 * Layer: page view (src/pages/account/). Rendered by src/pages/AccountSecurityPage.tsx.
 */
type Stage = { kind: "idle" } | { kind: "step-up" } | { kind: "enter"; stepUpToken: string };

export default function SetPasswordSection() {
    const { replaceUser } = useAuth();
    const [stage, setStage] = useState<Stage>({ kind: "idle" });
    const [newPassword, setNewPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (stage.kind !== "enter" || busy) return;
        // The server's own rule (wire.ts), checked here so a weak password is caught at the field.
        const problem = passwordProblem(newPassword) ?? (newPassword !== confirm ? "The passwords don't match" : null);
        if (problem) {
            setError(problem);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            replaceUser(await setPassword(newPassword, stage.stepUpToken));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not set the password");
            setBusy(false);
        }
    };

    return (
        <SettingsSection
            className="account-security-page__set-password-section"
            icon="lock"
            title="Set a Password"
            description="Optional. Lets you sign in without a code."
        >
            {stage.kind === "idle" && (
                <Button className="account-security-page__set-password-start" fullWidth variant="outlined" onClick={() => setStage({ kind: "step-up" })} sx={{ mt: 1.5 }}>
                    Set a password
                </Button>
            )}
            {stage.kind === "step-up" && (
                <Box className="account-security-page__set-password-step-up" sx={{ mt: 1.5 }}>
                    <StepUpPanel onConfirmed={(stepUpToken) => setStage({ kind: "enter", stepUpToken })} onCancel={() => setStage({ kind: "idle" })} />
                </Box>
            )}
            {stage.kind === "enter" && (
                <Box className="account-security-page__set-password-form" component="form" onSubmit={submit} noValidate>
                    {error && (
                        <Alert className="account-security-page__set-password-error" severity="error" sx={{ mt: 1.5 }}>
                            {error}
                        </Alert>
                    )}
                    <TextField
                        margin="normal"
                        fullWidth
                        label="New password"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        helperText="At least 8 characters, with a letter and a number."
                    />
                    <TextField
                        margin="normal"
                        fullWidth
                        label="Confirm new password"
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                    />
                    <Button className="account-security-page__set-password-submit" type="submit" fullWidth variant="contained" disabled={busy} sx={{ mt: 1.5, borderRadius: "14px" }}>
                        {busy ? "Saving..." : "Set password"}
                    </Button>
                </Box>
            )}
        </SettingsSection>
    );
}
