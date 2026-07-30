import { createContext, useContext, type ReactNode } from 'react';

/**
 * CameraZoomContext — makes the camera's live zoom readable by leaf sprite layers.
 *
 * LAYER: view (plumbing only — holds no policy; the fade curve itself lives in the pure
 * {@link ../../engine/market/layerTranslucency} module).
 *
 * WHY A CONTEXT. Each camera host owns `zoom` in local state and previously only ever spent it as
 * `scale` on its root `pixiContainer`; nothing below could see it. Zoom-driven layer translucency
 * needs it at the SPRITE leaves, which sit 2–4 components deep and behind shared components used by
 * all three surfaces ({@link ./HouseStripSprites} via {@link ./HouseLayer},
 * {@link ./PlaceholderHouseLayer} and `PlaceholderOccupantHouses` in
 * {@link ./TemplateEditorViewer}). Prop-drilling a purely-presentational value through those
 * intermediates would add a `zoom` prop to six components that have no other use for it, and every
 * future layered-asset renderer would have to remember to thread it too. A context makes the camera
 * the single publisher and lets any leaf opt in.
 *
 * PUBLISHERS — the two PLAYER-FACING cameras wrap their scene container's children:
 *   - {@link ./MarketEngineViewer}    — nmp runtime scene
 *   - {@link ./TemplateSandboxViewer} — nms compositing scene
 *
 * DELIBERATELY NOT A PUBLISHER: {@link ./TemplateEditorViewer} (nme, the single-board editor) and
 * the {@link ./TemplateLoadGallery} thumbnails. Those are AUTHORING surfaces — an author zooming in
 * to place a slot needs to see the occupant art solidly, not watch it dissolve. Because they
 * publish nothing, `useCameraZoom()` there falls back to the neutral 1 and every layer stays
 * opaque, so the peel is opt-in per surface rather than something each authoring tool must suppress.
 * Note the editor's own house preview is reached from nms too (nms renders `TemplateMaskOverlays`
 * inside its provider), so the SAME component correctly peels on nms and stays solid in nme.
 *
 * Referenced by: docs/NIGHT_MARKET_FEATURE.md § "Layer translucency (zoom-peel)".
 */

/**
 * Default 1 (not 0/NaN): a consumer rendered outside any camera — a gallery thumbnail, a test —
 * gets the neutral "default framing" zoom and therefore fully opaque layers, rather than an
 * accidentally ghosted building.
 */
const CameraZoomContext = createContext<number>(1);

export function CameraZoomProvider({ zoom, children }: { zoom: number; children: ReactNode }) {
  return <CameraZoomContext.Provider value={zoom}>{children}</CameraZoomContext.Provider>;
}

/** The enclosing camera's current zoom, or 1 when there is no camera above. */
export function useCameraZoom(): number {
  return useContext(CameraZoomContext);
}
