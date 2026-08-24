import { useState } from "react";
import { Box, Typography, Button, IconButton, Snackbar, Switch } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useSlideNavigate } from "../hooks/useSlideNavigate";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import MobileTabScreen from "../components/MobileTabScreen";
import { HeaderIconButton } from "../components/PageHeader";
import { FooterSpacer } from "../components/MobileFooter";
import DeckBuckets from "../components/DeckBuckets";
import IconPickerDialog from "../components/IconPickerDialog";
import Icon from "../components/Icon";
import { Label, Row, RowList, SectionHeader, StatCard } from "../components/primitives";
import { API_BASE_URL } from "../constants";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import { usePageTitle } from "../hooks/usePageTitle";
import { useCategoryCounts } from "../hooks/useCategoryCounts";
import { useVelocity } from "../hooks/useVelocity";
import InfoTip from "../components/InfoTip";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";

/**
 * Account (`/account`) — artboard 5 of the shelf redesign (docs/SHELF_REDESIGN.md
 * entry 5).
 *
 * The page is now assembled ENTIRELY from shelf-system primitives, in the artboard's
 * order: the profile as a `Row`, the four utcm bands as a `Shelf` under a "Your
 * library" header, Velocity as a `StatCard`, the two mastery goals as `Row`s with
 * switches, and Log Out as the `.btn3` outlined block.
 *
 * ⚠️ THE PAGE ITSELF HAS NO PADDING, and that is the whole reason the conversion
 * worked. Every primitive here carries its own page gutter (`RowList` 16px,
 * `SectionHeader`/`Shelf` 22px, `StatCard` 18px) plus its own top margin, because in
 * the design those gutters differ per shape. The previous version wrapped everything
 * in a 20px-padded, 350px-wide centred column, which would double every one of them.
 *
 * Depended on by: docs/SHELF_REDESIGN.md entry 5, docs/UX_AND_NAVIGATION.md,
 * docs/VELOCITY.md, docs/MASTERY_REWORK.md.
 */

function AccountPage() {
    usePageTitle("Account");
    const navigate = useNavigate();
    // Settings is a leaf page: slideNavigate plays the slide-up enter transition.
    const slideNavigate = useSlideNavigate();
    const { confirm } = useConfirmation();
    const { user, isLoading, logout, updateAvatar, updateGoals } = useAuth();

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

    // Settings moved out of the (now-removed) hamburger into a gear in this page's
    // header. Logout likewise moved here from the drawer.
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            logout();
            navigate("/");
        }
    };

    // Header right slot: just the gear. The streak flame is not passed here —
    // `PageHeader` renders it into every header itself, flush right of the gear.
    //
    // The gear is the OUTLINED variant, per the artboard: this is the one header in the
    // app carrying a single lone action on the bare paper ground, and an unboxed glyph
    // there has nothing separating it from the page. Drill-in headers, which carry 2–4
    // actions in a row, use the bare variant instead.
    const headerActions = (
        <>
            <HeaderIconButton
                className="account-page__settings-button"
                icon="settings"
                label="Open settings"
                variant="outlined"
                onClick={() => slideNavigate("/settings")}
            />
        </>
    );

    // Per-category library card counts, shown as the shelf's spine heights.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();

    // Velocity — mastery band-steps climbed in the sliding 7-day window for the
    // account's selected language (docs/VELOCITY.md). Display-only.
    const { velocity, windowDays, loaded: velocityLoaded } = useVelocity();

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

    if (isLoading) {
        return (
            <MobileTabScreen title="Account" contentClassName="account-page__content">
                <DelayedCircularProgress className="account-page__spinner" />
            </MobileTabScreen>
        );
    }

    if (!user) {
        return (
            <MobileTabScreen title="Account" contentClassName="account-page__content">
                <Typography
                    className="account-page__no-user-text"
                    sx={{ textAlign: "center", padding: "20px", color: COLORS.onSurface, fontFamily: FONTS.sans }}
                >
                    Please log in to view your account
                </Typography>
            </MobileTabScreen>
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
            className="account-page__avatar"
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
                // The artboard's own pair: the blue pastel with its `*A` ink, not the
                // solid `infoInk` disc this used to be.
                backgroundColor: COLORS.blu,
                color: COLORS.bluA,
                boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                fontFamily: FONTS.sans,
                fontSize: 17,
                fontWeight: 600,
            }}
        >
            {user.avatarIconId ? (
                <Box
                    component="img"
                    className="account-page__avatar-image"
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
            <MobileTabScreen title="Account" contentClassName="account-page__content" headerExtraActions={headerActions}>
                {/* Profile — one Row. Its third (mono) line is the copyable user ID,
                    which Friends needs the learner to be able to hand out. */}
                <RowList className="account-page__profile">
                    <Row
                        className="account-page__profile-row"
                        avatar={avatarButton}
                        title={userName}
                        subtitle={userEmail}
                        meta={
                            <>
                                ID {userId}
                                <IconButton
                                    className="account-page__copy-user-id-button"
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

                {/* The library as a shelf: one spine per utcm band, height encoding its
                    count. Withheld until the counts load, then mounted with a staggered
                    pop-in; the wrapper reserves the row's height up front so nothing
                    below shifts when the spines appear. */}
                <SectionHeader
                    className="account-page__library-header"
                    label={
                        <>
                            <Label>Your library</Label>
                            {countsLoaded && <Label className="account-page__library-total">{totalCards.toLocaleString()}</Label>}
                        </>
                    }
                    sx={{ "& > .lab": { flexShrink: 0 } }}
                />
                <Box className="account-page__deck-stats" sx={{ minHeight: 152 }}>
                    {countsLoaded && <DeckBuckets counts={categoryCounts} />}
                </Box>

                {/* Velocity — how many mastery bands the learner's cards climbed in the
                    last 7 days (docs/VELOCITY.md). Held back until loaded so a 0 never
                    flashes before the real number; the wrapper reserves the height so
                    nothing below shifts. */}
                <Box className="account-page__velocity" sx={{ minHeight: 122 }}>
                    {velocityLoaded && (
                        <StatCard
                            className="account-page__velocity-card"
                            sx={{ textAlign: "center" }}
                            label={
                                <>
                                    Velocity{" "}
                                    <InfoTip
                                        className="account-page__velocity-info"
                                        ariaLabel="What counts as a level-up"
                                        text="A level-up is one card crossing into a higher mastery band — Unfamiliar → Target → Comfortable → Mastered."
                                    />
                                </>
                            }
                            value={velocity}
                            description={`Mastery level-ups in the last ${windowDays} days`}
                        />
                    )}
                </Box>

                {/* Goals — opt into the Reading / Writing mastery goals
                    (docs/MASTERY_REWORK.md). Recognition + Production are always pursued
                    and aren't shown. Hidden for Spanish accounts.

                    The artboard replaces the old explanatory paragraph with one subtitle
                    per row ("Adds a reading bar to every card"), which is the same fact
                    said once per control instead of once per section. */}
                {showGoals && (
                    <>
                        <SectionHeader className="account-page__goals-header" label="Goals" />
                        <RowList className="account-page__goals">
                            <Row
                                className="account-page__goal-reading"
                                icon="menu_book"
                                hue="red"
                                title="Learn reading"
                                subtitle="Adds a reading bar to every card"
                                trailing={
                                    <Switch
                                        className="account-page__goal-reading-switch"
                                        inputProps={{ "aria-label": "Learn reading" }}
                                        checked={user.readingGoal === true}
                                        disabled={goalSaving !== null}
                                        onChange={(e) => handleToggleGoal("reading", e.target.checked)}
                                    />
                                }
                            />
                            <Row
                                className="account-page__goal-writing"
                                icon="edit"
                                hue="org"
                                title="Learn writing"
                                subtitle="Adds a writing bar to every card"
                                trailing={
                                    <Switch
                                        className="account-page__goal-writing-switch"
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
                <RowList className="account-page__logout">
                    <Button
                        className="account-page__logout-button"
                        fullWidth
                        variant="outlined"
                        color="primary"
                        startIcon={<Icon name="logout" size={17} color="inherit" />}
                        onClick={handleLogout}
                    >
                        Log Out
                    </Button>
                </RowList>

                {/* Clearance for the floating footer pill — the Log Out button is the
                    last row and would otherwise sit under the bar. Uses the shared
                    spacer, not MobileTabScreen's paddingBottom (see the FooterSpacer
                    comment for why that padding is unreliable). */}
                <FooterSpacer />
            </MobileTabScreen>

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
                className="account-page__copy-toast"
                open={copiedToastOpen}
                autoHideDuration={2000}
                onClose={() => setCopiedToastOpen(false)}
                message="Copied to clipboard"
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            />
        </>
    );
}

export default AccountPage;
