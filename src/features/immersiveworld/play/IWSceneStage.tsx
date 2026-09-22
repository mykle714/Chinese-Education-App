// PIXI's non-eval shader codegen. MUST be first — see ../../nightmarket/pixiRuntime.
import '../../nightmarket/pixiRuntime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Application, extend, useApplication, useTick } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box, IconButton, Tooltip } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import {
  computePedestrianZ, isoToScreen, TILE_HEIGHT, TILE_WIDTH,
} from '../../../engine/market/isometric';
import { buildEditorField, compileMasks, DIRT_FLOOR, type EditorMasks } from '../../../engine/market/farmTerrain';
import EditorTerrainLayer from '../../nightmarket/EditorTerrainLayer';
import FurnitureSprites from '../../nightmarket/FurnitureSprites';
import { useCameraControls } from '../../../hooks/useCameraControls';
import { parseCellKey } from '../../../engine/iw/sceneGraph';
import { resolveTapTarget, type IWTapTarget, type TapBody } from './tapTarget';
import type { IWBodyDrawable } from './iwSceneActors';

// No `Text`: the canvas draws no words at all since the head label became a DOM cpcd
// nametag (2026-09-21). Anything with glyphs in it belongs to the layer above.
extend({ Container, Sprite, Graphics });

/**
 * IWSceneStage — the Pixi host for a scene the learner is standing in (§ 12 phase 2).
 *
 * LAYER: view, and PURE given its props. It owns the camera and the frame loop and nothing
 * else: it does not know what an NPC is, what a turn is, or why anybody is walking. Every
 * decision belongs to `useIWSceneRuntime`, which this component calls once per frame and
 * then draws the answer.
 *
 * ⚠️ **IT REUSES THE NIGHT MARKET'S TERRAIN RENDERER, NOT ITS EDITOR.** `EditorTerrainLayer`
 * is the one mask-driven terrain renderer in the app and a scene's layout is that same mask
 * shape, so the board is drawn by the same code that draws a template. What is deliberately
 * NOT reused is `TemplateEditorViewer`: it is an AUTHORING surface — hover diamonds, paint
 * strokes, rectangle selections, a palette's worth of preview overlays — and none of that
 * belongs in front of a learner. The two share the layer, not the viewer.
 *
 * ⚠️ **TAP ROUTING IS § 14 Q18's RULE, IMPLEMENTED HERE.** A tap means several things, so
 * only the world surface hit-tests, and within the world a BODY wins over the tile beneath
 * it — which is the right default, since you cannot walk onto an occupied tile anyway. The
 * composer and the bubbles live outside this canvas entirely and consume their own taps.
 *
 * ⚠️ **PAN AND ZOOM ARE THE CAMERA'S, TAPS ARE THE GAME'S.** `useCameraControls` claims
 * middle/right-drag and the wheel; left/touch is left alone so a tap is never eaten by a pan.
 * A drag that travels further than {@link TAP_SLOP_PX} is not a tap — the same slop rule
 * `PedestrianLayer` uses, and for the same reason.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 3, § 12 phase 2, § 14 Q18.
 */

/** Pointer travel that still counts as a tap rather than a drag. */
const TAP_SLOP_PX = 10;

/**
 * Whole-number zoom ladder, as everywhere else in this engine — pixel art stays crisp.
 *
 * ⚠️ `MIN_ZOOM` IS THE CRISP FLOOR, NOT A HARD LIMIT: `useCameraControls` still lets a pinch
 * travel below it, that range simply never settles on a rung. It moved to 1 with the default
 * (2026-09-07) so that halving the default did not park the camera ON the floor, where zooming
 * out is the one gesture with nowhere to go.
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/**
 * Halved from 4 on 2026-09-07: a scene opened so close that the room around the conversation
 * was off screen, and the whole point of a scene is that the stall, the seats and the other
 * customers are visible while you talk to one of them.
 */
const DEFAULT_ZOOM = 2;
const ZOOM_STEP = 1;

/** How fast the camera closes on the player, per frame at 60fps. A lerp, not a snap. */
const CAMERA_EASE = 0.12;

/** Padding around a body's texture for hit-testing — a 16×32 sprite is a cruel finger target. */
const BODY_HIT_PAD_PX = 8;

/**
 * WHERE A BODY'S HEAD IS, in world px above the foot anchor — the one number the nametag
 * (and the bubble it grows into) hangs off.
 *
 * ⚠️ **THE TEXTURE BOX IS NOT THE BODY.** The free-farm pack's characters are 48×48 sprites
 * with the figure inked from row 6 to row 46, drawn `anchor={{x:0.5,y:1}}` so the box's BOTTOM
 * sits on the tile. So the visible head is 42px above the anchor, not 48 — and the two
 * offsets below were previously separate hand-tuned multiples of `TILE_HEIGHT` (3.0 and 3.4)
 * that happened to clear it. Derived from one head line instead, so "raise the bubble" is one
 * edit rather than two that can disagree.
 */
const BODY_SPRITE_PX = 48;
const BODY_INK_TOP_PX = 6;
const HEAD_TOP_PX = BODY_SPRITE_PX - BODY_INK_TOP_PX;

/**
 * The gap between the head and the BOTTOM EDGE of whatever the DOM layer hangs there.
 *
 * ⚠️ ONE GAP, NOT TWO, SINCE THE NAMETAG BECAME DOM (2026-09-21). There used to be a second,
 * smaller one for the in-canvas `pixiText` head label, which sat between the head and the
 * bubble. The nametag and the bubble are now the same element in two states
 * (`IWSpeechBubbles`), so they hang off the same anchor by construction and cannot drift
 * apart or overlap each other.
 */
const BUBBLE_GAP_PX = 12;

const PLACE_RING_COLOR = 0xffe1a3;
const FOCUS_RING_COLOR = 0x8fd6ff;

/**
 * The hover highlight, tinted by WHAT the click would select — the same three kinds
 * `resolveTapTarget` returns, in colours the surface already uses for those things, so the
 * highlight reads as "this is the thing you keep seeing ringed" rather than as a fourth idiom.
 */
const HOVER_TINT: Record<IWTapTarget['kind'], number> = {
  body: FOCUS_RING_COLOR,   // the same blue that rings whoever you are addressing
  place: PLACE_RING_COLOR,  // the same amber that rings a pokeable place
  cell: 0xffffff,
};

export interface IWSceneStageProps {
  width: number;
  height: number;
  masks: EditorMasks;
  /** Advance the simulation by `dtMs`. Called once per frame, before drawing. */
  onTick(dtMs: number, nowMs: number): void;
  /** Every body's pose this instant. Called once per frame, after ticking. */
  drawables(nowMs: number): IWBodyDrawable[];
  /** A tap on a walkable tile — move there (§ 14 Q18). */
  onTapCell(col: number, row: number): void;
  /** A tap on a person — address them. Wins over the tile beneath. */
  onTapBody(id: string): void;
  /** A tap on an interactive place — run its script (§ 14 Q43). */
  onTapPlace(tag: string): void;
  /** Places that have an interaction, so they can be ringed as pokeable. */
  places: ReadonlyArray<{ tag: string; cell: string }>;
  /**
   * `SceneGraph.walkable`. Used ONLY by the hit test, where an unwalkable cell means "blocking
   * decor stands here" and so outranks a body's near-miss box — see `tapTarget.ts` rule 2.
   * The renderer does not consult it; terrain is drawn from `masks`.
   */
  walkable: ReadonlySet<string>;
  /** The body the learner is addressing, ringed so "who am I talking to" is never a guess. */
  focusedId: string | null;
  /** Whose body id belongs to the learner, so the camera knows what to follow. */
  playerId: string;
  /**
   * Where each body is ON SCREEN this frame, in canvas pixels — written into every frame so
   * the DOM bubble layer can sit over the right head.
   *
   * ⚠️ A REF, NOT A CALLBACK OR STATE, AND THAT IS THE POINT. Nametags and bubbles are DOM
   * (§ 5.3a: both are `ForeignText`, never a bespoke CJK renderer), so something outside the
   * canvas has to follow a moving sprite at 60fps. Reporting positions through React state would
   * re-render the page every frame; the bubble layer instead reads this ref from its own
   * animation frame and writes a `transform`, touching no React state at all.
   */
  positions: React.MutableRefObject<Map<string, { x: number; y: number }>>;
}

/** The inner scene — everything below lives inside the Pixi `Application`. */
function SceneContents(props: IWSceneStageProps & {
  pan: { x: number; y: number };
  zoom: number;
  onPanChange(pan: { x: number; y: number }): void;
  /** While true the camera rides the avatar; a drag turns it off. */
  following: boolean;
  /** The learner dragged the board. Breaks the follow lock. */
  onPanGesture(): void;
}) {
  const { app, isInitialised } = useApplication();
  const { width, height, masks, onTick, drawables, places, walkable, focusedId, playerId } = props;

  const tiles = useMemo(
    () => buildEditorField(width, height, compileMasks(masks)),
    [width, height, masks],
  );

  // Frame counter: the ONLY per-frame React state in the play surface, and it lives inside the
  // Pixi tree so a frame costs a re-render of this subtree rather than of the page.
  const [, setFrame] = useState(0);
  const nowRef = useRef(performance.now());
  const panRef = useRef(props.pan);
  panRef.current = props.pan;

  // Camera follow, done INSIDE the frame loop rather than in an effect: the drawables array
  // is rebuilt every frame, so an effect keyed on the player object would fire every frame
  // and set state from a render pass. Here it sets state only when the camera actually has
  // somewhere to move, which is nothing at all while the learner stands still.
  const zoomRef = useRef(props.zoom);
  zoomRef.current = props.zoom;
  const onPanChange = props.onPanChange;
  const followingRef = useRef(props.following);
  followingRef.current = props.following;

  useTick(ticker => {
    const dtMs = ticker.deltaMS;
    nowRef.current += dtMs;
    onTick(dtMs, nowRef.current);

    // ⚠️ Read through a ref: the tick callback is registered once, and a stale `false` here
    // would leave the camera unlocked forever after the first re-lock.
    const me = followingRef.current ? drawables(nowRef.current).find(b => b.id === playerId) : null;
    if (me) {
      const target = isoToScreen(me.isoX, me.isoY);
      const want = { x: -target.screenX * zoomRef.current, y: -target.screenY * zoomRef.current };
      const current = panRef.current;
      const next = {
        x: current.x + (want.x - current.x) * CAMERA_EASE,
        y: current.y + (want.y - current.y) * CAMERA_EASE,
      };
      // Eased rather than locked: a hard lock slides an isometric board under every step,
      // which reads as the world moving instead of the person.
      if (Math.abs(next.x - current.x) > 0.05 || Math.abs(next.y - current.y) > 0.05) {
        panRef.current = next;
        onPanChange(next);
      }
    }

    setFrame(f => (f + 1) % 1_000_000);
  });

  const bodies = drawables(nowRef.current);

  // Publish this frame's screen positions for the DOM nametag/bubble layer (see the prop's note).
  // Written during render rather than in an effect because the values are only valid for the
  // frame that produced them, and an effect would deliver them one frame late.
  if (app?.screen) {
    const originX = app.screen.width / 2 + props.pan.x;
    const originY = app.screen.height / 2 + props.pan.y;
    const map = props.positions.current;
    map.clear();
    for (const body of bodies) {
      const { screenX, screenY } = isoToScreen(body.isoX, body.isoY);
      map.set(body.id, {
        x: originX + screenX * props.zoom,
        // A nametag (and the bubble it grows into) hangs above the HEAD, not at the feet the
        // sprite is anchored by. The DOM layer treats this as that element's BOTTOM edge (it
        // applies `translate(-50%,-100%)`).
        y: originY + (screenY - (HEAD_TOP_PX + BUBBLE_GAP_PX)) * props.zoom,
      });
    }
  }

  /**
   * Keep the canvas the size of its box.
   *
   * ⚠️ **`resizeTo` IS NOT A RESIZE OBSERVER.** Pixi's `ResizePlugin` listens to
   * `window.resize` and nothing else, so an element that changes size on its own — which
   * this one does every time a keyboard opens, because `IWPlayPage` reserves the space by
   * shrinking this box — leaves the canvas at its old height. It then overflows its box,
   * paints over the composer, and, since the board is drawn at the CANVAS centre, keeps the
   * scene anchored to a centre that is now behind the keyboard.
   *
   * Handing Pixi the new size fixes all three at once, and the camera needs no help: the
   * world point under the centre is `-pan / zoom`, which does not mention the viewport, so
   * whatever was centred before the crop is still centred after it.
   *
   * `queueResize` rather than `resize` — it coalesces into one animation frame, which matters
   * because the box travels on a 300ms transition and this fires for every frame of it.
   */
  useEffect(() => {
    const target = app?.resizeTo;
    // `resizeTo` may be the window (not ours) or absent before init; neither is observable.
    if (!target || !(target instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => app.queueResize());
    observer.observe(target);
    return () => observer.disconnect();
  }, [app, isInitialised]);

  // ── Textures ──────────────────────────────────────────────────────────────────────────
  const [textures, setTextures] = useState<Map<string, Texture>>(new Map());
  const wanted = bodies.map(b => b.imagePath).filter(Boolean).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    const paths = wanted ? wanted.split('|') : [];
    (async () => {
      const entries = await Promise.all(paths.map(async path => {
        const texture = await Assets.load<Texture>(path);
        texture.source.scaleMode = 'nearest';
        return [path, texture] as const;
      }));
      // Merged rather than replaced: a walk cycle asks for a new frame every eighth of a
      // second, and swapping the map wholesale would drop the frames still being drawn.
      if (!cancelled) setTextures(prev => new Map([...prev, ...entries]));
    })();
    return () => { cancelled = true; };
  }, [wanted]);

  // ── Tap routing (§ 14 Q18) ────────────────────────────────────────────────────────────
  const downAt = useRef({ x: 0, y: 0 });
  /** Where the last pan step was measured from — advanced each move so the drag is relative. */
  const dragFrom = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  /**
   * The pan this drag has accumulated so far.
   *
   * ⚠️ **NOT READ BACK FROM `panRef` MID-DRAG.** That mirror is written during RENDER, so two
   * pointer moves inside one frame would both measure from the same stale pan and the first
   * one's delta would be thrown away — a fast drag would visibly lag the finger. Seeded from
   * the live pan at `pointerdown` instead, which is also the moment any correction elsewhere
   * gets picked up. (The camera passes no `clampPan`, so nothing rewrites what we push and the
   * accumulator cannot drift from the truth within a gesture.)
   */
  const dragPan = useRef({ x: 0, y: 0 });
  const onPanGesture = props.onPanGesture;
  const onTapCell = props.onTapCell;
  const onTapPlace = props.onTapPlace;
  const onTapBody = props.onTapBody;

  /**
   * What the pointer is over, or null. A REF read during render rather than state: this
   * subtree already re-renders every frame (`setFrame`), so the highlight repaints with the
   * next tick at no extra cost, and a `pointermove` that set state would add a second,
   * unsynchronised render at mouse-move rate on top of it.
   */
  const hoverRef = useRef<IWTapTarget | null>(null);

  /**
   * The bodies, as `resolveTapTarget` needs them. Sprite size comes from the LOADED texture,
   * so a body whose frame has not arrived yet contributes no near-miss box — it can still be
   * selected by standing on the pointed-at cell, which is rule 1 and needs no picture.
   */
  const tapBodies = useMemo<TapBody[]>(
    () => bodies.map(b => {
      const texture = textures.get(b.imagePath);
      return {
        id: b.id, isoX: b.isoX, isoY: b.isoY,
        spriteWidth: texture?.width ?? 0, spriteHeight: texture?.height ?? 0,
      };
    }),
    [bodies, textures],
  );
  // Read by the pointer handlers, which are registered once and must not close over a stale
  // frame's bodies — the array is rebuilt every tick.
  const tapBodiesRef = useRef(tapBodies);
  tapBodiesRef.current = tapBodies;

  useEffect(() => {
    if (!app?.stage || !isInitialised) return;
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    /** Screen point → board-local point, with pan and zoom removed. */
    const toLocal = (e: FederatedPointerEvent) => ({
      x: (e.global.x - (app.screen.width / 2 + panRef.current.x)) / zoomRef.current,
      y: (e.global.y - (app.screen.height / 2 + panRef.current.y)) / zoomRef.current,
    });
    const resolve = (e: FederatedPointerEvent) => resolveTapTarget(toLocal(e), {
      boardWidth: width, boardHeight: height,
      bodies: tapBodiesRef.current, places, walkable, playerId, padPx: BODY_HIT_PAD_PX,
    });

    const onDown = (e: FederatedPointerEvent) => {
      downAt.current = { x: e.global.x, y: e.global.y };
      dragFrom.current = { x: e.global.x, y: e.global.y };
      dragPan.current = { ...panRef.current };
      dragging.current = true;
    };
    const endDrag = () => { dragging.current = false; };

    const onMove = (e: FederatedPointerEvent) => {
      // ── Drag-to-pan ───────────────────────────────────────────────────────────────────
      // `pan` is added AFTER the container's scale (`x = screen.width/2 + pan.x`, then
      // `scale={zoom}`), so it is already in screen pixels and the pointer delta transfers
      // one-for-one — no division by zoom.
      if (dragging.current) {
        const from = dragFrom.current;
        // Below the tap slop this is still a tap being made, not a drag. Waiting for the slop
        // is what stops a shaky finger from unlocking the camera on every tap.
        if (Math.hypot(e.global.x - downAt.current.x, e.global.y - downAt.current.y) > TAP_SLOP_PX) {
          onPanGesture();
          dragPan.current = {
            x: dragPan.current.x + (e.global.x - from.x),
            y: dragPan.current.y + (e.global.y - from.y),
          };
          onPanChange(dragPan.current);
          dragFrom.current = { x: e.global.x, y: e.global.y };
          // A drag is not a hover: hide the highlight rather than dragging it along.
          hoverRef.current = null;
          return;
        }
      }

      // Mouse only. A touch pointer "hovers" for exactly as long as a finger is down, so
      // painting a highlight for it would only ever flash under the finger that is already
      // acting; a pen is left out for the same reason.
      if (e.pointerType !== 'mouse') { hoverRef.current = null; return; }
      hoverRef.current = resolve(e);
    };
    const onLeave = () => { hoverRef.current = null; endDrag(); };

    const onUp = (e: FederatedPointerEvent) => {
      endDrag();
      // A drag is a camera pan, not a tap.
      if (Math.hypot(e.global.x - downAt.current.x, e.global.y - downAt.current.y) > TAP_SLOP_PX) return;
      // ⚠️ THE SAME CALL THE HIGHLIGHT WAS PAINTED FROM. See `tapTarget.ts` — one resolver is
      // what makes the indicator a promise rather than a guess.
      const target = resolve(e);
      if (!target) return;
      if (target.kind === 'body') onTapBody(target.id);
      else if (target.kind === 'place') onTapPlace(target.tag);
      else onTapCell(target.col, target.row);
    };

    stage.on('pointerdown', onDown);
    stage.on('pointerup', onUp);
    // A pointer released outside the canvas still ends the drag — without this the board keeps
    // panning when the button comes back down somewhere else.
    stage.on('pointerupoutside', onUp);
    stage.on('globalpointermove', onMove);
    stage.on('pointerleave', onLeave);
    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointerup', onUp);
      stage.off('pointerupoutside', onUp);
      stage.off('globalpointermove', onMove);
      stage.off('pointerleave', onLeave);
    };
  }, [app, isInitialised, width, height, places, walkable, playerId,
      onTapCell, onTapPlace, onTapBody, onPanChange, onPanGesture]);

  /** One tile diamond, at the origin. Positioned and tinted by the node that draws it. */
  const drawHoverCell = useCallback((g: Graphics) => {
    g.clear();
    g.moveTo(0, 0);                              // bottom vertex — the foot point itself
    g.lineTo(TILE_WIDTH / 2, -TILE_HEIGHT / 2);  // right
    g.lineTo(0, -TILE_HEIGHT);                   // top
    g.lineTo(-TILE_WIDTH / 2, -TILE_HEIGHT / 2); // left
    g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.13 });
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.85 });
  }, []);

  const drawPlaceRing = useCallback((g: Graphics) => {
    g.clear();
    for (const place of places) {
      const cell = parseCellKey(place.cell);
      if (!cell) continue;
      const { screenX, screenY } = isoToScreen(cell.col, cell.row);
      g.ellipse(screenX, screenY - TILE_HEIGHT / 2, 12, 6);
    }
    g.stroke({ color: PLACE_RING_COLOR, width: 1, alpha: 0.7 });
  }, [places]);

  const drawFocusRing = useCallback((g: Graphics) => {
    g.clear();
    g.ellipse(0, -2, 9, 4.5);
    g.stroke({ color: FOCUS_RING_COLOR, width: 1.5, alpha: 0.9 });
  }, []);

  if (!app?.renderer) return null;
  const cx = app.screen.width / 2 + props.pan.x;
  const cy = app.screen.height / 2 + props.pan.y;
  const focused = focusedId ? bodies.find(b => b.id === focusedId) : undefined;
  const focusFoot = focused ? isoToScreen(focused.isoX, focused.isoY) : null;
  // The highlight sits on the target's CELL, not under a moving sprite: for a body it is the
  // cell `resolveTapTarget` reported them standing on, so a walking NPC's highlight snaps
  // between tiles rather than sliding, which is what makes it read as "this square".
  const hover = hoverRef.current;
  const hoverFoot = hover ? isoToScreen(hover.col, hover.row) : { screenX: 0, screenY: 0 };

  return (
    <pixiContainer x={cx} y={cy} scale={props.zoom} sortableChildren>
      <EditorTerrainLayer tiles={tiles} />
      {/* Placed FURNITURE. Drawn from the same `masks` the terrain comes from, through the
          shared strip renderer, so a piece depth-sorts per screen column against the bodies
          (`computeLayerZ(..., 'entity')` is the same axis as `computePedestrianZ`): the
          companion passes IN FRONT of a table's near edge and BEHIND its far edge.
          ⚠️ Furniture does not yet BLOCK movement — see docs/LUMEISH_ASSET_PIPELINE.md § 7. */}
      <FurnitureSprites placements={masks.furniture ?? []} />
      <pixiGraphics draw={drawPlaceRing} zIndex={1} eventMode="none" />
      {hover && (
        // Read straight from the ref during render, which is sound here for the reason the
        // ref's own note gives: this subtree already re-renders every frame, so the highlight
        // is never more than one tick stale and costs no render of its own.
        // zIndex 2 — above the terrain and the place rings, below every body, so a highlight
        // on an occupied cell never paints over the person standing on it.
        <pixiGraphics
          draw={drawHoverCell}
          x={hoverFoot.screenX}
          y={hoverFoot.screenY}
          tint={HOVER_TINT[hover.kind]}
          zIndex={2}
          eventMode="none"
        />
      )}
      {focused && focusFoot && (
        <pixiGraphics
          draw={drawFocusRing}
          x={focusFoot.screenX}
          y={focusFoot.screenY}
          zIndex={computePedestrianZ(focused.isoX, focused.isoY) - 1}
          eventMode="none"
        />
      )}
      {bodies.map(body => {
        const texture = textures.get(body.imagePath);
        if (!texture) return null;
        const { screenX, screenY } = isoToScreen(body.isoX, body.isoY);
        return (
          <pixiSprite
            key={body.id}
            // The body id rides on the display object so ONE shared tap handler can resolve
            // which person was hit — a per-body closure would be a new listener every frame.
            label={body.id}
            texture={texture}
            x={screenX}
            y={screenY}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={computePedestrianZ(body.isoX, body.isoY)}
            // ⚠️ NOT INTERACTIVE, DELIBERATELY. Bodies used to carry their own padded hit
            // area and tap handler; a foot-anchored 48px sprite's box reaches three rows
            // BACKWARD in an isometric projection, so it swallowed every tap meant for the
            // furniture behind it. `resolveTapTarget` now hit-tests every pointer in one
            // place, with an explicit priority — and, being the same call the hover highlight
            // is painted from, it cannot disagree with what the learner was shown.
            eventMode="none"
          />
        );
      })}
    </pixiContainer>
  );
}

export default function IWSceneStage(props: IWSceneStageProps) {
  const { containerRef, pan, zoom, setPan, ready } = useCameraControls({
    crispFloor: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    ladderStep: ZOOM_STEP,
    initialZoom: DEFAULT_ZOOM,
    suppressContextMenu: true,
  });

  /**
   * Is the camera riding the avatar?
   *
   * ⚠️ **A DRAG BREAKS THE LOCK, AND NOTHING RE-TAKES IT SILENTLY.** The camera used to follow
   * unconditionally, so the board could not be looked around: any pan the learner made was
   * pulled back to the avatar within a few frames, which reads as the drag not working rather
   * than as a deliberate camera. Now a drag past the tap slop hands control over and KEEPS it —
   * a camera that snapped back on its own would be the same bug wearing a delay. Re-locking is
   * an explicit act, and the button below is the only thing that does it, which is also why the
   * button has to exist: an unlocked camera that has been panned far from the avatar is
   * otherwise a way to lose yourself in your own scene with no way back.
   */
  const [following, setFollowing] = useState(true);
  const unlock = useCallback(() => setFollowing(false), []);

  // The board's floor, read straight off the masks (absent ⇒ dirt) — the SAME derivation
  // `IWSceneMapPanel` makes, so the editor and the scene cannot disagree about it.
  const floorKind = (props.masks.floor ?? DIRT_FLOOR).kind;

  return (
    <Box
      className={`iw-scene-stage iw-scene-stage--floor-${floorKind}`}
      ref={containerRef}
      sx={{
        position: 'absolute', inset: 0, touchAction: 'none',
        // BLACK BEHIND A WOOD BOARD — the same rule, and the same one line, as the editor's
        // `IWSceneMapPanel`. The Pixi canvas is transparent (`backgroundAlpha={0}`), so
        // whatever this Box paints IS the void around the board; a wood floor replaces the
        // dirt slab, leaving the deck with no plateau body, and on the app's light paper that
        // reads as planks lying on a page rather than as a lit platform in the dark. Authoring
        // a scene and standing in it must not look like two different places, which is exactly
        // what a black editor and a white runtime were.
        backgroundColor: floorKind === 'wood' ? '#000' : 'transparent',
      }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <SceneContents
            {...props}
            pan={pan}
            zoom={zoom}
            onPanChange={setPan}
            following={following}
            onPanGesture={unlock}
          />
        </Application>
      )}
      {!following && (
        // Only while unlocked: a permanent recentre button on a camera that is already centred
        // is a control that does nothing, and its absence is what tells the learner the camera
        // is behaving normally again. Re-locking does not teleport — the tick's existing ease
        // glides back, so the way home is legible as movement rather than as a cut.
        <Tooltip title="Follow me again" placement="right">
          <IconButton
            className="iw-scene-stage__recentre"
            aria-label="Re-centre the camera on your character"
            size="small"
            onClick={() => setFollowing(true)}
            sx={{
              position: 'absolute', top: 8, left: 8, zIndex: 2,
              bgcolor: 'background.paper',
              border: 1, borderColor: 'divider',
              boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <MyLocationIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
