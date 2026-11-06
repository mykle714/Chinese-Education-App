import { Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";
import { SHADOW } from "../theme/shadows";

// The signed-in learner's profile picture as a round header button, in the Deck Tower
// header's far-right corner (MobileTabScreen `headerTrailingActions`, right of the
// minute-points flame). The host decides what a tap does — td raises the AccountSheet
// (there is no /account page; Dictionary took its footer slot on 2026-10-09).
//
// Its only caller is `BankingAvatarButton` (src/minutePoints/dailyBanking), rendered by
// DeckTowerAvatar. A 32px header copy also sat in the old Home page's header until that
// page was deleted on 2026-11-04, which is why this lives in src/components rather than
// in the deckTower feature folder.
//
// Shape: a CIRCLE, 46px (40px until the 2026-11-05 header scale-up), resting on `SHADOW.float` so it reads against td's sky and
// space backdrops. This is a deliberate departure from the list avatar (FriendPersonRow,
// AccountSheet), which is a rounded square: here it is a lone header control, not a
// row's leading mark.
//
// Content mirrors AccountSheet's `avatarButton` so the two never disagree: the chosen
// icons8 avatar when set, otherwise the name's initial on the blue MID tier (Artboard
// 5's avatar fill).
//
// GLOW: the td daily banking run charges this button up as embers land in it
// (docs/DAILY_MINUTE_BANKING.md § 3, § 7). Drawn as a `COLORS.fireActive` halo — the
// flame's orange arriving in the avatar — deliberately NOT the lowSupplyGlow recipe —
// appended to the `SHADOW.float` rest shadow. The host never passes it directly:
// `BankingAvatarButton` subscribes to the run and forwards `glowPx`, so the run's
// per-frame updates stay inside that leaf.
//
// Docs: docs/DECK_TOWER.md (§ "Layers"), docs/DAILY_MINUTE_BANKING.md (glow),
// docs/SHELF_REDESIGN.md (flame position).
const AVATAR_SIZE_PX = 46;
/** Resting shadow; the banking glow, when lit, is appended to it. */
const REST_SHADOW = SHADOW.float;
/** Initial's font size and the icon's inset, as shares of the circle (13px / 4px at 32px). */
const INITIAL_FONT_SHARE = 13 / 32;
const IMAGE_INSET_SHARE = 4 / 32;
/** Halo opacity; the spread is a fixed share of the blur so a brighter glow is also wider. */
const GLOW_ALPHA = 0.6;
const GLOW_SPREAD_SHARE = 0.35;

interface HeaderAvatarButtonProps {
    onClick: () => void;
    /** Banking-run halo blur in px; 0 / omitted = no glow. */
    glowPx?: number;
    /** Registers the button as the banking embers' destination. */
    buttonRef?: (node: HTMLElement | null) => void;
    className?: string;
}

function HeaderAvatarButton({
    onClick,
    glowPx = 0,
    buttonRef,
    className,
}: HeaderAvatarButtonProps) {
    const { user } = useAuth();

    // Signed out there is no profile to show (the flame renders null in that case too).
    if (!user) return null;

    // Name is optional on some accounts; fall back to the email so the initial is never empty.
    const initial = (user.name || user.email || "?").charAt(0).toUpperCase();

    // `box-shadow` is one property, so the rest shadow and the glow halo share it.
    const glowShadow = glowPx > 0
        ? `0 0 ${glowPx}px ${glowPx * GLOW_SPREAD_SHARE}px ${alpha(COLORS.fireActive, GLOW_ALPHA)}`
        : null;
    const boxShadow = [REST_SHADOW, glowShadow].filter(Boolean).join(", ");

    return (
        <Box
            className={className ? `header-avatar-button ${className}` : "header-avatar-button"}
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
                fontSize: Math.round(AVATAR_SIZE_PX * INITIAL_FONT_SHARE),
                fontWeight: WEIGHT.semibold,
            }}
            // The glow changes every frame during a banking run, so it goes in `style`:
            // as `sx` it would mint a new CSS class per frame.
            style={{ boxShadow }}
        >
            {user.avatarIconId ? (
                <Box
                    component="img"
                    className="header-avatar-button__image"
                    src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(user.avatarIconId)}/image`}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", padding: `${Math.round(AVATAR_SIZE_PX * IMAGE_INSET_SHARE)}px` }}
                />
            ) : (
                initial
            )}
        </Box>
    );
}

export default HeaderAvatarButton;
