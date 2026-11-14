import { displayName } from "../../utils/displayName";
import type { ReactNode } from "react";
import { Avatar, Box, Collapse, Typography, useMediaQuery } from "@mui/material";
import { API_BASE_URL } from "../../constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

/**
 * One person row, shared by the friend screens (list, incoming, sent), the
 * leaderboard and the challenges page.
 *
 * They render the SAME shape — avatar, display name, secondary line, actions on the
 * right — and differ only in what goes in `actions`. Keeping one component means an
 * avatar-fallback or truncation fix lands everywhere at once.
 * See docs/FRIENDS_FEATURE.md.
 *
 * ── WHY THIS IS NOT `Row` (src/components/primitives/Row.tsx) ─────────────────
 * It wears the design's `.rw` SKIN — white ground, radius 16, 36px rounded avatar,
 * 14.5/11.5 type — but it keeps its own structure, because a `Row` has ONE tap target
 * and this has two nesting models (`onPersonPress` puts the actions OUTSIDE the
 * tappable half; `onRowPress` swallows the whole row). Folding that into the shared
 * primitive would push a friends-only concern into every list in the app. If the two
 * ever converge, this is the component to delete — not the other way round.
 *
 * ── TWO TAP MODELS, and a row uses exactly one ────────────────────────────────
 *   * `onPersonPress` — the avatar + name half is tappable (→ expand) and the
 *     `actions` slot holds real buttons OUTSIDE it, so tapping Decline is never read
 *     as tapping the person. This is the friend screens.
 *   * `onRowPress` — the WHOLE row is one button and `actions` is presentational.
 *     For a row with exactly one thing it can do; this is the challenges page.
 * Passing both is not an error, but `onRowPress` wins and `onPersonPress` is dropped.
 */
interface FriendPersonRowProps {
    name: string | null;
    /** The public handle (migration 188): the fallback label and the hover title. Never an email. */
    username: string;
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
    /**
     * The row's LEFT SECTION — the leaderboard's rank numeral. It is not a chip beside the
     * avatar but a whole column: it runs the row's FULL HEIGHT (alongside an expanded
     * `detail` too), is divided from the rest of the row by one 1px line, and its content
     * stays level with the main line (it does not drift down as the detail opens).
     */
    leading?: ReactNode;
    /** Ground of the `leading` section (the leaderboard's podium tint). Omit for white. */
    leadingFill?: string;
    /**
     * What tapping the PERSON (avatar + name) does. When given, that area becomes
     * tappable; the `actions` slot deliberately stays OUTSIDE it, so tapping Remove or
     * Decline can never be read as a tap on the person. Omit to leave the row inert,
     * as it was before profiles existed.
     *
     * The leaderboard toggles the row's expand-in-place `detail` with it (the profile
     * page it used to open was deleted 2026-11-13 — hence the old name `onOpenProfile`).
     * On the Challenges page, tapping a row ISSUES OR ACCEPTS the challenge, because a page whose entire purpose is one action per friend should
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
    /**
     * Content shown UNDER the row's main line, inside the same bordered box — the
     * leaderboard's expand-in-place detail (FriendExpandedDetail). Pass it on every row
     * that CAN expand, open or not: `expanded` decides whether it shows, and the row
     * animates it open and closed (see DETAIL_COLLAPSE_MS). It is mounted only while open
     * or animating, so a long board does not render every friend's panel.
     */
    detail?: ReactNode;
    /**
     * Whether the row is expanded. Shows/hides `detail`, and drives `aria-expanded` on the
     * person half, so a row whose `onPersonPress` toggles a `detail` announces as a
     * disclosure. Leave undefined on rows that do not expand.
     */
    expanded?: boolean;
    className?: string;
}

/**
 * How long the detail takes to open or close. 280 ms, the same as FriendsBody's view
 * slide, so the Friends tab's motions share one tempo. Reduced motion snaps it (0).
 */
const DETAIL_COLLAPSE_MS = 280;

/**
 * The main line's geometry: 11px vertical padding around the 36px avatar. The `leading`
 * section reads both so its content sits level with the main line whatever the row's
 * full height is.
 */
const ROW_PAD_Y_PX = 11;
const AVATAR_PX = 36;

function FriendPersonRow({ name, username, avatarIconId, secondary, actions, leading, leadingFill, onPersonPress, onRowPress, detail, expanded, className }: FriendPersonRowProps) {
    // Name is optional on the account, so the username is the fallback label AND the
    // source of the initial — never render an empty avatar (docs/LOGIN_REWORK.md Q19–Q20).
    const label = displayName({ name, username });
    const initialSource = name?.trim() || username;

    // A whole-row button owns the tap, so the person half must not also be one — two
    // handlers on nested elements for the same row is exactly the composition
    // `onRowPress` exists to remove.
    const personPress = onRowPress ? undefined : onPersonPress;
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

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
                // Two columns: the optional full-height `leading` section, then the body.
                // `stretch` is what makes the section run the row's whole height.
                display: "flex",
                alignItems: "stretch",
                // `.rw` — the shelf system's list-row skin (docs/SHELF_REDESIGN.md § A5).
                // White on the paper ground, not the beige card fill: beige is the
                // FLASHCARD's material, and a person is not a card.
                borderRadius: "16px",
                ...(onRowPress && {
                    cursor: "pointer",
                    // Press feedback on the WHOLE row, which is the point: the thing
                    // that reacts to the tap is the thing that was tapped.
                    transition: "filter 120ms ease, transform 120ms ease",
                    "&:active": { filter: "brightness(0.97)", transform: "scale(0.995)" },
                }),
                // Every row, the viewer's own included, is the same white `.rw`. The
                // leaderboard used to fill the viewer's row with the org pastel (a
                // `highlighted` prop, removed 2026-11-13 by user request); "(you)" after
                // the name is now the only marker.
                border: `1px solid ${COLORS.rowBorder}`,
                backgroundColor: COLORS.white,
            }}
        >
            {/* The left section. Its fill is clipped to the row's left corners by its own
                radius (15 = the row's 16 minus the 1px border) rather than `overflow:
                hidden` on the row, so nothing inside the expanded detail gets clipped.
                The divider is the same `rowBorder` hairline as the row's outline. */}
            {leading !== undefined && (
                <Box
                    className="friend-person-row__leading"
                    sx={{
                        flexShrink: 0,
                        minWidth: 40,
                        px: 1,
                        pt: `${ROW_PAD_Y_PX}px`,
                        backgroundColor: leadingFill ?? "transparent",
                        borderRadius: "15px 0 0 15px",
                        borderRight: `1px solid ${COLORS.rowBorder}`,
                    }}
                >
                    <Box
                        className="friend-person-row__leading-content"
                        sx={{ height: AVATAR_PX, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                        {leading}
                    </Box>
                </Box>
            )}

            <Box
                className="friend-person-row__body"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    // Wraps only so `detail` (flexBasis 100%) can drop onto its own line inside
                    // the same box; the main line never wraps — its info column has minWidth 0.
                    flexWrap: "wrap",
                    // Column gap only. A row gap would sit between the main line and the
                    // wrapped `detail` even while it is collapsed to 0 height, so the detail
                    // carries its own top spacing INSIDE the collapse instead.
                    columnGap: 1.5,
                    rowGap: 0,
                    p: `${ROW_PAD_Y_PX}px 13px`,
                }}
            >

            <Box
                className="friend-person-row__person"
                onClick={personPress}
                role={personPress ? "button" : undefined}
                tabIndex={personPress ? 0 : undefined}
                aria-expanded={personPress ? expanded : undefined}
                onKeyDown={personPress
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();   // Space would scroll the page
                            personPress();
                        }
                    }
                    : undefined}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flex: 1,
                    minWidth: 0,
                    cursor: personPress ? "pointer" : "default",
                }}
            >
            {/* `.rw .av` — 36px, radius 12, NOT a circle: a list avatar is a rounded square.
                Ground is `bluM`, the SAME tile the person's avatar sits on everywhere else
                (AccountPane's `avatarButton`, HeaderAvatarButton), so someone's avatar looks
                the same on your leaderboard as on their own account sheet — it was the grey
                `iconBg` until 2026-11-13. The inset ring keeps the pastel's edge on white
                (docs/SHELF_REDESIGN.md § D2). */}
            <Avatar
                className="friend-person-row__avatar"
                variant="rounded"
                src={avatarIconId ? `${API_BASE_URL}/api/icons8/${encodeURIComponent(avatarIconId)}/image` : undefined}
                imgProps={{ sx: { objectFit: "contain", p: 0.5 } }}
                sx={{
                    width: AVATAR_PX,
                    height: AVATAR_PX,
                    borderRadius: "12px",
                    bgcolor: COLORS.bluM,
                    color: COLORS.onSurface,
                    fontSize: 13.5,
                    fontWeight: WEIGHT.semibold,
                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                }}
            >
                {initialSource.charAt(0).toUpperCase()}
            </Avatar>

            <Box className="friend-person-row__info" sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    className="friend-person-row__name"
                    title={`@${username}`}
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: 14.5,
                        fontWeight: WEIGHT.semibold,
                        letterSpacing: "-0.01em",
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
                            fontSize: 11.5,
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

            {/* The expand-in-place detail, grown and shrunk by height (MUI Collapse). The
                Collapse is the full-width flex item; `unmountOnExit` drops the content once
                a close has finished. Its 12px top spacing is padding inside the animated
                box, so a closed row is exactly as tall as an inert one. */}
            {detail && (
                <Collapse
                    className="friend-person-row__detail-collapse"
                    in={expanded === true}
                    timeout={reduceMotion ? 0 : DETAIL_COLLAPSE_MS}
                    unmountOnExit
                    sx={{ flexBasis: "100%", minWidth: 0 }}
                >
                    <Box className="friend-person-row__detail" sx={{ pt: 1.5 }}>
                        {detail}
                    </Box>
                </Collapse>
            )}
            </Box>
        </Box>
    );
}

export default FriendPersonRow;
