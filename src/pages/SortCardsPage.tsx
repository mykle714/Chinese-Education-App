import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, IconButton, Button } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import MobileDemoHeader from "../components/MobileDemoHeader";
import MinutePointsFireBadge from "../components/MinutePointsFireBadge";
import ForeignText from "../components/ForeignText";
import PosBadge from "../components/PosBadge";
import { API_BASE_URL } from "../constants";
import { stripParentheses } from "../utils/definitionUtils";
import type { Language, DiscoverCard, DiscoverFetchResponse, DiscoverSortResponse } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuth } from "../AuthContext";
import { useTTS } from "../hooks/useTTS";
import { useDiscoverSettings } from "../hooks/useDiscoverSettings";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// Per-language encoding of the integer difficulty level carried in
// DiscoverCard.difficulty. Both languages use the adaptive band; they differ only in
// how the level is stored and its ceiling (mirrors _levelConfig in
// StarterPacksService):
//   - zh: "HSK1".."HSK6" (HSK proficiency, ceiling 6)
//   - es: "1".."5"       (learner-acquisition difficulty, ceiling 5)
const LEVEL_CONFIG: Record<string, { max: number; parse: (label: string | null | undefined) => number | null }> = {
    zh: { max: 6, parse: (l) => { const m = l?.match(/^HSK([1-6])$/); return m ? Number(m[1]) : null; } },
    es: { max: 5, parse: (l) => { const m = l?.match(/^([1-5])$/); return m ? Number(m[1]) : null; } },
};

// Languages whose discover flow is leveled by an adaptive difficulty band. A
// language not listed here uses an unfiltered flow — the client must NOT apply the
// band filter (its cards have no level and would otherwise all be filtered out).
const DIFFICULTY_LEVELED_LANGUAGES = new Set<string>(Object.keys(LEVEL_CONFIG));
const isDifficultyLeveledLanguage = (lang?: string): boolean => !!lang && DIFFICULTY_LEVELED_LANGUAGES.has(lang);

// Parse a card's stored level using the language's encoding; null when missing,
// malformed, or the language isn't leveled.
function parseDifficultyLevel(label: string | null | undefined, language?: string): number | null {
    const cfg = language ? LEVEL_CONFIG[language] : undefined;
    return cfg ? cfg.parse(label) : null;
}

// The difficulty ceiling for a language (used to clamp the upper band edge).
// Falls back to 6 so non-leveled callers behave as before.
function maxLevelFor(language?: string): number {
    return (language && LEVEL_CONFIG[language]?.max) || 6;
}

// Styled Components — phone-frame sizing comes from MobileDemoFrame via Layout.tsx

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0, // allow flex item to shrink below content size
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
    // Disable text selection: the card is drag-to-sort, so selecting the
    // bucket labels / card text mid-drag is never intended and looks broken.
    userSelect: "none",
    WebkitUserSelect: "none",
    // Block native pan/scroll so dragging on the background/empty area doesn't
    // fight the card drag gesture (browser default would try to scroll the page).
    touchAction: "none",
});

// CSS grid distributes the 3 buckets evenly in a single row regardless of viewport height
const BucketsContainer = styled(Box)({
    width: "100%",
    flex: "1 1 0", // flex-basis: 0 gives grid a definite height so the 1fr row resolves correctly
    minHeight: 0, // allow flex to shrink below grid content size on small screens
    maxHeight: 208, // 1 × 200px bucket + 8px paddingBlock
    paddingBlock: "4px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gridTemplateRows: "1fr",
    columnGap: "12px",
    justifyItems: "center",
});

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; highlight?: boolean }>(
    ({ mainColor, accentColor, highlight }) => ({
        aspectRatio: "136 / 200",
        width: "100%", // fill the 1fr grid column; aspect-ratio then drives height
        maxHeight: "100%", // guard against short rows where ratio would overflow vertically
        minWidth: 0, // override grid item default (auto) so bucket shrinks with 1fr columns
        padding: 8,
        backgroundColor: mainColor,
        borderRadius: 12,
        boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        opacity: highlight ? 0.9 : 0.23,
        transition: "opacity 0.2s ease-in-out, transform 0.2s ease-in-out",
        transform: highlight ? "scale(1.05)" : "scale(1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& .bucket-inner": {
            width: "100%",
            height: "100%",
            backgroundColor: accentColor,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
        },
        "& .bucket-text": {
            fontSize: SIZE.caption,
            fontWeight: WEIGHT.regular,
            lineHeight: LEADING.tight,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: FONTS.sans,
            letterSpacing: TRACKING.caps,
        },
    })
);

const OnDeckSection = styled(Box)({
    width: "100%",
    flex: 1,
    minHeight: 0, // allow flex to shrink below card content size on small screens
    paddingBlock: "4px",
    position: "relative",
    backgroundColor: COLORS.header,
    borderTop: `2px dashed ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});

const AnimatedBox = animated(Box);

const FlashCard = styled(AnimatedBox)({
    aspectRatio: "136 / 200",
    height: 200,
    maxHeight: "calc(100% - 16px)", // scale down on small screens (8px margin each side)
    backgroundColor: COLORS.card,
    borderRadius: 12,
    boxShadow: "2px 4px 4px rgba(0, 0, 0, 0.25)",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    cursor: "grab",
    touchAction: "none",
    zIndex: 1000,
    "&:active": {
        cursor: "grabbing",
    },
});

interface BucketZone {
    id: string;
    label: string;
    mainColor: string;
    accentColor: string;
}

const SortCardsPage: React.FC = () => {
    usePageTitle("Discover");
    const navigate = useNavigate();
    const { token } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const tts = useTTS();
    const { settings: discoverSettings, update: updateDiscoverSettings } = useDiscoverSettings();
    // Primes the cloud provider's <audio> element for autoplay exactly once per
    // session, on the first drag gesture. Mobile autoplay policy rejects a
    // programmatic play() that isn't tied to a user gesture, so the on-deck
    // autoplay effect (which runs on card change, not on a tap) needs this unlock.
    const audioUnlockedRef = useRef(false);
    // `cardQueue` is the append-only master list of every card we've fetched.
    // `currentCardIndex` advances through it. We never replace `cardQueue` so the
    // currently displayed card (and undo history) survive mid-session refetches.
    const [cardQueue, setCardQueue] = useState<DiscoverCard[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [userDifficultyLevel, setUserDifficultyLevel] = useState<number | null>(null);
    // provisionalMode: true when user has <3 Unfamiliar cards; narrows filter to difficulty+1 only
    const [provisionalMode, setProvisionalMode] = useState<boolean>(false);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    // History entries snapshot the band state (userDifficultyLevel, provisionalMode) at sort time
    // so undo can restore the same band the card was sorted under. Without this, undo would
    // restore currentCardIndex but the head-skip effect would immediately re-skip the card
    // when the current band excludes it (e.g. after a rank-up or in provisional mode).
    const [history, setHistory] = useState<Array<{
        card: DiscoverCard;
        bucket: string;
        prevUserDifficultyLevel: number | null;
        prevProvisionalMode: boolean;
    }>>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    // Set to true when a load-more fetch returns 0 new unique cards — stops infinite retries.
    // Cleared whenever new cards actually arrive so sorting can resume if state changes.
    const [loadMoreExhausted, setLoadMoreExhausted] = useState(false);

    // Refs for DOM-based collision detection — CSS grid owns the layout, we read positions on drag
    const bucketsRef = useRef<HTMLDivElement>(null);
    const onDeckRef = useRef<HTMLDivElement>(null);
    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "skip", label: "Skip for now", mainColor: COLORS.greenMain, accentColor: COLORS.greenAccent },
        { id: "library", label: "Add to\nLearn Now", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
    ], []);

    const [{ x, y, scale, opacity }, api] = useSpring(() => ({
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
    }));

    // Fetch starter pack cards (initial load)
    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    credentials: "include",
                });
                if (response.ok) {
                    const data: DiscoverFetchResponse = await response.json();
                    setCardQueue(data.cards);
                    setUserDifficultyLevel(data.userDifficultyLevel);
                    setProvisionalMode(data.provisionalMode);
                } else {
                    console.error("Failed to fetch starter pack cards");
                }
            } catch (error) {
                console.error("Error fetching cards:", error);
            } finally {
                setLoading(false);
            }
        };

        if (language) {
            fetchCards();
        }
        // token is included so the initial load re-runs once auth resolves and a
        // token becomes available (the request sends the Authorization header).
    }, [language, token]);

    // Build the visible queue: the currently displayed card is "frozen" at the
    // head and is never filtered out — even if a fresh server response shifts
    // userDifficultyLevel mid-session, we don't want to yank the active card off-screen.
    // Normal mode: tail filtered to [userLevel, userLevel + 1].
    // Provisional mode (<3 Unfamiliar cards): tail filtered to only difficulty+1.
    const visibleQueue = useMemo<DiscoverCard[]>(() => {
        const head = cardQueue[currentCardIndex];
        // Non-leveled languages: no band filter — show every card from the current
        // index in the server-provided id order.
        if (!isDifficultyLeveledLanguage(language) || userDifficultyLevel == null) {
            // No level known yet, or this language isn't difficulty-leveled — show everything.
            return cardQueue.slice(currentCardIndex);
        }
        const targetLevel = Math.min(maxLevelFor(language), userDifficultyLevel + 1);
        const tail = cardQueue
            .slice(currentCardIndex + 1)
            .filter((c) => {
                const lvl = parseDifficultyLevel(c.difficulty, language);
                if (lvl == null) return false;
                if (provisionalMode) {
                    // Provisional: show only cards at exactly targetLevel (userDifficultyLevel+1).
                    return lvl === targetLevel;
                }
                // Normal: show [userDifficultyLevel, userDifficultyLevel+1]
                const min = Math.max(1, userDifficultyLevel);
                return lvl >= min && lvl <= targetLevel;
            });
        return head ? [head, ...tail] : tail;
    }, [cardQueue, currentCardIndex, userDifficultyLevel, provisionalMode, language]);

    const currentCard = visibleQueue[0];

    // TTS narration: auto-play the on-deck word each time a new card reaches the
    // head position. Keyed on the card id so re-renders (drag, highlight, band
    // changes) don't re-fire narration for the same card. Gated by both the
    // Discover autoplay toggle and the global TTS enable flag.
    useEffect(() => {
        if (!tts.enabled || !discoverSettings.autoplay) return;
        if (!currentCard) return;
        tts.speakSentence(currentCard.entryKey, currentCard.pronunciation ?? undefined);
        // Cancel narration if the user sorts/advances mid-utterance.
        return () => tts.cancel();
        // tts.speakSentence/cancel are stable across renders; depending on them
        // would re-fire narration on every settings change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCard?.id, tts.enabled, discoverSettings.autoplay]);

    // Animate card entrance when the active card changes
    useEffect(() => {
        if (currentCard) {
            // Reset to starting position below, invisible
            api.set({ x: 0, y: 50, scale: 1, opacity: 0 });
            // Animate in (slide up + fade in)
            api.start({
                y: 0,
                opacity: 1,
                config: { tension: 280, friction: 26 },
            });
        }
    }, [currentCard, api]);

    // Diagnostic: log the displayed card + current difficulty level whenever either changes
    useEffect(() => {
        if (currentCard) {
            const targetLevel = userDifficultyLevel != null ? Math.min(maxLevelFor(language), userDifficultyLevel + 1) : null;
            const bandMin = provisionalMode ? targetLevel : (userDifficultyLevel != null ? Math.max(1, userDifficultyLevel) : null);
            const bandMax = targetLevel;
            console.log(
                "[Discover] displaying card:",
                currentCard.entryKey,
                currentCard.difficulty,
                "| userDifficultyLevel:",
                userDifficultyLevel,
                "| provisionalMode:",
                provisionalMode,
                "| band:",
                bandMin != null ? `${bandMin}–${bandMax}` : "unfiltered"
            );
        }
    }, [currentCard, userDifficultyLevel, provisionalMode, language]);

    // Head-skip effect: advance past any out-of-band card at the head position.
    // Runs on cardQueue changes (initial load, load-more) and on band changes
    // (userDifficultyLevel / provisionalMode updates from the server) so that a
    // mid-session rank-up updates the displayed card to match the new band.
    // Only applies to difficulty-leveled languages; non-leveled flows have no band to skip.
    useEffect(() => {
        if (!isDifficultyLeveledLanguage(language) || userDifficultyLevel == null || cardQueue.length === 0) return;
        const head = cardQueue[currentCardIndex];
        if (!head) return; // index is past end; waiting for more cards
        const lvl = parseDifficultyLevel(head.difficulty, language);
        if (lvl == null) return;
        const targetLevel = Math.min(maxLevelFor(language), userDifficultyLevel + 1);
        const min = provisionalMode ? targetLevel : Math.max(1, userDifficultyLevel);
        if (lvl >= min && lvl <= targetLevel) return; // head is in-band, nothing to do
        let next = currentCardIndex + 1;
        while (next < cardQueue.length) {
            const nextLvl = parseDifficultyLevel(cardQueue[next].difficulty, language);
            if (nextLvl != null && nextLvl >= min && nextLvl <= targetLevel) break;
            next++;
        }
        if (next !== currentCardIndex) setCurrentCardIndex(next);
    }, [cardQueue, currentCardIndex, userDifficultyLevel, provisionalMode, language]);

    // Reset exhausted flag when the difficulty band changes — the server may have
    // cards in the new band even though the previous band was exhausted.
    useEffect(() => {
        setLoadMoreExhausted(false);
    }, [userDifficultyLevel, provisionalMode]);

    // Load more cards when ≤5 remain in the client-filtered visible queue
    useEffect(() => {
        console.log("[LoadMore] effect fired — visibleQueue:", visibleQueue.length, "cardQueue:", cardQueue.length, "isLoadingMore:", isLoadingMore, "exhausted:", loadMoreExhausted);
        if (visibleQueue.length <= 5 && cardQueue.length > 0 && !isLoadingMore && !loadMoreExhausted) {
            console.log("[LoadMore] → calling loadMoreCards()");
            loadMoreCards();
        }
    // loadMoreCards is intentionally excluded — the trigger conditions (visible queue size,
    // loading state, exhaustion) are already in deps. Wrapping it in useCallback would
    // require its own deep dep list (cardQueue, currentCardIndex, language) and cause excess re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleQueue.length, cardQueue.length, isLoadingMore, loadMoreExhausted]);

    // Check if the dragged card's center overlaps a bucket using actual DOM positions
    const checkBucketCollision = (ox: number, oy: number): string | null => {
        const onDeckEl = onDeckRef.current;
        if (!onDeckEl) return null;
        const onDeckRect = onDeckEl.getBoundingClientRect();

        // Card rests at center of OnDeckSection (via inset + margin:auto); drag offsets move it
        const cardCenterX = onDeckRect.left + onDeckRect.width / 2 + ox;
        const cardCenterY = onDeckRect.top + onDeckRect.height / 2 + oy;

        for (const [id, el] of bucketRefs.current) {
            // Guard: el could be null if the bucket unmounted between render and drag
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (
                cardCenterX >= rect.left &&
                cardCenterX <= rect.right &&
                cardCenterY >= rect.top &&
                cardCenterY <= rect.bottom
            ) {
                return id;
            }
        }
        return null;
    };

    // Handle card sorting
    const handleCardSort = async (bucketId: string) => {
        if (!currentCard) return;

        const sortedCard = currentCard;
        console.log(`[Sort] "${sortedCard.entryKey}" → ${bucketId}`);

        // Animate card exit (fade out + shrink). We await only the local
        // animation — the server POST is fire-and-forget so the user never
        // waits on the network to see the next card.
        await api.start({
            opacity: 0,
            scale: 0.8,
            config: { tension: 150, friction: 35 },
        });

        // Add to history for undo. Snapshot the band state *as of sort start* so undo
        // can restore it before the head-skip effect runs against the restored index.
        // Bounded to 1: only the most recent sort is undoable.
        setHistory([{
            card: sortedCard,
            bucket: bucketId,
            prevUserDifficultyLevel: userDifficultyLevel,
            prevProvisionalMode: provisionalMode,
        }]);

        // Advance past any out-of-band cards in cardQueue so the next active
        // card honors the current [userLevel, userLevel + 1] filter. If we run
        // off the end, the refetch effect (visibleQueue.length <= 5) will load more.
        // Non-leveled languages have no band — and their cards have difficulty=null,
        // which would make the band while-loop skip to the end of the queue every
        // sort (draining visibleQueue → a loadMore per card). So advance by exactly
        // one for them (guarded by isDifficultyLeveledLanguage below).
        setCurrentCardIndex((prev) => {
            if (!isDifficultyLeveledLanguage(language) || userDifficultyLevel == null) return prev + 1;
            const targetLevel = Math.min(maxLevelFor(language), userDifficultyLevel + 1);
            const min = provisionalMode ? targetLevel : Math.max(1, userDifficultyLevel);
            let next = prev + 1;
            while (next < cardQueue.length) {
                const lvl = parseDifficultyLevel(cardQueue[next].difficulty, language);
                if (lvl != null && lvl >= min && lvl <= targetLevel) break;
                next++;
            }
            return next;
        });

        // Fire-and-forget POST. When it returns we update userDifficultyLevel; the
        // useMemo recomputes visibleQueue against the new level on next render,
        // but the currently displayed card stays put (frozen head).
        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({
                    cardId: sortedCard.id,
                    bucket: bucketId,
                    language,
                }),
            });
            if (response.ok) {
                const data: DiscoverSortResponse = await response.json();
                if (typeof data.userDifficultyLevel === "number") {
                    setUserDifficultyLevel(data.userDifficultyLevel);
                }
                if (typeof data.provisionalMode === "boolean") {
                    setProvisionalMode(data.provisionalMode);
                }
            }
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    };

    // Undo last action — restore the just-sorted card. Because handleCardSort
    // may skip multiple out-of-band indices, we look up the card's actual
    // index in cardQueue rather than naively decrementing.
    const handleUndo = async () => {
        if (history.length === 0) return;

        const lastAction = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));

        // Restore the band state *before* the index so the head-skip effect, when it
        // runs in response to the index change, evaluates the restored card against
        // the same band it was originally sorted under.
        setUserDifficultyLevel(lastAction.prevUserDifficultyLevel);
        setProvisionalMode(lastAction.prevProvisionalMode);

        const restoredIndex = cardQueue.findIndex((c) => c.id === lastAction.card.id);
        if (restoredIndex >= 0) {
            setCurrentCardIndex(restoredIndex);
        } else {
            // Fallback (shouldn't normally happen since we never remove from cardQueue)
            setCurrentCardIndex((prev) => Math.max(0, prev - 1));
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({
                    cardId: lastAction.card.id,
                    language,
                }),
            });
            // Sync with server-recomputed band (post-rollback) once it returns.
            if (response.ok) {
                const data: Partial<DiscoverSortResponse> = await response.json();
                if (typeof data.userDifficultyLevel === "number") {
                    setUserDifficultyLevel(data.userDifficultyLevel);
                }
                if (typeof data.provisionalMode === "boolean") {
                    setProvisionalMode(data.provisionalMode);
                }
            }
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    };

    // Fetch the next batch of unsorted cards, telling the server which card IDs
    // the client already holds so they are excluded from the result. This
    // guarantees every card in the response is genuinely new to the client.
    const loadMoreCards = async () => {
        if (isLoadingMore) return;
        setIsLoadingMore(true);
        console.log("[LoadMore] fetching with excludeIds count:", cardQueue.length);
        try {
            // Only exclude cards from currentCardIndex onward — these are still
            // in the visible pipeline. Cards before the index were either sorted
            // (server excludes via vocabentries) or skipped by the head-skip effect
            // (we WANT the server to return those since the band may have changed).
            const excludeIds = cardQueue.slice(currentCardIndex).map((c) => c.id);
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}/more`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                credentials: "include",
                body: JSON.stringify({ excludeIds }),
            });
            console.log("[LoadMore] response status:", response.status);
            if (response.ok) {
                const data: DiscoverFetchResponse = await response.json();
                console.log("[LoadMore] received", data.cards.length, "new cards");
                if (data.cards.length > 0) {
                    setCardQueue((prev) => [...prev, ...data.cards]);
                    setLoadMoreExhausted(false);
                } else {
                    console.log("[LoadMore] server returned 0 cards — marking exhausted");
                    setLoadMoreExhausted(true); // server truly has nothing left
                }
                if (typeof data.userDifficultyLevel === "number") {
                    setUserDifficultyLevel(data.userDifficultyLevel);
                }
                if (typeof data.provisionalMode === "boolean") {
                    setProvisionalMode(data.provisionalMode);
                }
            }
        } catch (error) {
            console.error("Error loading more cards:", error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Drag gesture handler
    const bind = useDrag(
        ({ down, offset: [ox, oy] }) => {
            // First touch of a drag is a genuine user gesture — use it to unlock
            // mobile autoplay so the next card's narration isn't blocked.
            if (down && !audioUnlockedRef.current) {
                audioUnlockedRef.current = true;
                tts.unlockAudio();
            }
            api.start({
                x: down ? ox : 0,
                y: down ? oy : 0,
                scale: down ? 1.1 : 1,
                immediate: down,
            });

            const bucketId = checkBucketCollision(ox, oy);
            if (down) {
                setHighlightedBucket(bucketId);
            } else {
                setHighlightedBucket(null);
                if (bucketId) handleCardSort(bucketId);
            }
        },
        {
            from: () => [x.get(), y.get()],
            // Read actual container dimensions from the DOM at gesture start
            bounds: () => {
                const bucketsRect = bucketsRef.current?.getBoundingClientRect();
                const onDeckRect = onDeckRef.current?.getBoundingClientRect();
                if (!bucketsRect || !onDeckRect) return {};
                // Offsets are relative to card's rest position (center of OnDeck)
                const restCenterY = onDeckRect.top + onDeckRect.height / 2;
                return {
                    left: -(onDeckRect.width / 2 - 40),
                    right: onDeckRect.width / 2 - 40,
                    top: bucketsRect.top - restCenterY,
                    bottom: onDeckRect.bottom - restCenterY,
                };
            },
        }
    );

    if (loading) {
        return (
            <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100dvh" }}>
                <DelayedCircularProgress className="sort-cards__spinner" />
            </Box>
        );
    }

    if (!currentCard) {
        return (
            <>
                <MobileDemoHeader
                    title="Sort Cards"
                    showBack
                    onBack={() => navigate("/discover")}
                    extraActions={<MinutePointsFireBadge />}
                />
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__all-sorted" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <Typography className="sort-cards__all-sorted-text">All cards sorted! 🎉</Typography>
                    </Box>
                </ContentArea>
            </>
        );
    }

    return (
        <>
            {/* Header */}
            <MobileDemoHeader
                title="Sort Cards"
                showBack
                onBack={() => navigate("/discover")}
                extraActions={
                    <>
                        {/* Autoplay toggle — same "autoplay" text label flp uses
                            (FlashcardsLearnHeader), styled to the Discover header palette. */}
                        <Button
                            className="sort-cards__autoplay-toggle"
                            variant={discoverSettings.autoplay ? "contained" : "text"}
                            size="small"
                            onClick={() => updateDiscoverSettings({ autoplay: !discoverSettings.autoplay })}
                            aria-pressed={discoverSettings.autoplay}
                            sx={{
                                minWidth: "unset",
                                px: 1,
                                py: 0.25,
                                height: "30px",
                                fontSize: SIZE.micro,
                                textTransform: "lowercase",
                                lineHeight: LEADING.normal,
                                borderRadius: "6px",
                                color: COLORS.onSurface,
                                backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                                "&:hover": {
                                    backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                                },
                            }}
                        >
                            autoplay
                        </Button>
                        <IconButton
                            className="sort-cards__undo-button"
                            onClick={handleUndo}
                            size="small"
                            disabled={history.length === 0}
                            sx={{ color: "#1C1C1E" }}
                        >
                            <UndoIcon className="sort-cards__undo-icon" />
                        </IconButton>
                        <MinutePointsFireBadge />
                    </>
                }
            />

            {/* Content Area */}
            <ContentArea className="sort-cards__content">
                {/* Buckets — CSS grid owns placement, no JS position math needed */}
                <BucketsContainer className="sort-cards__buckets-container" ref={bucketsRef}>
                    {buckets.map((bucket) => (
                        <Bucket
                            className="sort-cards__bucket"
                            key={bucket.id}
                            ref={(el: HTMLElement | null) => {
                                if (el) bucketRefs.current.set(bucket.id, el);
                                else bucketRefs.current.delete(bucket.id);
                            }}
                            mainColor={bucket.mainColor}
                            accentColor={bucket.accentColor}
                            highlight={highlightedBucket === bucket.id}
                        >
                            <div className="bucket-inner">
                                <div className="bucket-text">{bucket.label}</div>
                            </div>
                        </Bucket>
                    ))}
                </BucketsContainer>

                {/* On Deck Section with Draggable Card */}
                <OnDeckSection className="sort-cards__on-deck" ref={onDeckRef}>
                    <FlashCard
                        className="sort-cards__flash-card"
                        {...bind()}
                        style={{
                            x,
                            y,
                            scale,
                            opacity,
                            position: "absolute",
                            inset: 0,
                            margin: "auto",
                        }}
                    >
                        {/* Characters + pronunciation centered in the middle, rendered per-character via cpcd */}
                        <Box className="sort-cards__card-key-group" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <ForeignText
                                size="sm"
                                className="sort-cards__card-key"
                                text={currentCard.entryKey}
                                pronunciation={currentCard.pronunciation}
                            />
                            {/* "(v)"/"(n)" badge for Spanish words with multiple discoverable POS */}
                            <PosBadge pos={currentCard.pos} hasMultiplePos={currentCard.hasMultiplePos} />
                        </Box>
                        {/* Definition pinned to the bottom of the card; clamped to 2 lines to prevent overflow */}
                        <Typography
                            className="sort-cards__card-value"
                            sx={{
                                fontSize: SIZE.caption,
                                fontWeight: WEIGHT.regular,
                                textAlign: "center",
                                width: "100%",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {stripParentheses(currentCard.definition)}
                        </Typography>
                    </FlashCard>
                </OnDeckSection>
            </ContentArea>
        </>
    );
};

export default SortCardsPage;
