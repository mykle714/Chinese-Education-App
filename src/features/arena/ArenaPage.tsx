import { Fragment, useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import ArenaCountdown from "./ArenaCountdown";
import ArenaEntryRow from "./ArenaEntryRow";
import ArenaJoinButton from "./ArenaJoinButton";
import ArenaMessageDialog from "./ArenaMessageDialog";
import ArenaSeatField from "./ArenaSeatField";
import DivisionBanner from "./DivisionBanner";
import Icon from "../../components/Icon";
import LockedBoard from "./LockedBoard";
import SteppedHelpPopup from "../../components/SteppedHelpPopup";
import { ARENA_HELP_STEPS, resolveArenaShot } from "./arenaHelpSteps";
import { HeaderIconButton } from "../../components/PageHeader";
import { Board, BoardZone } from "../../components/leaderboard/Board";
import { Label } from "../../components/primitives";
import { COLORS, RAMP } from "../../theme/colors";
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
import { FooterSpacer } from "../../components/MobileFooter";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { errorTextSx, mutedTextSx } from "./arenaStyles";

/**
 * Remembers that this learner has met the arena's explainer.
 *
 * ⚠️ PER DEVICE, NOT PER ACCOUNT. `localStorage`, so the same learner on a second device
 * sees the three steps again. That is the deliberate trade: the alternative is a column
 * on `users` and a migration, for a flag whose entire job is to stop showing a card
 * twice. Seeing it once more on a new phone costs a tap; being unable to ship the
 * explainer without a schema change costs a deploy. Revisit only if it turns out people
 * are annoyed by the repeat.
 *
 * Reads and writes are wrapped because Safari private mode throws on access rather than
 * returning null — an explainer must never be able to break the page it explains.
 */
const HELP_SEEN_KEY = "arena.helpSeen.v1";

function hasSeenHelp(): boolean {
    try {
        return window.localStorage.getItem(HELP_SEEN_KEY) === "1";
    } catch {
        // Storage unavailable: treat as "seen" rather than "not seen". A learner who
        // cannot persist the flag would otherwise meet the overlay on EVERY visit,
        // which is far worse than never meeting it automatically — the help button in
        // the header still opens it on demand.
        return true;
    }
}

function markHelpSeen(): void {
    try {
        window.localStorage.setItem(HELP_SEEN_KEY, "1");
    } catch {
        // Nothing to do; see hasSeenHelp.
    }
}

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
 * Arena (docs/ARENA_FEATURE.md) — a Home-hub drill-in showing the viewer's weekly cluster
 * of 25, ranked by minutes earned while the arena is live.
 *
 * Built to `Arena Flow - Shelf System.html`, which is the whole page: 15 artboards plus a
 * state map. The map is the thing to read first — the page is a switch over TWO questions
 * (do you hold a seat in a live arena, and has that arena closed) and everything else
 * follows from the answer.
 *
 * ── FOUR STATES, AND THE DESIGN RENAMED TWO OF THEM ─────────────────────────────────
 *   live     racing; banner, countdown to Sunday 16:00, the live board
 *   results  the week closed; the next countdown, Join, the outcome, the frozen board
 *   waiting  entered but not yet formed; the seat field with your seat lit, Withdraw
 *   out      no seat and not entered; the seat field and Join
 *
 * ⚠️ `waiting` AND `out` ARE NOT WIRE STATES. The server sends `opt-in` or `closed`
 * depending on whether the break is open, and the page renders those two IDENTICALLY —
 * it splits instead on `optedInNextWeek`, which is what the design's map actually names.
 * The wire distinction has been dead since § 8 stopped gating enrolment on the break;
 * it is a `ArenaState` variant nothing reads. Flagged in docs/DEFERRED_WORK.md rather
 * than removed here, because narrowing a server union is not a page change.
 *
 * ── THE PAGE NEVER RE-SORTS ─────────────────────────────────────────────────────────
 * The server assigns every rank, including the promotion/relegation zone on each row, so
 * what is drawn is always what resolution will act on. A client-side sort would
 * eventually disagree with the server about a tie-break and show someone a rank they will
 * not get.
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
    // their board row, because the editor opens in every state — including the two with
    // no rows at all.
    const [message, setMessage] = useState<string | null>(null);
    const [messageOpen, setMessageOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);

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

    // First visit opens the explainer over the page (A16) — deliberately AFTER the board
    // has loaded, so the thing being described is already behind the scrim rather than a
    // spinner. Runs once: `hasSeenHelp` is false only until the overlay is dismissed.
    useEffect(() => {
        if (loading || !board || hasSeenHelp()) return;
        setHelpOpen(true);
    }, [loading, board]);

    const closeHelp = useCallback(() => {
        setHelpOpen(false);
        markHelpSeen();
    }, []);

    /**
     * Join next week.
     *
     * Location is requested HERE, in context, immediately after the user has
     * expressed intent — never at page load. A permission asked cold is the one
     * users deny.
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

    // `waiting` and `out` are the two seat-less states; see the state note above. They
    // draw a banner, a clock, a fixed 25-cell grid and one action.
    //
    // ⚠️ EVERY STATE SCROLLS. The seat-less pair used to set `scrollable={false}` so the
    // grid could FLEX to fill the gap and the action dock against the footer without
    // absolute positioning — but `overflow: hidden` means a short phone (or a large text
    // size, or a banner that grew) silently CLIPS the action instead of letting the
    // learner reach it, and Join is the only thing on the page worth tapping. The dock
    // still works while it fits: the content column is `flex: 1` inside a scroller whose
    // own height is definite, so the spacer grows on a tall screen and the whole column
    // simply scrolls once it does not fit.
    const seatless = !!board && board.state !== "live" && board.state !== "results";

    const body = () => {
        if (loading) return <Typography sx={mutedTextSx}>Loading the arena…</Typography>;
        if (!board) {
            return <Typography sx={mutedTextSx}>The arena is unavailable right now.</Typography>;
        }

        const closesAt = board.boundaries?.closesAt;
        const closeSubtitle = `Closes Sunday 16:00${
            board.boundaries?.timezoneDiffersFromViewer ? ` (${board.boundaries.timezone})` : ""
        }`;

        return (
            <>
                {board.state === "live" && closesAt ? (
                    <ArenaCountdown
                        className="arena-page__countdown"
                        label="Arena closes in"
                        target={closesAt}
                        subtitle={closeSubtitle}
                    />
                ) : (
                    <ArenaCountdown
                        className="arena-page__opens"
                        // "Your" only when a seat is already held for it. The difference
                        // is small and it is the whole reward for having joined.
                        label={board.optedInNextWeek ? "Your arena opens in" : "Next arena opens in"}
                        target={board.nextOpensAt}
                        subtitle="Tuesday, 4:00 AM"
                    />
                )}

                {seatless && (
                    <>
                        {/* Flexes to fill whatever is between the clock and the action,
                            so the grid is centred on any device height. */}
                        <Box sx={{ flex: 1, display: "flex", alignItems: "center", minHeight: 0 }}>
                            <ArenaSeatField
                                className="arena-page__seats"
                                showViewerSeat={board.optedInNextWeek}
                            />
                        </Box>
                        {board.optedInNextWeek ? (
                            <EnteredCard busy={busy} onWithdraw={handleWithdraw} />
                        ) : (
                            <Box sx={{ px: "18px" }}>
                                <ArenaJoinButton
                                    className="arena-page__join"
                                    label={busy ? "Joining…" : "Join next arena"}
                                    busy={busy}
                                    onClick={handleJoin}
                                />
                            </Box>
                        )}
                    </>
                )}

                {/* In `results` the action is in normal flow directly under the clock:
                    the break IS the window in which joining next week is possible, so it
                    sits above last week's outcome rather than below it. */}
                {board.state === "results" && !board.optedInNextWeek && (
                    <Box sx={{ px: "18px", mt: "16px" }}>
                        <ArenaJoinButton
                            className="arena-page__join"
                            label={busy ? "Joining…" : "Join next arena"}
                            busy={busy}
                            onClick={handleJoin}
                        />
                    </Box>
                )}
                {board.state === "results" && board.optedInNextWeek && (
                    <EnteredCard busy={busy} onWithdraw={handleWithdraw} />
                )}

                {/* One inline line, in the danger ink at caption size — not a toast, not
                    a dialog (A8). The action stays exactly where it was with its button
                    live again, so the retry is the same tap in the same place, and the
                    server's own sentence is shown verbatim: it is the only thing that
                    knows why. */}
                {error && (
                    <Typography className="arena-page__error" sx={{ ...errorTextSx, px: "20px", pt: "9px" }}>
                        {error}
                    </Typography>
                )}

                {board.state === "results" && (
                    <>
                        <Box
                            className="arena-page__divline"
                            sx={{ height: "1px", backgroundColor: COLORS.border, margin: "16px 18px 0" }}
                        />
                        <Typography
                            className="arena-page__results-title"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 26,
                                fontWeight: WEIGHT.semibold,
                                letterSpacing: "-0.01em",
                                color: COLORS.onSurface,
                                margin: "16px 18px 0",
                            }}
                        >
                            Last Week's Results
                        </Typography>
                        <ResultsCard divisionChange={board.divisionChange} />
                    </>
                )}

                {board.entries.length > 0 &&
                    (board.state === "results" ? (
                        <LockedBoard className="arena-page__board">{renderRows(board.entries)}</LockedBoard>
                    ) : (
                        <Board className="arena-page__board">{renderRows(board.entries)}</Board>
                    ))}
            </>
        );
    };

    return (
        <NodePage
            title="Arena"
            onBack={() => slideNavigate("/")}
            contentClassName="arena-page"
            // Three things in the right slot — help, the message editor, and the ambient
            // minute-points flame every header carries — which is exactly the case
            // `dense` exists for. The artboards draw only the two buttons, because the
            // design's header has no flame; ours always does.
            headerSize="dense"
            // The banner IS the page's masthead and the header sits inside it — see
            // DivisionBanner. Drawn in EVERY state, deliberately: the rung you hold does
            // not stop existing between weeks, and without it the seat-less states are a
            // bare clock on an empty page with nothing naming the arena you would join.
            wrapHeader={(header) => (
                <DivisionBanner
                    className="arena-page__banner"
                    division={board?.division ?? 1}
                    header={header}
                />
            )}
            // Both editors live in the HEADER, not on the viewer's own row: that row is a
            // competitor among 24 others and must render identically to them (a pencil
            // only you can see is still a mark only your row carries), and both have to
            // be reachable in the states where that row does not exist at all.
            headerExtraActions={
                <>
                    <HeaderIconButton
                        className="arena-page__help"
                        icon="help"
                        label="How the arena works"
                        onClick={() => setHelpOpen(true)}
                    />
                    <HeaderIconButton
                        className="arena-page__edit-message"
                        icon="edit_note"
                        label="Edit your arena message"
                        onClick={() => setMessageOpen(true)}
                    />
                </>
            }
        >
            <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, pb: "14px" }}>
                {body()}
            </Box>
            {/* Clearance under the last board row. The seat-less states skip it: their
                column is sized to dock against the footer, and an extra spacer would
                push a page that exactly fits into scrolling for no content. */}
            {!seatless && <FooterSpacer />}
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
            <SteppedHelpPopup
                open={helpOpen}
                steps={ARENA_HELP_STEPS}
                resolveShot={resolveArenaShot}
                onClose={closeHelp}
            />
        </NodePage>
    );
}

/** The rows and their zone dividers — identical for a live and a frozen board. */
function renderRows(entries: ArenaEntry[]) {
    return entries.map((entry, i) => (
        <Fragment key={`${entry.userId ?? "bot"}-${entry.rank}`}>
            {i > 0 && renderZoneDivider(entries[i - 1], entry)}
            <ArenaEntryRow entry={entry} />
        </Fragment>
    ));
}

/**
 * "You are entered" — the `waiting` state's card (A7).
 *
 * Withdraw is OUTLINED, never the gold block: it reverses the action that block exists to
 * offer, and giving the two the same weight would make the page ask a question instead of
 * offering an answer.
 */
function EnteredCard({ busy, onWithdraw }: { busy: boolean; onWithdraw: () => void }) {
    return (
        <Box
            className="arena-page__entered"
            sx={{
                margin: "12px 18px 0",
                padding: "15px 16px 16px",
                borderRadius: "18px",
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
            }}
        >
            <Label>You are entered</Label>
            <Typography
                sx={{ fontFamily: FONTS.sans, fontSize: 17.5, color: COLORS.onSurface, mt: "5px" }}
            >
                You're in next week's arena.
            </Typography>
            <Button
                className="arena-page__withdraw"
                variant="outlined"
                fullWidth
                onClick={onWithdraw}
                disabled={busy}
                sx={{ mt: "13px" }}
            >
                Withdraw
            </Button>
        </Box>
    );
}

/**
 * `.rescard` — what last week's finish did to the viewer's rung (A9, A10, A11).
 *
 * Filled with the ramp pastel the BOARD already uses for the same idea — `RAMP.grn` for
 * promotion, `RAMP.red` for demotion — carrying the matching arrow from `BoardZone`. A
 * competitor who watched the green line all week meets the same green when they cross it.
 *
 * `hold` is deliberately untinted, for the same reason `BoardZone`'s hold band is:
 * tinting every outcome would make the tint carry no information, and "nothing happened
 * to you" is exactly the case that should not shout. It takes a `remove` dash rather than
 * an arrow, because there is no direction to point in.
 *
 * ⚠️ THE WORD IS "DEMOTED", not "relegated". This card said "You were relegated." until
 * the arena flow, which is the wire's word (`zone: 'relegate'`) rather than the app's:
 * the board's own divider two inches below it has always said **Demotion**. The design
 * agreed with the divider, so the card moved.
 */
function ResultsCard({ divisionChange }: { divisionChange: number | null }) {
    const promoted = divisionChange === 1;
    const demoted = divisionChange === -1;
    const text = promoted ? "You were promoted."
        : demoted ? "You were demoted."
            : "You held your division.";
    const hue = promoted ? RAMP.grn : demoted ? RAMP.red : null;
    const arrow = promoted ? "arrow_upward" : demoted ? "arrow_downward" : "remove";

    return (
        <Box
            className="arena-page__results"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "12px 18px 0",
                padding: "14px 16px",
                borderRadius: "18px",
                backgroundColor: hue?.fill ?? COLORS.card,
                border: `1px solid ${hue ? "transparent" : COLORS.rowBorder}`,
            }}
        >
            <Icon name={arrow} size={21} color={hue?.ink ?? COLORS.textSecondary} weight={600} />
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: 17.5,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.onSurface,
                }}
            >
                {text}
            </Typography>
        </Box>
    );
}

export default ArenaPage;
