import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";

/**
 * `SectionCard` — the shelf system's plain boxed section (docs/SHELF_REDESIGN.md § A5,
 * class `.card`): white on the paper ground, an 18px radius, a hairline outline, and
 * 14/16 of padding. Nothing else. It is the SHELL, and it holds whatever the caller puts
 * in it.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `StatCard` ───────────────────────────────────────
 * `StatCard` is this shell plus a fixed three-slot content layout (overline, 38px
 * figure, sentence). That layout is right for the ONE number a screen is about and wrong
 * for everything else — the arena's countdown is a time and a rank on one baseline, the
 * friends page's ID card is a mono string and a copy button. Before this component
 * existed those screens each kept a private `sectionCardSx` object, and the four numbers
 * that make a `.card` a `.card` were written out three times in three features
 * (`friendStyles.ts`, `arenaStyles.ts`, and inline). All three had already drifted from
 * the design — a `borderRadius: 3` (24px) where the design says 18px, and `p: 1.5`
 * (12px) where it says 14/16.
 *
 * So: `SectionCard` is the shell, `StatCard` is the shell plus the figure layout, and a
 * screen that needs the shell around its own content reaches for this one directly
 * rather than re-deriving it.
 *
 * ── THE MARGIN IS THE COMPONENT'S, NOT THE PAGE'S ────────────────────────────────────
 * `14px 18px 0` matches the design's `.card`, which carries its own gutters so a card
 * can sit directly in a page's scroll column with nothing wrapping it. Pass `sx` to
 * override when a card is already inside something that insets it.
 *
 * Sibling primitives: `StatCard`, `Row` / `RowList`, `Label` / `SectionRule` /
 * `SectionHeader`.
 */

export interface SectionCardProps {
    children: React.ReactNode;
    /**
     * Overrides the white ground. For the one case where a card's FILL is the message —
     * the arena's results banner going green on a promotion — not for decoration.
     */
    background?: string;
    className?: string;
    sx?: SxProps<Theme>;
}

const SectionCard: React.FC<SectionCardProps> = ({ children, background, className, sx }) => (
    <Box
        className={className ? `section-card ${className}` : "section-card"}
        sx={[
            {
                margin: "14px 18px 0",
                padding: "14px 16px",
                borderRadius: "18px",
                backgroundColor: background ?? COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
            },
            ...(Array.isArray(sx) ? sx : [sx]),
        ]}
    >
        {children}
    </Box>
);

export default SectionCard;
