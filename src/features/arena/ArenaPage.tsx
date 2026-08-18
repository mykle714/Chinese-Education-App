import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import ArenaEntryRow from "./ArenaEntryRow";
import {
    fetchArenaBoard,
    optInToArena,
    withdrawFromArena,
    shareArenaLocation,
} from "../../api/arena";
import type { ArenaBoardResponse } from "../../api/arena";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import {
    divisionColor,
    divisionName,
    divisionTextColor,
    errorTextSx,
    formatRemaining,
    joinButtonSx,
    mutedTextSx,
    secondaryButtonSx,
    sectionCardSx,
} from "./arenaStyles";

/**
 * Arena (docs/ARENA_FEATURE.md) — a Home-hub drill-in (NodePage) showing the
 * viewer's weekly cluster of 25, ranked by minutes earned while the arena is
 * live.
 *
 * FOUR STATES (§ 2.3), and the page is really a switch over them:
 *   live     racing; the board plus a countdown to Sunday 16:00
 *   results  the week just closed; the final board plus what it did to your rung
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

    const load = useCallback(() => {
        setLoading(true);
        fetchArenaBoard(language)
            .then((data) => {
                setBoard(data);
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

        return (
            <>
                <DivisionHeader division={board.division} />

                {board.state === "live" && board.boundaries && (
                    <CountdownCard
                        closesAt={board.boundaries.closesAt}
                        timezone={board.boundaries.timezone}
                        showTimezone={board.boundaries.timezoneDiffersFromViewer}
                    />
                )}

                {board.state === "results" && (
                    <ResultsBanner divisionChange={board.divisionChange} />
                )}

                {(board.state === "opt-in" || board.state === "closed") && (
                    <OptInCard
                        optedIn={board.optedInNextWeek}
                        busy={busy}
                        onJoin={handleJoin}
                        onWithdraw={handleWithdraw}
                    />
                )}

                {error && <Typography sx={{ ...errorTextSx, mt: 1 }}>{error}</Typography>}

                {board.entries.length > 0 && (
                    <Box
                        className="arena-page__board"
                        sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1.5 }}
                    >
                        {board.entries.map((entry) => (
                            <ArenaEntryRow key={`${entry.userId ?? "bot"}-${entry.rank}`} entry={entry} />
                        ))}
                    </Box>
                )}
            </>
        );
    };

    return (
        <NodePage
            title="Arena"
            activePage="home"
            onBack={() => slideNavigate("/")}
            contentClassName="arena-page"
        >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, px: 1.5, pt: 1 }}>
                {body()}
            </Box>
            <FooterSpacer />
        </NodePage>
    );
}

/** The rung the viewer currently holds. */
function DivisionHeader({ division }: { division: number }) {
    return (
        <Box
            className="arena-page__division"
            sx={{
                ...sectionCardSx,
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                backgroundColor: divisionColor(division),
            }}
        >
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.subtitle,
                    fontWeight: WEIGHT.bold,
                    color: divisionTextColor(division),
                }}
            >
                {divisionName(division)}
            </Typography>
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.micro,
                    // On a dark rung the muted grey disappears, so the secondary line
                    // takes the same inverted colour and leans on opacity instead.
                    color: divisionTextColor(division),
                    opacity: 0.7,
                }}
            >
                Division {division} of 12
            </Typography>
        </Box>
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
}: {
    closesAt: string;
    timezone: string;
    showTimezone: boolean;
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
        <Box className="arena-page__countdown" sx={sectionCardSx}>
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.body,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.onSurface,
                }}
            >
                {formatRemaining(remaining)} left
            </Typography>
            <Typography
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary }}
            >
                Closes Sunday 16:00{showTimezone ? ` (${timezone})` : ""}
            </Typography>
        </Box>
    );
}

/** What last week's finish did to the viewer's rung. */
function ResultsBanner({ divisionChange }: { divisionChange: number | null }) {
    const text =
        divisionChange === 1 ? "You were promoted."
            : divisionChange === -1 ? "You were relegated."
                : "You held your division.";
    const tint =
        divisionChange === 1 ? COLORS.greenAccent
            : divisionChange === -1 ? COLORS.redAccent
                : COLORS.sectionCard;

    return (
        <Box className="arena-page__results" sx={{ ...sectionCardSx, backgroundColor: tint }}>
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
    // Identical in `opt-in` and `closed`: the only difference between those two
    // states was whether the break was open, and that stopped gating enrolment
    // (§ 8). Someone without a seat joins next week's arena either way, so
    // `closed` no longer means "come back on Sunday".
    if (optedIn) {
        return (
            <Box className="arena-page__optin" sx={sectionCardSx}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.onSurface }}>
                    You're in next week's arena.
                </Typography>
                <Button className="arena-page__withdraw" sx={secondaryButtonSx} onClick={onWithdraw} disabled={busy}>
                    Withdraw
                </Button>
            </Box>
        );
    }

    return (
        <Box className="arena-page__optin" sx={sectionCardSx}>
            <Typography
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.body,
                    fontWeight: WEIGHT.semibold,
                    color: COLORS.onSurface,
                }}
            >
                Join next week's arena
            </Typography>
            <Typography
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: COLORS.textSecondary, mt: 0.5, mb: 1 }}
            >
                We use your rough area only to group you with nearby players. We never show
                it to anyone, and you can skip it.
            </Typography>
            <Button className="arena-page__join" sx={joinButtonSx} onClick={onJoin} disabled={busy}>
                {busy ? "Joining…" : "Join"}
            </Button>
        </Box>
    );
}

export default ArenaPage;
