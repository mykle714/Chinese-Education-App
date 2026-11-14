import { useEffect, useState, type FormEvent } from "react";
import { Box, ButtonBase, Checkbox, FormControlLabel, Typography } from "@mui/material";
import { useAuth } from "../../AuthContext";
import { checkUsername, completeSignUp, type SignUpNext } from "../../api/auth";
import { normalizeUsername, usernameProblem } from "../../../server/contracts/wire";
import type { UserGender } from "../../types";
import { getBrowserTimezone } from "../../utils/browserTimezone";
import { DEMOGRAPHICS_PURPOSE, EARLIEST_BIRTH_DATE, GENDER_CHOICES, PREFER_NOT_LABEL, birthDateProblem, todayIsoDate } from "../../utils/demographics";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { Field, FormMessage, PlateButton, StepHeading, TextAction } from "./loginUi";
import { errorMessage } from "./identifier";

/** Debounce for the live username check, ms. */
const USERNAME_CHECK_DEBOUNCE_MS = 350;

type GenderAnswer = UserGender | "prefer-not" | "";

/**
 * The last sign-up step, AFTER the channel was verified (docs/LOGIN_REWORK.md Q14, Q19–Q21):
 *   - username: required, prefilled with the server's suggestion, checked live (shape locally
 *     with wire.ts → usernameProblem, then availability on the server);
 *   - name: optional;
 *   - password: email sign-ups only (Q9); a phone account never has one (Q3);
 *   - gender + date of birth: required questions with "Prefer not to answer", as on the old
 *     register form (migration 164; src/utils/demographics.ts).
 *
 * Layer: page view (src/pages/login/). Rendered by src/pages/LoginPage.tsx.
 */
interface DetailsStepProps {
    next: SignUpNext;
    /** The verified email or phone, shown so the learner knows which account they are making. */
    identifier: string;
    onStartOver: () => void;
}

export default function DetailsStep({ next, identifier, onStartOver }: DetailsStepProps) {
    const { establishSession } = useAuth();
    const [username, setUsername] = useState(next.suggestedUsername);
    const [usernameStatus, setUsernameStatus] = useState<{ ok: boolean; message: string | null }>({ ok: true, message: null });
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [gender, setGender] = useState<GenderAnswer>("");
    const [birthDate, setBirthDate] = useState("");
    const [birthDatePreferNot, setBirthDatePreferNot] = useState(false);
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

    const isEmail = next.channel === "email";

    const validate = (): boolean => {
        const next: Record<string, string | null> = {};
        if (!usernameStatus.ok) next.username = usernameStatus.message ?? "Choose another username";
        if (isEmail && !password) next.password = "Choose a password";
        if (!gender) next.gender = "Choose one";
        if (!birthDatePreferNot) next.birthDate = birthDateProblem(birthDate);
        setErrors(next);
        return Object.values(next).every((v) => !v);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy || !validate()) return;
        setBusy(true);
        setFormError(null);
        try {
            const signedIn = await completeSignUp({
                signUpTicket: next.signUpTicket,
                username: normalizeUsername(username),
                name: name.trim() || null,
                ...(isEmail ? { password } : {}),
                gender: gender === "prefer-not" || gender === "" ? null : gender,
                birthDate: birthDatePreferNot ? null : birthDate,
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
            <StepHeading title="Create your account" sub={`Verified ${identifier}`} />
            <Field
                className="login-details-step__username"
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                inputProps={{ autoCapitalize: "none", autoCorrect: "off", spellCheck: false, maxLength: 21 }}
                startAdornment={<Typography sx={{ color: COLORS.textFaint, mr: 0.25, fontSize: SIZE.bodyLg }}>@</Typography>}
                error={errors.username ?? (usernameStatus.ok ? null : usernameStatus.message)}
                hint={usernameStatus.ok ? usernameStatus.message ?? "How friends find you. You can change it any time." : undefined}
            />
            <Field
                className="login-details-step__name"
                label="Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                hint="Shown to friends instead of your username."
            />
            {isEmail && (
                <Field
                    className="login-details-step__password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        setErrors((x) => ({ ...x, password: null }));
                    }}
                    autoComplete="new-password"
                    error={errors.password}
                    hint="At least 8 characters, with a letter and a number. You can also sign in with an emailed code."
                />
            )}

            <Box className="login-details-step__about-you" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary }}>{DEMOGRAPHICS_PURPOSE}</Typography>
                <Box className="login-details-step__gender" role="radiogroup" aria-label="Gender" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary }}>Gender</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        {[...GENDER_CHOICES, { value: "prefer-not" as const, label: PREFER_NOT_LABEL }].map((choice) => (
                            <ChoiceChip
                                key={choice.value}
                                className={`login-details-step__gender-option login-details-step__gender-option--${choice.value}`}
                                selected={gender === choice.value}
                                onClick={() => {
                                    setGender(choice.value);
                                    setErrors((x) => ({ ...x, gender: null }));
                                }}
                            >
                                {choice.label}
                            </ChoiceChip>
                        ))}
                    </Box>
                    {errors.gender && (
                        <Typography role="alert" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.dangerInk }}>
                            {errors.gender}
                        </Typography>
                    )}
                </Box>
                <Field
                    className="login-details-step__birth-date"
                    label="Date of birth"
                    type="date"
                    value={birthDate}
                    onChange={(e) => {
                        setBirthDate(e.target.value);
                        setErrors((x) => ({ ...x, birthDate: null }));
                    }}
                    disabled={birthDatePreferNot}
                    autoComplete="bday"
                    inputProps={{ min: EARLIEST_BIRTH_DATE, max: todayIsoDate() }}
                    error={birthDatePreferNot ? null : errors.birthDate}
                />
                <FormControlLabel
                    className="login-details-step__birth-date-prefer-not"
                    control={
                        <Checkbox
                            checked={birthDatePreferNot}
                            onChange={(e) => {
                                setBirthDatePreferNot(e.target.checked);
                                // Opting out discards anything typed, so it does not look like it will be sent.
                                if (e.target.checked) setBirthDate("");
                                setErrors((x) => ({ ...x, birthDate: null }));
                            }}
                            sx={{ color: COLORS.iconColor, "&.Mui-checked": { color: COLORS.onSurface } }}
                        />
                    }
                    label={PREFER_NOT_LABEL}
                    sx={{ "& .MuiFormControlLabel-label": { fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.onSurface } }}
                />
            </Box>

            {formError && <FormMessage className="login-details-step__error">{formError}</FormMessage>}
            <PlateButton className="login-details-step__create" type="submit" busy={busy}>
                Create account
            </PlateButton>
            <Box sx={{ display: "flex", justifyContent: "center" }}>
                <TextAction className="login-details-step__start-over" onClick={onStartOver} disabled={busy}>
                    Start over
                </TextAction>
            </Box>
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
                px: 1.75,
                py: 0.75,
            }}
        >
            {children}
        </ButtonBase>
    );
}
