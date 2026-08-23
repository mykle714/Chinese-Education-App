import type { ChallengeGameRef } from "../../types";

/**
 * How a Study Challenge round LAUNCHES a game (docs/STUDY_CHALLENGE.md § 5).
 *
 * A challenge round is normal play (§ 5.7), so it runs the ordinary game page at
 * the ordinary route. What this module supplies is the two things the page cannot
 * infer:
 *
 *  1. **The nav `state` each game requires.** Bubble Match bounces to /games with
 *     no `state.level`, Word Search with no `state.mode`; Match Speed defaults to
 *     Study Mix. A challenge launch has no hub card behind it, so it must state
 *     them itself.
 *  2. **The round's identity**, as query params the page hands straight to its pool
 *     request (`?challengeId=&gameId=&mode=`). Query rather than `state` on purpose:
 *     `state` does not survive a reload, and a player who reloads mid-round would
 *     otherwise silently drop into a casual game that scores nothing.
 *
 * ⚠️ THE FIXED SETTINGS MUST BE CONSTANTS, not the player's own preferences. Both
 * players play the same games in the same order (§ 5.1); if one played Bubble Match
 * on Chill and the other on Torture, the two scores would not be a comparison. So
 * the level/mode below are part of the format, and changing one re-tunes every
 * challenge score in the app.
 *
 * Referenced by: `ChallengeDetailPage`, `ChallengeRoundScoreboard`.
 */

/** Which game a challenge round is, plus everything needed to open it. */
export interface ChallengeLaunch {
    /** Path with the round's query params already attached. */
    to: string;
    /** Nav state the target page requires (level / mode). */
    state: Record<string, unknown>;
    /** Human label for the round row ("Bubble Match", "Word Search (Pinyin)"). */
    title: string;
}

/**
 * The fixed launch settings per challenge-eligible game.
 *
 * Keyed by `gameId`; a moded game reads its mode from the challenge's own
 * `ChallengeGameRef` (Word Search is eligible as Pinyin only), so nothing here
 * needs to restate it.
 */
const LAUNCHES: Record<string, { route: string; title: string; state: Record<string, unknown> }> = {
    "bubble-match": {
        route: "/games/bubble-match",
        title: "Bubble Match",
        // Hustle — the middle level. Chill barely ever loses (so the survival bonus
        // would be free for both players and stop separating them), Torture loses
        // too often for a once-a-week scored round.
        state: { level: 2 },
    },
    "match-speed": {
        route: "/games/match-speed",
        title: "Match Speed",
        // Study Mix, NOT Review or Challenge: those modes are hard bucket
        // restrictions, and a challenge board is a fixed twelve words plus
        // mastered-first filler — a restriction would throw half of it away.
        state: { mode: "mixed" },
    },
    "word-search": {
        route: "/games/word-search",
        title: "Word Search",
        // Overwritten with the challenge's own mode below; stated here so a future
        // gameId with no mode still gets a valid launch.
        state: { mode: "pinyin" },
    },
    "hydra-bubbles": {
        route: "/games/hydra-bubbles",
        title: "Hydra Bubbles",
        state: {},
    },
};

/**
 * Resolve one round of a challenge to a launch, or null for a game this build does
 * not know how to run.
 *
 * Null is a real case, not a defensive shrug: a challenge's sequence is drawn from
 * `CHALLENGE_GAMES` (the server contract) and stored, so a game removed from the
 * client while a challenge is live leaves a round nobody can play. The caller
 * renders that round as unplayable rather than crashing on it — which is the first
 * half of the two-phase game-retirement rule (docs/GAMES_FEATURE.md § Removing a
 * game).
 */
export function challengeLaunchFor(
    challengeId: string,
    round: number,
    game: ChallengeGameRef
): ChallengeLaunch | null {
    const base = LAUNCHES[game.gameId];
    if (!base) return null;

    const params = new URLSearchParams({
        challengeId,
        round: String(round),
        gameId: game.gameId,
    });
    // Only sent when the game HAS a mode: the server compares `mode ?? null` on both
    // sides, and an empty string would read as "no mode" anyway — but omitting it
    // keeps the URL honest about what the round actually is.
    if (game.mode) params.set("mode", game.mode);

    return {
        to: `${base.route}?${params.toString()}`,
        state: game.mode ? { ...base.state, mode: game.mode } : base.state,
        title: game.mode ? `${base.title} (${game.mode})` : base.title,
    };
}
