import { Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";

// The signed-in learner's profile picture as a round header button. The host decides
// what a tap does — on Home it raises the AccountSheet (there is no /account
// page any more; Dictionary took its footer slot on 2026-10-09).
//
// Rendered in PageHeader's `trailingContent` slot (to the RIGHT of the minute-points
// flame, after the Settings gear) by Home only — see HomePage and the
// trailing-slot note in PageHeader.
//
// Shape: a CIRCLE, 32px — the same footprint as `HeaderIconButton`'s outlined skin so
// it sits on the header line at the same height as any other right-slot action. This
// is a deliberate departure from the list avatar (FriendPersonRow, AccountSheet), which
// is a rounded square: here it is a lone header control, not a row's leading mark.
//
// Content mirrors AccountSheet's `avatarButton` so the two never disagree: the chosen
// icons8 avatar when set, otherwise the name's initial on the blue MID tier (Artboard
// 5's avatar fill).
//
// GLOW: the hp daily banking run charges this button up as embers land in it
// (docs/DAILY_MINUTE_BANKING.md § 3, § 7). Drawn as a `COLORS.fireActive` halo — the
// flame's orange arriving in the avatar — deliberately NOT the lowSupplyGlow recipe.
// The host never passes it directly: `BankingAvatarButton` subscribes to the run and
// forwards `glowPx`, so the run's per-frame updates stay inside that leaf.
//
// Docs: docs/UX_AND_NAVIGATION.md (hp header), docs/SHELF_REDESIGN.md (flame position),
// docs/DAILY_MINUTE_BANKING.md (glow).
const AVATAR_SIZE_PX = 32;
/** Halo opacity; the spread is a fixed share of the blur so a brighter glow is also wider. */
const GLOW_ALPHA = 0.6;
const GLOW_SPREAD_SHARE = 0.35;

interface HeaderAvatarButtonProps {
    onClick: () => void;
    /** Banking-run halo blur in px; 0 / omitted = no glow. */
    glowPx?: number;
    /** Registers the button as the banking embers' destination. */
    buttonRef?: (node: HTMLElement | null) => void;
}

function HeaderAvatarButton({ onClick, glowPx = 0, buttonRef }: HeaderAvatarButtonProps) {
    const { user } = useAuth();

    // Signed out there is no profile to show (the flame renders null in that case too).
    if (!user) return null;

    // Name is optional on some accounts; fall back to the email so the initial is never empty.
    const initial = (user.name || user.email || "?").charAt(0).toUpperCase();

    return (
        <Box
            className="header-avatar-button"
            component="button"
            type="button"
            aria-label="Account"
            onClick={onClick}
            ref={buttonRef}
            sx={{
                width: AVATAR_SIZE_PX,
                height: AVATAR_SIZE_PX,
                borderRadius: "50%",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                padding: 0,
                cursor: "pointer",
                // Every tappable button carries the app's --line2 outline (CLAUDE.md
                // "Buttons & cards").
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.bluM,
                color: COLORS.onSurface,
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: WEIGHT.semibold,
            }}
            // The glow changes every frame during a banking run, so it goes in `style`:
            // as `sx` it would mint a new CSS class per frame.
            style={{
                boxShadow: glowPx > 0
                    ? `0 0 ${glowPx}px ${glowPx * GLOW_SPREAD_SHARE}px ${alpha(COLORS.fireActive, GLOW_ALPHA)}`
                    : "none",
            }}
        >
            {user.avatarIconId ? (
                <Box
                    component="img"
                    className="header-avatar-button__image"
                    src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(user.avatarIconId)}/image`}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", padding: "4px" }}
                />
            ) : (
                initial
            )}
        </Box>
    );
}

export default HeaderAvatarButton;
