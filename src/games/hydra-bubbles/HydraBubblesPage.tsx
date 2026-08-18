import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import LeafPage from "../../components/LeafPage";
import BubbleMatchHeaderControls from "../bubble-match/BubbleMatchHeader";
import BubbleMatchEndPopup from "../bubble-match/BubbleMatchEndPopup";
import HydraStage from "./HydraStage";
import { MARK_TYPE, SURFACE } from "./constants";
import type { HydraOutcome, HydraPhase } from "./types";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { useColorBuffers } from "./useColorBuffers";
import HydraLendNotice from "./HydraLendNotice";

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
    const buffers = useColorBuffers(collectionSuffix, restricted);

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
        let cancelled = false;
        (async () => {
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
    }, [user?.id]);

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
    }, []);

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
        // No `token` dep — markFlashcard reads the header at call time, so this
        // callback's identity is stable across a silent refresh (CLAUDE.md ⛔ rule).
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
    // ⚠️ THIS MUST COME BACK WITH CHALLENGE MODE. A challenge round is scored on
    // TIME TO CLEAR (§ 7.5), which makes that variant genuinely timed and puts it
    // squarely back under the rule. Re-add `useBackgroundPause(challenge && phase ===
    // "playing")` plus the overlay when the challenge flow is wired to this page —
    // and note the hook's own warning that the pause is only real if elapsed time is
    // accumulated ACTIVE time, not `now − startedAt`.
    const framePaused = lendNoticeOpen;

    // End-of-run offer to keep the lent cards, a beat after the score card.
    const lentWords = buffers.lentDrawn().map((card) => card.entryKey);
    const sortOffer = useProvisionalSortOffer(phase === "over", lentWords);

    const renderCentered = (children: React.ReactNode) => (
        <Box
            className="hydra__overlay"
            sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2.5,
                px: 4,
                pb: 3,
                textAlign: "center",
            }}
        >
            {children}
        </Box>
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
                    sx={{ fontSize: SIZE.subtitle, color: fc.onSurface, lineHeight: LEADING.normal }}
                >
                    {blockMessage}
                </Typography>
                <Button className="hydra__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
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
                        ? "The board filled up. Clear more yellows and reds to hold it back."
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
            <LeafPage
                title="Hydra Bubbles"
                onBack={() => navigate("/games")}
                rightContent={
                    <BubbleMatchHeaderControls
                        language={language}
                        showPinyin={showPinyin}
                        onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                        autoplayChinese={autoplayChinese}
                        onToggleAutoplayChinese={() => update({ autoplayChinese: !autoplayChinese })}
                        // Restarting mid-run is just a new run — Hydra has no board
                        // worth preserving, so it shares the Play Again path.
                        onRestart={phase === "playing" ? playAgain : undefined}
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
                            />
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

            </LeafPage>
        </>
    );
};

export default HydraBubblesPage;
