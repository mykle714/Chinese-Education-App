import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography, useTheme } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import LeafPage from "../../components/LeafPage";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import type { DictionaryEntry } from "../hooks/useDictionaryEntries";
import WordSearchHeaderControls from "./WordSearchHeader";
import WordSearchWordList from "./WordSearchWordList";
import WordSearchGrid, { type WordSearchGridHandle } from "./WordSearchGrid";
import GameEndPopup from "../runtime/GameEndPopup";
import WordSearchInfoCard, { type InfoCardData } from "./WordSearchInfoCard";
import { GRID_QUERY, TOTAL_WORDS, medalForTime } from "./constants";
import type { PlacedWord, WordSearchResponse } from "./types";

type Phase = "loading" | "blocked" | "playing" | "won";

/** Win-log key for Word Search completions (shared `wins` table). */
const GAME_KEY = "wordSearch";

/** mm:ss from a millisecond duration. */
function formatTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Word Search — page shell + game-flow state machine.
 *
 * Flow: loading → (blocked | playing → won). One relaxed mode: a count-up timer
 * runs from the first interaction until all 20 words are found, and the finish
 * time earns a medal (see docs/WORD_SEARCH_GAME.md §5). Word Search is a LEAF
 * PAGE (down-arrow back → /games, no footer).
 */
const WordSearchPage: React.FC = () => {
    usePageTitle("Word Search");
    const navigate = useNavigate();
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const { token } = useAuth();
    const tts = useTTS();
    const { settings, update } = useFlashcardLearnSettings();
    const { showPinyin, showPinyinColor } = settings;

    // An edge swipe would navigate away mid-drag; block it while mounted.
    useBlockEdgeSwipe(true);

    const [phase, setPhase] = useState<Phase>("loading");
    const [blockMessage, setBlockMessage] = useState("");
    const [data, setData] = useState<WordSearchResponse | null>(null);
    const [found, setFound] = useState<Set<string>>(new Set());
    const [infoCard, setInfoCard] = useState<InfoCardData | null>(null);
    // Timer visibility only — the clock keeps ticking regardless (see HUD below).
    const [showTimer, setShowTimer] = useState(true);
    // Whether the end-of-run popup is collapsed into the corner puck.
    const [popupMinimized, setPopupMinimized] = useState(false);
    const gridRef = useRef<WordSearchGridHandle>(null);

    // Tapping anywhere that isn't a grid cell deselects the in-progress word.
    const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
        if (!(e.target as Element).closest?.('[data-cell="1"]')) {
            gridRef.current?.clearSelection();
        }
    }, []);

    // Count-up timer. Starts on first interaction, freezes on win.
    const [elapsedMs, setElapsedMs] = useState(0);
    const startRef = useRef<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [finalMs, setFinalMs] = useState(0);

    const stopTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    // Fetch a fresh randomized grid. Returns the payload, or null after switching
    // to the blocked phase (insufficient cards / wrong language / network error).
    const fetchGrid = useCallback(async (): Promise<WordSearchResponse | null> => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/onDeck/word-search-grid?${GRID_QUERY}`, {
                credentials: "include",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("Failed to load grid");
            const payload: WordSearchResponse = await res.json();

            if (!payload.sufficient || !payload.grid) {
                if (payload.reason === "language") {
                    setBlockMessage(
                        "Word Search is available for Chinese right now. Switch your study language to Chinese to play."
                    );
                } else {
                    setBlockMessage(
                        `You need at least ${payload.total} Learn Now cards with distinct characters to play Word Search. Study more cards to unlock it.`
                    );
                }
                setPhase("blocked");
                return null;
            }
            // Warm TTS for every target so the found-word narration is instant.
            payload.words.forEach((w) =>
                tts.prefetchSentence(w.entryKey, w.pinyin)
            );
            return payload;
        } catch {
            setBlockMessage("Couldn't load the game. Please try again.");
            setPhase("blocked");
            return null;
        }
        // tts.prefetchSentence is stable; only re-create on auth change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Load a fresh board and drop into play (resetting timer + found state).
    const startBoard = useCallback((payload: WordSearchResponse) => {
        setData(payload);
        setFound(new Set());
        setInfoCard(null);
        setElapsedMs(0);
        setFinalMs(0);
        setPopupMinimized(false);
        startRef.current = null;
        stopTimer();
        setPhase("playing");
    }, [stopTimer]);

    // Initial load on mount.
    useEffect(() => {
        if (!token) {
            setBlockMessage("Sign in to play Word Search.");
            setPhase("blocked");
            return;
        }
        let cancelled = false;
        (async () => {
            const payload = await fetchGrid();
            if (cancelled || !payload) return;
            startBoard(payload);
        })();
        return () => {
            cancelled = true;
        };
    }, [token, fetchGrid, startBoard]);

    // Tick the timer once per second while playing (after the first interaction).
    useEffect(() => {
        return () => stopTimer();
    }, [stopTimer]);

    const handleFirstInteraction = useCallback(() => {
        // Unlock audio inside the real pointer gesture so the first find narrates.
        tts.unlockAudio();
        if (startRef.current !== null) return;
        startRef.current = Date.now();
        timerRef.current = setInterval(() => {
            if (startRef.current !== null) setElapsedMs(Date.now() - startRef.current);
        }, 500);
    }, [tts]);

    // Log one Word Search completion (fire-and-forget), mirroring Bubble Match.
    const recordWin = useCallback(() => {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token && token !== "null" && token !== "undefined") {
            headers["Authorization"] = `Bearer ${token}`;
        }
        fetch(`${API_BASE_URL}/api/users/me/wins`, {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify({ game: GAME_KEY, level: 1 }),
        }).catch((err) => console.error("[WordSearch] win record failed:", err));
    }, [token]);

    const onFound = useCallback((word: PlacedWord) => {
        setInfoCard({
            word: word.entryKey,
            pronunciation: word.pinyin,
            definition: word.definition,
            isTarget: true,
        });
        if (tts.enabled) tts.speakSentence(word.entryKey, word.pinyin);
        setFound((prev) => {
            const next = new Set(prev);
            next.add(word.entryKey);
            return next;
        });
    }, [tts]);

    const onDiscover = useCallback((entry: DictionaryEntry) => {
        setInfoCard({
            word: entry.word1,
            pronunciation: entry.pronunciation,
            definition: entry.definition,
            isTarget: false,
        });
        if (tts.enabled) tts.speakSentence(entry.word1, entry.pronunciation ?? undefined);
    }, [tts]);

    // Win when every target is found. Freeze the timer, capture the final time.
    useEffect(() => {
        if (phase !== "playing" || !data) return;
        if (found.size >= data.words.length && data.words.length > 0) {
            stopTimer();
            const ms = startRef.current ? Date.now() - startRef.current : elapsedMs;
            setFinalMs(ms);
            setPopupMinimized(false);
            recordWin();
            setPhase("won");
        }
    }, [found, phase, data, elapsedMs, stopTimer, recordWin]);

    const playAgain = useCallback(async () => {
        tts.unlockAudio();
        setPhase("loading");
        const payload = await fetchGrid();
        if (!payload) return; // fetchGrid already switched to blocked
        startBoard(payload);
    }, [tts, fetchGrid, startBoard]);

    const renderCentered = (children: React.ReactNode) => (
        <Box
            className="word-search__overlay"
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

    let content: React.ReactNode = null;

    if (phase === "loading") {
        content = renderCentered(<DelayedCircularProgress className="word-search__spinner" />);
    } else if (phase === "blocked") {
        content = renderCentered(
            <>
                <Typography className="word-search__block-msg" sx={{ fontSize: SIZE.subtitle, color: fc.onSurface, lineHeight: LEADING.normal }}>
                    {blockMessage}
                </Typography>
                <Button className="word-search__block-back" variant="contained" onClick={() => navigate("/games")}>
                    Back to Games
                </Button>
            </>
        );
    } else if ((phase === "playing" || phase === "won") && data && data.grid) {
        const medal = medalForTime(Math.floor((phase === "won" ? finalMs : elapsedMs) / 1000));
        content = (
            <Box
                className="word-search__content"
                onPointerDown={handleBackgroundPointerDown}
                sx={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                }}
            >
                {/* HUD row above the glosses: count-up timer flush-left, found
                    count flush-right. The timer's text is hidden when the header's
                    timer toggle is off, but the clock keeps ticking. */}
                <Box
                    className="word-search__hud"
                    sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", px: 1.5, pt: 0.75 }}
                >
                    <Typography
                        className="word-search__hud-timer"
                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b", lineHeight: 1.25 }}
                    >
                        {showTimer ? `⏱ ${formatTime(phase === "won" ? finalMs : elapsedMs)}` : ""}
                    </Typography>
                    <Typography
                        className="word-search__hud-count"
                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b", lineHeight: 1.25 }}
                    >
                        {found.size}/{data.words.length}
                    </Typography>
                </Box>
                <WordSearchWordList words={data.words} found={found} />

                <WordSearchGrid
                    ref={gridRef}
                    grid={data.grid}
                    words={data.words}
                    found={found}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    onFound={onFound}
                    onDiscover={onDiscover}
                    onFirstInteraction={handleFirstInteraction}
                />

                {infoCard && (
                    <WordSearchInfoCard
                        data={infoCard}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        onDismiss={() => setInfoCard(null)}
                    />
                )}

                {phase === "won" && (
                    <GameEndPopup
                        classPrefix="word-search"
                        minimized={popupMinimized}
                        onMinimize={() => setPopupMinimized(true)}
                        onRestore={() => setPopupMinimized(false)}
                    >
                        <Typography className="word-search__win-title" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: fc.onSurface }}>
                            {medal.emoji} All {TOTAL_WORDS} found!
                        </Typography>
                        <Typography className="word-search__win-time" sx={{ fontSize: SIZE.bodyLg, color: fc.textSecondary }}>
                            Time {formatTime(finalMs)} — {medal.medal} medal
                        </Typography>
                        <Box className="word-search__win-actions" sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%", maxWidth: 260 }}>
                            <Button className="word-search__play-again" variant="contained" onClick={playAgain} sx={{ borderRadius: "12px", textTransform: "none", fontWeight: WEIGHT.bold }}>
                                Play Again
                            </Button>
                            <Button className="word-search__back-to-games" variant="outlined" onClick={() => navigate("/games")} sx={{ borderRadius: "12px", textTransform: "none" }}>
                                Back to Games
                            </Button>
                        </Box>
                    </GameEndPopup>
                )}
            </Box>
        );
    }

    return (
        <LeafPage
            title="Word Search"
            onBack={() => navigate("/games")}
            rightContent={
                <WordSearchHeaderControls
                    showPinyin={showPinyin}
                    onTogglePinyin={() => update({ showPinyin: !showPinyin })}
                    showPinyinColor={showPinyinColor}
                    onTogglePinyinColor={() => update({ showPinyinColor: !showPinyinColor })}
                    showTimer={showTimer}
                    onToggleTimer={() => setShowTimer((v) => !v)}
                />
            }
        >
            {content}
        </LeafPage>
    );
};

export default WordSearchPage;
