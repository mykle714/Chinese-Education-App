import { ButtonBase, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Icon from "../../components/Icon";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";

/**
 * `.joinbtn` — the arena's one action (`Arena Flow - Shelf System.html` A5, A6, A8–A11).
 *
 * A wide gold block with a trailing arrow, and the only thing on the page that is gold.
 *
 * ── WHY IT IS NOT THE APP'S INK PILL ────────────────────────────────────────────────
 * Every other primary action in the app is `.btn2`, the near-black pill the MUI theme
 * already draws on `variant="contained"`, and this button was one until the arena flow.
 * The flow gives it `RAMP.gld` instead for a reason specific to this page: /arena is the
 * one screen where the other hues are all SEMANTIC — green is promotion, red is
 * demotion, the org pastel is "this row is you" — so the page needs an action colour
 * that cannot be read as an outcome. (This is the same argument that took the join
 * button OFF green earlier; gold finishes it.) Gold is now a real ramp entry, minted
 * with this button, so it is a palette decision taken once rather than a hex inlined
 * here. See the `--gld` note in `theme/colors.ts`.
 *
 * ── THE DISABLED STATE IS A COLOUR, NOT AN OPACITY ──────────────────────────────────
 * Busy renders `RAMP.gld.tint` with the ink at 45%, per the artboard's `.joinbtn.off`,
 * rather than dimming the whole element. A page-wide opacity on a gold block turns it
 * grey-brown and reads as broken; a lighter gold still reads as the same button, waiting.
 * The arrow is dropped while busy for the same reason a spinner would be: there is
 * nowhere to go yet.
 *
 * The two softened inks use `alpha()` on the gold's own ink rather than a second hex,
 * so they composite ONTO the gold ground — which is what the artboard's
 * `oklch(28% 0.09 60 / .45)` does — and cannot drift from the colour they are a
 * transparency of.
 */
export interface ArenaJoinButtonProps {
    /** Label — "Join next arena", or "Joining…" while the request is in flight. */
    label: string;
    /** In flight. Renders the soft gold and takes no taps. */
    busy?: boolean;
    onClick: () => void;
    className?: string;
}

const ArenaJoinButton: React.FC<ArenaJoinButtonProps> = ({ label, busy = false, onClick, className }) => (
    <ButtonBase
        className={className ? `arena-join-button ${className}` : "arena-join-button"}
        onClick={onClick}
        disabled={busy}
        sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            width: "100%",
            padding: "18px 16px",
            // 16px, not the pill's 999px: at this width a full pill reads as a lozenge
            // floating on the page, while a soft rectangle reads as a bar across it.
            borderRadius: "16px",
            backgroundColor: busy ? RAMP.gld.tint : RAMP.gld.surface,
        }}
    >
        <Typography
            className="arena-join-button__label"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: 21,
                fontWeight: 800,
                letterSpacing: "-0.012em",
                // v2 removed `--gldA`: the label on gold is plain ink.
                color: busy ? alpha(COLORS.onSurface, 0.45) : COLORS.onSurface,
            }}
        >
            {label}
        </Typography>
        {!busy && (
            // 70% of the ink, per the artboard: the arrow is a direction cue, not a
            // second thing to read, and at full strength it competes with the label.
            <Icon name="arrow_forward" size={21} color={alpha(COLORS.onSurface, 0.7)} weight={700} />
        )}
    </ButtonBase>
);

export default ArenaJoinButton;
