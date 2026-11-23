import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { navigateBackOr } from "../../utils/navigateBack";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { HeaderIconButton } from "../../components/PageHeader";
import ForeignText from "../../components/ForeignText";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { SAFE_BOTTOM } from "../../theme/safeArea";
import {
    exchangeSentenceTiles,
    fetchSentenceTilesGame,
    playSentenceTiles,
    sentenceTilesErrorMessage,
    sentenceTilesSimpleMove,
    type SentenceTilesSimpleMove,
} from "../../api/sentenceTiles";
import {
    SENTENCE_TILES_DAILY_JUDGE_LIMIT,
    SENTENCE_TILES_MAX_REJECTED_PER_TURN,
    SENTENCE_TILES_RACK_SIZE,
} from "../../../server/contracts/sentenceTiles";
import type {
    SentenceTilesBoardTile,
    SentenceTilesDirection,
    SentenceTilesGameView,
    SentenceTilesMoveResponse,
} from "../../../server/contracts/sentenceTiles";
import SentenceTilesBoard, { type BoardCell, type PendingTile, type SentenceTilesBoardHandle } from "./SentenceTilesBoard";
import DraggableRackTile from "./DraggableRackTile";
import SentenceTilesMoveLog from "./SentenceTilesMoveLog";
import { useGameHeartbeat } from "./useGameHeartbeat";
import { TILES_HUE, TILE_WALL_ALLOWANCE_PX, mutedTextSx, pillButtonSx, playerName } from "./sentenceTilesStyles";

/**
 * SentenceTilesGamePage — `/sentence-tiles/:gameId`, one game (docs/SENTENCE_TILES_GAME.md § "Pages").
 *
 * A FOOTERLESS node page (NodePage `footerless`: content runs to the screen's bottom edge; the
 * page's scrollbar is hidden). The header carries Pass and the forfeit action (Resign /
 * Decline / Withdraw by state; a second tap confirms). Top to bottom: the two scores centred
 * either side of a divider, a short state line (only when there is a state to name: waiting,
 * challenged, over) and the judge's last verdict, the board, the info strip for the tapped
 * word, the rack, Play / Recall / Swap, the move log, and the quota line at the bottom.
 *
 * ── Placing tiles ──
 * DRAG a rack tile onto an empty square (DraggableRackTile, acp's pickup look); the board
 * lights the square under it. A tap still works as a fallback: tap a rack tile to select it,
 * then tap an empty square. Tap a tile you placed this turn to take it back. Tap any other tile
 * to see its pinyin and meaning. Nothing reaches the server until **Play**: the server
 * rebuilds the line from tile ids and judges it. The line direction is inferred from the
 * placed tiles (see inferDirection).
 *
 * ── Updates ──
 * The game loads once, then useGameHeartbeat asks every 10 s (visible tab only) whether it
 * changed; the server answers 204 when not. A move's own response carries the new state.
 *
 * Load effect keys on `user?.id` + the game id, never `token` (CLAUDE.md ⛔ rule).
 *
 * Layer: feature page. Data: src/api/sentenceTiles.ts → /api/sentenceTiles/games/:id/*.
 */

const CELL_PX = 48;
/** Largest rack tile, px; narrower screens shrink it so the rack always fits RACK_ROWS rows. */
const RACK_TILE_MAX_PX = 50;
const RACK_ROWS = 2;
/** Space between rack tiles beyond each tile's wall, px. */
const RACK_GAP_PX = 6;

type Banner = { tone: "good" | "bad" | "info"; text: string };

function SentenceTilesGamePage() {
    const navigate = useNavigate();
    // Back returns to the games list (or wherever the game was opened from); a game opened as
    // the first history entry (a deep link) falls back to the list. docs/BACK_NAVIGATION.md.
    const goBack = useCallback(() => navigateBackOr(navigate, "/sentence-tiles"), [navigate]);
    usePageTitle("Sentence Tiles");
    useBlockEdgeSwipe(true);
    const { gameId } = useParams<{ gameId: string }>();
    const { user } = useAuth();

    const [game, setGame] = useState<SentenceTilesGameView | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pending, setPending] = useState<PendingTile[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [exchanging, setExchanging] = useState(false);
    const [exchangeIds, setExchangeIds] = useState<Set<number>>(new Set());

    // Rack tile size from the rack's live width: a full rack (SENTENCE_TILES_RACK_SIZE) must
    // fit in RACK_ROWS rows, so the per-row count is fixed and the tile shrinks to fit it.
    // A callback ref, because the rack mounts only once the game is live.
    const [rackWidth, setRackWidth] = useState(0);
    const rackObserver = useRef<ResizeObserver | null>(null);
    const rackRef = useCallback((el: HTMLDivElement | null) => {
        rackObserver.current?.disconnect();
        rackObserver.current = null;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setRackWidth(entry.contentRect.width));
        ro.observe(el);
        rackObserver.current = ro;
    }, []);
    const perRow = Math.ceil(SENTENCE_TILES_RACK_SIZE / RACK_ROWS);
    const rackTilePx = rackWidth > 0
        ? Math.min(RACK_TILE_MAX_PX, Math.floor((rackWidth - (perRow - 1) * (RACK_GAP_PX + TILE_WALL_ALLOWANCE_PX) - TILE_WALL_ALLOWANCE_PX) / perRow))
        : RACK_TILE_MAX_PX;
    const [infoWord, setInfoWord] = useState<string | null>(null);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState<SentenceTilesSimpleMove | null>(null);

    useEffect(() => {
        if (!user?.id || !gameId) return;
        let cancelled = false;
        fetchSentenceTilesGame(gameId)
            .then((g) => { if (!cancelled) { setGame(g); setLoadError(null); } })
            .catch((err) => {
                if (cancelled) return;
                console.error("SentenceTilesGamePage: failed to load game", err);
                setLoadError(sentenceTilesErrorMessage(err, "Couldn't load this game."));
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity, not `token` (CLAUDE.md ⛔ rule).
    }, [user?.id, gameId]);

    /** Adopt a newer game state, dropping any unsent placement it invalidates. */
    const adopt = useCallback((next: SentenceTilesGameView) => {
        setGame(next);
        const rackIds = new Set(next.rack.map((t) => t.id));
        const taken = new Set(next.board.map((t) => `${t.row},${t.col}`));
        setPending((prev) => (next.isYourTurn ? prev.filter((p) => rackIds.has(p.tileId) && !taken.has(`${p.row},${p.col}`)) : []));
        setSelectedId((id) => (id !== null && rackIds.has(id) ? id : null));
    }, []);

    const live = game ? ["draft", "pending", "active"].includes(game.status) : false;
    useGameHeartbeat(game?.id, game?.version, live, busy, (next) => {
        adopt(next);
        if (next.isYourTurn) setBanner({ tone: "info", text: lastMoveSummary(next) ?? "Your turn." });
    });

    const pendingIds = useMemo(() => new Set(pending.map((p) => p.tileId)), [pending]);
    // The rack keeps every tile's SLOT: a tile placed this turn leaves an empty spot rather than
    // letting its neighbours close up. The server refills slots in place after a play or swap
    // (server/services/sentenceTiles/bag.ts → refillInPlace), so kept tiles never move.
    const rack = game?.rack ?? [];
    const lastPlayTurn = useMemo(() => {
        const plays = (game?.moves ?? []).filter((m) => m.kind === "play");
        return plays.length ? plays[plays.length - 1].turnNumber : 0;
    }, [game]);

    const canMove = !!game && live && game.isYourTurn && !busy;

    const onCellTap = useCallback((row: number, col: number) => {
        if (!game) return;
        const mine = pending.find((p) => p.row === row && p.col === col);
        if (mine) { // take it back
            setPending((prev) => prev.filter((p) => p !== mine));
            return;
        }
        const onBoard = game.board.find((t) => t.row === row && t.col === col);
        if (onBoard) { setInfoWord(onBoard.word); return; }
        if (!canMove || exchanging || selectedId === null) return;
        const tile = game.rack.find((t) => t.id === selectedId);
        if (!tile) return;
        setPending((prev) => [...prev, { tileId: tile.id, word: tile.word, row, col }]);
        setSelectedId(null);
    }, [game, pending, canMove, exchanging, selectedId]);

    // ── Drag and drop ──
    // The drag callbacks must stay referentially stable for the whole gesture (DraggableRackTile
    // is memoized so a mid-drag page re-render can't disturb it), so they read the live game
    // state through a ref instead of closing over it.
    const boardRef = useRef<SentenceTilesBoardHandle>(null);
    const dropStateRef = useRef({ game, pending, canMove, exchanging });
    dropStateRef.current = { game, pending, canMove, exchanging };

    /** The free square under a viewport point, if a tile may be dropped there now. */
    const dropTargetAt = useCallback((clientX: number, clientY: number): BoardCell | null => {
        const { game: g, pending: p, canMove: can, exchanging: ex } = dropStateRef.current;
        if (!g || !can || ex) return null;
        const cell = boardRef.current?.cellAt(clientX, clientY) ?? null;
        if (!cell) return null;
        const taken = g.board.some((t) => t.row === cell.row && t.col === cell.col) || p.some((t) => t.row === cell.row && t.col === cell.col);
        return taken ? null : cell;
    }, []);

    const onTileHover = useCallback((clientX: number, clientY: number) => {
        boardRef.current?.setHover(dropTargetAt(clientX, clientY));
    }, [dropTargetAt]);

    const onTileDrop = useCallback((tileId: number, clientX: number, clientY: number): boolean => {
        boardRef.current?.setHover(null);
        const cell = dropTargetAt(clientX, clientY);
        const tile = dropStateRef.current.game?.rack.find((t) => t.id === tileId);
        if (!cell || !tile) return false;
        setPending((prev) => [...prev, { tileId, word: tile.word, row: cell.row, col: cell.col }]);
        setSelectedId((id) => (id === tileId ? null : id));
        return true;
    }, [dropTargetAt]);

    const onRackTap = useCallback((id: number, word: string) => {
        setInfoWord(word);
        if (exchanging) {
            setExchangeIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
            });
            return;
        }
        setSelectedId((cur) => (cur === id ? null : id));
    }, [exchanging]);

    /** Run one move call; adopt its state and show its outcome. */
    const runMove = useCallback(async (call: () => Promise<SentenceTilesMoveResponse>, describe: (r: SentenceTilesMoveResponse) => Banner) => {
        setBusy(true);
        setConfirming(null);
        try {
            const res = await call();
            adopt(res.game);
            setBanner(describe(res));
            return res;
        } catch (err) {
            setBanner({ tone: "bad", text: sentenceTilesErrorMessage(err) });
            return null;
        } finally {
            setBusy(false);
        }
    }, [adopt]);

    const onPlay = useCallback(async () => {
        if (!game || pending.length === 0) return;
        const res = await runMove(
            () => playSentenceTiles(game.id, pending.map(({ tileId, row, col }) => ({ tileId, row, col })), inferDirection(pending, game.board)),
            (r) => r.outcome === "accepted"
                ? { tone: "good", text: `+${r.points} — ${r.reason || r.lineWords?.join("")}` }
                : { tone: "bad", text: `Not a sentence: ${r.reason || "the judge rejected this line."}` },
        );
        if (res?.outcome === "accepted") setPending([]);
    }, [game, pending, runMove]);

    const onExchange = useCallback(async () => {
        if (!game || exchangeIds.size === 0) return;
        const res = await runMove(
            () => exchangeSentenceTiles(game.id, [...exchangeIds]),
            () => ({ tone: "info", text: `Swapped ${exchangeIds.size} tile${exchangeIds.size === 1 ? "" : "s"}.` }),
        );
        if (res) { setExchanging(false); setExchangeIds(new Set()); }
    }, [game, exchangeIds, runMove]);

    const onSimple = useCallback(async (move: SentenceTilesSimpleMove) => {
        if (!game) return;
        // pass is cheap to undo-by-playing; the rest end the game, so they take a second tap.
        if (move !== "pass" && confirming !== move) { setConfirming(move); return; }
        setPending([]);
        await runMove(() => sentenceTilesSimpleMove(game.id, move), () => ({ tone: "info", text: SIMPLE_MOVE_DONE[move] }));
    }, [game, confirming, runMove]);

    if (loadError) {
        return <NodePage title="Sentence Tiles" contentClassName="sentence-tiles-game-root" onBack={goBack}><Typography sx={mutedTextSx}>{loadError}</Typography></NodePage>;
    }
    if (!game) {
        return <NodePage title="Sentence Tiles" contentClassName="sentence-tiles-game-root" onBack={goBack}><Typography sx={mutedTextSx}>Loading…</Typography></NodePage>;
    }

    const info = infoWord ? game.words[infoWord] : null;
    const status = statusBanner(game);

    const forfeit = forfeitMove(game);
    const canPass = canMove && game.status !== "draft";

    return (
        <NodePage
            title={`vs ${playerName(game.opponent)}`}
            onBack={goBack}
            contentClassName="sentence-tiles-game-root"
            horizontalPan
            footerless
            hideScrollbar
            headerExtraActions={live && (
                <>
                    {canPass && (
                        <HeaderIconButton className="sentence-tiles-header__pass" icon="skip_next" label="Pass" onClick={() => onSimple("pass")} />
                    )}
                    {forfeit && (
                        <HeaderIconButton
                            className={`sentence-tiles-header__${forfeit.move}`}
                            icon="flag"
                            label={confirming === forfeit.move ? `Tap again to ${forfeit.label.toLowerCase()}` : forfeit.label}
                            // Armed (first tap): the flag fills in, and the banner says what a second tap does.
                            fill={confirming === forfeit.move ? 1 : 0}
                            disabled={busy}
                            onClick={() => onSimple(forfeit.move)}
                        />
                    )}
                </>
            )}
        >
            {/* ── Scores: two equal columns, each centred, either side of a divider ── */}
            <Box className="sentence-tiles-scores" sx={{ display: "flex", alignItems: "stretch", justifyContent: "center", padding: "6px 16px 12px" }}>
                <Score label="You" score={game.you.score} />
                <Box className="sentence-tiles-scores__divider" sx={{ width: "1px", backgroundColor: COLORS.border, margin: "0 12px" }} />
                <Score label={playerName(game.opponent)} score={game.opponent.score} />
            </Box>

            {/* ── State + last verdict ── */}
            {(status || banner || confirming) && (
                <Box className="sentence-tiles-banners" sx={{ padding: "0 16px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                    {status && (
                        <Typography className="sentence-tiles-status" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, textAlign: "center" }}>
                            {status}
                        </Typography>
                    )}
                    {confirming && confirming !== "pass" && (
                        <Typography className="sentence-tiles-banner sentence-tiles-banner--confirm" sx={bannerSx("bad")}>
                            Tap the flag again to {SIMPLE_MOVE_VERB[confirming]}.
                        </Typography>
                    )}
                    {banner && !confirming && (
                        <Typography className={`sentence-tiles-banner sentence-tiles-banner--${banner.tone}`} sx={bannerSx(banner.tone)}>
                            {banner.text}
                        </Typography>
                    )}
                </Box>
            )}

            <SentenceTilesBoard ref={boardRef} board={game.board} pending={pending} lastPlayTurn={lastPlayTurn} onCellTap={onCellTap} cellPx={CELL_PX} />

            {/* ── The tapped word ── */}
            <Box className="sentence-tiles-info" sx={{ minHeight: 52, padding: "10px 16px 0", display: "flex", alignItems: "center", gap: "12px" }}>
                {infoWord && (
                    <>
                        <ForeignText className="sentence-tiles-info__word" text={infoWord} pronunciation={info?.pinyin || undefined} size="sm" />
                        <Typography sx={{ minWidth: 0, fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.onSurface }}>{info?.definition || "—"}</Typography>
                    </>
                )}
            </Box>

            {/* ── Rack: the tiles straight on the page, sized to fit RACK_ROWS rows ── */}
            {live && (
                <Box
                    ref={rackRef}
                    className="sentence-tiles-rack"
                    sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        // Never stretch a tile to the row's height (the reserved two-row minHeight
                        // would otherwise pull each tile's box — and its wall shadow — down into a tall slab).
                        alignItems: "flex-start",
                        alignContent: "flex-start",
                        // Each gap includes the tile's wall, which draws right of / below the face.
                        gap: `${RACK_GAP_PX + TILE_WALL_ALLOWANCE_PX}px`,
                        margin: "10px 12px 4px",
                        minHeight: rackTilePx * RACK_ROWS + RACK_GAP_PX + TILE_WALL_ALLOWANCE_PX * 2,
                    }}
                >
                    {rack.map((t) => pendingIds.has(t.id) ? (
                        <Box key={t.id} className="sentence-tiles-rack__empty-slot" sx={{ width: rackTilePx, height: rackTilePx, flexShrink: 0 }} />
                    ) : (
                        <DraggableRackTile
                            key={t.id}
                            tileId={t.id}
                            word={t.word}
                            sizePx={rackTilePx}
                            face={exchangeIds.has(t.id) ? COLORS.redTint : selectedId === t.id ? TILES_HUE.mid : undefined}
                            selected={selectedId === t.id || exchangeIds.has(t.id)}
                            draggable={canMove && !exchanging}
                            onTap={onRackTap}
                            onHover={onTileHover}
                            onDrop={onTileDrop}
                        />
                    ))}
                </Box>
            )}

            {/* ── Actions (Pass and the forfeit live in the header) ── */}
            {live && game.isYourTurn && (
                <Box className="sentence-tiles-actions" sx={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "8px", padding: "10px 16px" }}>
                    {!exchanging ? (
                        <>
                            <Button className="sentence-tiles-actions__play" disabled={!canMove || pending.length === 0} onClick={onPlay} sx={pillButtonSx(TILES_HUE.mid)}>
                                {busy ? "Judging…" : "Play"}
                            </Button>
                            <Button className="sentence-tiles-actions__recall" disabled={busy || pending.length === 0} onClick={() => setPending([])} sx={pillButtonSx(COLORS.white)}>Recall</Button>
                            <Button className="sentence-tiles-actions__swap" disabled={!canMove || game.bagCount === 0} onClick={() => { setPending([]); setSelectedId(null); setExchanging(true); }} sx={pillButtonSx(COLORS.white)}>Swap</Button>
                        </>
                    ) : (
                        <>
                            <Button className="sentence-tiles-actions__swap-confirm" disabled={!canMove || exchangeIds.size === 0} onClick={onExchange} sx={pillButtonSx(TILES_HUE.mid)}>
                                Swap {exchangeIds.size || ""}
                            </Button>
                            <Button className="sentence-tiles-actions__swap-cancel" onClick={() => { setExchanging(false); setExchangeIds(new Set()); }} sx={pillButtonSx(COLORS.white)}>Cancel</Button>
                        </>
                    )}
                </Box>
            )}

            <SentenceTilesMoveLog game={game} />

            {/* ── Quota line: the last thing on the page, down at the screen's bottom edge ── */}
            <Typography
                className="sentence-tiles-judge-usage"
                sx={{
                    marginTop: "auto",
                    padding: `16px 16px calc(10px + ${SAFE_BOTTOM})`,
                    textAlign: "center",
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    color: COLORS.textSecondary,
                }}
            >
                {game.bagCount} in bag · New-line checks today {game.judgeUsedToday}/{SENTENCE_TILES_DAILY_JUDGE_LIMIT}
                {live && game.isYourTurn && ` · rejected ${game.rejectedThisTurn}/${SENTENCE_TILES_MAX_REJECTED_PER_TURN}`}
            </Typography>
        </NodePage>
    );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Score({ label, score }: { label: string; score: number }) {
    // Fixed width so both columns are the same size and the divider sits at the true centre.
    return (
        <Box className="sentence-tiles-scores__side" sx={{ width: 120, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Typography className="sentence-tiles-scores__name" sx={{ maxWidth: "100%", fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</Typography>
            <Typography className="sentence-tiles-scores__value" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.title, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{score}</Typography>
        </Box>
    );
}

function bannerSx(tone: Banner["tone"]) {
    return {
        alignSelf: "stretch",
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        color: tone === "bad" ? COLORS.dangerInk : tone === "good" ? COLORS.successInk : COLORS.onSurface,
        backgroundColor: tone === "bad" ? COLORS.redTint : tone === "good" ? COLORS.grnTint : TILES_HUE.tint,
        border: `1px solid ${COLORS.border}`,
        borderRadius: "10px",
        padding: "8px 12px",
    } as const;
}

/** The header flag's move for this game state (null = nothing to forfeit). */
function forfeitMove(g: SentenceTilesGameView): { move: SentenceTilesSimpleMove; label: string } | null {
    if (g.status === "active") return { move: "resign", label: "Resign" };
    if (g.status === "pending" && !g.youAreChallenger) return { move: "decline", label: "Decline" };
    if ((g.status === "draft" || g.status === "pending") && g.youAreChallenger) return { move: "cancel", label: "Withdraw" };
    return null;
}

const SIMPLE_MOVE_VERB: Record<SentenceTilesSimpleMove, string> = {
    pass: "pass",
    resign: "resign",
    decline: "decline",
    cancel: "withdraw the challenge",
};

const SIMPLE_MOVE_DONE: Record<SentenceTilesSimpleMove, string> = {
    pass: "You passed.",
    resign: "You resigned.",
    decline: "Challenge declined.",
    cancel: "Challenge withdrawn.",
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Which way the unsent tiles read. Two or more tiles in one row → across, one column → down.
 * A single tile reads toward its board neighbours: left/right → across, above/below → down
 * (across when it has both or neither). The server re-validates; a wrong guess is a 400.
 */
export function inferDirection(pending: PendingTile[], board: SentenceTilesBoardTile[]): SentenceTilesDirection {
    if (pending.length >= 2) return pending.every((p) => p.row === pending[0].row) ? "across" : "down";
    const p = pending[0];
    const has = (r: number, c: number) => board.some((t) => t.row === r && t.col === c);
    const horizontal = has(p.row, p.col - 1) || has(p.row, p.col + 1);
    const vertical = has(p.row - 1, p.col) || has(p.row + 1, p.col);
    return vertical && !horizontal ? "down" : "across";
}

/**
 * The state line — only when there is a state to NAME; no how-to text (user call 2026-11-22).
 * A draft or an active game has none: the scores' turn dot already says whose move it is.
 */
function statusBanner(g: SentenceTilesGameView): string | null {
    const them = playerName(g.opponent);
    switch (g.status) {
        case "draft": return null;
        case "pending": return g.youAreChallenger ? `Waiting for ${them} to accept.` : `${them} challenged you.`;
        case "active": return null;
        case "declined": return `${them} declined.`;
        case "cancelled": return "This challenge was withdrawn.";
        case "finished":
            if (!g.winnerId) return "Game over — a draw.";
            return g.winnerId === g.you.userId ? "Game over — you won!" : `Game over — ${them} won.`;
    }
}

/** "They played 我 喜欢 你 (+9)." — the opponent's latest move, for the heartbeat banner. */
function lastMoveSummary(g: SentenceTilesGameView): string | null {
    const last = [...g.moves].reverse().find((m) => m.kind !== "rejected");
    if (!last || last.userId === g.you.userId) return null;
    const them = playerName(g.opponent);
    switch (last.kind) {
        case "play": return `${them} played ${(last.lineWords ?? []).join("")} (+${last.points}). Your turn.`;
        case "exchange": return `${them} swapped ${last.tileCount} tiles. Your turn.`;
        case "pass": return `${them} passed. Your turn.`;
        default: return null;
    }
}

export default SentenceTilesGamePage;
