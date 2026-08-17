import { describe, it, expect } from "vitest";
import { GAME_REGISTRY, challengeScoringFor } from "../registry";
import { MODE_CONFIGS } from "../word-search/constants";
import { CHALLENGE_GAMES, challengeGamesForLanguages, CHALLENGE_ROUND_COUNT } from "../../types";

/**
 * The registry ↔ `CHALLENGE_GAMES` sync test (docs/STUDY_CHALLENGE.md § 5.4,
 * docs/GAMES_FEATURE.md § "Challenge-eligible games").
 *
 * ── WHY THIS FILE IS LOAD-BEARING ─────────────────────────────────────────────
 * GAMES_FEATURE.md requires that challenge eligibility be "derived from the registry,
 * never hand-listed", so a new recognition/production game joins the rotation the day
 * it ships. But the scoring numbers physically live in `server/contracts/wire.ts`,
 * because the SERVER draws each challenge's game sequence and cannot import the
 * registry (lazy React components), and because live mode has to score the same events
 * with no game page mounted.
 *
 * Those two facts are in tension: a hand-maintained table in the contract can silently
 * fall behind the registry. THIS TEST IS THE THING THAT RESOLVES IT. Adding a
 * recognition/production game and forgetting its `CHALLENGE_GAMES` entry is a red test
 * rather than a game that is quietly never drawn — which is exactly the failure mode
 * "derived from the registry" was written to prevent, and it would be invisible in
 * production (a challenge would just always draw the other games).
 */
describe("challenge-eligible game pool", () => {
    /** The tracks a challenge test may draw from — recognition and production only. */
    const ELIGIBLE_TRACKS = ["recognition", "production"];

    it("has a CHALLENGE_GAMES entry for every recognition/production game in the registry", () => {
        const missing: string[] = [];

        for (const game of GAME_REGISTRY) {
            if (game.markType && ELIGIBLE_TRACKS.includes(game.markType)) {
                // A single-mode game: it must be present with mode `null`.
                if (!challengeScoringFor(game.gameId)) missing.push(game.gameId);
                continue;
            }
            // A MODED game omits `markType` and declares one per mode, so eligibility is
            // per mode. Word Search is the only such game today; this loop is written
            // generally so the next one is covered without a change here.
            if (!game.markType && game.gameId === "word-search") {
                for (const mode of MODE_CONFIGS) {
                    if (!ELIGIBLE_TRACKS.includes(mode.markType)) continue;
                    if (!challengeScoringFor(game.gameId, mode.mode)) {
                        missing.push(`${game.gameId} (${mode.mode})`);
                    }
                }
            }
        }

        expect(missing).toEqual([]);
    });

    it("has no CHALLENGE_GAMES entry for a game that is not in the registry", () => {
        const registryIds = new Set(GAME_REGISTRY.map((game) => game.gameId));
        const orphans = CHALLENGE_GAMES
            .filter((game) => !registryIds.has(game.gameId))
            .map((game) => game.gameId);
        // A stale entry is the mirror-image bug: a challenge could draw a game that no
        // longer exists, and the stored sequence would name a route nobody can open.
        // Retiring a game means removing it from this pool a week BEFORE deleting it
        // (GAMES_FEATURE.md § Removing a game, Q58).
        expect(orphans).toEqual([]);
    });

    it("never marks a reading or writing game eligible", () => {
        // The whole feature is core-only: the test is made exclusively of
        // recognition/production games, which is also why candidate eligibility bands on
        // the core bar. A reading game in this pool would silently change what a
        // challenge measures.
        for (const game of CHALLENGE_GAMES) {
            expect(ELIGIBLE_TRACKS).toContain(game.markType);
        }

        // Speed Reading is the concrete case worth pinning: it is a shipped game whose
        // track is `reading`, so it must never appear.
        expect(CHALLENGE_GAMES.some((game) => game.gameId === "speed-reading")).toBe(false);
        // Word Search's No-Pinyin mode is the other one — same game, ineligible mode.
        expect(challengeScoringFor("word-search", "no-pinyin")).toBeUndefined();
        expect(challengeScoringFor("word-search", "pinyin")).toBeDefined();
    });

    it("draws a same-language pool of at least the round count, and a smaller cross-language one", () => {
        // zh-vs-zh can fill a full test today.
        expect(challengeGamesForLanguages("zh", "zh").length).toBeGreaterThanOrEqual(CHALLENGE_ROUND_COUNT);

        // es-vs-es and any cross-language pair lose Word Search, which is zh-only because
        // its grid is built from characters. The format BENDS to two rounds rather than
        // blocking (§ 8.3), so this asserts the pool shrinks — not that it is empty.
        const crossLanguage = challengeGamesForLanguages("zh", "es");
        expect(crossLanguage.length).toBeGreaterThan(0);
        expect(crossLanguage.length).toBeLessThan(challengeGamesForLanguages("zh", "zh").length);
        expect(crossLanguage.some((game) => game.gameId === "word-search")).toBe(false);
    });

    it("gives every eligible game a scoring spec that pays contested more than filler", () => {
        for (const game of CHALLENGE_GAMES) {
            const { scoring } = game;
            // The contested/filler split is the point of the spec: filler is meant to be
            // near-free points that do not decide the match, so a spec where filler paid
            // as much as a contested word would silently stop measuring the ten words.
            expect(scoring.contestedHit).toBeGreaterThan(scoring.fillerHit);
            // Misses are penalties or zero, never rewards.
            expect(scoring.contestedMiss).toBeLessThanOrEqual(0);
            expect(scoring.fillerMiss).toBeLessThanOrEqual(0);
        }
    });
});
