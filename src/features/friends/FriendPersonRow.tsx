import type { ReactNode } from "react";
import { Avatar, Box, Typography } from "@mui/material";
import { API_BASE_URL } from "../../constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * One person row, shared by all three friend screens (list, incoming, sent).
 *
 * All three render the SAME shape — avatar, display name, secondary line, action
 * buttons on the right — and differ only in what goes in `actions`. Keeping one
 * component means an avatar-fallback or truncation fix lands everywhere at once.
 * See docs/FRIENDS_FEATURE.md.
 */
interface FriendPersonRowProps {
    name: string | null;
    email: string;
    avatarIconId: string | null;
    /** Small muted line under the name — "Friends since …", "Sent …", etc. */
    secondary?: string;
    /** Right-hand controls (Accept / Decline / Revoke / Remove). */
    actions?: ReactNode;
    /** Slot to the LEFT of the avatar — the leaderboard's rank badge. */
    leading?: ReactNode;
    /**
     * Draw the row as "this is you". Used only by the leaderboard, where the viewer
     * is ranked among their friends and needs to find themselves at a glance.
     */
    highlighted?: boolean;
    className?: string;
}

function FriendPersonRow({ name, email, avatarIconId, secondary, actions, leading, highlighted, className }: FriendPersonRowProps) {
    // Name is optional on the account, so the email is the fallback label AND the
    // source of the initial — never render an empty avatar.
    const label = name || email;

    return (
        <Box
            className={`friend-person-row ${className ?? ""}`.trim()}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                borderRadius: 3,
                backgroundColor: COLORS.infoCard,
                // "You" is marked with a border, not a fill: a different fill would
                // read as a different KIND of row rather than as the same row, yours.
                border: highlighted
                    ? `2px solid ${COLORS.blueMain}`
                    : `1px solid ${COLORS.rowBorder}`,
                // Compensate for the thicker border so highlighted and plain rows
                // keep the same outer height and the list stays evenly spaced.
                p: highlighted ? "11px" : 1.5,
            }}
        >
            {leading}

            <Avatar
                className="friend-person-row__avatar"
                src={avatarIconId ? `${API_BASE_URL}/api/icons8/${encodeURIComponent(avatarIconId)}/image` : undefined}
                imgProps={{ sx: { objectFit: "contain", p: 0.5 } }}
                sx={{ width: 44, height: 44, bgcolor: COLORS.iconBg, color: COLORS.onSurface }}
            >
                {label.charAt(0).toUpperCase()}
            </Avatar>

            <Box className="friend-person-row__info" sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    className="friend-person-row__name"
                    title={email}
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.onSurface,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {label}
                </Typography>
                {secondary && (
                    <Typography
                        className="friend-person-row__secondary"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            color: COLORS.textSecondary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {secondary}
                    </Typography>
                )}
            </Box>

            {actions && (
                <Box className="friend-person-row__actions" sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                    {actions}
                </Box>
            )}
        </Box>
    );
}

export default FriendPersonRow;
