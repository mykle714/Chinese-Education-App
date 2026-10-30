import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bandMaterial, CARD_THICKNESS, frozenBobOffsetPx, type CameraView, type WorldRect } from "./iso";
import { STUDY_CAMERA_HEIGHT, easeDive, studyCameraView, type StudyFrame } from "./towerCamera";
import { IMPACT_MS, SKY_DROP } from "./towerResizes";
import { CARD_D, CARD_W, FLOOR_Z } from "./towerPlatforms";
import type { TowerWorldId } from "./towerWorlds";
import { COLORS } from "../../theme/colors";
import type { FlpTowerHost } from "../flashcards/FlashcardsLearnPage/flpTowerHost";
import { CARD_FLY_OUT_MS } from "../flashcards/constants";
import { COVER_LIFT_MS, COVER_RETURN_MS, type TowerCover } from "./TowerCoverCard";

/**
 * useTowerStudy — studying the Deck Tower IN PLACE: the camera dives onto the tower's
 * top card, the flp session is laid over it, and every correct card comes off the tower
 * (docs/DECK_TOWER.md § "Studying the tower").
 *
 * Layer: page logic (feature module `src/features/deckTower`). DeckTowerPage owns the
 * scene and asks this hook for the camera, the tower's count while studying, the drop to
 * draw and the fades; this hook owns the clocks and the flp's host contract
 * (FlpTowerHost). No route change: the session is page state.
 *
 *   idle ──tap──▶ preparing ──(deal loaded + card measured)──▶ diving ──▶ uncovering ──▶ studying
 *     ▲                                                                                    │ back / dry
 *     └──────────────────────────── climbing ◀──────────── covering ◀──────────────────────┘
 *
 *   preparing  the world's PARKED session (below) is un-parked — still invisible — and
 *              its card measured: the camera has to know where the card will be before it
 *              flies there. Waits for the session's deal if it is still loading (or was
 *              re-dealt for being stale). The platform's bob is frozen.
 *   diving     DIVE_MS, easeDive: the tower view → straight down onto the top face, which
 *              lands exactly on the measured card (towerCamera.ts). The camera dives onto
 *              the COUNT card as it stands ("N cards"); the session's cards stay hidden
 *              under it (`cardsCovered`). The page fades its tower UI out and the session's
 *              header and buttons in on `e`.
 *   uncovering the count card is handed to its own layer over the session (TowerCoverCard,
 *              `cover`), which rests a beat and slides it off the deck — uncovering the
 *              session's first card where it lay. Like taking the top card off a real deck.
 *   studying   the camera stands over the top card, at the tower's current height:
 *                - a CORRECT mark takes a card off — the camera follows the top down
 *                  once the flown card has cleared the screen (CARD_DROP_DELAY_MS, then
 *                  CARD_DROP_MS);
 *                - an INCORRECT mark changes nothing here (the flp tucks the card back
 *                  into the deck: FlashCardSection `towerStack`);
 *                - undoing a correct mark puts the card back (UNDO_RISE_MS);
 *                - the tower running OUT while the session still deals (incorrect cards
 *                  coming round again, lent cards) spawns the session's cards back in
 *                  with the sky drop, re-drawn for this camera (`spawn`);
 *                - the session running DRY (nothing left to deal) climbs out.
 *   covering   the count card slides back onto the deck (at the session's tally), covering
 *              the session's card; skipped when the tower has run out (no top card).
 *   climbing   CLIMB_MS, the dive in reverse; then the page reconciles the tower with the
 *              server's real count (`onClimbedOut`).
 *
 * Parked sessions (docs/DECK_TOWER.md § "Studying the tower" → "Parked sessions"): each world's flp session
 * MOUNTS the first time the learner visits that world (`visitedWorld`) and stays mounted,
 * dealt and hidden, for the rest of the page's life — leaving the world does not unmount
 * it, so panning back and forth fetches nothing, and a tap dives at once onto a session
 * that is already laid out. A visit's climb-out parks it again with its working loop kept;
 * a session parked longer than PARKED_LOOP_FRESH_MS is re-dealt (remounted) on its next
 * tap instead, since cards come off cooldown meanwhile. `sessions` lists them for the page.
 *
 * Hiding the platform (docs/DECK_TOWER.md § "Studying the tower" → "Hiding the platform"):
 * with the study header's toggle on (`platformHidden`), the page fades the whole platform
 * out ON THE DIVE and back in on the climb (`platformOpacity`, on the dive's eased `e`) —
 * the cards float on the sky. The deck itself does NOT fade: the page keeps it drawn over
 * the fade (DeckTowerPlatform `keepDeck`), so the dive still lands on the count card, it
 * still slides off and back on, and the session's own fade stays hidden under it. The
 * camera then stops following the tower: a correct mark's drop, an undo's rise and a
 * spawn's sky drop are all skipped (the count still changes), and the camera snaps back
 * onto the tower's real top when the platform comes back (the toggle turned off, or the
 * climb-out's own settle in `climbOut`).
 *
 * The study surface earns minute points while `studying` (the page claims it —
 * src/minutePoints/studySurface.ts).
 *
 * Depended on by: DeckTowerPage.tsx. Depends on: towerCamera.ts, towerResizes.ts
 * (`SKY_DROP`'s timing, reused), TowerCoverCard.tsx (its timings), flpTowerHost.ts.
 */

export type TowerStudyPhase = "idle" | "preparing" | "diving" | "uncovering" | "studying" | "covering" | "climbing";

/** The dive onto the card, and the climb back out. */
const DIVE_MS = 550;
const CLIMB_MS = 480;
/** The camera following the tower's top down one card (a correct mark), and back up (its undo). */
const CARD_DROP_MS = 240;
const UNDO_RISE_MS = 380;
/**
 * A correct mark's camera drop waits this long after the swipe, so the zoom plays as the
 * flown card has fully left the screen rather than underneath it — the whole fly-out
 * (CARD_FLY_OUT_MS), so the two stay in step if the fly-out is retuned.
 * The drop is short (CARD_DROP_MS) so the one-card zoom reads as a punch, not a drift.
 */
const CARD_DROP_DELAY_MS = CARD_FLY_OUT_MS;
/** The session running dry: how long its last card has to fly off before the camera climbs out. */
const DRY_CLIMB_DELAY_MS = 700;
/** Give up waiting for the session's card to measure after this, and dive onto the fallback frame. */
const PREPARE_TIMEOUT_MS = 5000;
/**
 * A parked session's deal is used for a tap this long after it was dealt or last studied;
 * past it, the tap re-deals (cards have come off cooldown meanwhile). The same window as
 * flpLaunch.ts's preloaded loops (`LOOP_FRESH_MS`).
 */
const PARKED_LOOP_FRESH_MS = 5 * 60_000;
/**
 * A spawn's drop starts this far above its landing, as a share of the camera's height over
 * the top: just short of the camera, so the falling stack swells past the screen's edges
 * as it starts (iso/camera.ts clamps anything closer).
 */
const SPAWN_LIFT_SHARE = 0.85;
/** World units the platform sinks under a spawn's landing (DeckTowerPlatform's `IMPACT_SINK`). */
const SPAWN_IMPACT_SINK = 0.55;

/** A spawn's sky drop, as the page draws it. */
export interface StudyDrop {
    key: number;
    /** Cards in the falling stack. */
    cards: number;
    /** World z of its underside right now; null once it has landed (the tower stands at `cards` then). */
    baseZ: number | null;
    /** Bumped when it lands — the page keys the landing's smoke on it. */
    landedKey: number | null;
}

export interface TowerStudy {
    phase: TowerStudyPhase;
    /** Anything other than idle: the tower page is handed over to the session. */
    active: boolean;
    /** The world being studied. */
    world: TowerWorldId | null;
    /** The studied tower's count while active (the page draws this instead of its own). */
    cards: number;
    /** The tower count the scene stays FITTED to while active (the count at the tap). */
    fitCards: number;
    /** The camera, or null in the plain tower view (idle, preparing). */
    view: CameraView | null;
    /** The dive's position, 0 (tower view) → 1 (on the card). */
    e: number;
    /** The camera's height over the floor (the top face it looks at), world z. */
    cameraZ: number;
    /** The viewBox y on the tower's axis where the screen's middle stood at the tap (the sky's altitude then). */
    startMidY: number;
    drop: StudyDrop | null;
    /**
     * Every mounted flp session (one per visited world), with its host contract; the one
     * being studied has `host.parked` false. `key` changes when a stale session is re-dealt
     * (the page remounts it).
     */
    sessions: TowerStudySession[];
    /** The camera is down on the card (uncovering, studying, covering): the session owns the screen. */
    cameraDown: boolean;
    /**
     * The scene's top card shows its print. Off while the count card is its own layer or
     * off the deck (uncovering → covering): the session's cards lie on a bare top then.
     */
    towerPrintShown: boolean;
    /** The count card as its own layer (TowerCoverCard), while it slides off or back on. */
    cover: TowerCover | null;
    /**
     * The studied platform's opacity, for the "hide the platform" toggle: 1 with the toggle
     * off; on, it tracks the camera — out on the dive (1 − `e`), 0 while down, back in on the
     * climb. The camera does not follow the tower while it is hidden.
     */
    platformOpacity: number;
    /**
     * Ease `platformOpacity`'s changes (a CSS transition): only while the camera is down,
     * where it changes by the toggle. On the dive and the climb it is per frame already.
     */
    platformFadeEased: boolean;
    /** Start a session on `world`'s tower of `cards` cards (the stack tap). */
    start: (args: { world: TowerWorldId; cards: number; svg: SVGSVGElement; viewBox: SceneBox; startMidY: number }) => void;
}

/** A mounted flp session (see "Parked sessions" above). */
export interface TowerStudySession {
    world: TowerWorldId;
    key: string;
    host: FlpTowerHost;
}

type LoopReport = Parameters<FlpTowerHost["onLoopChange"]>[0];

/** What a session reports through, made once per world so a parked session's host is stable. */
interface WorldHandles {
    onExit: () => void;
    onMarked: (isCorrect: boolean) => void;
    onUndone: (wasCorrect: boolean) => void;
    onLoopChange: (loop: LoopReport) => void;
    cardFrameRef: (el: HTMLDivElement | null) => void;
}

/** The scene svg's viewBox (only what the screen ↔ viewBox mapping needs). */
export interface SceneBox {
    minX: number;
    minY: number;
    width: number;
}

/**
 * The session's plate-style buttons (Write it, Compare, More Info — the flp's towerPlate.ts):
 * the floor plate's slab in WHITE, per the design — its walls stepped down from white the
 * way a plate's are from its band (`bandMaterial`), so they read as light greys.
 */
const STUDY_PLATE_TONES = bandMaterial(COLORS.white);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (u: number) => 1 - Math.pow(1 - clamp01(u), 3);
/** World z of the top face of a tower of `cards` cards (the floor when empty). */
const topZOf = (cards: number) => FLOOR_Z + Math.max(0, cards) * CARD_THICKNESS;

/**
 * The landing's blow, as a share of SPAWN_IMPACT_SINK over the impact's 0 → 1: down fast,
 * back up past rest, a small settle — DeckTowerPlatform's `deck-tower-platform-sink`
 * keyframes, as a function (this camera cannot use a screen-y CSS slide).
 */
function impactSink(u: number): number {
    const keys: [number, number][] = [[0, 0], [0.16, 1], [0.46, -0.28], [0.72, 0.08], [1, 0]];
    const t = clamp01(u);
    for (let i = 1; i < keys.length; i++) {
        const [t1, v1] = keys[i];
        const [t0, v0] = keys[i - 1];
        if (t <= t1) {
            const k = (t - t0) / (t1 - t0);
            return v0 + (v1 - v0) * (0.5 - Math.cos(k * Math.PI) / 2);
        }
    }
    return 0;
}

/** Where the card lands when the session's own card could not be measured: centred, phone-card sized. */
function fallbackFrame(svg: SVGSVGElement, box: SceneBox): StudyFrame {
    const r = svg.getBoundingClientRect();
    const scale = r.width / box.width;
    const width = (window.innerWidth * 0.76) / scale;
    const height = (width * CARD_D) / CARD_W;
    const midY = box.minY + (window.innerHeight * 0.48 - r.top) / scale;
    return { left: box.minX + box.width / 2 - width / 2, top: midY - height / 2, width, height };
}

/** The element's screen box in the scene's viewBox units. */
function toSceneFrame(el: Element, svg: SVGSVGElement, box: SceneBox): StudyFrame | null {
    const r = el.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || s.width <= 0) return null;
    const scale = s.width / box.width;
    return {
        left: box.minX + (r.left - s.left) / scale,
        top: box.minY + (r.top - s.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
    };
}

export function useTowerStudy(opts: {
    /** Screen px per world unit of the scene's fixed view. */
    unit: number;
    /** The tower's footprint. */
    card: WorldRect;
    /** The world on screen, whose session mounts (parked) on the visit; null mounts nothing. */
    visitedWorld: TowerWorldId | null;
    /** The study header's title for a world. */
    titleFor: (world: TowerWorldId) => string;
    /** The study header's "hide the platform" toggle (studyPlatformStore.ts), and its setter. */
    platformHidden: boolean;
    onPlatformHiddenChange: (hidden: boolean) => void;
    /** The climb has ended: the tower stands at `cards` again in the tower view. */
    onClimbedOut: (world: TowerWorldId, cards: number) => void;
}): TowerStudy {
    const { unit, card } = opts;
    const [phase, setPhase] = useState<TowerStudyPhase>("idle");
    const [world, setWorld] = useState<TowerWorldId | null>(null);
    const [cards, setCards] = useState(0);
    const [fitCards, setFitCards] = useState(0);
    const [u, setU] = useState(0);
    const [cameraZ, setCameraZ] = useState(0);
    const [frame, setFrame] = useState<StudyFrame | null>(null);
    const [bobY, setBobY] = useState(0);
    const [startMidY, setStartMidY] = useState(0);
    const [drop, setDrop] = useState<StudyDrop | null>(null);
    const [cardsHidden, setCardsHidden] = useState(false);
    const [dealReady, setDealReady] = useState(false);
    // The count card's slide (TowerCoverCard), and the card frame's screen box it lies on.
    const [coverMode, setCoverMode] = useState<TowerCover["mode"] | null>(null);
    const [coverBox, setCoverBox] = useState<TowerCover["box"] | null>(null);
    // The mounted sessions' worlds, in visit order, and each one's deal generation (bumped
    // to remount — re-deal — a stale one).
    const [mountedWorlds, setMountedWorlds] = useState<TowerWorldId[]>([]);
    const [dealKeys, setDealKeys] = useState<Partial<Record<TowerWorldId, number>>>({});

    // Read by the stable callbacks below (the flp holds them for the whole session).
    const latest = useRef({ phase, cards, cameraZ, world, u, opts });
    latest.current = { phase, cards, cameraZ, world, u, opts };
    const sceneRef = useRef<{ svg: SVGSVGElement; box: SceneBox } | null>(null);
    // Per mounted session: its last loop report, its card frame's element, and when its deal
    // was last fresh (dealt, or studied up to the climb-out).
    const loops = useRef(new Map<TowerWorldId, LoopReport>());
    const frameEls = useRef(new Map<TowerWorldId, HTMLDivElement>());
    const freshAt = useRef(new Map<TowerWorldId, number>());
    /** The studied session's last loop report (still loading when none has come in). */
    const studiedLoop = (): LoopReport => {
        const w = latest.current.world;
        return (w && loops.current.get(w)) || { size: 0, loading: true, hasCard: false };
    };
    const timers = useRef<number[]>([]);
    const zFrame = useRef(0);
    const dropFrame = useRef(0);
    const nextKey = useRef(1);

    const clearClocks = useCallback(() => {
        for (const t of timers.current) window.clearTimeout(t);
        timers.current = [];
        cancelAnimationFrame(zFrame.current);
        cancelAnimationFrame(dropFrame.current);
    }, []);
    useEffect(() => clearClocks, [clearClocks]);

    /** Ease the camera's height to `to` over `ms` (cancelling any height move in flight). */
    const moveCameraZ = useCallback((to: number, ms: number) => {
        cancelAnimationFrame(zFrame.current);
        const from = latest.current.cameraZ;
        const t0 = performance.now();
        const tick = (now: number) => {
            const k = (now - t0) / ms;
            setCameraZ(from + (to - from) * easeOutCubic(k));
            if (k < 1) zFrame.current = requestAnimationFrame(tick);
        };
        zFrame.current = requestAnimationFrame(tick);
    }, []);

    // ── Parked sessions: mount each world's on its first visit ─────────────────
    const { visitedWorld } = opts;
    useEffect(() => {
        if (visitedWorld === null) return;
        setMountedWorlds((ws) => {
            if (ws.includes(visitedWorld)) return ws;
            freshAt.current.set(visitedWorld, Date.now());
            return [...ws, visitedWorld];
        });
    }, [visitedWorld]);

    // ── Start ─────────────────────────────────────────────────────────────────
    const start: TowerStudy["start"] = useCallback(
        ({ world: w, cards: n, svg, viewBox, startMidY: midY }) => {
            if (latest.current.phase !== "idle") return;
            sceneRef.current = { svg, box: viewBox };
            const now = Date.now();
            const mounted = freshAt.current.has(w);
            if (!mounted) {
                // Tapped before the visit effect mounted it: mount it now.
                freshAt.current.set(w, now);
                setMountedWorlds((ws) => (ws.includes(w) ? ws : [...ws, w]));
            } else if (now - (freshAt.current.get(w) ?? now) > PARKED_LOOP_FRESH_MS) {
                // Parked too long: re-deal. The remounted session fetches its own loop.
                loops.current.delete(w);
                freshAt.current.set(w, now);
                setDealKeys((k) => ({ ...k, [w]: (k[w] ?? 0) + 1 }));
            }
            setWorld(w);
            setCards(n);
            setFitCards(n);
            setCameraZ(topZOf(n));
            setU(0);
            setFrame(null);
            setDrop(null);
            setCardsHidden(false);
            setStartMidY(midY);
            setDealReady(false);
            setCoverMode(null);
            setPhase("preparing");
            // A parked session already dealt dives at once; one still loading (or just
            // re-dealt) is waited for — its `onLoopChange` sets this.
            const loop = loops.current.get(w);
            setDealReady(loop !== undefined && !loop.loading);
            // The parked card is already laid out: measure it now rather than on a resize.
            measureFrameOf(w);
        },
        []
    );

    // ── The card's frame ──────────────────────────────────────────────────────
    // The studied session's card box, measured into the scene's viewBox units whenever it
    // moves or resizes (the eip sheet, the edit toolbar, its header mounting as it is
    // un-parked). The scroller is locked while a session is up, so the svg does not move
    // under it. Every mounted session reports its frame (WorldHandles `cardFrameRef`); only
    // the studied one's is measured.
    function measureFrameOf(w: TowerWorldId | null) {
        const scene = sceneRef.current;
        const el = w ? frameEls.current.get(w) : undefined;
        if (!scene || !el) return;
        const f = toSceneFrame(el, scene.svg, scene.box);
        if (f) setFrame(f);
    }
    const measureFrame = useCallback(() => measureFrameOf(latest.current.world), []);
    useEffect(() => {
        window.addEventListener("resize", measureFrame);
        return () => window.removeEventListener("resize", measureFrame);
    }, [measureFrame]);

    /**
     * Start the count card's slide (`mode`) over the card frame as it stands on screen now,
     * then go to `then` once it has played. Returns false when there is no frame to lie on.
     */
    const slideCover = useCallback((mode: TowerCover["mode"], ms: number, then: TowerStudyPhase) => {
        const w = latest.current.world;
        const r = (w ? frameEls.current.get(w) : undefined)?.getBoundingClientRect();
        if (!r || r.width <= 0) return false;
        setCoverBox({ left: r.left, top: r.top, width: r.width, height: r.height });
        setCoverMode(mode);
        const t = window.setTimeout(() => {
            // One commit: the layer goes as the phase lands, so the scene's top card (or the
            // session's card) takes over in the same frame.
            setCoverMode(null);
            setPhase(then);
        }, ms);
        timers.current.push(t);
        return true;
    }, []);

    // preparing → diving, once the deal is in and the card measured (or on the timeout).
    useEffect(() => {
        if (phase !== "preparing") return;
        const begin = () => {
            const scene = sceneRef.current;
            // The bob was frozen on the tap (the page pauses it while active); aim for it.
            setBobY(frozenBobOffsetPx(scene?.svg ?? null));
            setPhase("diving");
        };
        if (dealReady && frame) {
            // The session settles its card slot over its first frames (its slot padding is
            // measured in a layout effect, the pill after it), and a move without a resize
            // never reaches the ResizeObserver — so measure once more, two frames on, then go.
            let raf = requestAnimationFrame(() => {
                raf = requestAnimationFrame(() => {
                    measureFrame();
                    begin();
                });
            });
            return () => cancelAnimationFrame(raf);
        }
        const t = window.setTimeout(() => {
            const scene = sceneRef.current;
            if (scene) setFrame((f) => f ?? fallbackFrame(scene.svg, scene.box));
            begin();
        }, PREPARE_TIMEOUT_MS);
        return () => window.clearTimeout(t);
    // `frame` changing re-runs this; the re-measure inside sets the same frame, so it settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, dealReady, frame !== null]);

    // The dive and the climb: one clock each, driving `u`.
    useEffect(() => {
        if (phase !== "diving" && phase !== "climbing") return;
        const diving = phase === "diving";
        // A climb can cut a dive short: it flies back from wherever the dive had got to,
        // in proportionally less time.
        const fromU = diving ? 0 : latest.current.u;
        const ms = diving ? DIVE_MS : Math.max(1, CLIMB_MS * fromU);
        const t0 = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const k = clamp01((now - t0) / ms);
            setU(diving ? k : fromU * (1 - k));
            if (k < 1) {
                raf = requestAnimationFrame(tick);
                return;
            }
            if (diving) {
                // Down on the count card: slide it off the deck to show the first card.
                setPhase("uncovering");
                if (!slideCover("lifting", COVER_LIFT_MS, "studying")) setPhase("studying");
                return;
            }
            // Climbed out: the page takes the tower back at the height it now stands at.
            const { world: w, cards: n } = latest.current;
            if (w) {
                // Parked again: its loop was live until now.
                freshAt.current.set(w, Date.now());
                latest.current.opts.onClimbedOut(w, n);
            }
            setPhase("idle");
            setWorld(null);
            setDrop(null);
            setCardsHidden(false);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    // `slideCover` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // ── Leaving ───────────────────────────────────────────────────────────────
    const climbOut = useCallback(() => {
        const p = latest.current.phase;
        if (p !== "studying" && p !== "uncovering" && p !== "diving" && p !== "preparing") return;
        clearClocks();
        setDrop(null);
        setCardsHidden(false);
        setCoverMode(null);
        // Settle the camera on the tower's real top before flying out.
        setCameraZ(topZOf(latest.current.cards));
        if (p === "preparing") {
            setPhase("idle");
            setWorld(null);
            return;
        }
        // Down on the deck: put the count card back on it first (there is none to put back
        // on a tower that has run out). Mid-dive the count card never came off.
        if (p !== "diving" && latest.current.cards > 0) {
            setPhase("covering");
            if (slideCover("returning", COVER_RETURN_MS, "climbing")) return;
        }
        setPhase("climbing");
    }, [clearClocks, slideCover]);

    // ── A spawn: the tower ran out while the session still deals ──────────────
    // The session's cards drop back onto the empty floor — the sky drop, re-drawn for this
    // camera: the stack is re-projected every frame (it falls TOWARD the floor, away from a
    // camera looking straight down, so it shrinks rather than slides), the platform's sink
    // is a bump of the camera's height, and the cards stay hidden until it has landed.
    const spawn = useCallback(
        (n: number) => {
            // The platform hidden: no drop to watch — the tower simply stands at `n` again,
            // and the cards stay up.
            if (latest.current.opts.platformHidden) {
                setCards(n);
                return;
            }
            const lift = STUDY_CAMERA_HEIGHT * SPAWN_LIFT_SHARE;
            const plan = SKY_DROP.plan({ fromCards: 0, toCards: n, skyAbove: lift, cameraMs: 0 });
            if (plan.kind !== "sky-drop") return;
            const { fallMs } = plan.drop;
            const key = nextKey.current++;
            const landing = topZOf(n);
            setCardsHidden(true);
            cancelAnimationFrame(zFrame.current);
            setCameraZ(landing);
            const t0 = performance.now();
            const tick = (now: number) => {
                const t = now - t0;
                if (t < fallMs) {
                    // Free fall from rest: the height lost grows with t².
                    const k = t / fallMs;
                    setDrop({ key, cards: n, baseZ: FLOOR_Z + lift * (1 - k * k), landedKey: null });
                } else if (t < fallMs + IMPACT_MS) {
                    if (latest.current.cards !== n) setCards(n);
                    setDrop({ key, cards: n, baseZ: null, landedKey: key });
                    setCameraZ(landing + SPAWN_IMPACT_SINK * impactSink((t - fallMs) / IMPACT_MS));
                } else {
                    setCameraZ(landing);
                    setDrop(null);
                    setCardsHidden(false);
                    return;
                }
                dropFrame.current = requestAnimationFrame(tick);
            };
            dropFrame.current = requestAnimationFrame(tick);
        },
        []
    );

    /** After the last card on the tower went: spawn what the session still deals, or leave. */
    const afterTowerEmptied = useCallback(() => {
        const t = window.setTimeout(() => {
            if (latest.current.phase !== "studying" || latest.current.cards > 0) return;
            const loop = studiedLoop();
            if (loop.hasCard) spawn(Math.max(1, loop.size));
            else if (!loop.loading) climbOut();
        }, CARD_FLY_OUT_MS);
        timers.current.push(t);
    }, [spawn, climbOut]);

    // ── The flp's reports ─────────────────────────────────────────────────────
    // Each session reports through its own world's handles; only the studied session's
    // reports move the tower (a parked one cannot be swiped, but its loop reports land
    // here as it deals, and are kept for its next tap).
    const isStudied = (w: TowerWorldId) => latest.current.world === w;
    const onMarked = useCallback(
        (isCorrect: boolean) => {
            if (latest.current.phase !== "studying" || !isCorrect) return;
            const next = Math.max(0, latest.current.cards - 1);
            // The count drops at the swipe (undo and the empty-tower check read it); only the
            // camera waits for the card to leave. The target is read when the timer fires,
            // so an undo or a second swipe inside the delay lands on the tower as it stands.
            setCards(next);
            const t = window.setTimeout(() => {
                // No zoom with the platform hidden: nothing on screen to follow down.
                if (latest.current.phase !== "studying" || latest.current.opts.platformHidden) return;
                moveCameraZ(topZOf(latest.current.cards), CARD_DROP_MS);
            }, CARD_DROP_DELAY_MS);
            timers.current.push(t);
            if (next === 0) afterTowerEmptied();
        },
        [moveCameraZ, afterTowerEmptied]
    );
    const onUndone = useCallback(
        (wasCorrect: boolean) => {
            if (latest.current.phase !== "studying" || !wasCorrect) return;
            const next = latest.current.cards + 1;
            setCards(next);
            if (!latest.current.opts.platformHidden) moveCameraZ(topZOf(next), UNDO_RISE_MS);
        },
        [moveCameraZ]
    );
    const onStudiedLoopChange = useCallback(
        (loop: LoopReport) => {
            const p = latest.current.phase;
            // The deal the tap is waiting on has come in.
            if (p === "preparing" && !loop.loading) setDealReady(true);
            // Nothing left to deal (every card resting): fly back out once the last card is gone.
            if (p === "studying" && !loop.loading && !loop.hasCard) {
                const t = window.setTimeout(() => {
                    if (!studiedLoop().hasCard) climbOut();
                }, DRY_CLIMB_DELAY_MS);
                timers.current.push(t);
            }
        },
        [climbOut]
    );

    // Made once per world (the callbacks they wrap are stable), so a parked session's host
    // keeps its identity and the memoised session never re-renders for the tower's frames.
    const handles = useRef(new Map<TowerWorldId, WorldHandles>());
    const frameObservers = useRef(new Map<TowerWorldId, ResizeObserver>());
    const handlesFor = (w: TowerWorldId): WorldHandles => {
        let h = handles.current.get(w);
        if (h) return h;
        h = {
            onExit: () => { if (isStudied(w)) climbOut(); },
            onMarked: (isCorrect) => { if (isStudied(w)) onMarked(isCorrect); },
            onUndone: (wasCorrect) => { if (isStudied(w)) onUndone(wasCorrect); },
            onLoopChange: (loop) => {
                loops.current.set(w, loop);
                if (isStudied(w)) onStudiedLoopChange(loop);
            },
            cardFrameRef: (el) => {
                frameObservers.current.get(w)?.disconnect();
                frameObservers.current.delete(w);
                if (!el) {
                    frameEls.current.delete(w);
                    return;
                }
                frameEls.current.set(w, el);
                if (isStudied(w)) measureFrame();
                if (typeof ResizeObserver !== "undefined") {
                    const ro = new ResizeObserver(() => { if (isStudied(w)) measureFrame(); });
                    ro.observe(el);
                    frameObservers.current.set(w, ro);
                }
            },
        };
        handles.current.set(w, h);
        return h;
    };
    useEffect(() => () => {
        for (const ro of frameObservers.current.values()) ro.disconnect();
    }, []);

    // The platform coming back mid-session (the toggle turned off): the camera has stood
    // still since it was hidden, so put it back on the tower's real top — while the fade-in
    // is still at nothing. (Leaving brings it back through climbOut's own settle.)
    const { platformHidden } = opts;
    useEffect(() => {
        if (platformHidden || latest.current.phase !== "studying") return;
        cancelAnimationFrame(zFrame.current);
        setCameraZ(topZOf(latest.current.cards));
    }, [platformHidden]);

    // A session that ran dry before the camera was down (every card resting from the start)
    // climbs straight back out once it is.
    useEffect(() => {
        if (phase !== "studying") return;
        const loop = studiedLoop();
        if (loop.loading || loop.hasCard) return;
        const t = window.setTimeout(() => {
            if (!studiedLoop().hasCard) climbOut();
        }, DRY_CLIMB_DELAY_MS);
        timers.current.push(t);
    }, [phase, climbOut]);

    // Parked hosts, one per world, kept by identity until the world's deal is re-keyed.
    const parkedHosts = useRef(new Map<TowerWorldId, FlpTowerHost>());
    const parkedHostFor = (w: TowerWorldId): FlpTowerHost => {
        let h = parkedHosts.current.get(w);
        if (h) return h;
        const { onExit, onMarked: marked, onUndone: undone, onLoopChange, cardFrameRef } = handlesFor(w);
        h = {
            world: w,
            parked: true,
            title: latest.current.opts.titleFor(w),
            onExit,
            onMarked: marked,
            onUndone: undone,
            onLoopChange,
            cardsHidden: false,
            // A parked session draws no header and flips nothing; the studied host carries
            // the live toggle (this one is cached by identity, so it would only go stale).
            platformHidden: false,
            onPlatformHiddenChange: latest.current.opts.onPlatformHiddenChange,
            // Hidden at once, like under the count card (the page also hides the layer).
            cardsCovered: true,
            cardFrameRef,
            plateTones: STUDY_PLATE_TONES,
        };
        parkedHosts.current.set(w, h);
        return h;
    };

    const { onPlatformHiddenChange } = opts;
    const sessions: TowerStudySession[] = useMemo(
        () =>
            mountedWorlds.map((w) => {
                const key = `${w}:${dealKeys[w] ?? 0}`;
                if (w !== world) return { world: w, key, host: parkedHostFor(w) };
                const { onExit, onMarked: marked, onUndone: undone, onLoopChange, cardFrameRef } = handlesFor(w);
                const host: FlpTowerHost = {
                    world: w,
                    parked: false,
                    title: latest.current.opts.titleFor(w),
                    onExit,
                    onMarked: marked,
                    onUndone: undone,
                    onLoopChange,
                    cardsHidden,
                    platformHidden,
                    onPlatformHiddenChange,
                    // Under the count card: the dive (it has not come off yet), the climb
                    // (it is back on) — and before both, while the session is measured.
                    cardsCovered: phase === "preparing" || phase === "diving" || phase === "climbing",
                    cardFrameRef,
                    plateTones: STUDY_PLATE_TONES,
                };
                return { world: w, key, host };
            }),
        // `handlesFor` / `parkedHostFor` read refs and stable callbacks only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mountedWorlds, dealKeys, world, phase, cardsHidden, platformHidden, onPlatformHiddenChange]
    );

    const e = easeDive(u);
    const cameraDown = phase === "uncovering" || phase === "studying" || phase === "covering";
    const showCamera = cameraDown || phase === "diving" || phase === "climbing";
    const view = useMemo(
        () => (showCamera && frame ? studyCameraView(e, { unit, card, topZ: cameraZ, frame, bobY }) : null),
        [showCamera, frame, e, unit, card, cameraZ, bobY]
    );

    // The count card as its own layer: the camera's on-the-card view with no bob (the layer
    // lies on the card frame itself, where the bobbing platform's face is aimed to land).
    const cover: TowerCover | null = useMemo(() => {
        if (coverMode === null || coverBox === null || frame === null) return null;
        const topZ = topZOf(cards);
        return {
            mode: coverMode,
            box: coverBox,
            frame,
            view: studyCameraView(1, { unit, card, topZ, frame, bobY: 0 }),
            card,
            topZ,
            count: cards,
        };
    }, [coverMode, coverBox, frame, unit, card, cards]);

    return {
        phase,
        active: phase !== "idle",
        world,
        cards,
        fitCards,
        view,
        e: showCamera ? e : 0,
        cameraZ,
        startMidY,
        drop,
        sessions,
        cameraDown,
        towerPrintShown: !cameraDown,
        cover,
        platformOpacity: !platformHidden ? 1 : cameraDown ? 0 : phase === "diving" || phase === "climbing" ? 1 - e : 1,
        platformFadeEased: cameraDown,
        start,
    };
}
