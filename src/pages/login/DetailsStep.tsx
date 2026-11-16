import { useEffect, useState, type FormEvent } from "react";
import { Box, ButtonBase, Collapse, Typography } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { checkUsername, completeSignUp, type SignUpNext } from "../../api/auth";
import { USERNAME_MAX_LENGTH, normalizeUsername, passwordProblem, usernameProblem } from "../../../server/contracts/wire";
import type { UserGender } from "../../types";
import { getBrowserTimezone } from "../../utils/browserTimezone";
import { EARLIEST_BIRTH_DATE, GENDER_CHOICES, PREFER_NOT_LABEL, birthDateProblem, todayIsoDate } from "../../utils/demographics";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { Field, FormMessage, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";
import { isTestSignUp, testDelay } from "./testSignUp";

/** Debounce for the live username check, ms. */
const USERNAME_CHECK_DEBOUNCE_MS = 350;

/**
 * "" = not answered (gender is optional; tapping the selected chip again clears it).
 * "prefer-not" = the explicit "Prefer not to answer" chip. Both are sent as null.
 */
type GenderAnswer = UserGender | "prefer-not" | "";

/**
 * The last sign-up step, AFTER the channel was verified (docs/LOGIN_REWORK.md Q14, Q19–Q21):
 *   - username: required, prefilled with the server's suggestion, checked live (shape locally
 *     with wire.ts → usernameProblem, then availability on the server);
 *   - name: optional;
 *   - password: OPTIONAL, for email and phone sign-ups alike (owner, 2026-11-15; migration 191):
 *     a code always signs the learner in, and a password enables "Sign in with password" on the
 *     verification window. Left blank, the account has none (Settings can add one later);
 *   - gender + date of birth: OPTIONAL (owner, 2026-11-15). Gender offers Female · Male ·
 *     Non-binary (migration 192) · Prefer not to answer; "Prefer not to answer" and leaving it
 *     blank are both sent as null. A blank date of birth is sent as null
 *     (migration 164; src/utils/demographics.ts).
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface DetailsStepProps {
    next: SignUpNext;
    onStartOver: () => void;
    /** The test sign-up number reached "Create account" (testSignUp.ts): no account is made. */
    onTestFinished: () => void;
}

export default function DetailsStep({ next, onStartOver, onTestFinished }: DetailsStepProps) {
    const isTest = isTestSignUp(next);
    const { establishSession } = useAuth();
    const [username, setUsername] = useState(next.suggestedUsername);
    const [usernameStatus, setUsernameStatus] = useState<{ ok: boolean; message: string | null }>({ ok: true, message: null });
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    // Shown (and checked) only once a password is typed: the password is optional.
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [gender, setGender] = useState<GenderAnswer>("");
    const [birthDate, setBirthDate] = useState("");
    const [errors, setErrors] = useState<Record<string, string | null>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Live username check: the shape locally at once, availability on the server after a pause.
    useEffect(() => {
        const normalized = normalizeUsername(username);
        const problem = usernameProblem(normalized);
        if (problem) {
            setUsernameStatus({ ok: false, message: problem });
            return;
        }
        setUsernameStatus({ ok: true, message: null });
        const controller = new AbortController();
        const t = window.setTimeout(() => {
            checkUsername(normalized, controller.signal)
                .then((r) => setUsernameStatus(r.available ? { ok: true, message: "Available" } : { ok: false, message: r.problem ?? "Not available" }))
                .catch(() => {
                    // Aborted or offline: the submit re-checks on the server anyway.
                });
        }, USERNAME_CHECK_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(t);
            controller.abort();
        };
    }, [username]);


    const validate = (): boolean => {
        const next: Record<string, string | null> = {};
        if (!usernameStatus.ok) next.username = usernameStatus.message ?? "Choose another username";
        // Date of birth is optional: only a typed date is checked.
        if (birthDate) next.birthDate = birthDateProblem(birthDate);
        if (password && passwordConfirm !== password) next.passwordConfirm = "The passwords don't match";
        setErrors(next);
        return Object.values(next).every((v) => !v);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy || !validate()) return;
        // The test sign-up dry run stops here: never call completeSignUp. The
        // optional password, when given, is checked first, as the server would (passwordProblem
        // is its rule).
        // It reports a weak password in the form message, where the server's rejection lands.
        if (isTest) {
            setBusy(true);
            setFormError(null);
            await testDelay();
            const problem = password ? passwordProblem(password) : null;
            if (problem) {
                setFormError(problem);
                setBusy(false);
                return;
            }
            onTestFinished();
            return;
        }
        setBusy(true);
        setFormError(null);
        try {
            const signedIn = await completeSignUp({
                signUpTicket: next.signUpTicket,
                username: normalizeUsername(username),
                name: name.trim() || null,
                ...(password ? { password } : {}),
                gender: gender === "" || gender === "prefer-not" ? null : gender,
                birthDate: birthDate || null,
                tz: getBrowserTimezone(),
            });
            establishSession(signedIn.user, signedIn.token);
        } catch (err) {
            setFormError(errorMessage(err));
            setBusy(false);
        }
    };

    return (
        <Box component="form" className="login-details-step" onSubmit={submit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* No "Verified <email / phone>" subline (owner, 2026-11-15). "Start over" sits in the
                card's top-right corner, on the heading's line (owner, 2026-11-15); its negative
                right margin lines its text up with the card's content edge. */}
            <Box className="login-details-step__header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <StepHeading title="Create your account" />
                <Box className="login-details-step__start-over-wrap" sx={{ mr: -0.5, flexShrink: 0 }}>
                    <TextAction className="login-details-step__start-over" onClick={onStartOver} disabled={busy}>
                        Start over
                    </TextAction>
                </Box>
            </Box>
            <Field
                className="login-details-step__username"
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false, maxLength: USERNAME_MAX_LENGTH + 1 /* room for a typed "@" */ }}
                startAdornment={<Typography sx={{ color: COLORS.textFaint, mr: 0.25, fontSize: SIZE.bodyLg }}>@</Typography>}
                error={errors.username ?? (usernameStatus.ok ? null : usernameStatus.message)}
                hint={usernameStatus.ok ? usernameStatus.message ?? "You can change it any time." : undefined}
            />
            <Field
                className="login-details-step__name"
                label="Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
            />
            <Field
                className="login-details-step__password"
                label="Password (optional)"
                type="password"
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors((x) => ({ ...x, password: null }));
                }}
                autoComplete="new-password"
                error={errors.password ?? null}
                // Two lines, requirements first (owner, 2026-11-15). Each is worded short enough to
                // fit one line at phone width (~300 px of 12 px caption text).
                hint={
                    <>
                        <Box component="span" className="login-details-step__password-rules" sx={{ display: "block" }}>
                            At least 8 characters, with a letter and a number.
                        </Box>
                        <Box component="span" className="login-details-step__password-why" sx={{ display: "block" }}>
                            A password lets you sign in without a code.
                        </Box>
                    </>
                }
            />
            {/* Confirm password: unrolls once the (optional) password box has content (owner,
                2026-11-15), and folds away again if it is emptied. The negative top margin takes
                back the form's gap while it is folded, so a closed confirm adds no space. */}
            <Collapse in={password.length > 0} timeout={250} className="login-details-step__password-confirm-collapse" sx={{ mt: password.length > 0 ? 0 : -2, transition: "margin-top 250ms ease" }}>
                <Field
                    className="login-details-step__password-confirm"
                    label="Confirm password"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => {
                        setPasswordConfirm(e.target.value);
                        setErrors((x) => ({ ...x, passwordConfirm: null }));
                    }}
                    autoComplete="new-password"
                    error={errors.passwordConfirm ?? null}
                />
            </Collapse>

            <Box className="login-details-step__about-you" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Box className="login-details-step__gender" role="radiogroup" aria-label="Gender" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary }}>Gender (optional)</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        {[...GENDER_CHOICES, { value: "prefer-not" as const, label: PREFER_NOT_LABEL }].map((choice) => (
                            <ChoiceChip
                                key={choice.value}
                                className={`login-details-step__gender-option login-details-step__gender-option--${choice.value}`}
                                selected={gender === choice.value}
                                // Tapping the selected chip again clears the answer (it is optional).
                                onClick={() => setGender((g) => (g === choice.value ? "" : choice.value))}
                            >
                                {choice.label}
                            </ChoiceChip>
                        ))}
                    </Box>
                </Box>
                <Field
                    className="login-details-step__birth-date"
                    label="Date of birth (optional)"
                    type="date"
                    value={birthDate}
                    onChange={(e) => {
                        setBirthDate(e.target.value);
                        setErrors((x) => ({ ...x, birthDate: null }));
                    }}
                    autoComplete="bday"
                    inputProps={{ min: EARLIEST_BIRTH_DATE, max: todayIsoDate() }}
                    error={errors.birthDate ?? null}
                />
            </Box>

            {formError && <FormMessage className="login-details-step__error">{formError}</FormMessage>}
            <PlateButton className="login-details-step__create" type="submit" busy={busy}>
                Create account
            </PlateButton>
        </Box>
    );
}

/** An outlined choice; the selected one wears the ink ring (CLAUDE.md "Buttons & cards"). */
function ChoiceChip({ children, selected, onClick, className }: { children: string; selected: boolean; onClick: () => void; className: string }) {
    return (
        <ButtonBase
            className={`${className}${selected ? " login-choice-chip--selected" : ""}`}
            role="radio"
            aria-checked={selected}
            onClick={onClick}
            disableRipple
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.body,
                fontWeight: selected ? WEIGHT.semibold : WEIGHT.medium,
                color: COLORS.onSurface,
                backgroundColor: selected ? COLORS.bluM : COLORS.white,
                border: `1px solid ${selected ? COLORS.onSurface : COLORS.border}`,
                boxShadow: selected ? `inset 0 0 0 1px ${COLORS.onSurface}` : "none",
                borderRadius: "999px",
                // Compact (owner, 2026-11-15): about 28 px tall, down from 34.
                px: 1.25,
                py: 0.5,
            }}
        >
            {children}
        </ButtonBase>
    );
}
