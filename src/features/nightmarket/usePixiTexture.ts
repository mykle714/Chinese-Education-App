import { useEffect, useState } from 'react';
import { Assets, Texture } from 'pixi.js';

/**
 * usePixiTexture — load one sprite URL into a Pixi texture, `nearest`-filtered.
 *
 * LAYER: view plumbing. Every sprite layer in the night market needs the same four lines
 * (load, force `nearest` so pixel art stays crisp, guard against a resolve landing after
 * unmount, clear between urls so no stale texture flashes), and they had been copy-pasted
 * into each new layer — the marker pins, the decor ghost, the occupant house.
 *
 * `Assets` caches by url, so N sprites sharing one url cost ONE decode; calling this per
 * placed prop is cheap and keeps each component's loading independent.
 *
 * Returns null while loading, and for a null/empty url (so a caller can hold the hook's
 * position in the hook order while it has nothing to show — never call it conditionally).
 */
export function usePixiTexture(url: string | null | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) { setTexture(null); return; }
    let cancelled = false;
    // Cleared to null first: without this, changing url keeps showing the PREVIOUS texture
    // until the new one resolves, which reads as the sprite not having changed.
    setTexture(null);
    Assets.load<Texture>(url).then((tex) => {
      // Pixel art: `nearest` everywhere, or a scaled sprite blurs against the crisp board.
      tex.source.scaleMode = 'nearest';
      if (!cancelled) setTexture(tex);
    }).catch(() => {
      // A missing/renamed asset must not take the scene down — the layer simply draws nothing.
      if (!cancelled) setTexture(null);
    });
    return () => { cancelled = true; };
  }, [url]);

  return texture;
}
