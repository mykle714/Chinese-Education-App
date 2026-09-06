// PIXI's non-eval shader codegen. MUST be first — see ../../nightmarket/pixiRuntime.
import '../../nightmarket/pixiRuntime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Application, extend, useApplication, useTick } from '@pixi/react';
import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Box } from '@mui/material';
import {
  computePedestrianZ, isoToScreen, screenToCell, TILE_HEIGHT,
} from '../../../engine/market/isometric';
import { buildEditorField, compileMasks, type EditorMasks } from '../../../engine/market/farmTerrain';
import EditorTerrainLayer from '../../nightmarket/EditorTerrainLayer';
import { useCameraControls } from '../../../hooks/useCameraControls';
import { parseCellKey } from '../../../engine/iw/sceneGraph';
import type { IWBodyDrawable } from './iwSceneActors';

extend({ Container, Sprite, Graphics, Text });

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

/** Whole-number zoom ladder, as everywhere else in this engine — pixel art stays crisp. */
const MIN_ZOOM = 2;
const MAX_ZOOM = 8;
const DEFAULT_ZOOM = 4;
const ZOOM_STEP = 1;

/** How fast the camera closes on the player, per frame at 60fps. A lerp, not a snap. */
const CAMERA_EASE = 0.12;

/** Padding around a body's texture for hit-testing — a 16×32 sprite is a cruel finger target. */
const BODY_HIT_PAD_PX = 8;

const PLACE_RING_COLOR = 0xffe1a3;
const FOCUS_RING_COLOR = 0x8fd6ff;
const LABEL_STYLE = { fontFamily: 'monospace', fontSize: 8, fill: 0xffffff } as const;

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
  /** The body the learner is addressing, ringed so "who am I talking to" is never a guess. */
  focusedId: string | null;
  /** Whose body id belongs to the learner, so the camera knows what to follow. */
  playerId: string;
  /**
   * Where each body is ON SCREEN this frame, in canvas pixels — written into every frame so
   * the DOM bubble layer can sit over the right head.
   *
   * ⚠️ A REF, NOT A CALLBACK OR STATE, AND THAT IS THE POINT. Bubbles are DOM (§ 5.3a: the
   * bubble is `ForeignText`, never a bespoke CJK renderer), so something outside the canvas
   * has to follow a moving sprite at 60fps. Reporting positions through React state would
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
}) {
  const { app, isInitialised } = useApplication();
  const { width, height, masks, onTick, drawables, places, focusedId, playerId } = props;

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

  useTick(ticker => {
    const dtMs = ticker.deltaMS;
    nowRef.current += dtMs;
    onTick(dtMs, nowRef.current);

    const me = drawables(nowRef.current).find(b => b.id === playerId);
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

  // Publish this frame's screen positions for the DOM bubble layer (see the prop's note).
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
        // A bubble hangs above the HEAD, not at the feet the sprite is anchored by.
        y: originY + (screenY - TILE_HEIGHT * 3.4) * props.zoom,
      });
    }
  }

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
  const onTapCell = props.onTapCell;
  const onTapPlace = props.onTapPlace;

  useEffect(() => {
    if (!app?.stage || !isInitialised) return;
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;

    const onDown = (e: FederatedPointerEvent) => { downAt.current = { x: e.global.x, y: e.global.y }; };
    const onUp = (e: FederatedPointerEvent) => {
      if (Math.hypot(e.global.x - downAt.current.x, e.global.y - downAt.current.y) > TAP_SLOP_PX) return;
      const cx = app.screen.width / 2 + panRef.current.x;
      const cy = app.screen.height / 2 + panRef.current.y;
      const local = {
        x: (e.global.x - cx) / props.zoom,
        y: (e.global.y - cy) / props.zoom,
      };
      const cell = screenToCell(local.x, local.y, width, height);
      if (!cell) return;
      // An interactive place wins over the floor: poking the water station should examine it,
      // not walk to the square it happens to occupy.
      const place = places.find(p => p.cell === `${cell.col},${cell.row}`);
      if (place) onTapPlace(place.tag);
      else onTapCell(cell.col, cell.row);
    };

    stage.on('pointerdown', onDown);
    stage.on('pointerup', onUp);
    return () => {
      stage.off('pointerdown', onDown);
      stage.off('pointerup', onUp);
    };
  }, [app, isInitialised, props.zoom, width, height, places, onTapCell, onTapPlace]);

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

  const handleBodyTap = useCallback((e: FederatedPointerEvent) => {
    // A body hit WINS over the tile beneath it (§ 14 Q18), and the stage's own handler is an
    // ancestor in the federated event tree — without this it would also fire and walk the
    // learner to the square the person is standing on.
    e.stopPropagation();
    if (Math.hypot(e.global.x - downAt.current.x, e.global.y - downAt.current.y) > TAP_SLOP_PX) return;
    const id = (e.currentTarget as { label?: string | null } | null)?.label;
    if (id && id !== playerId) props.onTapBody(id);
  }, [playerId, props]);

  if (!app?.renderer) return null;
  const cx = app.screen.width / 2 + props.pan.x;
  const cy = app.screen.height / 2 + props.pan.y;
  const focused = focusedId ? bodies.find(b => b.id === focusedId) : undefined;
  const focusFoot = focused ? isoToScreen(focused.isoX, focused.isoY) : null;

  return (
    <pixiContainer x={cx} y={cy} scale={props.zoom} sortableChildren>
      <EditorTerrainLayer tiles={tiles} />
      <pixiGraphics draw={drawPlaceRing} zIndex={1} eventMode="none" />
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
            eventMode={body.id === playerId ? 'none' : 'static'}
            hitArea={{
              contains: (px: number, py: number) =>
                px >= -texture.width / 2 - BODY_HIT_PAD_PX && px <= texture.width / 2 + BODY_HIT_PAD_PX
                && py >= -texture.height - BODY_HIT_PAD_PX && py <= BODY_HIT_PAD_PX,
            }}
            onPointerUp={handleBodyTap}
          />
        );
      })}
      {bodies.filter(b => b.label).map(body => {
        const { screenX, screenY } = isoToScreen(body.isoX, body.isoY);
        return (
          <pixiText
            key={`label:${body.id}`}
            text={body.label}
            anchor={0.5}
            x={screenX}
            y={screenY - TILE_HEIGHT * 3}
            style={LABEL_STYLE}
            zIndex={computePedestrianZ(body.isoX, body.isoY) + 1}
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

  return (
    <Box
      className="iw-scene-stage"
      ref={containerRef}
      sx={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <SceneContents {...props} pan={pan} zoom={zoom} onPanChange={setPan} />
        </Application>
      )}
    </Box>
  );
}
