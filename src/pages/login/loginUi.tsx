import { forwardRef, type ReactNode } from "react";
import { Box, ButtonBase, CircularProgress, InputBase, Typography, type InputBaseProps } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import { towerPlateSx, type PlateTones } from "../../theme/towerPlate";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../theme/roundedEdge";

/**
 * The login screen's building blocks (docs/LOGIN_REWORK.md § 3, Q12). The screen continues the
 * launch sky, so its controls are the Deck Tower's: the PLATE push button (theme/towerPlate.ts)
 * for actions, a raised white card with the hairline rounded edge (theme/roundedEdge.ts) for the
 * form, and outlined fields. Every colour is a framework token (theme/colors.ts):
 *   - the primary action is the app's action gold (`gld`, wall `gldFrame`) with ink print;
 *   - the secondary action is a white plate with the app outline (`border`, wall `card`);
 *   - text and errors are ink (`onSurface`, `dangerInk`), secondary text `textSecondary`.
 *
 * Layer: page view (src/pages/login/), shared by the login steps only.
 */

/** The action gold plate (the app's `--gld` action ground). */
const PRIMARY_TONES: PlateTones = { top: COLORS.gld, left: COLORS.gldFrame, right: COLORS.gldFrame };
/** A white plate, outlined, for the alternative action ("Email me a code"). */
const SECONDARY_TONES: PlateTones = { top: COLORS.white, left: COLORS.card, right: COLORS.card };

/** The form's raised card: white face, a 4 px wall, the hairline rounded edge, the outline. */
const CARD_WALL = COLORS.card;
const CARD_WALL_PX = 4;

interface PlateButtonProps {
    children: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    variant?: "primary" | "secondary";
    disabled?: boolean;
    busy?: boolean;
    className: string;
}

/** A full-width plate button. `busy` shows a spinner and blocks taps. */
export function PlateButton({ children, onClick, type = "button", variant = "primary", disabled, busy, className }: PlateButtonProps) {
    const tones = variant === "primary" ? PRIMARY_TONES : SECONDARY_TONES;
    return (
        <ButtonBase
            className={`login-plate-button login-plate-button--${variant} ${className}`}
            type={type}
            onClick={onClick}
            disabled={disabled || busy}
            disableRipple
            sx={{
                ...towerPlateSx(tones),
                width: "100%",
                minHeight: 48,
                borderRadius: "14px",
                fontSize: SIZE.body,
                // The secondary plate carries the app outline (CLAUDE.md "Buttons & cards"); the
                // gold one's edge is its wall, as on every plate.
                ...(variant === "secondary" ? { outline: `1px solid ${COLORS.border}`, outlineOffset: -1 } : null),
                "&.Mui-disabled": { opacity: 0.55, color: COLORS.onSurface },
            }}
        >
            {busy ? <CircularProgress className="login-plate-button__spinner" size={20} sx={{ color: COLORS.onSurface }} /> : children}
        </ButtonBase>
    );
}

/** A quiet text action ("Forgot password?", "Use a different email"). */
export function TextAction({ children, onClick, className, disabled }: { children: ReactNode; onClick: () => void; className: string; disabled?: boolean }) {
    return (
        <ButtonBase
            className={`login-text-action ${className}`}
            onClick={onClick}
            disabled={disabled}
            disableRipple
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.body,
                fontWeight: WEIGHT.semibold,
                color: COLORS.onSurface,
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                textDecorationColor: COLORS.border,
                padding: "6px 4px",
                borderRadius: "6px",
                "&.Mui-disabled": { color: COLORS.textFaint },
            }}
        >
            {children}
        </ButtonBase>
    );
}

interface FieldProps extends Omit<InputBaseProps, "error"> {
    label: string;
    /** Shown under the field; ink, like every error in v2. */
    error?: string | null;
    /** Shown under the field when there is no error. */
    hint?: ReactNode;
    className: string;
}

/** A labelled, outlined field. 16 px text so iOS does not zoom on focus. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, className, id, ...input }, ref) {
    const fieldId = id ?? `login-field-${className}`;
    return (
        <Box className={`login-field ${className}`} sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Typography
                component="label"
                htmlFor={fieldId}
                className="login-field__label"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary }}
            >
                {label}
            </Typography>
            <InputBase
                {...input}
                id={fieldId}
                inputRef={ref}
                className="login-field__input"
                inputProps={{ ...input.inputProps, "aria-invalid": !!error, "data-beginner-keyboard": "off" }}
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.bodyLg,
                    color: COLORS.onSurface,
                    backgroundColor: COLORS.white,
                    border: `1px solid ${error ? COLORS.onSurface : COLORS.border}`,
                    borderRadius: "12px",
                    minHeight: 48,
                    px: 1.5,
                    "&.Mui-focused": { borderColor: COLORS.onSurface },
                    // Greyed out (the Phone box before phone sign-in is set up).
                    "&.Mui-disabled": { backgroundColor: COLORS.background, color: COLORS.textFaint },
                    "& input.Mui-disabled": { WebkitTextFillColor: COLORS.textFaint },
                    "& input::placeholder": { color: COLORS.textFaint, opacity: 1 },
                    ...input.sx,
                }}
            />
            <FieldNote error={error} hint={hint} />
        </Box>
    );
});

/**
 * The line under a field: its error (ink on danger, announced) or else its hint. Shared by
 * `Field` and PhoneDigitsField.tsx.
 */
export function FieldNote({ error, hint }: { error?: string | null; hint?: ReactNode }) {
    if (!error && !hint) return null;
    return (
        <Typography
            className={error ? "login-field__error" : "login-field__hint"}
            role={error ? "alert" : undefined}
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                lineHeight: LEADING.normal,
                color: error ? COLORS.dangerInk : COLORS.textSecondary,
                fontWeight: error ? WEIGHT.semibold : WEIGHT.regular,
            }}
        >
            {error || hint}
        </Typography>
    );
}

/** The step's heading + optional subline. */
export function StepHeading({ title, sub }: { title: string; sub?: ReactNode }) {
    return (
        <Box className="login-step-heading" sx={{ display: "flex", flexDirection: "column", gap: "4px", mb: 0.5 }}>
            <Typography
                component="h1"
                className="login-step-heading__title"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.bold, color: COLORS.onSurface, letterSpacing: "-0.01em" }}
            >
                {title}
            </Typography>
            {sub && (
                <Typography className="login-step-heading__sub" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textSecondary, lineHeight: LEADING.normal }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

/** A form-level message (an error from the server, or a notice). */
export function FormMessage({ children, tone = "error", className }: { children: ReactNode; tone?: "error" | "notice"; className: string }) {
    return (
        <Typography
            className={`login-form-message login-form-message--${tone} ${className}`}
            role={tone === "error" ? "alert" : "status"}
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.body,
                lineHeight: LEADING.normal,
                color: tone === "error" ? COLORS.dangerInk : COLORS.textSecondary,
                fontWeight: tone === "error" ? WEIGHT.semibold : WEIGHT.regular,
                backgroundColor: tone === "error" ? COLORS.redAccent : COLORS.blueAccent,
                border: `1px solid ${COLORS.rowBorder}`,
                borderRadius: "10px",
                px: 1.5,
                py: 1,
            }}
        >
            {children}
        </Typography>
    );
}

/** A thin "or" divider between the two ways forward. */
export function OrDivider() {
    return (
        <Box className="login-or-divider" sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 0.5 }}>
            <Box sx={{ flex: 1, height: "1px", backgroundColor: COLORS.rowBorder }} />
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textFaint, fontWeight: WEIGHT.semibold }}>or</Typography>
            <Box sx={{ flex: 1, height: "1px", backgroundColor: COLORS.rowBorder }} />
        </Box>
    );
}

/** The raised white card the steps sit in. */
export function LoginCard({ children }: { children: ReactNode }) {
    return (
        <Box
            className="login-card"
            sx={{
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.border}`,
                borderRadius: "20px",
                boxShadow: `${roundedEdgeRimLightTop(COLORS.white, 1)}, ${roundedEdgeFilletDown(COLORS.white, CARD_WALL)}, 0 ${CARD_WALL_PX}px 0 ${CARD_WALL}`,
                p: 2.5,
                display: "flex",
                flexDirection: "column",
                gap: 2,
            }}
        >
            {children}
        </Box>
    );
}
