import { COLORS, type RampHue } from "../../theme/colors";
import { WRONG_BUBBLE_BG, WRONG_FEEDBACK_MS } from "../bubbles/constants";
import type { MarkType } from "../../types";

/**
 * Bucket Drop — the tunable constants (docs/BUCKET_DROP_GAME.md).
 *
 * A stopwatch game: all of a run's foreign words are dealt as a pile in the middle of
 * the play panel, the panel's perimeter is lined with grey square keycap-hole buckets
 * each holding one English dd, and the player drags ANY word into its meaning's bucket
 * (or leaves it anywhere on the field). The run is 20 words; the clock stops when the
 * last one is dropped.
 *
 * Referenced by: BucketDropPage, BucketDropStage, BucketDropEndPopup, DropBucket,
 * StackWord, perimeterLayout, games/registry.ts, runtime/challengeLaunch.ts,
 * features/flashcards/centers/ReadingGamesCarousel.
 */

/** Stable slug — the registry key, the route segment, the GAME_FLAGS / personal-best key. */
export const GAME_ID = "bucket-drop";

/**
 * THE GAME'S HUE — its hub tile AND the accent ground its screen is flooded with
 * (docs/SHELF_REDESIGN.md § A6b). Red, the same hue as Bubble Match: both are
 * drag-a-word-to-its-meaning drills, so the two share a family colour.
 */
export const GAME_HUE: RampHue = "red";

/** Key under which medalled runs are logged in the shared `wins` table (useGameWins). */
export const GAME_KEY = "bucketDrop";

/** localStorage key for Bucket Drop's own device-local preferences (useLocalGameSettings). */
export const SETTINGS_STORAGE_KEY = "bucketDrop.settings";
/**
 * `showTimer` — whether the stopwatch's numerals are visible (the eye in `GameTimer`).
 * The clock keeps running either way, and the end popup always shows the final time.
 * docs/BUCKET_DROP_GAME.md § 6.
 */
export const DEFAULT_SETTINGS = { showTimer: true };
/** Every medalled run logs under level 1 — the game has no levels, only modes. */
export const WIN_LEVEL = 1;

// ── Modes ─────────────────────────────────────────────────────────────────────

/**
 * Two modes, chosen by the LAUNCH SURFACE, never in-game (the Word Search pattern):
 *   pinyin    — the Games hub tile. Pinyin shown over the characters ⇒ PRODUCTION:
 *               each English bucket is the prompt, and the learner finds the foreign
 *               word that answers it (Word Search's Pinyin mode marks the same track).
 *               The challenge-eligible mode.
 *   no-pinyin — the Reading Center carousel (zh only). Characters alone ⇒ READING.
 *
 * The run's actual track is `runTrackFor(language, config)` below: a Spanish run is
 * production in either mode — 'es' has no phonetic layer to hide, so its "no-pinyin"
 * board is the pinyin board. `markType` is the zh value and is what the registry
 * declares per mode (`GameDef.modes`).
 */
export type BucketDropMode = "pinyin" | "no-pinyin";

export interface BucketDropModeConfig {
    mode: BucketDropMode;
    showPinyin: boolean;
    /** The mode's PRIMARY track on a zh board — see the block comment above. */
    markType: MarkType;
}

export const MODE_CONFIGS: BucketDropModeConfig[] = [
    { mode: "pinyin", showPinyin: true, markType: "production" },
    { mode: "no-pinyin", showPinyin: false, markType: "reading" },
];

/**
 * Resolve the launch's `state.mode`. A launch with NO mode (the hub tile, which is a
 * plain router link, or a direct URL) is the Pinyin mode — unlike Word Search, which
 * bounces to /games, because the hub's tile has no way to pass state.
 */
export function modeConfigFor(mode: unknown): BucketDropModeConfig {
    return MODE_CONFIGS.find((m) => m.mode === mode) ?? MODE_CONFIGS[0];
}

/**
 * The track a run is pooled and marked on. zh: the mode's own `markType`. Any other
 * language: production, whatever the mode (see the block comment above) — only a zh
 * board can hide a reading.
 *
 * Referenced by: BucketDropPage (`lockRunTrack`). Doc: docs/BUCKET_DROP_GAME.md § 1.
 */
export function runTrackFor(language: string | null | undefined, config: BucketDropModeConfig): MarkType {
    return language === "zh" ? config.markType : "production";
}

// ── The run ───────────────────────────────────────────────────────────────────

/**
 * The pool request's bucket mix — Bubble Match's 2/10/6/2, i.e. 20 words. The server
 * tops it up from fallback buckets, and lends provisional cards up to
 * CARD_BASELINES['bucket-drop'] (= 20, server/contracts/wire.ts) for a small deck.
 */
export const GAME_DISTRIBUTION: Record<string, number> = {
    Unfamiliar: 2,
    Target: 10,
    Comfortable: 6,
    Mastered: 2,
};
export const TOTAL_WORDS = Object.values(GAME_DISTRIBUTION).reduce((a, b) => a + b, 0);

/**
 * Medal thresholds by FINISHING TIME (ms), lower is better — Speed Reading's shape.
 * Gold is 2.25 s a word. ⚠️ First guesses; re-tune once real runs exist.
 * The challenge spec's time-penalty grace (CHALLENGE_GAMES → 'bucket-drop') is set to
 * the gold line, so keep the two together.
 */
export const MEDAL_THRESHOLDS = { gold: 45_000, silver: 70_000, bronze: 100_000 };

export type Medal = "gold" | "silver" | "bronze";

/** Medal for a FINISHED run's time, or null when slower than bronze. */
export function medalFor(totalMs: number): Medal | null {
    if (totalMs <= MEDAL_THRESHOLDS.gold) return "gold";
    if (totalMs <= MEDAL_THRESHOLDS.silver) return "silver";
    if (totalMs <= MEDAL_THRESHOLDS.bronze) return "bronze";
    return null;
}

export const MEDAL_LABEL: Record<Medal, string> = {
    gold: "🥇 Gold",
    silver: "🥈 Silver",
    bronze: "🥉 Bronze",
};

// ── Perimeter geometry (perimeterLayout.ts) ───────────────────────────────────

/**
 * EVERY BUCKET IS THE SAME SQUARE — BUCKET_SIZE × BUCKET_SIZE, on every screen — and they
 * sit in ONE ROW along the top edge of the field. The side columns and the bottom row were
 * removed on request (2026-10-06). Only the COUNT and the SPACING adapt to the field
 * (perimeterLayout → `layoutPerimeter`):
 *   - the row holds as many squares as fit with at least BUCKET_GAP of space around each;
 *   - the spacing is EVEN: one gap value is used between neighbouring buckets, between the
 *     end buckets and the field's side edges, AND between the row and the top edge — so a
 *     corner bucket sits equally far from both edges it touches;
 *   - never more than MAX_LIVE_BUCKETS — only reachable on a very wide field.
 *
 * 91px (76 → 114 → 91: raised 50%, then reduced 20%, on request 2026-10-06): a
 * ~340–370px phone field fits three — 3 live buckets, ~17–24px apart.
 */
export const BUCKET_SIZE = 91;
/** The MINIMUM even gap (px); the real gap grows to share the row's spare width. */
export const BUCKET_GAP = 10;
/**
 * Ceiling on the row's top inset. The even gap is reused as that inset, which is
 * exact on every phone and tablet (the gap tops out ~30px), but on a very wide field the row hits
 * MAX_LIVE_BUCKETS and the gap balloons (~200px at 2000px wide) — reused vertically it
 * would push the row far down the field. Only those fields are clamped.
 */
export const MAX_EDGE_INSET = 40;
export const MAX_LIVE_BUCKETS = 12;

/**
 * A keycap's corner. Bubble Match's keycap is `border-radius: 40%` of a SQUARE; on a
 * rectangle a percentage radius goes elliptical, so the hole uses a fixed radius that
 * gives the same soft-square read at bucket size.
 */
export const BUCKET_RADIUS = 16;
/**
 * The gloss's fitted font-size range (DropBucket → FittedGloss): starts at the body size
 * and steps down until no word is cut off and the lines fit the hole.
 */
export const GLOSS_MAX_FONT_PX = 14;
export const GLOSS_MIN_FONT_PX = 8;
export const GLOSS_FONT_STEP_PX = 0.5;
/** The hole's fill — the palette's inert grey (`--grey`). No hue, by design. */
export const BUCKET_FILL = COLORS.grey;
/**
 * The wrong-drop outline: the strongest red the palette owns, the same token Bubble
 * Match flashes a wrong bubble with (`WRONG_BUBBLE_BG` = `--redMk`). `dangerInk`
 * would NOT do — v2 set every semantic role to ink, so it is black.
 */
export const BUCKET_WRONG_RING = WRONG_BUBBLE_BG;

// ── The opening pile ──────────────────────────────────────────────────────────

/**
 * Every word is dealt at load as a pile in the field's open centre, each nudged up to
 * this far (px) from the centre point at random so the heap reads as a heap rather than
 * one word. From then on a word rests wherever it was last let go (StackWord).
 */
export const PILE_JITTER_X = 14;
export const PILE_JITTER_Y = 10;

// ── Drag + feedback timing ────────────────────────────────────────────────────

/** The held word's lift — Bubble Match's SCALE_HELD, applied once at pickup. */
export const HELD_SCALE = 1.12;
/** "Being held" fade. */
export const HELD_OPACITY = 0.75;
/** A wrong drop's glide back to where that drag started. */
export const SNAP_BACK_MS = 260;
/**
 * The wrong bucket's shake — Bubble Match's own duration, so the two games' "no"
 * reads identically. Input is locked for max(SNAP_BACK_MS, this).
 */
export const WRONG_SHAKE_MS = WRONG_FEEDBACK_MS;
/** A correct word's fall into its hole (the sort flow's DROP_FALL_MS). */
export const DROP_FALL_MS = 340;
export const DROP_FALL_END_SCALE = 0.15;
/** The emptied bucket fading out, then its replacement fading in. */
export const BUCKET_EXIT_MS = 220;
export const BUCKET_ENTER_MS = 220;
