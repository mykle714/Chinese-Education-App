import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import ForeignText from "../../components/ForeignText";
import { Label } from "../../components/primitives";
import { COLORS } from "../../theme/colors";
import type { Language } from "../../types";

/**
 * `InfoPeek` — the design's `.peek` (artboards 18–25): the LIP of the extra-info
 * panel, resting at the bottom of a card surface.
 *
 * ── What it replaced, and why the shape changed ───────────────────────────────
 * This was `MoreInfoPill` — a floating "↑ More Info" capsule centred over the card.
 * A capsule is a BUTTON: it says "something will happen", and the learner has to have
 * been told what. The design turns it into the top edge of the panel it opens, which
 * says the same thing structurally — there is a sheet down there, it has a grabber, it
 * is about this word, and it opens on the definition. Nothing has to be learned, and
 * the affordance stops competing with the card for the middle of the screen.
 *
 * It is a resting sheet edge, not a pill, so it spans the full width and carries the
 * sheet's own radius and shadow. On the flp it sits flush to the bottom; on the cdp it
 * sits at `FOOTER_HEIGHT`, because that page keeps the footer bar.
 *
 * ── The two states it keeps from the pill ─────────────────────────────────────
 * `disabled` (the icon editor is open — the panel would cover the canvas) and `dimmed`
 * (the flp card has not been flipped yet, so there is no answer to expand on). Both
 * were on the pill and both are still true of the panel; a dimmed peek is drawn but
 * inert, which is what tells the learner the panel exists before it is usable.
 * `pulse` is the earned coaching hint, unchanged.
 *
 * Referenced by docs/SHELF_REDESIGN.md (artboards 18–25).
 */

export interface InfoPeekProps {
    /** The word the panel will open on — printed as the peek's own subject. */
    word: string;
    /** Optional to match `VocabEntry.language`, which is nullable on a det-fallback entry. */
    language?: Language;
    /** Which tab the panel opens on, named on the right (`definition`, `examples`, …). */
    tabLabel?: string;
    onOpen: () => void;
    /** Distance from the bottom of the frame. `0` on a footerless page; FOOTER_HEIGHT under a footer. */
    bottom?: number;
    /** Drawn but inert and greyed — the surface is busy (the icon editor is open). */
    disabled?: boolean;
    /**
     * Faded — there is nothing to expand on yet (the flp card has not been flipped).
     *
     * Still TAPPABLE, unlike `disabled`: a tap in this state is how the learner gets the
     * "flip the card first" hint, so swallowing it would make the affordance silent
     * exactly when it needs to explain itself.
     */
    dimmed?: boolean;
    /** Nudge the peek up and down until the learner has used it once. */
    pulse?: boolean;
    className?: string;
}

export const InfoPeek: React.FC<InfoPeekProps> = ({
    word,
    language,
    tabLabel = "definition",
    onOpen,
    bottom = 0,
    disabled = false,
    dimmed = false,
    pulse = false,
    className,
}) => {
    return (
        <Box
            className={className ? `info-peek ${className}` : "info-peek"}
            role="button"
            aria-label="Open extra info"
            aria-disabled={disabled}
            onClick={disabled ? undefined : onOpen}
            sx={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom,
                backgroundColor: COLORS.white,
                borderRadius: "24px 24px 0 0",
                borderTop: `1px solid ${COLORS.rowBorder}`,
                boxShadow: "0 -9px 26px rgba(20,18,26,0.10)",
                padding: "9px 20px 15px",
                zIndex: 4,
                cursor: disabled ? "default" : "pointer",
                pointerEvents: disabled ? "none" : "auto",
                // The editor case greys the whole lip; the not-yet-flipped case only
                // fades it, because the sheet edge is still structurally correct — it
                // just has nothing to say yet.
                opacity: disabled ? 0.32 : dimmed ? 0.5 : 1,
                transition: "opacity 0.35s ease",
                animation: pulse && !disabled ? "infoPeekNudge 1.6s ease-in-out infinite" : "none",
                "@keyframes infoPeekNudge": {
                    "0%, 100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-5px)" },
                },
            }}
        >
            {/* `.grab` — the same grabber the raised sheet carries, so the lip and the
                open panel are visibly one object. */}
            <Box
                className="info-peek__grab"
                sx={{ width: 44, height: 4, borderRadius: "3px", backgroundColor: COLORS.border, margin: "0 auto 11px" }}
            />
            <Box className="info-peek__row" sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Icon name="menu_book" size={18} color={COLORS.textSecondary} />
                {/* The headword through ForeignText like everywhere else — never a raw
                    string in a `<b>` (see the project's foreign-text rule). */}
                <ForeignText
                    className="info-peek__word"
                    // `xs` (18px): the peek names its subject, it does not present it —
                    // the card above is the presentation. A larger row here competes
                    // with the card for the eye at the moment the learner is deciding
                    // whether to raise the panel at all.
                    size="xs"
                    bold
                    language={language}
                    text={word}
                    showPinyin={false}
                />
                <Label className="info-peek__tab" sx={{ marginLeft: "auto" }}>{tabLabel}</Label>
            </Box>
        </Box>
    );
};

export default InfoPeek;
