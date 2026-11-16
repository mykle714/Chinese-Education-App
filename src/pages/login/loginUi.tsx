import { forwardRef, type ReactNode } from "react";
import { Box, ButtonBase, CircularProgress, Collapse, InputBase, Typography, type InputBaseProps } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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
/** A white plate, outlined, for an alternative action ("Continue with email", "Sign in" with a password). */
const SECONDARY_TONES: PlateTones = { top: COLORS.white, left: COLORS.card, right: COLORS.card };

/** The form's raised card: white face, a 4 px wall, the hairline rounded edge, the outline. */
const CARD_WALL = COLORS.card;
const CARD_WALL_PX = 4;
/** The card's padding (MUI spacing units) and corner radius; Disclosure bleeds through the padding. */
const CARD_PAD = 2.5;
const CARD_RADIUS_PX = 20;

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
    /**
     * Shown under the field; ink, like every error in v2. Pass `null` (not undefined) for a field
     * that can show an error but has none right now: that reserves its line (FieldNote).
     */
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
 *
 * It never changes the card's height (owner, 2026-11-15: the window must not grow for an
 * error). For a field that CAN show an error (the caller passes `error`, `null` when there is
 * none) the line is always laid out, one caption line tall even with nothing to say, and the
 * hint and the error share one grid cell, the inactive one kept invisible, so the slot is as
 * tall as the taller of the two and swapping between them moves nothing. (A two-line hint over a
 * one-line error, DetailsStep's password, therefore keeps its two lines when the error shows.)
 * The error element is always present, so as a live region its text is announced when it fills.
 *
 * A field that can never show an error (`error` left undefined) and has no hint draws no line
 * at all, so it leaves no empty gap (owner, 2026-11-15: the Name field's blank line).
 */
export function FieldNote({ error, hint }: { error?: string | null; hint?: ReactNode }) {
    if (error === undefined && !hint) return null;
    const textSx = { fontFamily: FONTS.sans, fontSize: SIZE.caption, lineHeight: LEADING.normal, gridArea: "1 / 1" } as const;
    return (
        <Box className="login-field__note" sx={{ display: "grid" }}>
            <Typography
                className="login-field__hint"
                aria-hidden={!!error || !hint}
                sx={{ ...textSx, color: COLORS.textSecondary, fontWeight: WEIGHT.regular, visibility: error ? "hidden" : "visible" }}
            >
                {/* A non-breaking space holds one line open when there is no hint. */}
                {hint || "\u00a0"}
            </Typography>
            <Typography
                className="login-field__error"
                role="alert"
                sx={{ ...textSx, color: COLORS.dangerInk, fontWeight: WEIGHT.semibold, visibility: error ? "visible" : "hidden" }}
            >
                {error ?? ""}
            </Typography>
        </Box>
    );
}

/**
 * Text that changes between a few known strings WITHOUT reflowing: every string is laid out in
 * the same grid cell and only the active one is visible, so the box is always as tall (and as
 * wide) as the longest and swapping moves nothing. For a status line whose wording changes
 * mid-step ("Sending a code…" → "We texted a code…"). Inline (spans), so it can sit inside a
 * Typography. Only the active string is exposed to assistive tech.
 */
export function SwapText({ texts, active, className }: { texts: readonly string[]; active: number; className: string }) {
    return (
        <Box component="span" className={`login-swap-text ${className}`} sx={{ display: "inline-grid" }}>
            {texts.map((text, i) => (
                <Box
                    key={i}
                    component="span"
                    className="login-swap-text__option"
                    aria-hidden={i !== active}
                    sx={{ gridArea: "1 / 1", visibility: i === active ? "visible" : "hidden" }}
                >
                    {text}
                </Box>
            ))}
        </Box>
    );
}

/**
 * The bottom row of a code step: resend (with its countdown) on the left, an optional way back
 * on the right (the sign-in windows put theirs in the heading instead: IdentifierLine). It never wraps, and the countdown uses tabular figures and keeps the width of its
 * longest wording (SwapText), so the row holds still while the seconds tick and when the
 * countdown ends. The labels must be short enough to share one line at phone width.
 */
export function CodeLinksRow({
    className,
    secondsLeft,
    resendDisabled,
    onResend,
    backLabel,
    onBack,
    backDisabled,
}: {
    className: string;
    secondsLeft: number;
    resendDisabled: boolean;
    onResend: () => void;
    backLabel?: string;
    onBack?: () => void;
    backDisabled?: boolean;
}) {
    return (
        <Box className={`login-code-links ${className}`} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, whiteSpace: "nowrap" }}>
            <TextAction className="login-code-links__resend" onClick={onResend} disabled={resendDisabled}>
                <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {/* The third wording is never shown: it reserves the countdown's widest form ("in 00s"). */}
                    <SwapText
                        className="login-code-links__resend-label"
                        texts={["Resend code", `Resend code in ${secondsLeft}s`, "Resend code in 00s"]}
                        active={secondsLeft > 0 ? 1 : 0}
                    />
                </Box>
            </TextAction>
            {backLabel && onBack && (
                <TextAction className="login-code-links__back" onClick={onBack} disabled={backDisabled}>
                    {backLabel}
                </TextAction>
            )}
        </Box>
    );
}

/**
 * A heading subline naming the identifier a window is for, with an inline "Change" that goes
 * back to step 1. Lives in the heading so it is reachable whichever accordion section is open.
 */
export function IdentifierLine({ text, onChange, disabled, className }: { text: string; onChange: () => void; disabled?: boolean; className: string }) {
    return (
        <Box component="span" className={`login-identifier-line ${className}`} sx={{ display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 0.5 }}>
            <Box component="span" className="login-identifier-line__text" sx={{ color: COLORS.onSurface, fontWeight: WEIGHT.semibold }}>
                {text}
            </Box>
            <TextAction className="login-identifier-line__change" onClick={onChange} disabled={disabled}>
                Change
            </TextAction>
        </Box>
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

/**
 * The card's pull-down bottom section: a strip that spans the LoginCard edge to edge (it bleeds
 * out through the card's padding, so it must be the card's LAST child), separated from the form
 * by one full-width hairline. Its header is a quiet centred caption + chevron that stays at the
 * very bottom: tapping it unrolls the content at the top seam (under the hairline) and pushes the
 * header down ahead of it, so the card grows longer like a scroll — no box, no border of its own. The strip sits on paper (`background`) to read as the card's underside, and takes the
 * card's bottom corner radius. Used by IdentifierStep for its other ways in (email, SSO).
 */
export function Disclosure({
    label,
    open,
    onToggle,
    animate = true,
    panelId,
    className,
    children,
}: {
    label: string;
    open: boolean;
    onToggle: () => void;
    /** False = open / close at once, no unroll (a close that happens while the window slides away). */
    animate?: boolean;
    panelId: string;
    className: string;
    children: ReactNode;
}) {
    return (
        <Box
            className={`login-disclosure ${open ? "login-disclosure--open" : ""} ${className}`}
            sx={{
                // Bleed to the card's edges and bottom (undo LoginCard's padding).
                mx: -CARD_PAD,
                mb: -CARD_PAD,
                borderTop: `1px solid ${COLORS.rowBorder}`,
                backgroundColor: COLORS.background,
                borderRadius: `0 0 ${CARD_RADIUS_PX - 1}px ${CARD_RADIUS_PX - 1}px`,
                overflow: "hidden",
            }}
        >
            {/* The content unrolls at the TOP seam (just under the hairline), pushing the header
                down ahead of it — the header is the scroll's rolled edge, riding the bottom. */}
            <Collapse in={open} timeout={animate ? 250 : 0} className="login-disclosure__collapse">
                <Box id={panelId} className="login-disclosure__panel" sx={{ px: CARD_PAD, pt: 2, pb: 0.5 }}>
                    {children}
                </Box>
            </Collapse>
            <ButtonBase
                className="login-disclosure__header"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={panelId}
                disableRipple
                sx={{
                    width: "100%",
                    minHeight: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "2px",
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.textSecondary,
                }}
            >
                {label}
                <ExpandMoreIcon
                    className="login-disclosure__chevron"
                    sx={{ fontSize: 18, transition: "transform 250ms ease", transform: open ? "rotate(180deg)" : "none" }}
                />
            </ButtonBase>
        </Box>
    );
}

/**
 * The vertical rhythm INSIDE an accordion section (MUI spacing units). The verification windows'
 * two sections are built from the same pieces in the same order (a field with its reserved note
 * line, a plate button, a row of text links), all spaced by this one value, so they come out the
 * same height and switching sections never grows or shrinks the card (owner, 2026-11-15).
 * Used by CodeStep.tsx, PhoneStep.tsx and PasswordSignInForm.tsx.
 */
export const ACCORDION_SECTION_GAP = 1.5;

/** One section of an Accordion: its header label and its content. */
export interface AccordionItem<T extends string> {
    id: T;
    label: string;
    content: ReactNode;
}

/**
 * A proper accordion (owner, 2026-11-15): stacked sections, each a full-width header row (label
 * left, chevron right) over its content, divided by hairlines. EXACTLY ONE section is open:
 * tapping a closed header opens it and folds the open one (both fold at the same 250 ms, so the
 * card changes height once). The open header cannot be closed (WAI-ARIA accordion pattern:
 * `aria-disabled` on it), so the card is never left empty.
 *
 * Like Disclosure it is the card's bottom section: it bleeds through the card's padding to the
 * edges and bottom (must be the card's LAST child). Closed headers sit on paper (`background`),
 * the open section on white, so which one is live reads at a glance; the open header's label is
 * ink, a closed one's `textSecondary`.
 *
 * Used by the verification windows (CodeStep.tsx, PhoneStep.tsx): "Email me a code" /
 * "Text me a code" and "Sign in with password".
 */
export function Accordion<T extends string>({ items, open, onOpen, className }: { items: readonly AccordionItem<T>[]; open: T; onOpen: (id: T) => void; className: string }) {
    return (
        <Box
            className={`login-accordion ${className}`}
            sx={{
                // Bleed to the card's edges and bottom (undo LoginCard's padding).
                mx: -CARD_PAD,
                mb: -CARD_PAD,
                borderTop: `1px solid ${COLORS.rowBorder}`,
                borderRadius: `0 0 ${CARD_RADIUS_PX - 1}px ${CARD_RADIUS_PX - 1}px`,
                overflow: "hidden",
            }}
        >
            {items.map((item, i) => {
                const isOpen = item.id === open;
                const headerId = `${className}-${item.id}-header`;
                const panelId = `${className}-${item.id}-panel`;
                return (
                    <Box
                        key={item.id}
                        className={`login-accordion__item login-accordion__item--${item.id}${isOpen ? " login-accordion__item--open" : ""}`}
                        sx={{
                            borderTop: i === 0 ? "none" : `1px solid ${COLORS.rowBorder}`,
                            backgroundColor: isOpen ? COLORS.white : COLORS.background,
                            transition: "background-color 250ms ease",
                        }}
                    >
                        <ButtonBase
                            id={headerId}
                            className="login-accordion__header"
                            onClick={() => !isOpen && onOpen(item.id)}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-disabled={isOpen}
                            disableRipple
                            sx={{
                                width: "100%",
                                minHeight: 52,
                                px: CARD_PAD,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 1,
                                cursor: isOpen ? "default" : "pointer",
                            }}
                        >
                            <Typography
                                component="span"
                                className="login-accordion__label"
                                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: isOpen ? COLORS.onSurface : COLORS.textSecondary, transition: "color 250ms ease" }}
                            >
                                {item.label}
                            </Typography>
                            <ExpandMoreIcon
                                className="login-accordion__chevron"
                                sx={{ fontSize: 20, color: isOpen ? COLORS.onSurface : COLORS.textSecondary, transition: "transform 250ms ease", transform: isOpen ? "rotate(180deg)" : "none" }}
                            />
                        </ButtonBase>
                        <Collapse in={isOpen} timeout={250} className="login-accordion__collapse">
                            <Box id={panelId} role="region" aria-labelledby={headerId} className="login-accordion__panel" sx={{ px: CARD_PAD, pt: 0.5, pb: CARD_PAD }}>
                                {item.content}
                            </Box>
                        </Collapse>
                    </Box>
                );
            })}
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
                borderRadius: `${CARD_RADIUS_PX}px`,
                boxShadow: `${roundedEdgeRimLightTop(COLORS.white, 1)}, ${roundedEdgeFilletDown(COLORS.white, CARD_WALL)}, 0 ${CARD_WALL_PX}px 0 ${CARD_WALL}`,
                p: CARD_PAD,
                display: "flex",
                flexDirection: "column",
                gap: 2,
            }}
        >
            {children}
        </Box>
    );
}
