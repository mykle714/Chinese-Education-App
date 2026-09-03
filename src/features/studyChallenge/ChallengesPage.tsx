import { useCallback, useEffect, useState } from "react";
import { Box, Button, Switch, Typography } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import FriendPersonRow from "../friends/FriendPersonRow";
import { fetchChallengesPage } from "../../api/studyChallenges";
import type { ChallengeFriendRow, ChallengesPageResponse } from "../../api/studyChallenges";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import {
    blockedReasonLabel,
    challengeAction,
    challengeActionColor,
    challengeActionLabel,
    challengeErrorMessage,
    challengeStatusLine,
} from "./challengeLabels";
import { useChallengeAnytime } from "./challengeAnytime";
import ChallengeAnytimeNotice from "./ChallengeAnytimeNotice";
import ChallengePanel from "./ChallengePanel";
import type { ChallengePanelTarget } from "./ChallengePanel";
import {
    challengeActionPillMutedSx,
    challengeActionPillSx,
    challengeMessageSx,
    challengeMutedSx,
    crownSx,
} from "./challengeStyles";

/**
 * Study Challenges (docs/STUDY_CHALLENGE.md § 1) — a NodePage under the Friends
 * drill-in, sibling to `/friends/sent` and `/friends/requests`.
 *
 * ⚠️ THIS PAGE IS A LIST OF FRIENDS, NOT A LIST OF CHALLENGES. The friend is the
 * unit: one row per friend, always present, whether or not a challenge is active,
 * and the row carries that pair's whole lifecycle (Challenge → Waiting on them /
 * Review words → Play test → See results). There is deliberately never a second
 * place to look for "what is happening with Bob".
 *
 * ⚠️ THE ROW IS THE BUTTON. Unlike every other `FriendPersonRow` in the app, this one
 * is a single tap target (`onRowPress`) whose action is the row's own lifecycle step —
 * issue, accept, or open the challenge — and it never opens a profile. The pill on the
 * right only NAMES that action; it is a Box, not a Button, because a control nested in
 * a clickable row competes with it for taps and for the tab order. A row with no
 * available action is inert rather than falling back to anything.
 *
 * Two things the row shows and one it deliberately does not:
 *   * 👑 the REIGNING CHAMPION — whoever won the pair's most recent resolved
 *     challenge. A draw or a no-contest leaves the previous champion in place, so the
 *     crown only moves when somebody wins.
 *   * the single lifecycle control, whose label IS the state.
 *   * NO LIFETIME W–L, anywhere. A running record makes a losing streak a reason to
 *     stop playing, and the crown already supplies the rivalry. The data is stored, so
 *     a record can be added later if it is ever actually wanted.
 *
 * LANGUAGE-SCOPED: the row set is "friends who study this language", because the
 * words, the deck and the minute points a challenge earns are all per-language. A
 * friend who studies only Spanish does not appear here on a Chinese page. The BADGE on
 * the Friends row is the one thing that ignores that scoping (§ 1, Q48) — it is the
 * only thread back to a challenge the viewer cannot otherwise see.
 */
function ChallengesPage() {
    usePageTitle("Challenges");
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [page, setPage] = useState<ChallengesPageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // The tester escape hatch, per device (docs/STUDY_CHALLENGE.md § 2a). Only a
    // validator account can spend it — the server ignores it from anybody else — so
    // the switch below is rendered only for one.
    const [anytime, setAnytime] = useChallengeAnytime();

    // Keyed on isAuthenticated, never on `token`: a silent 15-minute refresh must not
    // re-fetch and flash the list (CLAUDE.md "Never reload on token refresh").
    // `anytime` IS a dependency: it changes what the server sends (which rows are
    // expired, whether a friend can be challenged again this week), so flipping the
    // switch has to re-ask rather than just relabel what is on screen.
    /**
     * Bumped by the panel after any mutation. It is a COUNTER rather than a boolean
     * flag or a direct `load()` call because the effect below owns the cancellation
     * token: a second refresh arriving while the first is in flight has to supersede
     * it, and re-running the effect is what does that.
     */
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchChallengesPage()
            .then((result) => { if (!cancelled) { setPage(result); setError(null); } })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load your challenges"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isAuthenticated, anytime, reloadToken]);

    /**
     * The open pre-play sheet, or null. The PAGE owns this rather than the row,
     * because only one sheet may be open at a time and the scrim belongs to the page.
     */
    const [panelTarget, setPanelTarget] = useState<ChallengePanelTarget | null>(null);

    /**
     * What tapping a row does — bound to the ROW, not to the pill (`onRowPress`).
     *
     * TWO KINDS OF DESTINATION, and the split is the design's (F6–F9 vs F11–F17):
     *   * the three PRE-PLAY states are decisions about this row, so they open a sheet
     *     OVER this list and never navigate — see ChallengeSheet for why;
     *   * study / test / results are the challenge itself, so they navigate to it.
     *
     * Neither branch mutates anything. Issuing, accepting, declining and withdrawing
     * all happen on the sheet's own action bar, so this handler stays a pure "open the
     * thing" and the list never has to reason about a half-finished write.
     */
    const handleAction = useCallback((row: ChallengeFriendRow) => {
        const action = challengeAction(row.challenge, anytime);
        switch (action) {
            case "issue":
            case "waiting":
            case "incoming":
                setPanelTarget({
                    mode: action,
                    friendUserId: row.friend.userId,
                    friendName: row.friend.name || row.friend.email,
                    challengeId: row.challenge?.id,
                });
                break;
            case "study":
            case "test":
            case "results":
                slideNavigate(`/friends/challenges/${row.challenge!.id}`);
                break;
            default:
                break;
        }
    }, [slideNavigate, anytime]);

    const maxActive = page?.maxActive ?? 0;

    return (
        <NodePage
            title="Challenges"
            onBack={() => slideNavigate("/friends")}
            contentClassName="challenges-page__content"
        >
            <Box className="challenges-page" sx={{ display: "flex", flexDirection: "column", gap: 2, px: 2, pt: 1 }}>

                {/* The full log lives behind its own screen: this page is about THIS
                    week, and a growing history on the same surface would bury it. */}
                <Button
                    className="challenges-page__history-button"
                    onClick={() => slideNavigate("/friends/challenges/history")}
                    startIcon={<HistoryIcon />}
                    sx={{
                        alignSelf: "flex-start",
                        textTransform: "none",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.onSurface,
                        backgroundColor: COLORS.sectionCard,
                        borderRadius: 3,
                        px: 2,
                        py: 0.75,
                    }}
                >
                    History
                </Button>

                {/* ── TESTER: allow anytime (docs/STUDY_CHALLENGE.md § 2a) ──
                    Validator accounts only. The row is rendered rather than hidden
                    behind a menu because a tester needs to SEE whether the week is
                    being bypassed — a hidden flag that silently rewrites every
                    deadline is exactly the kind of state that gets left on and then
                    misread as a bug. */}
                {user?.isValidator && (
                    <Box
                        className="challenges-page__anytime"
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            backgroundColor: COLORS.sectionCard,
                            borderRadius: 3,
                            px: 2,
                            py: 1,
                        }}
                    >
                        <Box sx={{ flex: 1 }}>
                            <Typography sx={{
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.semibold,
                                color: COLORS.onSurface,
                            }}>
                                Allow anytime
                            </Typography>
                            <Typography sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}>
                                {/* Says what it lifts AND what it does not, because both
                                    surprise a tester: a challenge issued this way is
                                    parked in a future week for the pair, and the switch
                                    is per device, so a two-account test needs it set in
                                    both browsers. */}
                                {/* WHAT IT LIFTS — the half you need before turning it on.
                                    What it COSTS is the notice below, which appears only
                                    once it is on. */}
                                Tester only · lifts the accept deadline, the test window,
                                one-per-friend-per-week and the 6-challenge cap.
                            </Typography>
                        </Box>
                        <Switch
                            className="challenges-page__anytime-switch"
                            checked={anytime}
                            onChange={(event) => setAnytime(event.target.checked)}
                            inputProps={{ "aria-label": "Allow challenges and tests anytime" }}
                        />
                    </Box>
                )}

                {/* The consequences, spelled out WHILE the hatch is on. Every one of
                    them is correct behaviour that reads as a bug if you meet it
                    unprepared (see the component). Only for a validator, and only
                    while the switch is on — the second condition is what keeps it from
                    becoming wallpaper. */}
                {user?.isValidator && anytime && <ChallengeAnytimeNotice />}

                {/* Hidden while the hatch is on: the cap is not being enforced, so a
                    count of slots "used this week" would be stating a rule that is not
                    currently in force. */}
                {page && page.activeCount > 0 && !anytime && (
                    <Typography className="challenges-page__active-count" sx={challengeMutedSx}>
                        {page.activeCount} of {maxActive} challenge slots used this week
                    </Typography>
                )}

                {error && (
                    <Typography className="challenges-page__error" sx={challengeMessageSx}>{error}</Typography>
                )}

                {loading ? (
                    <Typography className="challenges-page__loading" sx={challengeMutedSx}>Loading…</Typography>
                ) : (page?.rows.length ?? 0) === 0 ? (
                    // A BARE empty state, not a feature explainer and not a hidden row
                    // (Q67). Teaching the feature is not this page's job, and a row that
                    // vanished until you had a friend would make the feature
                    // undiscoverable for exactly the people who have not found friends yet.
                    <Typography className="challenges-page__empty" sx={challengeMutedSx}>
                        No challenges yet.
                    </Typography>
                ) : (
                    <Box className="challenges-page__list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {page!.rows.map((row) => {
                            const action = challengeAction(row.challenge, anytime);
                            const isChampion = !!row.championUserId
                                && row.championUserId === row.friend.userId;
                            const viewerIsChampion = !!row.championUserId
                                && !!user?.id
                                && row.championUserId === user.id;
                            const blocked = blockedReasonLabel(row.blockedReason, maxActive);
                            // "issue" is the only action the server can veto: a live
                            // challenge already shows its own control, so a blocked
                            // reason next to one would be nonsense.
                            const showAction = action !== "issue" || row.canChallenge;
                            // Whether the ROW does anything when tapped. "none" is a
                            // state with no destination; a vetoed issue has nothing to
                            // open either.
                            const rowIsActionable = showAction && action !== "none";

                            return (
                                <FriendPersonRow
                                    key={row.friend.userId}
                                    className="challenges-page__row"
                                    name={row.friend.name}
                                    email={row.friend.email}
                                    avatarIconId={row.friend.avatarIconId}
                                    secondary={challengeStatusLine(row.challenge, anytime) ?? undefined}
                                    // ⚠️ THE WHOLE ROW IS THE BUTTON, and it never
                                    // opens a profile. One row = one action (issue,
                                    // accept, or open the challenge), so the entire
                                    // row is that action's target rather than a
                                    // composition of a tappable person half and a
                                    // small button — those two made the row's largest
                                    // region do something other than the row's job.
                                    // A row with no available action (blocked, or at
                                    // the cap) gets NO handler: it is inert, with no
                                    // cursor and no focus stop, because a tap that
                                    // quietly goes somewhere else is worse than a tap
                                    // that does nothing. Profiles stay reachable from
                                    // /friends. (docs/STUDY_CHALLENGE.md § 1)
                                    onRowPress={rowIsActionable ? () => handleAction(row) : undefined}
                                    actions={
                                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                            {/* The crown sits on whoever holds it — on the
                                                friend's row when they do, and on the same row
                                                as a "you" marker when the viewer does, because
                                                the claim is about the PAIR and belongs where
                                                the pair is. */}
                                            {isChampion && (
                                                <Box component="span" className="challenges-page__crown" sx={crownSx} title="Reigning champion">👑</Box>
                                            )}
                                            {viewerIsChampion && (
                                                <Typography
                                                    className="challenges-page__you-champion"
                                                    sx={{ ...challengeMutedSx, fontSize: SIZE.micro }}
                                                >
                                                    👑 you
                                                </Typography>
                                            )}
                                            {/* PRESENTATIONAL, not a control — see
                                                challengeActionPillSx. The row owns the
                                                tap; this only names what the tap does. */}
                                            {showAction ? (
                                                <Box
                                                    className={`challenges-page__action challenges-page__action--${action}`}
                                                    sx={rowIsActionable
                                                        ? challengeActionPillSx(challengeActionColor(action))
                                                        : challengeActionPillMutedSx}
                                                >
                                                    {challengeActionLabel(action)}
                                                </Box>
                                            ) : (
                                                <Typography
                                                    className="challenges-page__unavailable"
                                                    sx={{ ...challengeMutedSx, fontSize: SIZE.micro, textAlign: "right" }}
                                                >
                                                    {blocked}
                                                </Typography>
                                            )}
                                        </Box>
                                    }
                                />
                            );
                        })}
                    </Box>
                )}

                <FooterSpacer />
            </Box>

            {/* The pre-play sheet (F6-F9). Rendered as a sibling of the page content so
                its scrim covers the whole list including the header — the sheet is a
                layer over this page, not a section of it. */}
            <ChallengePanel
                target={panelTarget}
                onClose={() => setPanelTarget(null)}
                onChanged={() => setReloadToken((n) => n + 1)}
            />
        </NodePage>
    );
}

export default ChallengesPage;
