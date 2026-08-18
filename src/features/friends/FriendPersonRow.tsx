import type { ReactNode } from "react";
import { Avatar, Box, Typography } from "@mui/material";
import { API_BASE_URL } from "../../constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * One person row, shared by the friend screens (list, incoming, sent), the
 * leaderboard and the challenges page.
 *
 * They render the SAME shape — avatar, display name, secondary line, actions on the
 * right — and differ only in what goes in `actions`. Keeping one component means an
 * avatar-fallback or truncation fix lands everywhere at once.
 * See docs/FRIENDS_FEATURE.md.
 *
 * ── TWO TAP MODELS, and a row uses exactly one ────────────────────────────────
 *   * `onPersonPress` — the avatar + name half is tappable (→ the profile) and the
 *     `actions` slot holds real buttons OUTSIDE it, so tapping Decline is never read
 *     as tapping the person. This is the friend screens.
 *   * `onRowPress` — the WHOLE row is one button and `actions` is presentational.
 *     For a row with exactly one thing it can do; this is the challenges page.
 * Passing both is not an error, but `onRowPress` wins and `onPersonPress` is dropped.
 */
interface FriendPersonRowProps {
    name: string | null;
    email: string;
    avatarIconId: string | null;
    /** Small muted line under the name — "Friends since …", "Sent …", etc. */
    secondary?: string;
    /**
     * Right-hand controls (Accept / Decline / Revoke / Remove).
     *
     * ⚠️ With `onRowPress` set these must be PRESENTATIONAL only — the row is the
     * button, and a nested one would compete with it. See `onRowPress`.
     */
    actions?: ReactNode;
    /** Slot to the LEFT of the avatar — the leaderboard's rank badge. */
    leading?: ReactNode;
    /**
     * Draw the row as "this is you". Used only by the leaderboard, where the viewer
     * is ranked among their friends and needs to find themselves at a glance.
     */
    highlighted?: boolean;
    /**
     * What tapping the PERSON (avatar + name) does. When given, that area becomes
     * tappable; the `actions` slot deliberately stays OUTSIDE it, so tapping Remove or
     * Decline can never be read as a tap on the person. Omit to leave the row inert,
     * as it was before profiles existed.
     *
     * Almost every caller opens the person's profile (docs/USER_PROFILE_PAGE.md) —
     * hence the old name `onOpenProfile`. The Challenges page is the exception and the
     * reason this is a generic handler now: there, tapping a row ISSUES OR ACCEPTS the
     * challenge, because a page whose entire purpose is one action per friend should
     * not have a large tap target that does something else
     * (docs/STUDY_CHALLENGE.md § 1).
     */
    onPersonPress?: () => void;
    /**
     * Make the ENTIRE row one button — avatar, name, secondary line, actions slot and
     * the padding between them.
     *
     * Use this when the row has exactly ONE thing it can do, as the challenges page
     * does (issue / accept / open, docs/STUDY_CHALLENGE.md § 1). It replaces
     * `onPersonPress`, which is ignored while this is set, and it comes with an
     * obligation on the caller: **nothing inside `actions` may be interactive.** A
     * `<button>` nested in a clickable row steals the tap near its own edges, adds a
     * second tab stop for the same action, and lets the two drift apart — so a row
     * button renders its control as a presentational pill
     * (`challengeActionPillSx`) instead.
     *
     * Leave it undefined to make the row inert; do NOT pass a no-op, or the row will
     * still look and behave like a control (cursor, focus ring, Enter/Space).
     */
    onRowPress?: () => void;
    className?: string;
}

function FriendPersonRow({ name, email, avatarIconId, secondary, actions, leading, highlighted, onPersonPress, onRowPress, className }: FriendPersonRowProps) {
    // Name is optional on the account, so the email is the fallback label AND the
    // source of the initial — never render an empty avatar.
    const label = name || email;

    // A whole-row button owns the tap, so the person half must not also be one — two
    // handlers on nested elements for the same row is exactly the composition
    // `onRowPress` exists to remove.
    const personPress = onRowPress ? undefined : onPersonPress;

    return (
        <Box
            className={`friend-person-row ${className ?? ""}`.trim()}
            // The row is a real button when `onRowPress` is set: role + tabIndex +
            // Enter/Space, not just an onClick, so it is reachable and operable from a
            // keyboard the way the <button> it replaces would have been.
            onClick={onRowPress}
            role={onRowPress ? "button" : undefined}
            tabIndex={onRowPress ? 0 : undefined}
            onKeyDown={onRowPress
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();   // Space would scroll the page
                        onRowPress();
                    }
                }
                : undefined}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                borderRadius: 3,
                backgroundColor: COLORS.infoCard,
                ...(onRowPress && {
                    cursor: "pointer",
                    // Press feedback on the WHOLE row, which is the point: the thing
                    // that reacts to the tap is the thing that was tapped.
                    transition: "filter 120ms ease, transform 120ms ease",
                    "&:active": { filter: "brightness(0.97)", transform: "scale(0.995)" },
                }),
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

            <Box
                className="friend-person-row__person"
                onClick={personPress}
                role={personPress ? "button" : undefined}
                tabIndex={personPress ? 0 : undefined}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flex: 1,
                    minWidth: 0,
                    cursor: personPress ? "pointer" : "default",
                }}
            >
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
