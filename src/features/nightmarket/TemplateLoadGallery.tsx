import { useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react';
import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import { Box } from '@mui/material';
import { TILE_WIDTH, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildEditorField, type EditorMasks } from '../../engine/market/farmTerrain';
import { placeholderAreaCells } from '../../engine/market/placeholderArea';
import EditorTerrainLayer from './EditorTerrainLayer';
import { TemplateMaskOverlays } from './TemplateEditorViewer';
import { definitionToMasks, type TemplateGalleryEntry } from './templateEditorApi';

// Register the Pixi classes this scene mounts (idempotent with the viewer's own extend()).
extend({ Container, Sprite, Graphics, Text });

/**
 * TemplateLoadGallery — the visual Load picker for the Night Market template editor
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Desktop-only.
 *
 * Renders EVERY template as a scaled isometric board thumbnail laid out in a scrolling grid,
 * inside a SINGLE Pixi Application (one WebGL context for the whole gallery — a per-tile
 * Application would exhaust the browser's ~16-context budget). Each thumbnail draws the
 * template's actual terrain / decor (via {@link EditorTerrainLayer}) plus the shared spriteless
 * mask tints + occupant houses (via {@link TemplateMaskOverlays}; `houseMode` chooses whether
 * houses appear only in condition-filled areas or in EVERY placeholder area — the sandbox's picker
 * uses the latter so a card previews the template fully occupied). Per the author's request the
 * thumbnail shows the version with the MOST conditions (chosen server-side — see
 * `listTemplateGallery`), so the richest layout is what you preview. Clicking a card fires
 * {@link onPick} with that entry (the parent loads its `chosenVersion`).
 *
 * The parent owns fetch/loading/empty/error states and the Load↔Cancel button; this component
 * only renders a non-empty entry list.
 */

/** Thumbnail house rule — see the `houseMode` prop. Subset of TemplateMaskOverlays' modes. */
export type GalleryHouseMode = 'filled' | 'all';

// ── Grid metrics (screen px, pre-scroll) ──────────────────────────────────────────
const GAP = 16;
const MIN_CELL_W = 240; // a column is added whenever this many px more will fit
const CARD_PAD = 14; // inset from the card edge to the board-fit box
const LABEL_H = 48; // caption band under each board
const BOARD_ASPECT = 0.78; // board-area height as a fraction of the cell width

const CARD_BG_COLOR = 0x000000;
const CARD_BORDER_IDLE = 0xffffff;
const CARD_BORDER_HOVER = 0xffe066; // the editor's Save-yellow accent

interface PreparedEntry {
  entry: TemplateGalleryEntry;
  masks: EditorMasks;
  tiles: ReturnType<typeof buildEditorField>;
  /** Board bounding box in board-local screen px (centreX is 0 by symmetry). */
  boxW: number;
  boxH: number;
  /** Board-local Y of the bounding-box centre (used to seat the board in its cell). */
  centerY: number;
}

/**
 * Derive a template's render inputs + its board-local screen bounding box ONCE (memoised on the
 * entry list). The box mirrors the editor viewer's centring math: the top is the far corner's
 * grass surface, the bottom is the near corner's dirt body, and an extra top allowance clears
 * the taller house sprites so a house-bearing board isn't clipped at the top of its card.
 */
function prepare(entries: TemplateGalleryEntry[], houseMode: GalleryHouseMode): PreparedEntry[] {
  return entries.map((entry) => {
    const masks = definitionToMasks(entry.definition);
    const tiles = buildEditorField(entry.width, entry.height, masks);
    // A placeholder area containing a condition cell renders occupant HOUSE(S) (see
    // TemplateMaskOverlays); reserve extra top room so the taller house sprites aren't clipped.
    // Under `'all'` every placeholder area gets a house, so any area at all needs the allowance.
    const hasOccupant = houseMode === 'all'
      ? masks.placeholder.length > 0
      : masks.placeholder.some((area) =>
        placeholderAreaCells(area).some((c) => masks.condition.has(c)),
      );
    const houseAllowance = hasOccupant ? TILE_HEIGHT * 4 : 0;
    const topLocalY =
      -((entry.width - 1) + (entry.height - 1)) * (TILE_HEIGHT / 2) - TILE_HEIGHT - houseAllowance;
    const bottomLocalY = TILE_HEIGHT;
    return {
      entry,
      masks,
      tiles,
      boxW: (entry.width + entry.height) * (TILE_WIDTH / 2),
      boxH: bottomLocalY - topLocalY,
      centerY: (topLocalY + bottomLocalY) / 2,
    };
  });
}

// ── Scene: the grid of board thumbnails inside the Application ─────────────────────
function GalleryScene({
  prepared,
  scrollY,
  onContentHeight,
  onPick,
  houseMode,
}: {
  prepared: PreparedEntry[];
  scrollY: number;
  /** Report the total content height so the outer wheel handler can clamp the scroll. */
  onContentHeight: (h: number) => void;
  onPick: (entry: TemplateGalleryEntry) => void;
  /** House rule for the thumbnails' mask overlays — see the outer component's `houseMode` prop. */
  houseMode: GalleryHouseMode;
}) {
  const { app } = useApplication();
  const [size, setSize] = useState({ w: app?.screen.width ?? 0, h: app?.screen.height ?? 0 });
  const [hovered, setHovered] = useState<string | null>(null);

  // Track the canvas size (resizeTo keeps app.screen in sync; the renderer fires 'resize').
  useEffect(() => {
    if (!app?.renderer) return;
    // Capture the renderer rather than re-reading app.renderer in the cleanup: Pixi's
    // Application.destroy() nulls app.renderer, and React deletes a subtree parent-first, so the
    // enclosing <Application>'s cleanup destroys the app BEFORE this child's cleanup runs.
    const renderer = app.renderer;
    const sync = () => setSize({ w: app.screen.width, h: app.screen.height });
    sync();
    renderer.on('resize', sync);
    return () => { renderer.off('resize', sync); };
  }, [app]);

  // Column count grows with available width; cell width fills the remaining space evenly.
  const cols = Math.max(1, Math.floor((size.w - GAP) / (MIN_CELL_W + GAP)));
  const cellW = (size.w - GAP * (cols + 1)) / cols;
  const boardAreaH = cellW * BOARD_ASPECT;
  const cellH = boardAreaH + LABEL_H;
  const rows = Math.ceil(prepared.length / cols);
  const contentH = GAP + rows * (cellH + GAP);

  // Publish the content height whenever the layout changes (drives scroll clamping upstream).
  useEffect(() => { onContentHeight(contentH); }, [contentH, onContentHeight]);

  if (!app?.renderer || cellW <= 0) return null;

  return (
    // Whole grid shifts up by the scroll offset; each card is positioned in absolute grid space.
    <pixiContainer y={-scrollY} sortableChildren>
      {prepared.map((p, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellX = GAP + col * (cellW + GAP);
        const cellY = GAP + row * (cellH + GAP);
        const isHover = hovered === p.entry.name;

        // Fit the board box into the padded board area, then seat it so the box centre lands at
        // the board-area centre (centreX is 0, so the container's X is just the area centre).
        const fitW = cellW - CARD_PAD * 2;
        const fitH = boardAreaH - CARD_PAD * 2;
        const s = Math.min(fitW / p.boxW, fitH / p.boxH);
        const boardCX = cellX + cellW / 2;
        const boardAreaCY = cellY + CARD_PAD + fitH / 2;
        const containerY = boardAreaCY - p.centerY * s;

        const { name, width, height, chosenVersion, conditionCount, versionCount } = p.entry;
        const caption =
          `${name}\n${width}×${height} · v${chosenVersion}` +
          (versionCount > 1 ? ` of ${versionCount}` : '') +
          ` · ${conditionCount} cond`;

        return (
          <Fragment key={name}>
            {/* Card background + border (border brightens on hover). */}
            <pixiGraphics
              draw={(g: Graphics) => {
                g.clear();
                g.roundRect(cellX, cellY, cellW, cellH, 12);
                g.fill({ color: CARD_BG_COLOR, alpha: 0.4 });
                g.stroke({
                  color: isHover ? CARD_BORDER_HOVER : CARD_BORDER_IDLE,
                  width: isHover ? 2 : 1,
                  alpha: isHover ? 0.95 : 0.28,
                });
              }}
            />
            {/* The scaled board itself — its own sortableChildren so terrain/house z-sort is
                local to this thumbnail and never bleeds across cards. */}
            <pixiContainer x={boardCX} y={containerY} scale={s} sortableChildren>
              <EditorTerrainLayer tiles={p.tiles} />
              <TemplateMaskOverlays masks={p.masks} houseMode={houseMode} />
            </pixiContainer>
            {/* Caption band. */}
            <pixiText
              text={caption}
              x={cellX + cellW / 2}
              y={cellY + boardAreaH + LABEL_H / 2}
              anchor={{ x: 0.5, y: 0.5 }}
              style={{
                fill: 0xffffff,
                fontFamily: 'sans-serif',
                fontSize: 13,
                fontWeight: '600',
                align: 'center',
                wordWrap: true,
                wordWrapWidth: cellW - 16,
                lineHeight: 17,
              }}
            />
            {/* Transparent hit surface over the whole card (drawn last → on top). A near-zero
                alpha keeps the geometry hit-testable while staying invisible. */}
            <pixiGraphics
              eventMode="static"
              cursor="pointer"
              onPointerTap={() => onPick(p.entry)}
              onPointerOver={() => setHovered(name)}
              onPointerOut={() => setHovered((h) => (h === name ? null : h))}
              draw={(g: Graphics) => {
                g.clear();
                g.roundRect(cellX, cellY, cellW, cellH, 12);
                g.fill({ color: 0xffffff, alpha: 0.001 });
              }}
            />
          </Fragment>
        );
      })}
    </pixiContainer>
  );
}

// ── Outer component: Application mount + vertical wheel scroll ─────────────────────
function TemplateLoadGallery({
  entries,
  onPick,
  houseMode = 'filled',
}: {
  entries: TemplateGalleryEntry[];
  onPick: (entry: TemplateGalleryEntry) => void;
  /**
   * Which placeholder areas preview an occupant house in the thumbnails:
   * `'filled'` (default — the editor's Load picker: only condition-filled areas, matching what the
   * editor itself draws) or `'all'` (the sandbox's Add picker: every placeholder area, so a card
   * previews the template at full occupancy, exactly as a freshly-added tile renders there).
   */
  houseMode?: GalleryHouseMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  // Content + viewport heights kept in refs so the (stable) wheel handler can clamp without
  // re-subscribing on every layout change.
  const contentHRef = useRef(0);
  const scrollYRef = useRef(0);
  scrollYRef.current = scrollY;

  const prepared = useMemo(() => prepare(entries, houseMode), [entries, houseMode]);

  useEffect(() => { if (containerRef.current) setReady(true); }, []);

  // Reset the scroll whenever the shown set changes (e.g. gallery re-opened).
  useEffect(() => { setScrollY(0); scrollYRef.current = 0; }, [entries]);

  const onContentHeight = useCallback((h: number) => {
    contentHRef.current = h;
    // Re-clamp in case the layout shrank below the current scroll (e.g. a resize widened the
    // grid into fewer rows).
    const viewportH = containerRef.current?.clientHeight ?? 0;
    const maxScroll = Math.max(0, h - viewportH);
    if (scrollYRef.current > maxScroll) setScrollY(maxScroll);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const viewportH = containerRef.current?.clientHeight ?? 0;
    const maxScroll = Math.max(0, contentHRef.current - viewportH);
    setScrollY((prev) => Math.min(maxScroll, Math.max(0, prev + e.deltaY)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => { el.removeEventListener('wheel', handleWheel); };
  }, [handleWheel, ready]);

  return (
    <Box
      className="template-load-gallery"
      ref={containerRef}
      sx={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      {ready && (
        <Application resizeTo={containerRef} backgroundAlpha={0} antialias={false}>
          <GalleryScene
            prepared={prepared}
            scrollY={scrollY}
            onContentHeight={onContentHeight}
            onPick={onPick}
            houseMode={houseMode}
          />
        </Application>
      )}
    </Box>
  );
}

export default TemplateLoadGallery;
