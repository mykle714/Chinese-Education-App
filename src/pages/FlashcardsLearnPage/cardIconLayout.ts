// Geometry + small helpers for the custom flashcard icon layout (the "edit" mode on
// the flp back face). See docs/CARD_ICON_LAYOUT.md.
//
// Layout coordinates are NORMALIZED to the card: x,y are the icon CENTER as a
// fraction of card width/height, and the on-screen icon box width is
// BASE_ICON_FRAC * scale as a fraction of the card WIDTH. Because every dimension is
// expressed as a percentage of the card, the rendering layer needs no pixel
// measurement — it just maps each item to CSS percentages. The edit canvas does need
// the card's pixel rect to convert drag/pinch deltas back into fractions.

import type { CSSProperties } from "react";
import type { IconLayoutItem, VocabEntry } from "../../types";
import { API_BASE_URL } from "../../constants";

/** Base icon box as a fraction of card width (before per-icon scale). */
export const BASE_ICON_FRAC = 0.28;

/** Per-icon scale clamp (mirrors the server's validateIconLayout). Max is ~4.5 so a
 *  maximized icon is ~1.26× the card width (BASE_ICON_FRAC × 4.5 ≈ 1.26 — the earlier
 *  "just larger than the card" 3.75 bumped up 20% per design). */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4.5;

/** Default placement of the seeded single icon: horizontally centered, ~2/3 up from
 *  the bottom of the card (i.e. 1/3 down from the top). */
export const DEFAULT_ICON_X = 0.5;
export const DEFAULT_ICON_Y = 0.3333;

/** Our cached-icon image endpoint (transparent SVG/PNG bytes from our DB). */
export const iconImageUrl = (id: string) =>
  `${API_BASE_URL}/api/icons8/${encodeURIComponent(id)}/image`;

/**
 * icons8's public by-id CDN preview, used for un-cached search results in the add
 * dialog (we only download+cache to our own DB on select). Public, no token.
 */
export const iconCdnPreviewUrl = (id: string) =>
  `https://img.icons8.com/?id=${encodeURIComponent(id)}&format=png&size=96`;

/**
 * Seed layout when a card has no custom arrangement yet: the entry's default det icon
 * at the central default spot (empty when the entry has no icon at all).
 */
export function defaultLayoutForEntry(entry: VocabEntry): IconLayoutItem[] {
  if (!entry.iconId) return [];
  return [{ iconId: entry.iconId, x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: 1, rotation: 0, z: 0 }];
}

/**
 * CSS for one placed icon, positioned by its center via percentages of the card box.
 * The icon box is square (aspect-ratio 1); width is a % of the card width.
 */
export function iconItemStyle(item: IconLayoutItem): CSSProperties {
  return {
    position: "absolute",
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${BASE_ICON_FRAC * item.scale * 100}%`,
    aspectRatio: "1 / 1",
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
    // Each icon's z drives paint order within the layer.
    zIndex: item.z,
  };
}

/** Clamp a scale into the allowed range. */
export const clampScale = (s: number) => Math.min(Math.max(s, SCALE_MIN), SCALE_MAX);

/** Highest z in a layout (so selection can bring an icon to the front: max + 1). */
export const maxZ = (layout: IconLayoutItem[]) =>
  layout.reduce((m, it) => Math.max(m, it.z), -1);
