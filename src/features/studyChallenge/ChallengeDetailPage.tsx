import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Box, ButtonBase, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import Icon from "../../components/Icon";
import ChallengeWordCard from "./ChallengeWordCard";
import ChallengeTestCard from "./ChallengeTestCard";
import ChallengeResults from "./ChallengeResults";
import ChallengeDetailHeader from "./ChallengeDetailHeader";
import ChallengeHelpPopup from "./ChallengeHelpPopup";
import { HOW_THE_TEST_WORKS_STEPS, HOW_TO_STUDY_STEPS } from "./challengeHelpSteps";
import { storedWordToReviewWord } from "./reviewWord";
import { fetchChallenge } from "../../api/studyChallenges";
import type { ChallengeSummary } from "../../api/studyChallenges";
import type { VocabEntry } from "../../types";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useDragScroll } from "../../hooks/useDragScroll";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { challengeErrorMessage } from "./challengeLabels";
import { useChallengeAnytime } from "./challengeAnytime";
import { challengeMessageSx, challengeMutedSx, challengeWordCardHeight } from "./challengeStyles";

/** Which of the two explainers is open, if any. */
type OpenHelp = "study" | "test" | null;

/**
 * View Challenge — one challenge in every state after it is accepted
 * (docs/STUDY_CHALLENGE.md §§ 4–6, design F11/F12/F15/F15b–d/F16/F17/F18).
 *
 * ⚠️ TWO PAGES, NOT ONE — ONCE THERE ARE TWO SIDES TO READ. A challenge has two
 * players, so the TEST CARD is two horizontally-
 * swipeable pages, yours in blue and theirs in red, with dots under them saying which
 * you are on. The masthead ABOVE the pager does not travel with them and does not
 * change: "vs <name>" is the same sentence on both sides. The blocks that are the
 * same for both players (the "How to study this
 * deck" button and the nine word cards) sit BELOW the dots and do not move: the
 * masthead and the dot row are the lines where the swipe's reach begins and ends. During the STUDY
 * days there is nothing on their side at all (neither player has a sequence, let
 * alone a round), so the pager and its dots are not rendered and the screen is a
 * single scroll; they appear as soon as the opponent has submitted anything. A dot
 * row that advertises a page saying nothing is worse than no dot row. Both pages have the SAME layout, which is what lets
 * a reader compare them without translating between two designs; the colour is the
 * whole ownership mark, and red here is never a warning.
 *
 * The opponent's page fills in round by round: a round is revealed the moment it is
 * complete (§ 6), and a round they have not played yet is simply absent. A round IN
 * PROGRESS is never visible on either side, because only submitted rounds are stored.
 *
 * ⚠️ ONCE THE CHALLENGE RESOLVES THE TWO PAGES COLLAPSE INTO ONE. `complete` and
 * `no_contest` render the results screen instead — a single scroll carrying the
 * verdict and both players' cards. Keeping the swipe would ask the reader to page
 * back and forth to make the comparison the verdict has already made.
 *
 * ⚠️ WHAT THIS PAGE STILL MUST NOT SHOW: THE GAMES, before the viewer's own window
 * opens. `gameSequence` is absent from the payload until then (Q63), so its absence
 * IS the gate and there is nothing to leak even by accident. Do not add a date check
 * alongside it.
 */
function ChallengeDetailPage() {
    const { challengeId } = useParams<{ challengeId: string }>();
    usePageTitle("Challenge");

    /**
     * Where Back goes. This page is reached from the challenges list AND from the
     * History log, so the opener names its own route in navigation state; the list
     * stays the default for a direct hit on the URL (a refresh, a shared link),
     * because that is the page a challenge normally lives on.
     */
    const location = useLocation();
    const backTo = (location.state as { from?: string } | null)?.from ?? "/friends/challenges";

    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    // Tester escape hatch (docs/STUDY_CHALLENGE.md § 2a) — read, never set, here: the
    // switch lives on the challenges list. Only the copy depends on it; whether the
    // rounds are actually playable is the server's answer, arriving as the presence of
    // `gameSequence`.
    const [anytime] = useChallengeAnytime();
    const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [help, setHelp] = useState<OpenHelp>(null);
    /** 0 = your page, 1 = theirs. Driven by the scroller, not the other way round. */
    const [page, setPage] = useState(0);
    const pagerRef = useRef<HTMLDivElement | null>(null);
    /**
     * Desktop click-and-drag on the pager. A native scroll-snap container is pannable by
     * finger and trackpad only — a mouse drag scrolls nothing in any browser — so without
     * this the swipe the whole page is built around is simply absent under a mouse, and
     * the dots are the only way across. `paged` makes the drag turn one page and settle
     * (see `useDragScroll`); `handlePagerScroll` still reads the position, so the dots,
     * the drag and a finger cannot disagree.
     */
    useDragScroll(pagerRef, { paged: true });

    // Keyed on isAuthenticated + the id, never on `token`
    // (CLAUDE.md "Never reload on token refresh").
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchChallenge(challengeId!)
            .then((result) => { if (!cancelled) { setChallenge(result); setError(null); } })
            .catch((err: unknown) => {
                if (!cancelled) setError(challengeErrorMessage(err, "Could not load that challenge"));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // `anytime` is a dependency because it changes what the SERVER sends: with the
        // hatch on, `gameSequence` is present outside the test window, which is what
        // turns the round list into playable Play buttons.
    }, [isAuthenticated, challengeId, anytime]);

    /**
     * The word set as mini preview cards. Same trick as the pre-play panel and Quick
     * Mark: MiniVocabCardGrid is typed for VocabEntry[], but a challenge word is a
     * stored (language, word1) pair (Q49) — never a vet row here — so the list is cast
     * for the grid and looked up by `word1` in the renderer.
     */
    const words = useMemo(
        () => (challenge?.words ?? []).map(storedWordToReviewWord),
        [challenge?.words]
    );
    const wordGridEntries = useMemo(
        () => (challenge?.words ?? []).map((w) => ({
            id: w.dictionaryEntryId ?? w.position,
            entryKey: w.word1,
        })) as unknown as VocabEntry[],
        [challenge?.words]
    );
    const renderWordCard = useCallback(
        (entry: VocabEntry, _index: number, animationDelayMs?: number) => {
            const word = words.find((w) => w.word1 === entry.entryKey);
            if (!word) return null;
            // No onStrike / onSelect: after accept the set is final (§ 3.3), so the card
            // is inert rather than tappable-but-pointless.
            return <ChallengeWordCard key={word.word1} word={word} animationDelayMs={animationDelayMs} />;
        },
        [words]
    );

    /**
     * Follow the scroller rather than driving it. The pager is a native
     * scroll-snap container — the platform already does the physics, the rubber-band
     * and the momentum — so the dots read the scroll position instead of a
     * `currentPage` state that would have to be kept honest against a gesture already
     * in flight.
     */
    const handlePagerScroll = useCallback(() => {
        const node = pagerRef.current;
        if (!node) return;
        setPage(node.scrollLeft > node.clientWidth / 2 ? 1 : 0);
    }, []);

    /**
     * Drive the pager from the dots.
     *
     * ⚠️ THE DOTS ARE THE INPUT-INDEPENDENT WAY TO REACH PAGE 2. A native scroll-snap
     * container is pannable by FINGER and by trackpad, and by nothing else — a mouse
     * drag does not scroll an overflow container in any browser — and the pager was
     * also inert on touch until the shell was widened (`horizontalPan`). Making the
     * dots buttons removes the whole class of problem: they work under every pointer,
     * they are keyboard reachable, and the gesture stays the fast path. Mouse drag is
     * wired up separately by `useDragScroll` above (2026-09-02); the dots remain the
     * keyboard and accessibility path, which the gesture can never be.
     *
     * They still do not own the position — `handlePagerScroll` remains the single
     * reader of it, so a dot tap and a swipe cannot disagree.
     */
    const goToPage = useCallback((next: number) => {
        const node = pagerRef.current;
        if (!node) return;
        node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
    }, []);

    const isResolved = challenge?.status === "complete" || challenge?.status === "no_contest";
    const opponentName = challenge?.opponent.name || challenge?.opponent.email || "them";
    // The state chip in the header. Its vocabulary is the row pill's, so the page a
    // learner lands on names its state the same way the row they tapped did.
    const chip = !challenge ? null
        : isResolved ? { text: challenge.status === "no_contest" ? "no contest" : "results", fill: COLORS.blu }
        : challenge.gameSequence
            ? (Object.keys(challenge.rounds).length >= challenge.roundCount
                ? { text: "waiting", fill: COLORS.org }
                : { text: "test", fill: COLORS.blu })
            : { text: "study", fill: COLORS.org };

    /**
     * The word set — the one block that is the same on both pages.
     *
     * ⚠️ NO HEADING (removed 2026-09-01). It used to be captioned "The 9 words". The
     * cards ARE the caption: nine word cards under a challenge cannot be anything else,
     * and the label spent a line of the first screen restating them while counting a
     * number the learner cannot act on. The grid keeps its class names, so the section
     * is still addressable in CSS and in a screenshot review.
     */
    const wordSet = challenge && challenge.words.length > 0 ? (
        <Box className="challenge-detail-page__words" sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 2 }}>
            {/* The SAME mini preview card the pre-play sheet strikes from, minus the
                strike: the nine are settled once the challenge is accepted, so there is
                nothing to act on — but a learner should recognise the set they
                confirmed, which means it has to look the same. */}
            <MiniVocabCardGrid
                containerClassName="challenge-detail-page__word-grid"
                classPrefix="challenge-detail-page__words"
                loading={false}
                entries={wordGridEntries}
                emptyMessage="This challenge has no words."
                onCardClick={() => {}}
                renderCard={renderWordCard}
                cardHeightPx={challengeWordCardHeight(false)}
                staggerReveal
                // No elastic scroll stretch here: the word set is a settled reference
                // list sitting under the pager, not the content the reader is travelling
                // through, and rows that spring apart under it fight the swipe above.
                scrollStretch={false}
            />
        </Box>
    ) : null;

    /**
     * Is the viewer still in the STUDY days? The sequence's absence is the gate the
     * whole page already runs on (§ 5.1b) — the server withholds `gameSequence` until
     * this player's window opens — so this asks the same question rather than adding a
     * second date check that could disagree with it.
     */
    const studying = !!challenge && !challenge.gameSequence;

    /**
     * Does the second page exist yet?
     *
     * Normally it is the study state that decides, but the two players' windows are
     * their OWN (shared/challengeWeek.ts): an opponent far enough east can be playing
     * while this viewer is still studying. So the real test is whether their side has
     * anything to show — a submitted round — and the study state is only the common
     * case of that being empty.
     */
    const showOpponentPage = !!challenge
        && (!studying || Object.keys(challenge.opponentRounds).length > 0);

    /**
     * The masthead — ONE copy for both pages, outside the pager.
     *
     * It reads the same on both sides ("vs <name>"), so it is rendered once, above the
     * pager, and does not move or change with `page`.
     *
     * ⚠️ NO SUBTITLE (removed 2026-09-01) AND NO SIDE EYEBROW (removed 2026-09-02).
     * The subtitle printed "Round 2 of 3 · closes 4 AM Sunday" — a round counter the
     * numerals down the test card's left edge already draw, over a close date the
     * card's own head already states. The eyebrow was a blue/red rule + "Your
     * challenge" / "Their side" kicker that re-inked as the swipe crossed halfway; the
     * test card's own ownership ink and the pager dots already say whose side you are
     * reading. The challenges LIST row keeps `challengeStatusLine`, where it is the
     * row's only description.
     */
    const masthead = <ChallengeDetailHeader opponentName={opponentName} />;

    /**
     * Page 1 · yours. Hoisted so it can render with or without the pager around it.
     *
     * ⚠️ THE TEST CARD IS THE ONLY THING THAT SWIPES (narrowed 2026-09-01, narrowed
     * again 2026-09-02). The pager once carried the masthead too; it now carries the
     * test card alone. The masthead reads "vs <name>" on both sides, so sliding one
     * copy out and an identical copy in made the gesture look like a stutter rather
     * than a page turn. It now sits ABOVE the pager, static (see `masthead`).
     * (The pager also held an
     * itemised running total until 2026-09-02; that card was deleted and its per-round
     * subtotals now print on the test card's own rows — see `ChallengeTestCard`.) The
     * study button and the word set are likewise the same on both sides and sit under
     * the dots, outside the scroller.
     */
    const yourTest = challenge ? (
        <Box className="challenge-detail-page__page challenge-detail-page__page--you" sx={{ flex: "0 0 100%", scrollSnapAlign: "start", minWidth: 0 }}>
            <ChallengeTestCard
                challenge={challenge}
                side="you"
                rounds={challenge.rounds}
                onExplain={() => setHelp("test")}
                onPlay={(to, state) => slideNavigate(to, { state })}
            />

        </Box>
    ) : null;

    /**
     * The deck explainer + the word set — the blocks that are common to both sides and
     * therefore live BELOW the dots, outside the pager.
     *
     * The study button is the loudest thing on the page during the study days, because
     * the deck is that stretch's ONE job. It disappears once the deck is dropped —
     * which happens the moment this player finishes their test.
     */
    const sharedFooter = challenge ? (
        <>
            {challenge.presetDeckId && (
                <ButtonBase
                    className="challenge-detail-page__study"
                    onClick={() => setHelp("study")}
                    sx={{
                        ml: 2.25,
                        mt: 1.75,
                        px: 1.9,
                        py: 1.4,
                        borderRadius: "13px",
                        backgroundColor: COLORS.org,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 1,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.onSurface,
                    }}
                >
                    <Icon name="help" size={17} color={COLORS.orgA} />
                    How to study this deck
                </ButtonBase>
            )}

            {wordSet}
            <FooterSpacer />
        </>
    ) : null;

    /** Page 2 · theirs. Only ever rendered inside the pager. */
    const theirTest = challenge ? (
        <Box className="challenge-detail-page__page challenge-detail-page__page--opponent" sx={{ flex: "0 0 100%", scrollSnapAlign: "start", minWidth: 0 }}>
            <ChallengeTestCard
                challenge={challenge}
                side="opponent"
                rounds={challenge.opponentRounds}
            />
        </Box>
    ) : null;

    return (
        <NodePage
            title="View Challenge"
            onBack={() => slideNavigate(backTo)}
            contentClassName="challenge-detail-page__content"
            // The two-page pager below is a horizontal scroller, and the scroll area's
            // `touch-action` is a CEILING on its descendants — without this the pager's
            // own `pan-x pan-y` is overruled and the swipe is silently inert. Harmless
            // on the states that render one page: there is then nothing to pan.
            horizontalPan
            headerExtraActions={chip ? (
                <Box
                    className={`challenge-detail-page__state challenge-detail-page__state--${chip.text.replace(" ", "-")}`}
                    sx={{
                        flexShrink: 0,
                        fontFamily: FONTS.mono,
                        fontSize: SIZE.micro,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: COLORS.onSurface,
                        backgroundColor: chip.fill,
                        borderRadius: 2,
                        px: 1.1,
                        py: 0.75,
                    }}
                >
                    {chip.text}
                </Box>
            ) : undefined}
        >
            <Box className="challenge-detail-page">
                {error && (
                    <Typography className="challenge-detail-page__error" sx={{ ...challengeMessageSx, px: 2.5, pt: 1.5 }}>{error}</Typography>
                )}

                {loading ? (
                    <Typography className="challenge-detail-page__loading" sx={{ ...challengeMutedSx, px: 2.5, pt: 2 }}>Loading…</Typography>
                ) : !challenge ? (
                    <Typography className="challenge-detail-page__missing" sx={{ ...challengeMutedSx, px: 2.5, pt: 2 }}>
                        This challenge is no longer available.
                    </Typography>
                ) : isResolved ? (
                    // Resolved: one scroll, both players, no swipe. See the header note.
                    <>
                        <ChallengeDetailHeader opponentName={opponentName} />
                        <ChallengeResults
                            challenge={challenge}
                            viewerUserId={user?.id}
                            onChallengeUpdated={setChallenge}
                        />
                        {wordSet}
                        <FooterSpacer />
                    </>
                ) : !showOpponentPage ? (
                    // THE STUDY DAYS ARE A ONE-PAGE SCREEN. Until a window opens there is
                    // nothing on the opponent's side to swipe to — no rounds, no scores,
                    // not even a locked sequence, because `gameSequence` is withheld from
                    // both of them — so the pager would be an empty gesture and the dots
                    // would advertise a page that says nothing. Both appear the moment
                    // there IS a second side to read.
                    <>
                        {masthead}
                        {yourTest}
                        {sharedFooter}
                    </>
                ) : (
                    <>
                        {/* The masthead does not swipe — it reads the same on both sides. */}
                        {masthead}

                        {/* THE PAGER CARRIES ONLY THE TWO TEST CARDS. Everything above
                            the masthead and below the dots is shared, so the swipe
                            moves exactly the part of the screen that has two answers. */}
                        <Box
                            className="challenge-detail-page__pager"
                            ref={pagerRef}
                            onScroll={handlePagerScroll}
                            sx={{
                                display: "flex",
                                overflowX: "auto",
                                scrollSnapType: "x mandatory",
                                // The app shell's global `touchAction: none` means a
                                // horizontal pan has to be opted into explicitly
                                // (CLAUDE.md "Touch & Scroll"). `pan-x pan-y` keeps the
                                // vertical scroll of each page working through the pager.
                                touchAction: "pan-x pan-y",
                                overscrollBehaviorX: "contain",
                                scrollbarWidth: "none",
                                "&::-webkit-scrollbar": { display: "none" },
                            }}
                        >
                            {yourTest}
                            {theirTest}
                        </Box>

                        {/* The dots say which page you are on, that there IS a second one
                            — nothing else hints at a sideways gesture — and, since they
                            are buttons, they are also the way to GET there under a
                            pointer that cannot swipe. See `goToPage`.
                            ⚠️ BETWEEN THE PAGER AND THE SHARED BLOCKS (moved 2026-09-01).
                            They sit directly under the thing they page and directly above
                            the first block that does NOT move, which is what tells a
                            reader where the swipe's reach ends. This only works because
                            the pager is now the test alone: when it also carried the nine
                            word cards it scrolled to ~1100px and dots underneath it were
                            permanently below the fold. */}
                        <Box
                            className="challenge-detail-page__dots"
                            sx={{ display: "flex", justifyContent: "center", gap: 1, pt: 1, pb: 0.25 }}
                        >
                            {[0, 1].map((dot) => (
                                <ButtonBase
                                    key={dot}
                                    className={`challenge-detail-page__dot${page === dot ? " challenge-detail-page__dot--active" : ""}`}
                                    onClick={() => goToPage(dot)}
                                    aria-label={dot === 0 ? "Your side" : "Their side"}
                                    // The tap target is the 44px row, not the 7px dot: the
                                    // padding is what makes a dot hittable without drawing
                                    // a control the size of a button.
                                    sx={{ px: 0.75, py: 1.25, borderRadius: "99px" }}
                                >
                                <Box
                                    sx={{
                                        // The current dot stretches as well as changing ink:
                                        // at 7px a colour change alone is easy to miss.
                                        width: page === dot ? 18 : 7,
                                        height: 7,
                                        borderRadius: "99px",
                                        // The active dot takes the ink of the page it marks,
                                        // so the dots repeat the ownership colour rather than
                                        // inventing a third one.
                                        backgroundColor: page === dot
                                            ? (dot === 0 ? COLORS.onSurface : "#8E1526")
                                            : COLORS.border,
                                        transition: "width 160ms ease, background-color 160ms ease",
                                    }}
                                />
                                </ButtonBase>
                            ))}
                        </Box>

                        {sharedFooter}
                    </>
                )}
            </Box>

            <ChallengeHelpPopup
                open={help !== null}
                steps={help === "study" ? HOW_TO_STUDY_STEPS : HOW_THE_TEST_WORKS_STEPS}
                deckName={challenge ? `vs ${opponentName}` : undefined}
                onClose={() => setHelp(null)}
            />
        </NodePage>
    );
}

export default ChallengeDetailPage;
