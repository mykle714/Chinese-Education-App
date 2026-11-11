import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * A `React.lazy` component that can also be told to start loading its chunk BEFORE it is
 * rendered. `React.lazy` only fetches on first render, which for an flp game break is the
 * frame the game mounts on — so the first break of each game showed a spinner where its
 * board should fade in. The break host calls `preload()` the moment the break falls due
 * (useGameBreak → `startPlan`), alongside the board prefetch (docs/FLP_GAME_BREAKS.md § 1).
 *
 * The factory runs once: `preload()` and the lazy render share one promise. A failed import
 * clears it, so a later render retries instead of re-throwing a stale network error.
 *
 * Layer: games runtime (no React state). Used by: every `src/games/flpBreak/*Break.ts`.
 */
// `any`, as `React.lazy`'s own signature has it: any component's props must fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
    preload: () => Promise<unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithPreload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
    let pending: Promise<{ default: T }> | null = null;
    const load = (): Promise<{ default: T }> => {
        pending ??= factory().catch((error: unknown) => {
            pending = null;
            throw error;
        });
        return pending;
    };
    return Object.assign(lazy(load), { preload: load });
}
