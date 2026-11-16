import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { Box, ButtonBase, InputBase, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FieldNote } from "./loginUi";
import { US_PHONE_DIGITS, emptyPhoneDigits, spreadDigits } from "./identifier";

/**
 * The login screen's Phone box: ten single-digit spots, grouped 3 · 3 · 4 like a US number is
 * written (owner, 2026-11-14; docs/LOGIN_REWORK.md Q10). US / Canada only, but it no longer says
 * so up front: the fixed "+1" was dropped (owner, 2026-11-15). A habitual leading 1 typed into
 * the first spot is swallowed, and a non-NANP number is told "Only US and Canada numbers work
 * right now" (identifier.ts → spreadDigits, US_ONLY_MESSAGE).
 * Each spot is an UNDERLINE, not a box (owner, 2026-11-15: quieter, reads like a blank to fill).
 * (The code still says "box" for a spot: `focusBox`, `onBoxChange`, `login-phone-digits__box`.)
 *
 * Behaviour (the filling logic is the pure `spreadDigits` in identifier.ts):
 *   - typing always starts from the first empty box: focusing (tapping) a box past it moves the
 *     caret back to it, and → stops there, so a number never has gaps (owner, 2026-11-15);
 *     a filled box before it can still be tapped and retyped;
 *   - a digit moves focus to the next box, and the digit that completes the number releases
 *     focus altogether (no box stays selected); Backspace in an empty box clears and returns to the
 *     one before; ← / → move between boxes;
 *   - a "Clear" button sits in the field's top-right corner (on the label's line, so it adds no
 *     height) while any box holds a digit; it empties all ten and puts the caret in the first
 *     (owner, 2026-11-15);
 *   - a paste or an OS autofill of a whole number ("+1 (555) 123-4567") fills all ten from the
 *     first box, whichever box received it. Only the first box advertises `tel-national` so the
 *     OS offers its autofill once.
 *
 * Layer: page view (src/pages/login/). Rendered by IdentifierStep.tsx.
 */

/**
 * Spot shape. Each spot takes an equal share of the row (capped at SPOT_MAX_WIDTH) over a fixed
 * height; with no box to frame it, only the underline's width and the digit show, so the tall-
 * sliver problem the boxes had on narrow phones is gone. SPOT_UNDERLINE_PX is the rule's weight:
 * `border` when empty, ink when focused, filled, or in error.
 */
const SPOT_MAX_WIDTH = 30;
const SPOT_HEIGHT = 40;
const SPOT_UNDERLINE_PX = 2;

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

    /**
     * The digits as of the LATEST change, not this render's props. A change hands the new digits
     * up and moves focus in the same handler, so the next box's onFocus redirect fires before the
     * parent re-renders: read from `digits` it would see the old number, judge the box it just
     * moved to as "past the first empty one", and bounce the caret back to (and select) the box
     * that was just filled. Every change goes through `commit`, which updates this first.
     */
    const latest = useRef(digits);
    latest.current = digits;
    const commit = (next: string[]) => {
        latest.current = next;
        onChange(next);
    };

    /** The furthest box the caret may sit in: the first empty one (the last box when all are full). */
    const furthestBox = () => {
        const firstEmpty = latest.current.findIndex((d) => !d);
        return firstEmpty === -1 ? US_PHONE_DIGITS - 1 : firstEmpty;
    };

    const put = (at: number, text: string) => {
        const { boxes, focus } = spreadDigits(latest.current, at, text);
        commit(boxes);
        // The number is complete (the last digit typed, or a whole number pasted / autofilled):
        // let go of the field instead of selecting the last digit, so the next key cannot
        // overwrite it and the learner's eye moves on to Continue (owner, 2026-11-15).
        if (focus === US_PHONE_DIGITS - 1 && boxes.every(Boolean)) {
            inputs.current[at]?.blur();
            return;
        }
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
            const next = [...latest.current];
            next[i] = "";
            commit(next);
            return;
        }
        const old = digits[i] ?? "";
        put(i, old && text.length > 1 ? text.replace(old, "") : text);
    };

    const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !digits[i] && i > 0) {
            e.preventDefault();
            const next = [...latest.current];
            next[i - 1] = "";
            commit(next);
            focusBox(i - 1);
        } else if (e.key === "ArrowLeft" && i > 0) {
            e.preventDefault();
            focusBox(i - 1);
        } else if (e.key === "ArrowRight" && i < furthestBox()) {
            e.preventDefault();
            focusBox(i + 1);
        }
    };

    const hasContent = digits.some(Boolean);
    const clearAll = () => {
        commit(emptyPhoneDigits());
        focusBox(0);
    };

    const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        put(i, e.clipboardData.getData("text"));
    };

    return (
        <Box className="login-phone-digits" sx={{ position: "relative", display: "flex", flexDirection: "column", gap: "6px" }}>
            {/* Top-right "Clear", only while there is something to clear. Absolutely placed on the
                label's line (negative offsets give it a finger-sized hit area without growing the
                field), so it appearing or going moves nothing. */}
            {hasContent && !disabled && (
                <ButtonBase
                    className="login-phone-digits__clear"
                    onClick={clearAll}
                    aria-label="Clear phone number"
                    disableRipple
                    sx={{
                        position: "absolute",
                        top: "-8px",
                        right: "-8px",
                        padding: "8px",
                        borderRadius: "8px",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.textSecondary,
                        // The label's line height (MUI body1), so the two texts share a baseline.
                        lineHeight: 1.5,
                    }}
                >
                    Clear
                </ButtonBase>
            )}
            <Typography
                component="label"
                htmlFor="login-phone-digit-0"
                className="login-phone-digits__label"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary }}
            >
                Phone number
            </Typography>
            <Box className="login-phone-digits__row" role="group" aria-label="Phone number, 10 digits" sx={{ display: "flex", alignItems: "center", gap: "5px" }}>
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
                        // Typing starts from the first empty box: a tap past it lands there instead.
                        // The tap is stopped BEFORE the tapped box takes focus (pointerdown is what
                        // focuses it), so only the box being typed in ever lights up. Moving focus
                        // from inside the tapped box's own focus handler is not enough: MUI marks
                        // a box focused AFTER our onFocus returns, so the tapped box stayed lit
                        // next to the real one.
                        onPointerDown={(e) => {
                            if (i <= furthestBox()) return;
                            e.preventDefault();
                            focusBox(furthestBox());
                        }}
                        // Fallback for focus that does not come from a tap (Tab is already kept to
                        // reachable boxes by tabIndex). Deferred a frame so MUI has finished
                        // marking this box focused before the move un-marks it.
                        onFocus={(e) => {
                            if (i > furthestBox()) requestAnimationFrame(() => focusBox(furthestBox()));
                            else e.target.select();
                        }}
                        disabled={disabled}
                        autoFocus={autoFocus && i === 0}
                        inputProps={{
                            // Boxes past the first empty one are skipped by Tab.
                            tabIndex: i > furthestBox() ? -1 : 0,
                            inputMode: "numeric",
                            autoComplete: i === 0 ? "tel-national" : "off",
                            "aria-label": `Digit ${i + 1}`,
                            "aria-invalid": !!error,
                            "data-beginner-keyboard": "off",
                        }}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            maxWidth: SPOT_MAX_WIDTH,
                            ml: GROUP_STARTS.has(i) ? "9px" : 0,
                            height: SPOT_HEIGHT,
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.onSurface,
                            // A filled spot's rule goes ink too, so the typed part of the number reads as done.
                            borderBottom: `${SPOT_UNDERLINE_PX}px solid ${error || digits[i] ? COLORS.onSurface : COLORS.border}`,
                            transition: "border-color 120ms ease",
                            "& input": { textAlign: "center", padding: 0, caretColor: COLORS.onSurface },
                            "&.Mui-focused": { borderColor: COLORS.onSurface },
                            "&.Mui-disabled": { borderBottomColor: COLORS.rowBorder },
                            "& input.Mui-disabled": { WebkitTextFillColor: COLORS.textFaint },
                        }}
                    />
                ))}
            </Box>
            <FieldNote error={error} hint={hint} />
        </Box>
    );
}
