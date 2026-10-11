import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAuth } from "../../AuthContext";
import { fetchLanguageSummary, markBankingSeen } from "../minutePointsSync";
import { planBankingRun, sampleBankingRun, type BankingFrame } from "./bankingAnimation";
import { readBankingAlwaysPlay } from "./bankingAlwaysPlay";

/**
 * DailyBankingContext — owns the ONE running instance of the hp daily banking animation
 * (docs/DAILY_MINUTE_BANKING.md § 5) and hands its frames to the three views that draw
 * it: the header flame (`MinutePointsFireBadge`), the profile picture
 * (`BankingAvatarButton`) and the ember overlay (`BankingEmbers`).
 *
 * ── WHY A CONTEXT ────────────────────────────────────────────────────────────────────
 * The flame lives in PageHeader's right slot, the avatar in the `trailingContent` that
 * HomePage passes, and the embers in a portal — siblings with no shared parent below
 * PageHeader. HomePage mounts `DailyBankingProvider` around its screen; anywhere else
 * there is no provider, `useBankingFrame()` returns null, and the badge is unchanged.
 * This is deliberately NOT a second `useMinutePoints` instance: each of those runs its
 * own 1-second accrual tick (the ⚠️ on PageHeader's right slot).
 *
 * ── WHY AN EXTERNAL STORE, NOT STATE ─────────────────────────────────────────────────
 * The run is driven by requestAnimationFrame. Holding the frame in the provider's state
 * would re-render the whole Home page (study hand, sheets and all) 60 times a second
 * for up to ~5.5s.
 * Instead the frame sits in a tiny store and only the three leaf subscribers re-render,
 * via `useSyncExternalStore`. The context value itself never changes identity.
 *
 * LAYER: client state. Server calls go through `minutePointsSync`
 * (`fetchLanguageSummary`, `markBankingSeen`).
 */

type Listener = () => void;

/** Minimal observable holding the current frame (null = no run on screen). */
interface FrameStore {
    subscribe: (listener: Listener) => () => void;
    getSnapshot: () => BankingFrame | null;
    set: (frame: BankingFrame | null) => void;
}

function createFrameStore(): FrameStore {
    let frame: BankingFrame | null = null;
    const listeners = new Set<Listener>();
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => frame,
        set: (next) => {
            frame = next;
            listeners.forEach((l) => l());
        },
    };
}

/** The two on-screen points embers fly between. Filled by the views' refs. */
export type BankingAnchor = "flame" | "avatar";

interface DailyBankingContextValue {
    store: FrameStore;
    anchors: Record<BankingAnchor, { current: HTMLElement | null }>;
}

const DailyBankingContext = createContext<DailyBankingContextValue | null>(null);

/** Used when no provider is mounted: a store that is always empty and never notifies. */
const EMPTY_STORE: FrameStore = {
    subscribe: () => () => {},
    getSnapshot: () => null,
    set: () => {},
};

/**
 * A rAF gap longer than this is treated as the tab having been hidden (rAF stops while
 * it is), and the run's clock is shifted forward by the gap — so a backgrounded tab
 * PAUSES the animation rather than jumping to its end on return.
 */
const MAX_FRAME_GAP_MS = 100;

/**
 * Fetch the summary, decide whether today's run is owed, and if so play it. Lives in
 * the provider so exactly one instance runs per hp mount.
 */
function useDailyBankingRun(store: FrameStore): void {
    const { user, token } = useAuth();
    const language = user?.selectedLanguage || "zh";

    // The legacy summary fetch takes a token; read it from a ref so a silent refresh
    // never re-runs the effect below (CLAUDE.md "Never reload on token refresh").
    const tokenRef = useRef(token);
    useEffect(() => { tokenRef.current = token; }, [token]);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        let rafId = 0;

        (async () => {
            const summary = await fetchLanguageSummary(language, tokenRef.current);
            // The server owns "owed today?" — it compares the streak dates, the client
            // never does. The one override is the validator "always play" toggle (§ 8),
            // honored only on a validator account so a stale localStorage key on a shared
            // device cannot affect a learner. A zero yesterday never plays either way
            // (Q11a): there is nothing to drain.
            const forced = !!user?.isValidator && readBankingAlwaysPlay();
            if (cancelled || !summary || summary.yesterdayMinutes <= 0) return;
            if (!summary.bankingPending && !forced) return;

            // Mark it seen at the START (§ 5): a tab closed mid-run must not replay the
            // run on another device. Fire-and-forget — the run is presentational, so a
            // failed stamp only means it may play once more; it is never worth blocking on.
            markBankingSeen(language).catch((err) => {
                console.warn("[daily-banking] failed to mark the run seen", err);
            });

            const plan = planBankingRun(summary.yesterdayMinutes, summary.todayMinutes);
            let elapsed = 0;
            let last = performance.now();
            const step = (now: number) => {
                if (cancelled) return;
                const gap = now - last;
                last = now;
                // Advance by the real frame time, except across a hidden-tab gap.
                elapsed += gap > MAX_FRAME_GAP_MS ? 0 : gap;
                const frame = sampleBankingRun(plan, elapsed);
                if (frame.done) {
                    // Hand back to the live badge / plain avatar.
                    store.set(null);
                    return;
                }
                store.set(frame);
                rafId = requestAnimationFrame(step);
            };
            store.set(sampleBankingRun(plan, 0));
            rafId = requestAnimationFrame(step);
        })();

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
            store.set(null);
        };
        // Stable identities only: user id + language. A language switch re-checks, and
        // replays for the other language if its run is owed (Q3).
    }, [user?.id, user?.isValidator, language, store]);
}

/** Mounted by HomePage around its screen. Only the hp plays the banking run. */
export function DailyBankingProvider({ children }: { children: React.ReactNode }) {
    const value = useMemo<DailyBankingContextValue>(
        () => ({ store: createFrameStore(), anchors: { flame: { current: null }, avatar: { current: null } } }),
        []
    );
    useDailyBankingRun(value.store);
    return <DailyBankingContext.Provider value={value}>{children}</DailyBankingContext.Provider>;
}

/** The current banking frame, or null when no run is playing (or there is no provider). */
export function useBankingFrame(): BankingFrame | null {
    const store = useContext(DailyBankingContext)?.store ?? EMPTY_STORE;
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * A callback ref that registers an element as one end of the ember path. Returns a
 * harmless no-op ref outside a provider so callers need no branch.
 */
export function useBankingAnchorRef(anchor: BankingAnchor): (node: HTMLElement | null) => void {
    const ctx = useContext(DailyBankingContext);
    return useCallback(
        (node: HTMLElement | null) => {
            if (ctx) ctx.anchors[anchor].current = node;
        },
        [ctx, anchor]
    );
}

/** Read access to both anchors, for the overlay that flies between them. */
export function useBankingAnchors(): DailyBankingContextValue["anchors"] | null {
    return useContext(DailyBankingContext)?.anchors ?? null;
}
