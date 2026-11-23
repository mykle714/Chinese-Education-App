/**
 * bankingAnimation.ts — the PURE timeline of the td daily banking animation
 * (docs/DAILY_MINUTE_BANKING.md § 3–4). No React, no DOM, no clock.
 *
 * Everything on screen during a run — the flame's count and fill, the avatar's
 * glow, every ember's position along its path — is a function of ONE number, the
 * milliseconds since the run started. `planBankingRun` turns yesterday's minutes into
 * the run's fixed shape once; `sampleBankingRun` reads that plan at any instant. Keeping
 * the maths here means the components only draw, and the timeline can be unit-tested
 * without fake timers (src/minutePoints/dailyBanking/__tests__/bankingAnimation.test.ts).
 *
 * LAYER: client view-model (pure). Consumed by `useDailyBanking` (the clock) and,
 * through `DailyBankingContext`, by `MinutePointsFireBadge`, `BankingAvatarButton` and
 * `BankingEmbers`.
 */

/**
 * Every tunable in one place, so device tuning is one edit (§ 4). `min` is the value at
 * a 1-minute day, `max` at a day of `fullCeremonyMinutes` or more; everything between is
 * a log-interpolation through `bankingIntensity`.
 */
export const BANKING_ANIMATION = {
    /** The day size that earns the full ceremony. */
    fullCeremonyMinutes: 120,
    /**
     * Phases 1–2 together, ms. Phase 0 (`restMs`) is extra and fixed. The flame no longer
     * swells (the pop phase was cut 2026-11-21); these were 1600/5000 with the swell's 20%
     * share included, so the drain and settle keep their old absolute lengths.
     */
    durationMs: { min: 1280, max: 4000 },
    /** Avatar halo blur radius at full charge, px. */
    peakGlowPx: { min: 3, max: 14 },
    /** Phase 0: held on yesterday's number before anything moves, so the eye can read it. */
    restMs: 500,
    /** How the phases 1–2 budget is split. Must sum to 1. */
    phaseShare: { drain: 0.725, settle: 0.275 },
    /**
     * One ember's flight from flame to avatar, ms. Long enough for the burst-then-home
     * path (BankingEmbers.tsx) to read: out along its own direction, a turn, then in.
     */
    emberFlightMs: 800,
    /** Fraction of the settle phase the avatar glow HOLDS at peak before it decays. */
    glowHoldShare: 0.35,
    /**
     * Phase 3: after the run, the empty flame relights while the count climbs from 0 to
     * TODAY's minutes. Sized by today's count on the same log curve. A day with nothing
     * yet earned still relights, over `relightOnlyMs`, with the count staying at 0.
     */
    countUpMs: { min: 450, max: 1200 },
    relightOnlyMs: 300,
} as const;

/** The run's fixed shape, decided once from yesterday's and today's minutes. */
export interface BankingPlan {
    /** Yesterday's minutes — the figure the flame opens on, drained to 0. */
    fromCount: number;
    /** Today's minutes — counted up from 0 once the run is over (phase 3). */
    toCount: number;
    peakGlowPx: number;
    /**
     * Embers flown = EXACTLY the minutes drained (`fromCount`): one flame per minute, each
     * launched the instant the count drops by that minute. Uncapped by decision
     * (2026-10-10) — the stream is meant to literally be the minutes. Only the ones in the
     * air are mounted (one flight ≈ 0.5 s of the drain), so a 200-minute day has a few
     * dozen nodes up at once, not 200.
     */
    emberCount: number;
    restMs: number;
    drainMs: number;
    settleMs: number;
    /** Phase 3: relight + count up to `toCount`. */
    countUpMs: number;
    /** restMs + drain + settle + countUp. */
    totalMs: number;
}

/** One ember mid-flight. `progress` 0 = leaving the flame, 1 = arriving at the avatar. */
export interface EmberSample {
    /** Stable index, for React keys. */
    id: number;
    progress: number;
}

/** Everything the three views need at one instant. */
export interface BankingFrame {
    /** The number beside the flame. */
    displayCount: number;
    /** How full the flame is, 0–1 (1 = solid). The badge maps this onto the ink band. */
    fillLevel: number;
    /** Avatar halo blur, px. 0 = no glow. */
    glowPx: number;
    /** Embers currently in the air (landed and not-yet-launched ones are omitted). */
    embers: EmberSample[];
    /** True once the timeline has run out; the views drop back to their live state. */
    done: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The one normalized size of a day, 0–1 (§ 4). Log, not linear: 3 → 30 minutes should
 * feel like a big jump, 120 → 150 like none.
 */
export function bankingIntensity(minutes: number): number {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    return clamp01(Math.log1p(minutes) / Math.log1p(BANKING_ANIMATION.fullCeremonyMinutes));
}

/** Decide the run's shape. `yesterdayMinutes` must be > 0 — a zero day never plays (Q11a). */
export function planBankingRun(yesterdayMinutes: number, todayMinutes: number): BankingPlan {
    const cfg = BANKING_ANIMATION;
    const k = bankingIntensity(yesterdayMinutes);
    const active = lerp(cfg.durationMs.min, cfg.durationMs.max, k);
    const drainMs = active * cfg.phaseShare.drain;
    // The settle phase starts when the count hits 0 — which is when the LAST ember
    // launches — so it gets one extra flight's time for that ember to land before the
    // avatar's glow starts to hold and decay.
    const settleMs = cfg.emberFlightMs + active * cfg.phaseShare.settle;
    const toCount = Math.max(0, Math.round(todayMinutes));
    const countUpMs = toCount > 0
        ? lerp(cfg.countUpMs.min, cfg.countUpMs.max, bankingIntensity(toCount))
        : cfg.relightOnlyMs;
    return {
        fromCount: Math.max(0, Math.round(yesterdayMinutes)),
        toCount,
        peakGlowPx: lerp(cfg.peakGlowPx.min, cfg.peakGlowPx.max, k),
        emberCount: Math.max(0, Math.round(yesterdayMinutes)),
        restMs: cfg.restMs,
        drainMs,
        settleMs,
        countUpMs,
        totalMs: cfg.restMs + drainMs + settleMs + countUpMs,
    };
}

/** Inverse of `easeInOutCubic`: the linear progress at which the eased value is `y`. */
const inverseEaseInOutCubic = (y: number) =>
    y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2;

/**
 * When ember `i` leaves the flame, ms from run start: the instant the count ticks from
 * `fromCount − i` to `fromCount − i − 1`. The count is `round(fromCount · (1 − d))` with
 * `d` the eased drain, so that tick happens at `d = (i + 0.5) / fromCount` — inverted
 * through the drain's easing to get the time. Each ember therefore IS one minute leaving
 * the number (§ 3 phase 1), and the stream speeds up and slows down with the count.
 */
function emberLaunchMs(plan: BankingPlan, i: number): number {
    const drainStart = plan.restMs;
    const d = (i + 0.5) / plan.fromCount;
    return drainStart + inverseEaseInOutCubic(d) * plan.drainMs;
}

/** Read the plan at `elapsedMs` since the run started. */
export function sampleBankingRun(plan: BankingPlan, elapsedMs: number): BankingFrame {
    const cfg = BANKING_ANIMATION;
    const t = Math.max(0, elapsedMs);
    const drainStart = plan.restMs;
    const settleStart = drainStart + plan.drainMs;
    const countUpStart = settleStart + plan.settleMs;

    // ── Flame: count, fill ─────────────────────────────────────────────────────
    let fillLevel = 1;
    let displayCount = plan.fromCount;
    if (t < drainStart) {
        // Phase 0 — rest on yesterday, full.
    } else if (t < settleStart) {
        // Phase 1 — count and fill move together: yesterday drains to 0.
        const drained = easeInOutCubic(clamp01((t - drainStart) / plan.drainMs));
        fillLevel = 1 - drained;
        displayCount = Math.round(lerp(plan.fromCount, 0, drained));
    } else if (t < countUpStart) {
        // Phase 2 — the bank is done: an empty flame at 0 while the avatar glow settles.
        fillLevel = 0;
        displayCount = 0;
    } else {
        // Phase 3 — today: the flame relights to the solid off-study flame the td header
        // shows without a run (so the hand-back is invisible) while the count climbs to
        // today's minutes.
        const up = easeOutCubic(clamp01((t - countUpStart) / plan.countUpMs));
        fillLevel = up;
        displayCount = Math.round(lerp(0, plan.toCount, up));
    }

    // ── Embers + avatar charge ─────────────────────────────────────────────────
    const embers: EmberSample[] = [];
    let landed = 0;
    for (let i = 0; i < plan.emberCount; i++) {
        const progress = (t - emberLaunchMs(plan, i)) / cfg.emberFlightMs;
        if (progress >= 1) landed++;
        else if (progress >= 0) embers.push({ id: i, progress });
    }
    // Charge only grows as embers LAND. The settle phase opens with one flight's time for
    // the last ember to arrive, then the glow holds a beat and decays to none — it is
    // gone before today's count-up begins.
    let charge = plan.emberCount > 0 ? landed / plan.emberCount : 0;
    const glowSettleStart = settleStart + cfg.emberFlightMs;
    if (t >= glowSettleStart) {
        const glowSettleMs = plan.settleMs - cfg.emberFlightMs;
        const holdMs = glowSettleMs * cfg.glowHoldShare;
        const decay = clamp01((t - glowSettleStart - holdMs) / (glowSettleMs - holdMs));
        charge *= 1 - easeOutCubic(decay);
    }

    return {
        displayCount,
        fillLevel,
        glowPx: charge * plan.peakGlowPx,
        embers,
        done: t >= plan.totalMs,
    };
}
