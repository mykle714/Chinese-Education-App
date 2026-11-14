import { useEffect, useRef, useState } from "react";
import { Box, Button, Dialog, DialogContent, InputAdornment, TextField, Typography } from "@mui/material";
import { SettingsSection } from "../../components/primitives";
import { useAuth } from "../../AuthContext";
import { changeName, changePhone, changeUsername, checkUsername, confirmEmailChange, startEmailChange } from "../../api/auth";
import { normalizeUsername, usernameProblem } from "../../../server/contracts/wire";
import { phoneAuthConfigured, sendSmsCode, type PendingSms } from "../../utils/firebasePhone";
import { formatPhone, parseEmail, parsePhone } from "../login/identifier";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import StepUpPanel from "./StepUpPanel";
import type { User } from "../../types";

/**
 * Settings · "Your account": username, name, email, phone (docs/LOGIN_REWORK.md Q24).
 *
 *   - username: changeable any time, unique (Q21); checked live like the sign-up form;
 *   - name: optional, clearable (Q19);
 *   - email / phone: add or change. Each runs: confirm it's you (StepUpPanel, a 10-minute
 *     step-up token) → the new address → its code (an email code from us, or Firebase's SMS) →
 *     the server stores it as verified.
 *
 * Layer: page view (src/pages/account/). Rendered by src/pages/AccountSecurityPage.tsx.
 */

const metaSx = { fontFamily: FONTS.sans, fontSize: 12.5, color: COLORS.textSecondary } as const;
const errorSx = { fontFamily: FONTS.sans, fontSize: 12.5, fontWeight: 600, color: COLORS.dangerInk } as const;

export default function AccountIdentitySection() {
    const { user, replaceUser } = useAuth();
    const [channelDialog, setChannelDialog] = useState<"email" | "phone" | null>(null);
    if (!user) return null;

    return (
        <SettingsSection className="account-identity-section" icon="person" title="Your account">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1.5 }}>
                <UsernameField current={user.username} onSaved={replaceUser} />
                <NameField current={user.name ?? ""} onSaved={replaceUser} />
                <ChannelRow
                    className="account-identity-section__email"
                    label="Email"
                    value={user.email}
                    onEdit={() => setChannelDialog("email")}
                />
                <ChannelRow
                    className="account-identity-section__phone"
                    label="Phone"
                    value={user.phone ? formatPhone(user.phone) : null}
                    onEdit={phoneAuthConfigured() ? () => setChannelDialog("phone") : undefined}
                    unavailableNote="Phone numbers aren't available yet"
                />
            </Box>
            <Dialog
                className="account-identity-section__dialog"
                open={channelDialog !== null}
                onClose={() => setChannelDialog(null)}
                fullWidth
                maxWidth="sm"
                slotProps={{ paper: { sx: { margin: "18px", width: "calc(100% - 36px)", borderRadius: "18px", backgroundColor: COLORS.white } } }}
            >
                <DialogContent sx={{ padding: "20px" }}>
                    {channelDialog && (
                        <ChannelChangeFlow
                            channel={channelDialog}
                            onDone={(next) => {
                                replaceUser(next);
                                setChannelDialog(null);
                            }}
                            onCancel={() => setChannelDialog(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </SettingsSection>
    );
}

function UsernameField({ current, onSaved }: { current: string; onSaved: (u: User) => void }) {
    const [value, setValue] = useState(current);
    const [status, setStatus] = useState<string | null>(null);
    const [ok, setOk] = useState(true);
    const [busy, setBusy] = useState(false);
    const normalized = normalizeUsername(value);
    const changed = normalized !== current;

    useEffect(() => setValue(current), [current]);

    // The sign-up form's live check: shape locally, availability after a pause.
    useEffect(() => {
        if (!changed) {
            setStatus(null);
            setOk(true);
            return;
        }
        const problem = usernameProblem(normalized);
        if (problem) {
            setStatus(problem);
            setOk(false);
            return;
        }
        const controller = new AbortController();
        const t = window.setTimeout(() => {
            checkUsername(normalized, controller.signal)
                .then((r) => {
                    setOk(r.available);
                    setStatus(r.available ? "Available" : r.problem ?? "Not available");
                })
                .catch(() => {});
        }, 350);
        return () => {
            window.clearTimeout(t);
            controller.abort();
        };
    }, [normalized, changed]);

    const save = async () => {
        setBusy(true);
        try {
            onSaved(await changeUsername(normalized));
            setStatus("Saved");
        } catch (e) {
            setOk(false);
            setStatus(e instanceof Error ? e.message : "Could not save");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box className="account-identity-section__username" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <TextField
                    className="account-identity-section__username-field"
                    label="Username"
                    size="small"
                    fullWidth
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false, maxLength: 21, "data-beginner-keyboard": "off" }}
                    InputProps={{ startAdornment: <InputAdornment position="start">@</InputAdornment> }}
                />
                <Button className="account-identity-section__username-save" variant="outlined" onClick={save} disabled={!changed || !ok || busy} sx={{ borderRadius: "14px", height: 40 }}>
                    Save
                </Button>
            </Box>
            <Typography sx={ok ? metaSx : errorSx}>{status ?? "Friends find you by this. You can change it any time."}</Typography>
        </Box>
    );
}

function NameField({ current, onSaved }: { current: string; onSaved: (u: User) => void }) {
    const [value, setValue] = useState(current);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => setValue(current), [current]);
    const changed = value.trim() !== current;

    const save = async () => {
        setBusy(true);
        setMessage(null);
        try {
            onSaved(await changeName(value.trim() || null));
            setMessage({ text: "Saved", error: false });
        } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : "Could not save", error: true });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box className="account-identity-section__name" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <TextField
                    className="account-identity-section__name-field"
                    label="Name (optional)"
                    size="small"
                    fullWidth
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputProps={{ "data-beginner-keyboard": "off" }}
                />
                <Button className="account-identity-section__name-save" variant="outlined" onClick={save} disabled={!changed || busy} sx={{ borderRadius: "14px", height: 40 }}>
                    Save
                </Button>
            </Box>
            <Typography sx={message?.error ? errorSx : metaSx}>{message?.text ?? "Shown to friends instead of your username."}</Typography>
        </Box>
    );
}

function ChannelRow({ label, value, onEdit, unavailableNote, className }: { label: string; value: string | null; onEdit?: () => void; unavailableNote?: string; className: string }) {
    return (
        <Box className={className} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 600, color: COLORS.textSecondary }}>{label}</Typography>
                <Typography noWrap sx={{ fontFamily: FONTS.sans, fontSize: 14, color: value ? COLORS.onSurface : COLORS.textFaint }}>
                    {value ?? "Not added"}
                </Typography>
                {!onEdit && unavailableNote && <Typography sx={metaSx}>{unavailableNote}</Typography>}
            </Box>
            {onEdit && (
                <Button className={`${className}-edit`} variant="outlined" size="small" onClick={onEdit} sx={{ borderRadius: "14px" }}>
                    {value ? "Change" : "Add"}
                </Button>
            )}
        </Box>
    );
}

type FlowStage = { kind: "step-up" } | { kind: "enter"; stepUpToken: string } | { kind: "code"; stepUpToken: string; target: string };

/** Confirm it's you → the new address → its code → saved and verified. */
function ChannelChangeFlow({ channel, onDone, onCancel }: { channel: "email" | "phone"; onDone: (u: User) => void; onCancel: () => void }) {
    const [stage, setStage] = useState<FlowStage>({ kind: "step-up" });
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const recaptchaRef = useRef<HTMLDivElement>(null);
    const pendingSms = useRef<PendingSms | null>(null);

    if (stage.kind === "step-up") {
        return <StepUpPanel onConfirmed={(stepUpToken) => setStage({ kind: "enter", stepUpToken })} onCancel={onCancel} />;
    }

    const sendToNew = async () => {
        if (stage.kind !== "enter") return;
        const parsed = channel === "email" ? parseEmail(value) : parsePhone(value);
        if (parsed.kind === "invalid") {
            setError(parsed.message);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (channel === "email") await startEmailChange(parsed.value, stage.stepUpToken);
            else if (recaptchaRef.current) pendingSms.current = await sendSmsCode(parsed.value, recaptchaRef.current);
            setStage({ kind: "code", stepUpToken: stage.stepUpToken, target: parsed.value });
            setValue("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not send the code");
        } finally {
            setBusy(false);
        }
    };

    const confirmCode = async () => {
        if (stage.kind !== "code") return;
        setBusy(true);
        setError(null);
        try {
            if (channel === "email") {
                onDone(await confirmEmailChange(stage.target, value.trim()));
            } else {
                if (!pendingSms.current) throw new Error("Send the code first");
                const idToken = await pendingSms.current.confirm(value.trim());
                onDone(await changePhone(idToken, stage.stepUpToken));
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not confirm");
            setBusy(false);
        }
    };

    const entering = stage.kind === "enter";
    return (
        <Box className={`account-identity-section__flow account-identity-section__flow--${channel}`} sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: 15, fontWeight: 700, color: COLORS.onSurface }}>
                {entering ? (channel === "email" ? "New email" : "New phone number") : "Enter the code"}
            </Typography>
            <Typography sx={metaSx}>
                {entering
                    ? channel === "email"
                        ? "We'll send a code to confirm it."
                        : "Include your country code, e.g. +1 555 123 4567. We'll text a code to confirm it."
                    : `We sent a 6-digit code to ${stage.target}.`}
            </Typography>
            <TextField
                className="account-identity-section__flow-field"
                autoFocus
                fullWidth
                size="small"
                label={entering ? (channel === "email" ? "Email" : "Phone") : "Code"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete={entering ? (channel === "email" ? "email" : "tel") : "one-time-code"}
                inputProps={{
                    "data-beginner-keyboard": "off",
                    ...(entering ? { inputMode: channel === "email" ? "email" : "tel", autoCapitalize: "none" } : { inputMode: "numeric", maxLength: 6 }),
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && value) void (entering ? sendToNew() : confirmCode());
                }}
            />
            {error && <Typography role="alert" sx={errorSx}>{error}</Typography>}
            <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="outlined" onClick={onCancel} disabled={busy} sx={{ flex: 1, borderRadius: "14px" }}>
                    Cancel
                </Button>
                <Button variant="contained" onClick={entering ? sendToNew : confirmCode} disabled={busy || !value} sx={{ flex: 1, borderRadius: "14px" }}>
                    {entering ? "Send code" : "Confirm"}
                </Button>
            </Box>
            <Box ref={recaptchaRef} className="account-identity-section__recaptcha" />
        </Box>
    );
}
