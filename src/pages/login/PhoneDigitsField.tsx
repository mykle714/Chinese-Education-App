import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { Box, InputBase, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FieldNote } from "./loginUi";
import { US_PHONE_DIGITS, spreadDigits } from "./identifier";

/**
 * The login screen's Phone box: a fixed "+1" and ten single-digit boxes, grouped 3 · 3 · 4 like
 * a US number is written (owner, 2026-11-14; docs/LOGIN_REWORK.md Q10). US / Canada only.
 *
 * Behaviour (the filling logic is the pure `spreadDigits` in identifier.ts):
 *   - a digit moves focus to the next box; Backspace in an empty box clears and returns to the
 *     one before; ← / → move between boxes;
 *   - a paste or an OS autofill of a whole number ("+1 (555) 123-4567") fills all ten from the
 *     first box, whichever box received it. Only the first box advertises `tel-national` so the
 *     OS offers its autofill once.
 *
 * Layer: page view (src/pages/login/). Rendered by IdentifierStep.tsx.
 */

/** Where the 3 · 3 · 4 groups break: a wider gap before these boxes. */
const GROUP_STARTS = new Set([3, 6]);

interface PhoneDigitsFieldProps {
    digits: readonly string[];
    onChange: (digits: string[]) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    error?: string | null;
    hint?: string;
}

export default function PhoneDigitsField({ digits, onChange, disabled, autoFocus, error, hint }: PhoneDigitsFieldProps) {
    const inputs = useRef<(HTMLInputElement | null)[]>([]);
    const focusBox = (i: number) => {
        const el = inputs.current[i];
        if (!el) return;
        el.focus();
        el.select();
    };

    const put = (at: number, text: string) => {
        const { boxes, focus } = spreadDigits(digits, at, text);
        onChange(boxes);
        focusBox(focus);
    };

    /**
     * A box's new text. Emptied (Delete / Backspace on a filled box) → clear it and stay. A typed
     * key arrives as the box's old digit plus the new one (the text is selected on focus, so
     * usually just the new one): drop the old digit once. Autofill arrives as the whole number.
     * spreadDigits does the rest.
     */
    const onBoxChange = (i: number, text: string) => {
        if (!text) {
            const next = [...digits];
            next[i] = "";
            onChange(next);
            return;
        }
        const old = digits[i] ?? "";
        put(i, old && text.length > 1 ? text.replace(old, "") : text);
    };

    const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !digits[i] && i > 0) {
            e.preventDefault();
            const next = [...digits];
            next[i - 1] = "";
            onChange(next);
            focusBox(i - 1);
        } else if (e.key === "ArrowLeft" && i > 0) {
            e.preventDefault();
            focusBox(i - 1);
        } else if (e.key === "ArrowRight" && i < US_PHONE_DIGITS - 1) {
            e.preventDefault();
            focusBox(i + 1);
        }
    };

    const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        put(i, e.clipboardData.getData("text"));
    };

    return (
        <Box className="login-phone-digits" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Typography
                component="label"
                htmlFor="login-phone-digit-0"
                className="login-phone-digits__label"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary }}
            >
                Phone number
            </Typography>
            <Box className="login-phone-digits__row" role="group" aria-label="Phone number, 10 digits" sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Typography
                    className="login-phone-digits__country"
                    aria-hidden
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.bodyLg, fontWeight: WEIGHT.semibold, color: disabled ? COLORS.textFaint : COLORS.onSurface, pr: "4px", flexShrink: 0 }}
                >
                    +1
                </Typography>
                {Array.from({ length: US_PHONE_DIGITS }, (_, i) => (
                    <InputBase
                        key={i}
                        id={`login-phone-digit-${i}`}
                        className="login-phone-digits__box"
                        inputRef={(el: HTMLInputElement | null) => {
                            inputs.current[i] = el;
                        }}
                        value={digits[i] ?? ""}
                        onChange={(e) => onBoxChange(i, e.target.value)}
                        onKeyDown={onKeyDown(i)}
                        onPaste={onPaste(i)}
                        onFocus={(e) => e.target.select()}
                        disabled={disabled}
                        autoFocus={autoFocus && i === 0}
                        inputProps={{
                            inputMode: "numeric",
                            autoComplete: i === 0 ? "tel-national" : "off",
                            "aria-label": `Digit ${i + 1}`,
                            "aria-invalid": !!error,
                            "data-beginner-keyboard": "off",
                        }}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            maxWidth: 34,
                            ml: GROUP_STARTS.has(i) ? "6px" : 0,
                            height: 44,
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.onSurface,
                            backgroundColor: COLORS.white,
                            border: `1px solid ${error ? COLORS.onSurface : COLORS.border}`,
                            borderRadius: "8px",
                            "& input": { textAlign: "center", padding: 0, caretColor: COLORS.onSurface },
                            "&.Mui-focused": { borderColor: COLORS.onSurface },
                            "&.Mui-disabled": { backgroundColor: COLORS.background },
                            "& input.Mui-disabled": { WebkitTextFillColor: COLORS.textFaint },
                        }}
                    />
                ))}
            </Box>
            <FieldNote error={error} hint={hint} />
        </Box>
    );
}
