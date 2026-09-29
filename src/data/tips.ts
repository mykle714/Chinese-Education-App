/**
 * Hardcoded tip pool for the hub TipBox (src/components/TipBox.tsx) — shipped
 * with the frontend, not stored in the database. Add/remove tips freely;
 * order doesn't matter since a tip is always picked at random.
 *
 * ── Flag gating ──────────────────────────────────────────────────────────────
 * A tip that talks about a flagged feature or game MUST name that flag, so that
 * switching the feature off (server/contracts/featureFlags.ts) also retires the
 * tip instead of pointing the learner at a route that no longer exists. Tips are
 * an entry point like any tile or button — see docs/FEATURE_FLAGS.md § 5.
 * `feature` is checked with `isFeatureEnabled`, `game` with `isGameEnabled`; a
 * tip carrying neither is always shown.
 *
 * Referenced by: docs/FEATURE_FLAGS.md, docs/COMMUNITY_PAGE.md.
 */
import {
    isFeatureEnabled,
    isGameEnabled,
    type FeatureFlag,
    type GameFlagId,
} from "../../server/contracts/featureFlags";

interface TipDef {
    text: string;
    /** The feature flag this tip depends on, if it mentions a flagged feature. */
    feature?: FeatureFlag;
    /** The game this tip depends on, if it mentions a game (GAME_FLAGS slug). */
    game?: GameFlagId;
}

const ALL_TIPS: TipDef[] = [
    { text: "Tap a flashcard's icon to jump straight to its detail page." },
    { text: "Use Discover to sort new cards into your decks before they pile up." },
    { text: "Bubble Match gets harder each level — Torture drops the ceiling fast!", game: "bubble-match" },
    { text: "Word Search hides your vocab in a grid — words can run in any direction.", game: "word-search" },
    { text: "Your streak resets if a full day passes without any study activity." },
    { text: "The Community page shows card designs other learners have upvoted.", feature: "community" },
    { text: "Visit the Night Market for a change of scenery while you review.", feature: "nightMarket" },
    { text: "Check the Reader to mine new words straight out of real texts." },
];

/** Whether every flag a tip depends on is switched on. */
const isTipEnabled = (tip: TipDef): boolean =>
    (tip.feature === undefined || isFeatureEnabled(tip.feature)) &&
    (tip.game === undefined || isGameEnabled(tip.game));

/** The tips currently eligible to show — flags are build-time, so this is computed once. */
export const TIPS: string[] = ALL_TIPS.filter(isTipEnabled).map((tip) => tip.text);
