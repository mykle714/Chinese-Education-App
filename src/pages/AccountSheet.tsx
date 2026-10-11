import { useRef, useState } from "react";
import { Box, Typography, Button, IconButton, Snackbar, Switch } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import SheetPanel, { type SheetPanelBodyHandle } from "../components/sheet/SheetPanel";
import LibraryShelfWithVelocity from "../components/velocity/LibraryShelfWithVelocity";
import IconPickerDialog from "../components/IconPickerDialog";
import BankBanner from "../minutePoints/BankBanner";
import Icon from "../components/Icon";
import { Label, Row, RowList, SectionHeader } from "../components/primitives";
import { API_BASE_URL } from "../constants";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import { useCategoryCounts } from "../hooks/useCategoryCounts";
import { useVelocity } from "../hooks/useVelocity";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SAFE_BOTTOM } from "../theme/safeArea";

/**
 * Account — artboard 5 of the shelf redesign (docs/SHELF_REDESIGN.md entry 5), as a
 * MAXIMIZABLE BOTTOM SHEET raised from the Home header's avatar button
 * (HeaderAvatarButton → HomePage). It used to be the `/account` footer tab; Dictionary
 * took that slot on 2026-10-09 and the route was deleted.
 *
 * Why a sheet: the account is something you glance at from Home (your library shelf,
 * velocity, goal switches), not a destination with drill-ins of its own. As a sheet it
 * opens at SheetPanel's default height, drags to full screen (the merge chrome turns it
 * into a page-with-a-header — the "maximize"), and drags away leaving Home untouched.
 * Settings is NOT reached from in here any more: its gear was extracted to sit beside
 * the avatar in the Home header, so both live in the same corner.
 *
 * The body is assembled ENTIRELY from shelf-system primitives, in the artboard's
 * order: the profile as a `Row`, the minute bank as a `StatCard` (`BankBanner`,
 * docs/DAILY_MINUTE_BANKING.md § 6 — not on the artboard, added 2026-10-10), the four utcm bands as a `Shelf` under a "Your
 * library" header, Velocity as a `StatCard`, the two mastery goals as `Row`s with
 * switches, and Log Out as the `.btn3` outlined block.
 *
 * ⚠️ THE BODY ITSELF HAS NO SIDE PADDING, and that is the whole reason the conversion
 * worked. Every primitive here carries its own page gutter (`RowList` 16px,
 * `SectionHeader`/`Shelf` 22px, `StatCard` 18px) plus its own top margin, because in
 * the design those gutters differ per shape.
 *
 * LAYER: app-level page surface (src/pages — not part of any one feature). Data comes
 * from AuthContext + useCategoryCounts/useVelocity; no direct server calls.
 *
 * Depended on by: docs/SHELF_REDESIGN.md entry 5, docs/UX_AND_NAVIGATION.md,
 * docs/VELOCITY.md, docs/MASTERY_REWORK.md.
 */

// The sheet body is its own scroll region. `pan-y`, NOT `none`: SheetPanel picks
// resize-vs-scroll on a gesture's first committed move and expresses "scroll" by NOT
// calling preventDefault, so the browser must be allowed to pan natively (same note as
// CompareWorkspace / InfoCardPanelBody). The bottom padding replaces the old
// FooterSpacer — the sheet covers the footer, so only the home-indicator inset (plus a
// breath under Log Out) needs clearing.
const bodyScrollSx = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    touchAction: "pan-y",
    paddingBottom: `calc(24px + ${SAFE_BOTTOM})`,
} as const;

interface AccountSheetProps {
    // Called once the sheet has finished its dismiss animation (or immediately on
    // logout) — the host (HomePage) unmounts it here.
    onClose: () => void;
}

function AccountSheet({ onClose }: AccountSheetProps) {
    const { confirm } = useConfirmation();
    const { user, isLoading, logout, updateAvatar, updateGoals } = useAuth();

    // SheetPanel's resize/scroll coupling needs the body's gesture root and its scroll
    // element. They are the same node here (one scroll region, like CompareWorkspace),
    // so a callback ref fills both halves of the handle.
    const bodyRef = useRef<SheetPanelBodyHandle | null>(null);
    const setBodyNode = (node: HTMLDivElement | null) => {
        bodyRef.current = { root: node, scroll: node };
    };

    // Goal toggles (docs/MASTERY_REWORK.md). Optimistic local state; a failed PUT
    // reverts. Reading/Writing are only meaningful where those marks can be earned
    // (zh games), so the section is hidden for Spanish accounts.
    const [goalSaving, setGoalSaving] = useState<null | "reading" | "writing">(null);
    const showGoals = user?.selectedLanguage !== "es";
    const handleToggleGoal = async (which: "reading" | "writing", next: boolean) => {
        setGoalSaving(which);
        try {
            await updateGoals(which === "reading" ? { readingGoal: next } : { writingGoal: next });
        } catch {
            /* AuthContext surfaces the error; local switch reverts via user state */
        } finally {
            setGoalSaving(null);
        }
    };

    // Avatar picker (modal) open state.
    const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

    // Logging out tears the sheet down at once (no dismiss animation) — the host page
    // is about to lose its signed-in state, so there is nothing to slide back to.
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            onClose();
            logout();
        }
    };

    // Per-category library card counts, shown as the shelf's spine heights.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();

    // Velocity — mastery band-steps climbed in the sliding 7-day window for the
    // account's selected language (docs/VELOCITY.md). Display-only.
    const { velocity, windowDays, boundaryCounts, loaded: velocityLoaded } = useVelocity();

    // "Copied to clipboard" toast for the user-ID copy button
    const [copiedToastOpen, setCopiedToastOpen] = useState(false);

    // Copy the user ID to the clipboard, then surface a confirmation toast.
    // Falls back silently if the Clipboard API is unavailable (e.g. insecure context).
    const handleCopyUserId = async (id: string) => {
        try {
            await navigator.clipboard.writeText(id);
            setCopiedToastOpen(true);
        } catch {
            // Clipboard unavailable (non-HTTPS / unsupported) — no-op rather than crash.
        }
    };

    // Loading / signed-out are edge states: the host only offers the avatar button while
    // a user is loaded. They still render inside the sheet so it never opens blank.
    if (isLoading || !user) {
        return (
            <SheetPanel onClose={onClose} bodyRef={bodyRef} bodyKey="account" title="Account">
                <Box className="account-sheet__body" ref={setBodyNode} sx={bodyScrollSx}>
                    {isLoading ? (
                        <DelayedCircularProgress className="account-sheet__spinner" />
                    ) : (
                        <Typography
                            className="account-sheet__no-user-text"
                            sx={{ textAlign: "center", padding: "20px", color: COLORS.onSurface, fontFamily: FONTS.sans }}
                        >
                            Please log in to view your account
                        </Typography>
                    )}
                </Box>
            </SheetPanel>
        );
    }

    const userId = user.id;
    const userEmail = user.email;
    const userName = user.name;

    // The shelf header's right-hand figure: the library's total size. It is the sum of
    // the four bands rather than a fifth number from the server, so it can never
    // disagree with the spines under it.
    const totalCards = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);

    // The avatar OWNS the whole 48px slot (Row's `avatar` escape hatch) because it is
    // tappable and the styled 36px box the primitive draws for `icon`/`initials` is
    // neither the right size nor focusable. It is a real <button>, so the picker is
    // reachable by keyboard — the old MUI Avatar carried role="button" on a div.
    const avatarButton = (
        <Box
            className="account-sheet__avatar"
            component="button"
            type="button"
            aria-label="Change avatar"
            onClick={() => setAvatarPickerOpen(true)}
            sx={{
                width: 48,
                height: 48,
                borderRadius: "15px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                border: "none",
                padding: 0,
                cursor: "pointer",
                // Artboard 5's avatar: `--bluK` (= the blue MID tier) with an ink initial.
                backgroundColor: COLORS.bluM,
                color: COLORS.onSurface,
                boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                fontFamily: FONTS.sans,
                fontSize: 17,
                fontWeight: 600,
            }}
        >
            {user.avatarIconId ? (
                <Box
                    component="img"
                    className="account-sheet__avatar-image"
                    src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(user.avatarIconId)}/image`}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", padding: "6px" }}
                />
            ) : (
                userName.charAt(0).toUpperCase()
            )}
        </Box>
    );

    return (
        <>
            <SheetPanel onClose={onClose} bodyRef={bodyRef} bodyKey="account" title="Account">
                <Box className="account-sheet__body" ref={setBodyNode} sx={bodyScrollSx}>
                    {/* Profile — one Row. Its third (mono) line is the copyable user ID,
                        which Friends needs the learner to be able to hand out. */}
                    <RowList className="account-sheet__profile">
                        <Row
                            className="account-sheet__profile-row"
                            avatar={avatarButton}
                            title={userName}
                            subtitle={userEmail}
                            meta={
                                <>
                                    ID {userId}
                                    <IconButton
                                        className="account-sheet__copy-user-id-button"
                                        aria-label="Copy user ID"
                                        size="small"
                                        onClick={() => handleCopyUserId(String(userId))}
                                        sx={{ color: COLORS.textFaint, padding: "1px" }}
                                    >
                                        <Icon name="content_copy" size={12} color="inherit" />
                                    </IconButton>
                                </>
                            }
                        />
                    </RowList>

                    {/* The minute bank — NET through yesterday, with today's minutes as
                        a corner chip. Directly under the profile row, tying it to the
                        avatar the hp banking embers fly into (Q4). */}
                    <BankBanner className="account-sheet__bank-banner" />

                    <SectionHeader
                        className="account-sheet__library-header"
                        label={
                            <>
                                <Label>Your library</Label>
                                {countsLoaded && <Label className="account-sheet__library-total">{totalCards.toLocaleString()}</Label>}
                            </>
                        }
                        sx={{ "& > .lab": { flexShrink: 0 } }}
                    />
                    {/* The library shelf, with the Velocity card hanging under it: one
                        spine per utcm band (height encodes its count), then the card whose
                        U-arrows join neighbouring spines with the cards that climbed between
                        them in the last 7 days (docs/VELOCITY.md). One component, because
                        the arrows have to line up with the spines. It holds each half back
                        until it loads and reserves its height, so nothing below shifts. */}
                    <LibraryShelfWithVelocity
                        className="account-sheet__library"
                        counts={countsLoaded ? categoryCounts : null}
                        velocity={velocityLoaded ? { velocity, windowDays, boundaryCounts } : null}
                    />

                {/* Goals — opt into the Reading / Writing mastery goals
                    (docs/MASTERY_REWORK.md). Recognition + Production are always pursued
                    and aren't shown. Hidden for Spanish accounts.

                    The artboard replaces the old explanatory paragraph with one subtitle
                    per row ("Adds a reading bar to every card"), which is the same fact
                    said once per control instead of once per section. */}
                {showGoals && (
                    <>
                        <SectionHeader className="account-sheet__goals-header" label="Goals" />
                        <RowList className="account-sheet__goals">
                            <Row
                                className="account-sheet__goal-reading"
                                icon="menu_book"
                                hue="red"
                                title="Learn reading"
                                subtitle="Adds a reading bar to every card"
                                trailing={
                                    <Switch
                                        className="account-sheet__goal-reading-switch"
                                        inputProps={{ "aria-label": "Learn reading" }}
                                        checked={user.readingGoal === true}
                                        disabled={goalSaving !== null}
                                        onChange={(e) => handleToggleGoal("reading", e.target.checked)}
                                    />
                                }
                            />
                            <Row
                                className="account-sheet__goal-writing"
                                icon="edit"
                                hue="org"
                                title="Learn writing"
                                subtitle="Adds a writing bar to every card"
                                trailing={
                                    <Switch
                                        className="account-sheet__goal-writing-switch"
                                        inputProps={{ "aria-label": "Learn writing" }}
                                        checked={user.writingGoal === true}
                                        disabled={goalSaving !== null}
                                        onChange={(e) => handleToggleGoal("writing", e.target.checked)}
                                    />
                                }
                            />
                        </RowList>
                    </>
                )}

                {/* Log Out — the `.btn3` outlined block. Its own RowList rather than the
                    goals' one (where the artboard draws it) so it survives the Spanish
                    case, which hides the goals section entirely. */}
                <RowList className="account-sheet__logout">
                    <Button
                        className="account-sheet__logout-button"
                        fullWidth
                        variant="outlined"
                        color="primary"
                        startIcon={<Icon name="logout" size={17} color="inherit" />}
                        onClick={handleLogout}
                    >
                        Log Out
                    </Button>
                </RowList>

                </Box>
            </SheetPanel>

            {/* Avatar icon picker — shared icon search/browser. Empty query browses all
                downloaded icons; typing searches icons8 (download-on-select). */}
            <IconPickerDialog
                open={avatarPickerOpen}
                onClose={() => setAvatarPickerOpen(false)}
                title="Choose your avatar"
                currentIconId={user.avatarIconId ?? null}
                onPick={(id) => updateAvatar(id)}
                onRemove={() => updateAvatar(null)}
                removeLabel="Remove avatar"
            />

            {/* "Copied to clipboard" confirmation for the user-ID copy button */}
            <Snackbar
                className="account-sheet__copy-toast"
                open={copiedToastOpen}
                autoHideDuration={2000}
                onClose={() => setCopiedToastOpen(false)}
                message="Copied to clipboard"
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            />
        </>
    );
}

export default AccountSheet;
