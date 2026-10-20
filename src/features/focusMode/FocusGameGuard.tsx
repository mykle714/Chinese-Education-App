import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchFocusStatus } from "../../api/focusMode";
import { focusGameMinimum, type FocusStatusResponse } from "../../../server/contracts/focusMode";
import { worldForMarkType } from "../../../server/contracts/mastery";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import type { GameDef } from "../../games/types";
import FocusDialog from "./FocusDialog";

/**
 * FocusGameGuard — refuses a game launched from a menu when focus mode leaves too few of
 * today's cards to play it (docs/FOCUS_MODE.md § 5).
 *
 * Wraps every game route (src/routes/registry.ts), so every launch surface — the Games
 * hub's tiles and level cards, the Word Search hub item, the Reading and Writing Centers'
 * carousels — is covered by one check rather than one per button. On a launch it reads
 * `GET /api/focus` and, if blocked, shows the "not enough focus cards" popup over a blank
 * page and returns to the menu when it is dismissed. The game page is not mounted until
 * the check passes, so it never fetches a pool it cannot play.
 *
 * NOT checked (the game mounts straight away):
 *   - a deck / collection launch (`?deck=` / `?collection=`) — a hand-picked set ignores
 *     focus mode, and so does a Study Challenge board (`?challengeId=`);
 *   - a failed status read — never block a game on a network error.
 *
 * Blocked means: in EVERY world the game can mark (a moded game picks its mode in-game,
 * so it is refused only when no mode could be played), focus is on and fewer than
 * `focusGameMinimum(gameId)` cards remain. flp game breaks are separate — the break skips
 * the game instead (useGameBreak).
 */

/** The worlds a launch of `game` can mark. */
function launchWorlds(game: GameDef, showPinyin: boolean | undefined): MasteryWorldId[] {
    if (game.modes && game.modes.length > 0) {
        return [...new Set(game.modes.map((m) => worldForMarkType(m.markType)))];
    }
    // A pinyin-following game launched with pinyin hidden (the Reading Center's Bubble
    // Match) marks its no-pinyin track.
    const markType = showPinyin === false && game.noPinyinMarkType ? game.noPinyinMarkType : game.markType;
    return markType ? [worldForMarkType(markType)] : [];
}

function blockedWorld(game: GameDef, status: FocusStatusResponse, showPinyin: boolean | undefined): { world: MasteryWorldId; remaining: number } | null {
    const worlds = launchWorlds(game, showPinyin);
    const needed = focusGameMinimum(game.gameId);
    const short = worlds.map((world) => ({ world, s: status.worlds[world] }))
        .filter(({ s }) => s?.on && (s.remaining ?? 0) < needed);
    if (worlds.length === 0 || short.length < worlds.length) return null;
    return { world: short[0].world, remaining: short[0].s.remaining ?? 0 };
}

const FocusGameGuard: React.FC<{ game: GameDef; children: React.ReactNode }> = ({ game, children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const params = new URLSearchParams(location.search);
    const exempt = params.has("deck") || params.has("collection") || params.has("challengeId");
    const showPinyin = (location.state as { showPinyin?: boolean } | null)?.showPinyin;

    const [verdict, setVerdict] = useState<"checking" | "ok" | { world: MasteryWorldId; remaining: number }>(
        exempt ? "ok" : "checking"
    );

    useEffect(() => {
        if (exempt) return;
        let cancelled = false;
        fetchFocusStatus()
            .then((status) => {
                if (!cancelled) setVerdict(blockedWorld(game, status, showPinyin) ?? "ok");
            })
            .catch(() => !cancelled && setVerdict("ok"));
        return () => { cancelled = true; };
        // Checked once per launch (mount). The route key changes on every navigation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (verdict === "ok") return <>{children}</>;
    if (verdict === "checking") return null;
    return (
        <FocusDialog
            content={{
                kind: "game-blocked",
                world: verdict.world,
                gameTitle: game.title,
                remaining: verdict.remaining,
                needed: focusGameMinimum(game.gameId),
            }}
            onClose={() => navigate(-1)}
        />
    );
};

export default FocusGameGuard;
