import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { Fragment } from "react";
import ArenaEntryRow from "./ArenaEntryRow";
import ArenaMessageDialog from "./ArenaMessageDialog";
import DivisionBanner from "./DivisionBanner";
import Icon from "../../components/Icon";
import { HeaderIconButton } from "../../components/PageHeader";
import { Board, BoardZone } from "../../components/leaderboard/Board";
import { Label, SectionCard, SectionRule } from "../../components/primitives";
import { RAMP } from "../../theme/colors";
import {
    fetchArenaBoard,
    optInToArena,
    withdrawFromArena,
    shareArenaLocation,
} from "../../api/arena";
import type { ArenaBoardResponse, ArenaEntry } from "../../api/arena";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { errorTextSx, formatRemaining, mutedTextSx } from "./arenaStyles";

/**
 * The divider between two adjacent rows, or null when nothing changes there.
 *
 * Drawn where the BAND CHANGES, which is the only place it means anything — a competitor
 * reads this board as "which side of the line am I on". Derived from the server's
 * per-row `zone` rather than from any rank arithmetic of our own, so the line can never
 * disagree with the tints on either side of it.
 *
 * There are exactly TWO lines on a board, and each is named for what CROSSING it does to
 * you rather than for the band underneath it: the top of the table ends at PROMOTION and
 * the bottom begins at DEMOTION. An earlier cut labelled the first one "Holding" — the
 * band below it — which is a correct fact about the wrong thing. Nobody watches that line
 * to find out where the middle of the table starts.
 *
 * ⚠️ The user-facing word is **Demotion**; the wire value stays `zone: 'relegate'`
 * (`ArenaEntry`, a server contract). Do not "fix" either one to match the other.
 */
function renderZoneDivider(prev: ArenaEntry, cur: ArenaEntry) {
    if (prev.zone === "promote" && cur.zone !== "promote") {
        return <BoardZone label="Promotion" tone="promote" />;
    }
    if (cur.zone === "relegate" && prev.zone !== "relegate") {
        return <BoardZone label="Demotion" tone="relegate" />;
    }
    return null;
}

/**
 * Arena (docs/ARENA_FEATURE.md) — a Home-hub drill-in (NodePage) showing the
 * viewer's weekly cluster of 25, ranked by minutes earned while the arena is
 * live.
 *
 * FOUR STATES (§ 2.3), and the page is really a switch over them:
 *   live     racing; the board plus a countdown to Sunday 16:00
 *   results  the week just closed; the final board, what it did to your rung,
 *            and the SAME Join card as the two states below (no live seat)
 *   opt-in   not racing, the break is open, one button to join next week
 *   closed   not racing, the break has passed — SAME card as opt-in, because
 *            enrolment is no longer gated on the break (§ 8)
 *
 * The page NEVER re-sorts. The server assigns every rank, including the
 * promotion/relegation zone on each row, so what is drawn is always what
 * resolution will act on. A client-side sort would eventually disagree with the
 * server about a tie-break and show someone a rank they will not get.
 */
function ArenaPage() {
    usePageTitle("Arena");
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();
    // The app has no LanguageContext; the selected language lives on the user.
    // /arena follows it rather than offering a combined view (settled as Q17),
    // exactly as decks, minute points and night markets do.
    const language = user?.selectedLanguage ?? "zh";

    const [board, setBoard] = useState<ArenaBoardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Whether we have already asked for location THIS SESSION. A denied
    // permission must never be re-prompted (§ 5.2) — a repeated sheet is the
    // fastest route to a permanent browser-level block.
    const [locationAsked, setLocationAsked] = useState(false);
    // The viewer's own board message (§ 2.1a). Held on the page rather than read off
    // their board row, because the editor opens in every state — including opt-in,
    // where there are no rows at all.
    const [message, setMessage] = useState<string | null>(null);
    const [messageOpen, setMessageOpen] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        fetchArenaBoard(language)
            .then((data) => {
                setBoard(data);
                setMessage(data.viewerMessage);
                setError(null);
            })
            .catch((err) => setError(err?.message ?? "Could not load the arena."))
            .finally(() => setLoading(false));
    }, [language]);

    // Keyed on isAuthenticated + language, never on `token`: a silent 15-minute
    // refresh must not re-fetch and flash the board
    // (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        if (!isAuthenticated) return;
        load();
    }, [isAuthenticated, language, load]);

    /**
     * Join next week.
     *
     * Location is requested HERE, in context, immediately after the user has
     * expressed intent — never at page load. A permission asked cold is the one
     * users deny. Our explanatory copy sits above the button so it is read
     * BEFORE the browser's own prompt appears; the web has no Info.plist purpose
     * string, so that sentence is our only substitute.
     *
     * Denial is a first-class outcome: the join proceeds regardless and the user
     * simply lands in the location-less pool.
     */
    const handleJoin = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (!locationAsked) {
                setLocationAsked(true);
                // Failure and refusal are the same thing here, and neither blocks
                // the join — hence a catch that deliberately does nothing.
                await shareArenaLocation().catch(() => null);
            }
            await optInToArena(language);
            load();
        } catch (err: unknown) {
            setError((err as Error)?.message ?? "Could not join. Try again.");
        } finally {
            setBusy(false);
        }
    }, [language, load, locationAsked]);

    const handleWithdraw = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            await withdrawFromArena(language);
            load();
        } catch (err: unknown) {
            setError((err as Error)?.message ?? "Could not withdraw. Try again.");
        } finally {
            setBusy(false);
        }
    }, [language, load]);

    const body = () => {
        if (loading) return <Typography sx={mutedTextSx}>Loading the arena…</Typography>;
        if (!board) {
            return <Typography sx={mutedTextSx}>The arena is unavailable right now.</Typography>;
        }

        // The viewer's own rank, for the countdown card's right-hand slot. Read off the
        // board rather than tracked separately, so it can never disagree with the row the
        // page is drawing; `undefined` when they have no seat this week.
        const viewerRank = board.entries.find((e) => e.isViewer)?.rank;

        return (
            <>
                {/* The banner is drawn in EVERY state, and that is deliberate. It is the
                    page's identity — the rung you hold does not stop existing between
                    weeks — so it anchors the opt-in and closed states too, which would
                    otherwise be a bare card on an empty page with nothing saying what
                    arena they are about to join. */}
                <DivisionBanner division={board.division} className="arena-page__banner" />

                {board.state === "live" && board.boundaries && (
                    <CountdownCard
                        closesAt={board.boundaries.closesAt}
                        timezone={board.boundaries.timezone}
                        showTimezone={board.boundaries.timezoneDiffersFromViewer}
                        rank={viewerRank}
                    />
                )}

                {board.state === "results" && (
                    <ResultsCard divisionChange={board.divisionChange} />
                )}

                {board.state !== "live" && (
                    <OptInCard
                        optedIn={board.optedInNextWeek}
                        busy={busy}
                        onJoin={handleJoin}
                        onWithdraw={handleWithdraw}
                    />
                )}

                {error && <Typography sx={{ ...errorTextSx, mt: 1 }}>{error}</Typography>}

                {board.entries.length > 0 && (
                    <>
                        {/* `.shelfhd` in the artboard — the size of the field on the left,
                            the unit on the right. Both are facts about the board, so this
                            is a rule with a trailing label rather than a header with an
                            affordance: there is nothing here to tap. */}
                        <SectionRule
                            label={`Board · ${board.entries.length}`}
                            right={<Label sx={{ whiteSpace: "nowrap" }}>minutes</Label>}
                        />
                        <Board className="arena-page__board">
                            {board.entries.map((entry, i) => (
                                <Fragment key={`${entry.userId ?? "bot"}-${entry.rank}`}>
                                    {i > 0 && renderZoneDivider(board.entries[i - 1], entry)}
                                    <ArenaEntryRow entry={entry} />
                                </Fragment>
                            ))}
                        </Board>
                    </>
                )}
            </>
        );
    };

    return (
        <NodePage
            title="Arena"
            onBack={() => slideNavigate("/")}
            contentClassName="arena-page"
            // The message editor lives in the HEADER, not on the viewer's own row: the
            // row is a competitor among 24 others and must render identically to them
            // (a pencil only you can see is still a mark only your row carries), and
            // the editor has to be reachable in the states where that row does not
            // exist at all.
            headerExtraActions={
                <HeaderIconButton
                    className="arena-page__edit-message"
                    icon="edit_note"
                    label="Edit your arena message"
                    onClick={() => setMessageOpen(true)}
                />
            }
        >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, px: 1.5, pt: 1 }}>
                {body()}
            </Box>
            <FooterSpacer />
            <ArenaMessageDialog
                open={messageOpen}
                initialMessage={message}
                onClose={() => setMessageOpen(false)}
                onSaved={(stored) => {
                    setMessage(stored);
                    // Reload so the viewer's own ROW shows the new line too — the board
                    // is rendered from server entries, and patching one of them here
                    // would be a second source of truth for the same string.
                    load();
                }}
            />
        </NodePage>
    );
}

/**
 * Time left in the live week.
 *
 * ⚠️ When the arena's timezone differs from the viewer's, the time is LABELLED
 * with the arena's zone (§ 3). A member who travels mid-week keeps racing on the
 * clock they started on, and an unlabelled time would quietly be wrong for them.
 * When the zones agree no label is shown — an unqualified time is correct, and a
 * redundant timezone tag is noise.
 */
function CountdownCard({
    closesAt,
    timezone,
    showTimezone,
    rank,
}: {
    closesAt: string;
    timezone: string;
    showTimezone: boolean;
    /** The viewer's current position, shown at the right end. Omitted when they have no seat. */
    rank?: number;
}) {
    const [remaining, setRemaining] = useState(() => new Date(closesAt).getTime() - Date.now());

    useEffect(() => {
        // Once a minute is enough: the label is coarse above an hour, so a faster
        // tick would re-render for no visible change.
        const id = window.setInterval(
            () => setRemaining(new Date(closesAt).getTime() - Date.now()),
            60_000,
        );
        return () => window.clearInterval(id);
    }, [closesAt]);

    return (
        // The time and the rank share one baseline, as artboard 9 draws them: the two
        // facts a competitor checks in the same glance are "how long have I got" and
        // "where am I", and putting them on separate lines makes that two glances.
        <SectionCard className="arena-page__countdown">
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                <Box sx={{ minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 15,
                            fontWeight: WEIGHT.semibold,
                            color: COLORS.onSurface,
                        }}
                    >
                        {formatRemaining(remaining)} left
                    </Typography>
                    {/* Sentence case, not the overline's uppercase: this is a TIME, and
                        tracking a clock reading out to 0.14em makes it unreadable. */}
                    <Label sx={{ textTransform: "none", letterSpacing: "0.04em", marginTop: "3px", display: "block" }}>
                        Closes Sunday 16:00{showTimezone ? ` (${timezone})` : ""}
                    </Label>
                </Box>
                {rank !== undefined && <Label sx={{ whiteSpace: "nowrap" }}>rank {rank}</Label>}
            </Box>
        </SectionCard>
    );
}

/**
 * What last week's finish did to the viewer's rung.
 *
 * ⚠️ EXTRAPOLATED — artboard 9 draws only the `live` state (docs/SHELF_REDESIGN.md entry
 * 9 flags this as the redesign's biggest gap). The rule applied here, and to `OptInCard`
 * below, is: use the page's OWN vocabulary rather than inventing a third one. So the
 * outcome is a `SectionCard` filled with the ramp pastel the BOARD already uses for the
 * same idea — `RAMP.grn` for promotion, `RAMP.red` for demotion — carrying the matching
 * arrow from `BoardZone`. A competitor who watched the green line all week meets the same
 * green when they cross it.
 *
 * `hold` is deliberately untinted, for the same reason `BoardZone`'s hold band is:
 * tinting every outcome would make the tint carry no information, and "nothing happened
 * to you" is exactly the case that should not shout.
 */
function ResultsCard({ divisionChange }: { divisionChange: number | null }) {
    const promoted = divisionChange === 1;
    const demoted = divisionChange === -1;
    const text = promoted ? "You were promoted."
        : demoted ? "You were relegated."
            : "You held your division.";
    const hue = promoted ? RAMP.grn : demoted ? RAMP.red : null;
    const arrow = promoted ? "arrow_upward" : demoted ? "arrow_downward" : null;

    return (
        <SectionCard className="arena-page__results" background={hue?.fill}>
            <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {arrow && hue && <Icon name={arrow} size={17} color={hue.ink} weight={600} />}
                <Typography
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.onSurface,
                    }}
                >
                    {text}
                </Typography>
            </Box>
        </SectionCard>
    );
}

/**
 * The join card.
 *
 * The location sentence is deliberately ABOVE the button and phrased as what we
 * do and do not do. On the web the browser's own prompt says only "wants to use
 * your location", so this line is the entire explanation the user gets.
 */
function OptInCard({
    optedIn,
    busy,
    onJoin,
    onWithdraw,
}: {
    optedIn: boolean;
    busy: boolean;
    onJoin: () => void;
    onWithdraw: () => void;
}) {
    // Identical in EVERY non-live state -- `results`, `opt-in` and `closed`. The
    // gate on enrolment is a live seat, not the clock (§ 8), and none of those
    // three states has one, so all three offer the same button. `results` used to
    // be excluded, which hid Join for the whole Sun 16:00 -> Tue 04:00 break --
    // i.e. for exactly the window in which joining next week is possible -- and
    // only revealed it at 04:00 once that week had already formed without you.
    if (optedIn) {
        return (
            <SectionCard className="arena-page__optin">
                <Label>You are entered</Label>
                <Typography
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.onSurface, mt: "4px" }}
                >
                    You're in next week's arena.
                </Typography>
                {/* Outlined, not contained: withdrawing is the reversal of the action this
                    card exists to offer, so it must not wear the page's one ink pill. */}
                <Button
                    className="arena-page__withdraw"
                    variant="outlined"
                    fullWidth
                    onClick={onWithdraw}
                    disabled={busy}
                    sx={{ mt: "12px" }}
                >
                    Withdraw
                </Button>
            </SectionCard>
        );
    }

    return (
        <SectionCard className="arena-page__optin">
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: 15.5,
                    fontWeight: WEIGHT.semibold,
                    letterSpacing: "-0.015em",
                    color: COLORS.onSurface,
                }}
            >
                Join next week's arena
            </Typography>
            <Typography
                sx={{ fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 1.45, color: COLORS.textSecondary, mt: "5px" }}
            >
                We use your rough area only to group you with nearby players. We never show
                it to anyone, and you can skip it.
            </Typography>
            {/* `.btn2` — the design's one ink pill, which the MUI theme already draws on a
                contained Button. The arena's join used to be a green fill; green means
                PROMOTION everywhere else on this page, and spending it on a button made
                the page's one semantic colour ambiguous. */}
            <Button
                className="arena-page__join"
                variant="contained"
                onClick={onJoin}
                disabled={busy}
                sx={{ mt: "12px" }}
            >
                {busy ? "Joining…" : "Join"}
            </Button>
        </SectionCard>
    );
}

export default ArenaPage;
