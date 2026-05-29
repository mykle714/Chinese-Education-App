import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Application, extend, useApplication, useTick } from "@pixi/react";
import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Application as PixiApplication } from "pixi.js";
import { Box, CircularProgress, Alert } from "@mui/material";
import { API_BASE_URL } from "../../constants";
import type { GameAsset } from "../types";

// Register Pixi.js classes so JSX <pixiContainer />, <pixiSprite />, etc. resolve.
extend({ Container, Sprite, Graphics, Text });

/** Context passed to a game once its Pixi app + textures are mounted. */
export interface GameStageContext {
    app: PixiApplication;
    /** Texture map keyed by `GameAsset.assetId`. */
    textures: Map<string, Texture>;
    viewport: { width: number; height: number };
}

export interface GameStageProps {
    /** Assets to preload as Pixi textures before the scene mounts. */
    assets: GameAsset[];
    /** Called once after all textures load and the Pixi `Application` is ready. */
    onReady?: (ctx: GameStageContext) => void;
    /**
     * Called every Pixi tick with `(dtMs, tMs)`. Use this to advance simulation
     * state. Render through `children` (pixi JSX) rather than mutating refs here.
     */
    onTick?: (dtMs: number, tMs: number) => void;
    /** Pixi scene tree owned by the game (sprites, containers, etc.). */
    children?: ReactNode;
    /** Background fill colour. Defaults to the mobile-demo cream. */
    background?: string;
}

/** Resolve an asset path returned from the backend into a full URL. */
function resolveAssetUrl(imagePath: string): string {
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    if (imagePath.startsWith("/")) return `${API_BASE_URL}${imagePath}`;
    return imagePath;
}

/**
 * Inner Pixi component — has access to the live `Application` via
 * `useApplication`. Owns the per-frame tick and exposes the application + the
 * texture map to the parent so the game can build its scene tree.
 */
function StageInner({
    textures,
    onReady,
    onTick,
    children,
}: {
    textures: Map<string, Texture>;
    onReady?: GameStageProps["onReady"];
    onTick?: GameStageProps["onTick"];
    children?: ReactNode;
}) {
    const { app } = useApplication();
    const tStart = useRef<number | null>(null);
    const readyFired = useRef(false);

    useEffect(() => {
        if (!app || readyFired.current) return;
        readyFired.current = true;
        onReady?.({
            app: app as PixiApplication,
            textures,
            viewport: { width: app.screen.width, height: app.screen.height },
        });
    }, [app, textures, onReady]);

    useTick((ticker) => {
        if (!onTick) return;
        const dtMs = ticker.deltaMS;
        if (tStart.current === null) tStart.current = performance.now();
        const tMs = performance.now() - tStart.current;
        onTick(dtMs, tMs);
    });

    return <>{children}</>;
}

/**
 * Generic Pixi.js host for games.
 *
 * Responsibilities:
 *   - Sizes itself to fill the parent (designed to live inside `ContentArea`
 *     of `MobileDemoFrame`).
 *   - Preloads textures for every asset in `props.assets`, keyed by `assetId`.
 *   - Mounts a single Pixi `Application` and forwards the `app` + texture map
 *     via `onReady`. The game owns its own scene tree through `children`.
 *   - Runs one shared `useTick` and forwards `(dtMs, tMs)` to `onTick`.
 *
 * Games render their actor / sprite layout as pixi JSX `children` (e.g.
 * `<pixiContainer>...<pixiSprite texture={textures.get('hero')} /></pixiContainer>`).
 */
function GameStage({ assets, onReady, onTick, children, background = "#FAFAFB" }: GameStageProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [textures, setTextures] = useState<Map<string, Texture> | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Stable list of (assetId, resolvedUrl) pairs — reloaded only when the
    // asset set actually changes, not on every parent re-render.
    const loadList = useMemo(
        () =>
            assets.map((a) => ({
                assetId: a.assetId,
                url: resolveAssetUrl(a.imagePath),
            })),
        [assets]
    );

    useEffect(() => {
        if (loadList.length === 0) {
            setTextures(new Map());
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const entries = await Promise.all(
                    loadList.map(async ({ assetId, url }) => {
                        const tex = await Assets.load<Texture>(url);
                        return [assetId, tex] as const;
                    })
                );
                if (!cancelled) setTextures(new Map(entries));
            } catch (err) {
                if (!cancelled) setLoadError(`Failed to load game textures: ${err}`);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loadList]);

    if (loadError) {
        return (
            <Box className="game-stage__error" sx={{ p: 3 }}>
                <Alert severity="error">{loadError}</Alert>
            </Box>
        );
    }

    if (!textures) {
        return (
            <Box
                className="game-stage__loading"
                sx={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box
            ref={containerRef}
            className="game-stage"
            sx={{
                flex: 1,
                minHeight: 0,
                width: "100%",
                position: "relative",
                overflow: "hidden",
            }}
        >
            <Application
                resizeTo={containerRef.current ?? undefined}
                background={background}
                antialias
            >
                <StageInner textures={textures} onReady={onReady} onTick={onTick}>
                    {children}
                </StageInner>
            </Application>
        </Box>
    );
}

export default GameStage;
