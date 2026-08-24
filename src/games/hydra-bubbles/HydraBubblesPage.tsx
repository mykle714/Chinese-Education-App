import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { markFlashcard } from "../../api/flashcards";
import { useLaunchCollection } from "../../features/flashcards/useLaunchCollection";
import { collectionQuerySuffix } from "../../features/flashcards/collectionRef";
import type { Language, VocabEntry } from "../../types";
import { CHALLENGE_WORD_COUNT } from "../../types";
import { GameLeafPage } from "../shared/GameSurface";
// The game's accent hue — one constant drives its hub row and its own ground (§ A6b).
import { GAME_HUE } from "./constants";
import BubbleMatchHeaderControls from "../bubble-match/BubbleMatchHeader";
import BubbleMatchEndPopup from "../bubble-match/BubbleMatchEndPopup";
import HydraStage from "./HydraStage";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { MARK_TYPE, SURFACE } from "./constants";
import type { HydraOutcome, HydraPhase } from "./types";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { useColorBuffers } from "./useColorBuffers";
import HydraLendNotice from "./HydraLendNotice";
import { API_BASE_URL } from "../../constants";
import { authHeader } from "../../utils/authHeader";
import { useChallengeRound } from "../runtime/useChallengeRound";
import ChallengeRoundScoreboard from "../runtime/ChallengeRoundScoreboard";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import { useBackgroundPause } from "../runtime/useBackgroundPause";

/**
 * Hydra Bubbles — page shell + run state machine (docs/HYDRA_BUBBLES.md).
 *
 * Flow: loading → playing → over → playing (Play Again) …
 *
 * There is NO LEVEL PICKER and no level state: Hydra has one mode, and board size is
 * its difficulty curve (§ 9). There is also no card-count gate of any kind — Hydra
 * declares no baseline (§ 6.5), so a learner with an empty library plays a board
 * built entirely from lent cards rather than meeting a block screen.
 *
 * Minute points accrue by route prefix in the global activity layer, so this page
 * only renders the fire badge.
 */
const HydraBubblesPage: React.FC = () => {
    const launchCollection = useLaunchCollection();
    const collectionSuffix = collectionQuerySuffix(launchCollection);
    usePageTitle("Hydra Bubbles");
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { user } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor, autoplayChinese } = settings;
    const language = (user?.selectedLanguage ?? "zh") as Language;

    // An edge swipe mid-drag would navigate away; CSS touch-action cannot stop the
    // history gesture, so it is blocked at the touch-event layer.
    useBlockEdgeSwipe(true);

    const [phase, setPhase] = useState<HydraPhase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    const [score, setScore] = useState(0);
    const [outcome, setOutcome] = useState<HydraOutcome | null>(null);
    const [popupMinimized, setPopupMinimized] = useState(false);
    const [lendNoticeOpen, setLendNoticeOpen] = useState(false);
    // Bumped per run so HydraStage remounts with a clean field.
    const [runId, setRunId] = useState(0);
    const runIdRef = useRef(0);

    // A deck/collection run plays exactly the set the learner chose: no lending, and
    // the cooldown is not honored either (§ 6.3).
    const restricted = launchCollection !== null;

    // ── STUDY CHALLENGE ROUND (§ 7.5, docs/STUDY_CHALLENGE.md § 5) ──
    // BACKGROUND PAUSE IS BACK, exactly as the note below the pause gate promised: a
    // challenge round is scored on TIME TO CLEAR, which makes this variant genuinely
    // timed and puts it under the app-wide rule. A free-play run stays unpaused —
    // nothing in it advances on its own.
    // Read straight off the URL rather than from the hook below, which needs the
    // pause flag this line produces. One fact, two readers, no cycle.
    const isChallengeLaunch = !!searchParams.get("challengeId");
    const { paused: backgroundPaused, resume: resumeFromBackground } =
        useBackgroundPause(phase === "playing" && isChallengeLaunch);
    const challengeRound = useChallengeRound({
        gameId: "hydra-bubbles",
        paused: lendNoticeOpen || backgroundPaused,
        running: phase === "playing",
    });
    /**
     * The contested words as CARDS, fetched once before the run starts.
     *
     * Hydra is the one challenge game whose FILLER is not `mastered-first`, and that
     * is deliberate: its filler comes from the colour buffers, whose bands ARE the
     * payout ladder (§ 5) — a board padded entirely from the player's mastered cards
     * would be a board of nothing but bloom, which is not the game. So only the
     * contested set is drawn from the challenge, and the economy is untouched.
     */
    const [challengeCards, setChallengeCards] = useState<VocabEntry[] | null>(null);
    const buffers = useColorBuffers(collectionSuffix, restricted, challengeCards);
    /** Contested words still unmatched — the run ends when this empties (§ 7.5). */
    const remainingContestedRef = useRef<Set<string>>(new Set());

    /**
     * The round's twelve contested words, as playable cards.
     *
     * `need = CHALLENGE_WORD_COUNT` asks the server for the contested set and no
     * filler — Hydra's filler is its own colour supply (see `challengeCards`).
     */
    const fetchChallengeCards = useCallback(async (): Promise<VocabEntry[] | null> => {
        try {
            const params = [
                `markType=${MARK_TYPE}`,
                `surface=${SURFACE}`,
                `need=${CHALLENGE_WORD_COUNT}`,
                `challengeId=${encodeURIComponent(searchParams.get("challengeId") ?? "")}`,
                `gameId=hydra-bubbles`,
            ];
            const res = await fetch(`${API_BASE_URL}/api/onDeck/gamePool?${params.join("&")}`, {
                credentials: "include",
                headers: authHeader(),
            });
            if (!res.ok) return null;
            const data = await res.json() as { cards?: VocabEntry[] };
            return data.cards?.length ? data.cards : null;
        } catch {
            return null;
        }
        // authHeader() reads the token at call time (CLAUDE.md ⛔ rule).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Does clearing this word end the run? Yes on the LAST contested word (§ 7.5).
     *
     * Filler clears never end a run, and neither does clearing a contested word
     * while others are outstanding — so a challenge round is "clear all twelve,
     * fastest", with a wrong match ending it early and the unmatched words scoring
     * nothing.
     */
    const shouldEndRun = useCallback((entry: VocabEntry): boolean => {
        if (!remainingContestedRef.current.size) return false;
        remainingContestedRef.current.delete(entry.entryKey);
        return remainingContestedRef.current.size === 0;
    }, []);

    // ---- Run lifecycle ------------------------------------------------------
    const beginRun = useCallback(() => {
        setScore(0);
        setOutcome(null);
        setPopupMinimized(false);
        setLendNoticeOpen(false);
        runIdRef.current += 1;
        setRunId(runIdRef.current);
        setPhase("playing");
    }, []);

    useEffect(() => {
        if (!user) {
            setBlockMessage("Sign in to play Hydra Bubbles.");
            setPhase("blocked");
            return;
        }
        // WAIT FOR THE CHALLENGE CONTEXT. The round's contested set arrives with the
        // challenge payload, and a board dealt before it lands would be classified
        // entirely as filler — a round scored at 20 points a card with no way to tell
        // afterwards that it went wrong. `ready` flips once, so this costs an
        // ordinary launch nothing (`active` is false and the guard never fires).
        if (challengeRound.active && !challengeRound.ready) return;
        let cancelled = false;
        (async () => {
            // A challenge round's contested words come first, and the buffers are
            // primed AFTER them so their ids are already excluded from every refill.
            // A failure here is fatal to the round rather than degraded: a Hydra
            // challenge with no contested words has nothing to score and no ending.
            if (isChallengeLaunch) {
                const cards = await fetchChallengeCards();
                if (cancelled) return;
                if (!cards) {
                    setBlockMessage("Couldn't load your challenge words. Please try again.");
                    setPhase("blocked");
                    return;
                }
                remainingContestedRef.current = new Set(cards.map((card) => card.entryKey));
                setChallengeCards(cards);
            }
            // Prime all four color buffers before the first bubble is placed. This is
            // the ONLY blocking fetch in a run — every later top-up is async and the
            // board never waits on one (§ 6.2b).
            await buffers.prime();
            if (cancelled) return;
            if (buffers.size() === 0) {
                // Every buffer came back empty. Not a card-count gate: with lending
                // enabled this means the dictionary itself has nothing left to offer,
                // which is a genuinely unplayable state rather than a small library.
                setBlockMessage("Couldn't load any words. Please try again.");
                setPhase("blocked");
                return;
            }
            beginRun();
        })();
        return () => {
            cancelled = true;
        };
        // Keyed on the STABLE auth identity, never `token`: a silent access-token
        // refresh (~every 15 min) must not restart a live run.
        // See CLAUDE.md "Never reload on token refresh".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, challengeRound.active, challengeRound.ready]);

    // A challenge round that cannot be played says so rather than starting an
    // endless free-play run that scores nothing.
    useEffect(() => {
        if (challengeRound.error) {
            setBlockMessage(challengeRound.error);
            setPhase("blocked");
        }
    }, [challengeRound.error]);

    const playAgain = useCallback(() => {
        // Prime the audio element inside the real click gesture: in-game autoplay
        // fires from a bubble's pointerdown, and on mobile a first play outside a
        // gesture is silently dropped.
        tts.unlockAudio();
        beginRun();
    }, [tts.unlockAudio, beginRun]);

    const onGameOver = useCallback((why: HydraOutcome, finalScore: number) => {
        setOutcome(why);
        setScore(finalScore);
        setPopupMinimized(false);
        setPhase("over");
        // `won` is "cleared the set" — Hydra's spec carries no all-or-nothing bonus,
        // so this only ever records what happened rather than changing the score.
        challengeRound.finish(why === "challengeComplete");
    }, [challengeRound]);

    /**
     * Record a recognition mark. Fire-and-forget — the run never blocks on it.
     *
     * The server may SUPPRESS the mark when the card's track has not finished
     * cooling (§ 8). That is not an error and not something Hydra reacts to: the
     * clear still scores, which is exactly what § 8 specifies.
     */
    const markCard = useCallback((entry: VocabEntry, isCorrect: boolean) => {
        markFlashcard({ cardId: entry.id, isCorrect, type: MARK_TYPE, surface: SURFACE })
            .catch((err) => console.error(`[Hydra] mark failed → card ${entry.id}:`, err));
        // A challenge round is normal play plus a scored event (§ 5.7). A wrong match
        // ends the run, so at most one miss is ever emitted.
        challengeRound.emit({
            kind: isCorrect ? "hit" : "miss",
            word: entry.entryKey,
            contested: challengeRound.isContested(entry.entryKey),
        });
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
        // challengeRound's emit/isContested are stable by construction.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Pause gates --------------------------------------------------------
    // A modal over a live drag either eats the pointer or strands a half-finished
    // match underneath it, so the field freezes while one is up (§ 6.4). That is the
    // ONLY reason Hydra freezes.
    //
    // NO BACKGROUND PAUSE, deliberately. The app-wide rule
    // (docs/GAMES_FEATURE.md § "Backgrounding pauses the clock") exists so a round
    // cannot run down while nobody is watching — it protects a CLOCK. Hydra has no
    // clock and nothing that advances on its own: bubbles do not drift
    // (`stepPhysics(..., { drift: false })`), there is no descending ceiling, and the
    // board changes only in response to a match. Backgrounding therefore costs the
    // player nothing, and a tap-to-resume overlay on return is pure friction over a
    // board that is exactly as they left it.
    //
    // ⚠️ IT IS BACK FOR CHALLENGE MODE ONLY (2026-08-22), exactly as this note
    // predicted. A challenge round is scored on TIME TO CLEAR (§ 7.5), so that
    // variant IS timed and falls squarely under the rule — `useBackgroundPause` is
    // armed for it above, its overlay renders below, and the round's elapsed time is
    // ACCUMULATED ACTIVE time (the shared hook ticks only while unpaused), never
    // `now − startedAt`. A free-play run is unchanged: nothing in it advances on its
    // own, so pausing it would be friction over a board that has not moved.
    const framePaused = lendNoticeOpen || backgroundPaused;

    // End-of-run offer to keep the lent cards, a beat after the score card.
    const lentWords = buffers.lentDrawn().map((card) => card.entryKey);
    const sortOffer = useProvisionalSortOffer(phase === "over", lentWords);

    // The centred column shown INSTEAD of the board (spinner, or the blocked
    // message). The shape is shared — `GameCentered` also owns the rule that text on
    // the accent ground is white — so this is only the page's class name for it.
    const renderCentered = (children: React.ReactNode) => (
        <GameCentered className="hydra__overlay">{children}</GameCentered>
    );

    let centered: React.ReactNode = null;
    let popup: React.ReactNode = null;

    if (phase === "loading") {
        centered = renderCentered(<DelayedCircularProgress className="hydra__spinner" />);
    } else if (phase === "blocked") {
        centered = renderCentered(
            <>
                <Typography
                    className="hydra__block-msg"
                    sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}
                >
                    {blockMessage}
                </Typography>
                <Button className="hydra__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
    } else if (phase === "over" && challengeRound.active) {
        // A challenge round ends on the scoreboard (§ 5.5): contested/filler points,
        // not bubbles cleared, and no Play Again — the round is final (§ 5.1a).
        popup = <ChallengeRoundScoreboard round={challengeRound} classPrefix="hydra" />;
    } else if (phase === "over") {
        popup = (
            <BubbleMatchEndPopup
                minimized={popupMinimized}
                onMinimize={() => setPopupMinimized(true)}
                onRestore={() => setPopupMinimized(false)}
            >
                <Typography
                    className="hydra__popup-title"
                    sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}
                >
                    You cleared {score} bubbles
                </Typography>
                <Typography className="hydra__popup-msg" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                    {outcome === "overflow"
                        ? "The board filled up. Clear more charcoal bubbles to hold it back."
                        : outcome === "challengeComplete"
                            ? "You cleared the whole challenge set."
                            : "Wrong match — the run ends there."}
                </Typography>
                <Box
                    className="hydra__replay-actions"
                    sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
                >
                    <Button
                        className="hydra__replay-btn hydra__replay-btn--play-again"
                        variant="contained"
                        onClick={playAgain}
                        sx={{
                            py: 1.25,
                            borderRadius: "14px",
                            textTransform: "none",
                            fontSize: SIZE.bodyLg,
                            fontWeight: WEIGHT.bold,
                            lineHeight: LEADING.tight,
                        }}
                    >
                        Play Again
                    </Button>
                    <Button
                        className="hydra__replay-btn hydra__replay-btn--back"
                        variant="outlined"
                        onClick={() => navigate("/games")}
                        sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                    >
                        Back to Games
                    </Button>
                </Box>
            </BubbleMatchEndPopup>
        );
    }

    // The stage stays mounted across playing → over (same runId) so the popup
    // overlays the final board rather than replacing it.
    const showStage = phase === "playing" || phase === "over";

    return (
        <>
            {/* One-shot mid-run notice the first time a lent card reaches the board.
                A notification, not a review step: no word table, one dismissal, and
                the field is frozen behind it (§ 6.4). */}
            <HydraLendNotice open={lendNoticeOpen} onDismiss={() => setLendNoticeOpen(false)} />
            <GameLeafPage
            hue={GAME_HUE}
                title="Hydra Bubbles"
                // Back lands where the player came FROM — the challenge mid-test, or
                // the Games hub for an ordinary run.
                onBack={() => navigate(challengeRound.challengeId
                    ? `/friends/challenges/${challengeRound.challengeId}`
                    : "/games")}
                rightContent={
                    <BubbleMatchHeaderControls
                        language={language}
                        showPinyin={showPinyin}
                        onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                        autoplayChinese={autoplayChinese}
                        onToggleAutoplayChinese={() => update({ autoplayChinese: !autoplayChinese })}
                        // Restarting mid-run is just a new run — Hydra has no board
                        // worth preserving, so it shares the Play Again path.
                        // NEVER during a challenge round: one attempt each (§ 5.1a),
                        // and a restart would be a re-roll of a scored round.
                        onRestart={phase === "playing" && !challengeRound.active ? playAgain : undefined}
                    />
                }
            >
                <Box
                    className="hydra__content"
                    sx={{
                        position: "relative",
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        userSelect: "none",
                        WebkitUserSelect: "none",
                        WebkitTouchCallout: "none",
                    }}
                >
                    {showStage ? (
                        <>
                            {/* `.play` — the inset panel the board lives in
                                (docs/SHELF_REDESIGN.md § A6). The stage measures its own
                                container for physics bounds, so moving it inside the
                                panel just re-bounds the field; no constant changed.
                                The two overlays below stay OUTSIDE it, because both cover
                                the whole content area and must not be clipped by the
                                panel's radius. */}
                            <GameFrame className="hydra__frame">
                                <HydraStage
                                    key={runId}
                                    buffers={buffers}
                                    language={language}
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    onSpeak={autoplayChinese && tts.enabled ? tts.speak : undefined}
                                    onScore={setScore}
                                    onGameOver={onGameOver}
                                    onMark={markCard}
                                    paused={framePaused}
                                    onFirstLend={() => setLendNoticeOpen(true)}
                                    // Ends a challenge round on its last contested
                                    // clear; undefined-safe for a free-play run,
                                    // which is endless.
                                    shouldEndRun={challengeRound.active ? shouldEndRun : undefined}
                                />
                            </GameFrame>
                            {popup}
                            <ProvisionalSortOffer
                                open={sortOffer.open}
                                words={lentWords}
                                language={language}
                                onDismiss={sortOffer.dismiss}
                                minimized={sortOffer.minimized}
                                onMinimize={sortOffer.onMinimize}
                                onRestore={sortOffer.onRestore}
                            />
                        </>
                    ) : (
                        centered
                    )}
                </Box>

                {/* Backgrounding paused a CHALLENGE round (the only timed Hydra
                    variant). Covers the board so the pause cannot be used as a free
                    look at it; the clock restarts only on Resume. */}
                <GamePausedOverlay
                    open={backgroundPaused}
                    onResume={resumeFromBackground}
                    classPrefix="hydra"
                />
            </GameLeafPage>
        </>
    );
};

export default HydraBubblesPage;
