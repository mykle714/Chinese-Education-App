/**
 * @deprecated Canvas2D renderer — superseded by MarketEngineViewer (Pixi).
 * Used only by the legacy MarketViewerPage at /night-market-legacy.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import type { FrameAnimation, MotionSpec } from '../config/nightMarketRegistry';
import { RENDER_SLOT_Z } from '../config/nightMarketRegistry';
import { evaluateMotion, currentFrameImage } from '../utils/nightMarketMotion';
import { isoToScreen } from '../utils/isometric';

interface Layer {
    imagePath: string;      // Path to image file (used when no frameAnimation)
    x: number;              // Base X position in scene (0 = center) — before motion offset
    y: number;              // Base Y position in scene (0 = center) — before motion offset
    zIndex: number;         // Base draw order (lower = behind) — before motion offset
    scale?: number;         // Optional: scale this layer independently (default 1.0)
    groupId?: string;       // Optional: groups sub-layers for hit-testing (e.g. all parts of a stand)
    // Time-driven iso-grid offsets. When non-empty, the canvas switches to a
    // RAF loop. Multiple specs compose additively — e.g. an asset-level track
    // plus a per-layer bob.
    motions?: MotionSpec[];
    // Sprite-frame animation. When set, all `imagePaths` are preloaded and the
    // renderer picks the current frame each tick.
    frameAnimation?: FrameAnimation;
}

interface GridLine {
    x1: number; y1: number; x2: number; y2: number;  // scene-space endpoints
    color?: string;   // optional stroke color (default red)
}

/**
 * Transient entity injected into the canvas each frame (e.g. a pedestrian).
 * Unlike a Layer, these are not preloaded from the `layers` array — their
 * images must be listed in `dynamicSpriteImages` so the viewer can preload
 * them up front. Rendered in the RENDER_SLOT_Z.entity slot, z-sorted against
 * static layers by iso depth.
 */
interface DynamicDrawable {
    id: string;
    isoX: number;
    isoY: number;
    imagePath: string;
    scale?: number;
}

interface MarketViewerProps {
    layers: Layer[];
    /** Optional scene-space line segments drawn beneath image layers, inside the zoom/pan transform. */
    gridLines?: GridLine[];
    /** Callback fired when a layer is tapped (not dragged). Receives groupId if set, else layer index. */
    onLayerTap?: (id: string | number) => void;
    /** All sprite image paths that may appear in dynamicDrawables. Preloaded once. */
    dynamicSpriteImages?: string[];
    /** Called every frame to sample current transient entities. Must be cheap. */
    dynamicDrawables?: () => DynamicDrawable[];
}

interface Point {
    x: number;
    y: number;
}

interface LoadedImage {
    // One entry per frame. Non-animated layers have length 1.
    images: HTMLImageElement[];
    layer: Layer;
    // Offscreen canvas copy used for per-pixel alpha lookups during hit-testing.
    // Built from frame 0 only — hit-testing moving/animating pixels is not worth
    // the per-frame cost for this use case.
    hitCanvas: HTMLCanvasElement;
}

function MarketViewer({ layers, gridLines, onLayerTap, dynamicSpriteImages, dynamicDrawables }: MarketViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const loadedImagesRef = useRef<LoadedImage[]>([]);
    // Preloaded sprites for transient entities (pedestrians, etc.). Keyed by imagePath.
    const dynamicSpritesRef = useRef<Map<string, HTMLImageElement>>(new Map());

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // True once images are loaded iff any layer has motion or frameAnimation.
    // Gates the RAF loop so static scenes pay zero per-frame cost.
    const [hasAnimation, setHasAnimation] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
    const [lastPan, setLastPan] = useState<Point>({ x: 0, y: 0 });

    // Touch state for pinch zoom
    const [touchDistance, setTouchDistance] = useState<number | null>(null);
    const [lastZoom, setLastZoom] = useState(1);

    // Track total drag distance to distinguish taps from drags
    const dragDistanceRef = useRef(0);

    // Constants
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 5.0;
    const ZOOM_SPEED = 0.002;

    // Calculate distance between two touch points
    const getTouchDistance = useCallback((touches: TouchList): number => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }, []);

    // Get center point between two touches
    const getTouchCenter = useCallback((touches: TouchList): Point => {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }, []);

    // Fit scene to viewport (fit to largest image dimensions).
    // Defined before the image-loading effect so it can be listed as a stable dep.
    const fitSceneToViewport = useCallback(() => {
        if (loadedImagesRef.current.length === 0 || !containerRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const container = containerRef.current;

        // Find the bounding box of all layers
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        loadedImagesRef.current.forEach(({ images, layer }) => {
            const image = images[0];
            const layerScale = layer.scale || 1.0;
            const width = image.width * layerScale;
            const height = image.height * layerScale;
            const x = layer.x - width / 2;
            const y = layer.y - height;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
        });

        const sceneWidth = maxX - minX;
        const sceneHeight = maxY - minY;

        // Calculate scale to fit scene in viewport
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const scaleX = containerWidth / sceneWidth;
        const scaleY = containerHeight / sceneHeight;
        const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add some padding

        setZoom(scale);
        setPan({ x: 0, y: 0 });
        setLastPan({ x: 0, y: 0 });
    }, []);

    // Load all images (including every frame of any frameAnimation).
    // A layer is "ready" only once all its frames finish loading; the scene is
    // "ready" once every layer is ready.
    useEffect(() => {
        if (layers.length === 0) {
            // No assets yet — show empty scene rather than an error
            loadedImagesRef.current = [];
            setHasAnimation(false);
            setLoading(false);
            return;
        }

        setLoading(true);
        loadedImagesRef.current = [];

        const loadedImages: LoadedImage[] = [];
        let errorOccurred = false;

        layers.forEach((layer) => {
            const framePaths = layer.frameAnimation?.imagePaths ?? [layer.imagePath];
            const frames: HTMLImageElement[] = new Array(framePaths.length);
            let framesLoaded = 0;

            framePaths.forEach((path, i) => {
                const img = new Image();
                img.onload = () => {
                    if (errorOccurred) return;
                    frames[i] = img;
                    framesLoaded++;

                    // Wait until every frame for this layer has loaded
                    if (framesLoaded < framePaths.length) return;

                    // Build hit-test canvas from frame 0 only
                    const hitCanvas = document.createElement('canvas');
                    hitCanvas.width = frames[0].naturalWidth;
                    hitCanvas.height = frames[0].naturalHeight;
                    const hctx = hitCanvas.getContext('2d');
                    if (hctx) hctx.drawImage(frames[0], 0, 0);

                    loadedImages.push({ images: frames, layer, hitCanvas });

                    if (loadedImages.length === layers.length) {
                        // Stable initial sort — animated layers re-sort per frame
                        loadedImages.sort((a, b) => a.layer.zIndex - b.layer.zIndex);
                        loadedImagesRef.current = loadedImages;
                        const anyAnimated = layers.some(l => (l.motions && l.motions.length > 0) || l.frameAnimation);
                        setHasAnimation(anyAnimated);
                        setLoading(false);
                        fitSceneToViewport();
                    }
                };
                img.onerror = () => {
                    if (!errorOccurred) {
                        errorOccurred = true;
                        setError(`Failed to load image: ${path}`);
                        setLoading(false);
                    }
                };
                img.src = path;
            });
        });
    }, [layers, fitSceneToViewport]);

    // Preload transient entity sprites (pedestrians, etc.). Images are kept in
    // a ref'd Map so the render loop can draw them without async waits.
    // Missing sprites at render time are silently skipped.
    useEffect(() => {
        if (!dynamicSpriteImages || dynamicSpriteImages.length === 0) return;
        const map = dynamicSpritesRef.current;
        for (const path of dynamicSpriteImages) {
            if (map.has(path)) continue;
            const img = new Image();
            img.src = path;
            // Optimistically insert; draw calls guard against incomplete images.
            map.set(path, img);
        }
    }, [dynamicSpriteImages]);

    // Render canvas with all layers
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Save context state
        ctx.save();

        // Apply global transformations (zoom and pan)
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        ctx.translate(centerX + pan.x, centerY + pan.y);
        ctx.scale(zoom, zoom);

        // Draw grid lines beneath image layers (if provided).
        // Group by color so each color only pays one stroke() call.
        if (gridLines && gridLines.length > 0) {
            ctx.save();
            ctx.lineWidth = 2 / zoom;  // keep visually constant through zoom
            const byColor = new Map<string, GridLine[]>();
            for (const line of gridLines) {
                const color = line.color ?? 'rgba(255, 0, 0, 0.9)';
                const bucket = byColor.get(color);
                if (bucket) bucket.push(line);
                else byColor.set(color, [line]);
            }
            for (const [color, lines] of byColor) {
                ctx.strokeStyle = color;
                ctx.beginPath();
                for (const { x1, y1, x2, y2 } of lines) {
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                }
                ctx.stroke();
            }
            ctx.restore();
        }

        // Resolve each layer's current frame image, motion-adjusted (x, y), and
        // current zIndex. For non-animated layers this is a direct copy of the
        // base values; for animated ones we evaluate motion/frame at the
        // current time. `isoToScreen` is linear, so an iso-offset delta
        // converts cleanly to a screen-space delta without knowing the base.
        const tMs = performance.now();
        const drawables = loadedImagesRef.current.map(({ images, layer }) => {
            let image = images[0];
            let x = layer.x;
            let y = layer.y;
            let zIndex = layer.zIndex;

            if (layer.frameAnimation) {
                image = currentFrameImage(layer.frameAnimation, images, tMs);
            }
            if (layer.motions && layer.motions.length > 0) {
                let dIsoX = 0;
                let dIsoY = 0;
                for (const spec of layer.motions) {
                    const d = evaluateMotion(spec, tMs);
                    dIsoX += d.dIsoX;
                    dIsoY += d.dIsoY;
                }
                const delta = isoToScreen(dIsoX, dIsoY);
                x += delta.screenX;
                y += delta.screenY;
                zIndex -= dIsoX + dIsoY;
            }
            return { image, layer, x, y, zIndex, dynamicScale: undefined as number | undefined };
        });

        // Merge transient entities (pedestrians) into the drawables list so
        // they z-sort correctly against static layers. Each dynamic drawable
        // is an iso-positioned sprite rendered in the entity slot.
        if (dynamicDrawables) {
            const entries = dynamicDrawables();
            for (const d of entries) {
                const sprite = dynamicSpritesRef.current.get(d.imagePath);
                if (!sprite || !sprite.complete || sprite.naturalWidth === 0) continue;
                const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
                const zIndex = -(d.isoX + d.isoY) + RENDER_SLOT_Z.entity;
                drawables.push({
                    image: sprite,
                    // A minimal fake layer record: rendering only reads scale off `layer`.
                    layer: { imagePath: d.imagePath, x: screenX, y: screenY, zIndex, scale: d.scale ?? 1 },
                    x: screenX,
                    y: screenY,
                    zIndex,
                    dynamicScale: d.scale ?? 1,
                });
            }
        }

        // Sort by current zIndex so moving assets swap depth with neighbours
        // correctly. O(n log n) on a small n — negligible cost.
        drawables.sort((a, b) => a.zIndex - b.zIndex);

        for (const { image, layer, x, y, dynamicScale } of drawables) {
            ctx.save();
            const layerScale = dynamicScale ?? layer.scale ?? 1.0;
            ctx.translate(x, y);
            ctx.scale(layerScale, layerScale);
            // Image is anchored at its bottom-center pixel
            ctx.drawImage(image, -image.width / 2, -image.height);
            ctx.restore();
        }

        // Restore context state
        ctx.restore();
    }, [zoom, pan, gridLines, dynamicDrawables]);

    // Resize canvas to match container
    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        render();
    }, [render]);

    // Handle window resize.
    // Also re-fires when `loading` flips to false, because that's when the canvas
    // first appears in the DOM — resizeCanvas() is a no-op while canvasRef is null.
    useEffect(() => {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [resizeCanvas, loading]);

    // Render when zoom or pan changes
    useEffect(() => {
        render();
    }, [render]);

    // RAF loop — only runs when a layer has motion or frameAnimation.
    // We stash the current `render` in a ref so the loop always calls the
    // latest closure (which captures the latest zoom/pan) without having to
    // re-install the RAF each time zoom/pan changes.
    const renderRef = useRef(render);
    renderRef.current = render;

    // RAF runs whenever there's any animation OR when transient entities are
    // being injected each frame (pedestrians). Static scenes with no dynamic
    // drawables pay zero per-frame cost.
    const needsRaf = hasAnimation || !!dynamicDrawables;
    useEffect(() => {
        if (!needsRaf) return;
        let rafId = requestAnimationFrame(function tick() {
            renderRef.current();
            rafId = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(rafId);
    }, [needsRaf]);

    // Mouse wheel zoom
    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Get mouse position relative to canvas
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom change
        const delta = -e.deltaY * ZOOM_SPEED;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + delta)));

        // Calculate pan adjustment to zoom at mouse position
        const zoomRatio = newZoom / zoom;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const newPanX = mouseX - (mouseX - centerX - pan.x) * zoomRatio - centerX;
        const newPanY = mouseY - (mouseY - centerY - pan.y) * zoomRatio - centerY;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
        setLastPan({ x: newPanX, y: newPanY });
    }, [zoom, pan]);

    /**
     * Hit-test: convert screen coordinates to scene coordinates,
     * then check loaded images in reverse z-order (front to back).
     * Returns the index in the layers array, or -1 if nothing was hit.
     */
    const hitTest = useCallback((screenX: number, screenY: number): number => {
        const canvas = canvasRef.current;
        if (!canvas || loadedImagesRef.current.length === 0) return -1;

        const rect = canvas.getBoundingClientRect();
        const canvasX = screenX - rect.left;
        const canvasY = screenY - rect.top;

        // Convert screen coords to scene coords (reverse the pan/zoom transform)
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const sceneX = (canvasX - centerX - pan.x) / zoom;
        const sceneY = (canvasY - centerY - pan.y) / zoom;

        // Near-transparent pixels should not register as a hit — lets taps pass through
        // PNG padding to the layer underneath. 10/255 keeps anti-aliased edges clickable.
        const ALPHA_THRESHOLD = 10;

        // Check layers in reverse z-order (highest zIndex first = frontmost layer).
        // Hit-testing uses frame-0 bounds and ignores runtime motion offsets —
        // precision on moving targets isn't worth the per-frame re-sort here.
        const images = loadedImagesRef.current;
        for (let i = images.length - 1; i >= 0; i--) {
            const { images: frames, layer, hitCanvas } = images[i];
            const image = frames[0];
            const layerScale = layer.scale || 1.0;
            const width = image.width * layerScale;
            const height = image.height * layerScale;

            // Layer position is the bottom-center anchor, so bounds sit above it
            const left = layer.x - width / 2;
            const top = layer.y - height;

            if (sceneX >= left && sceneX <= left + width &&
                sceneY >= top && sceneY <= top + height) {
                // Convert scene coords to image-local pixel coords
                // (undo layer scale and the bottom-center anchor offset)
                const imgX = Math.floor((sceneX - layer.x) / layerScale + image.width / 2);
                const imgY = Math.floor((sceneY - layer.y) / layerScale + image.height);

                const hctx = hitCanvas.getContext('2d');
                if (hctx && imgX >= 0 && imgY >= 0 && imgX < hitCanvas.width && imgY < hitCanvas.height) {
                    const alpha = hctx.getImageData(imgX, imgY, 1, 1).data[3];
                    if (alpha <= ALPHA_THRESHOLD) continue; // transparent — fall through to layer below
                }

                // Find this layer's index in the original layers array
                return layers.findIndex(l => l === layer);
            }
        }
        return -1;
    }, [zoom, pan, layers]);

    // Tap threshold — if total drag distance is below this, treat as a tap
    const TAP_THRESHOLD = 5;

    // Mouse drag pan
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setLastPan(pan);
        dragDistanceRef.current = 0;
    }, [pan]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        dragDistanceRef.current = Math.sqrt(dx * dx + dy * dy);

        setPan({
            x: lastPan.x + dx,
            y: lastPan.y + dy
        });
    }, [isDragging, dragStart, lastPan]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        // If total drag distance was small, treat this as a tap and fire onLayerTap
        if (dragDistanceRef.current < TAP_THRESHOLD && onLayerTap) {
            const layerIndex = hitTest(e.clientX, e.clientY);
            if (layerIndex >= 0) {
                // Return groupId if the layer belongs to a group (e.g. multi-layer stand)
                onLayerTap(layers[layerIndex]?.groupId ?? layerIndex);
            }
        }
        setIsDragging(false);
    }, [onLayerTap, hitTest, layers]);

    // Touch handlers
    const handleTouchStart = useCallback((e: TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 1) {
            // Single touch - start pan
            setIsDragging(true);
            setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            setLastPan(pan);
            dragDistanceRef.current = 0;
        } else if (e.touches.length === 2) {
            // Two touches - start pinch zoom
            setIsDragging(false);
            const distance = getTouchDistance(e.touches);
            setTouchDistance(distance);
            setLastZoom(zoom);
        }
    }, [pan, zoom, getTouchDistance]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 1 && isDragging) {
            // Single touch - pan
            const dx = e.touches[0].clientX - dragStart.x;
            const dy = e.touches[0].clientY - dragStart.y;

            dragDistanceRef.current = Math.sqrt(dx * dx + dy * dy);

            setPan({
                x: lastPan.x + dx,
                y: lastPan.y + dy
            });
        } else if (e.touches.length === 2 && touchDistance !== null) {
            // Two touches - pinch zoom
            const canvas = canvasRef.current;
            if (!canvas) return;

            const newDistance = getTouchDistance(e.touches);
            const scale = newDistance / touchDistance;
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, lastZoom * scale));

            // Get center point of pinch
            const center = getTouchCenter(e.touches);
            const rect = canvas.getBoundingClientRect();
            const touchX = center.x - rect.left;
            const touchY = center.y - rect.top;

            // Calculate pan adjustment to zoom at touch center
            const zoomRatio = newZoom / zoom;
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;

            const newPanX = touchX - (touchX - centerX - pan.x) * zoomRatio - centerX;
            const newPanY = touchY - (touchY - centerY - pan.y) * zoomRatio - centerY;

            setZoom(newZoom);
            setPan({ x: newPanX, y: newPanY });
            setLastPan({ x: newPanX, y: newPanY });
        }
    }, [isDragging, dragStart, lastPan, touchDistance, lastZoom, zoom, pan, getTouchDistance, getTouchCenter]);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 0) {
            // All touches ended — check for tap (short drag distance on single touch)
            if (dragDistanceRef.current < TAP_THRESHOLD && onLayerTap && e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
                const layerIndex = hitTest(touch.clientX, touch.clientY);
                if (layerIndex >= 0) {
                    // Return groupId if the layer belongs to a group (e.g. multi-layer stand)
                    onLayerTap(layers[layerIndex]?.groupId ?? layerIndex);
                }
            }
            setIsDragging(false);
            setTouchDistance(null);
        } else if (e.touches.length === 1) {
            // Back to single touch, reset drag
            setTouchDistance(null);
            setIsDragging(true);
            setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            setLastPan(pan);
        }
    }, [pan, onLayerTap, hitTest, layers]);

    // Attach wheel listener as non-passive so preventDefault works (blocks page scroll)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    // Attach touch listeners as non-passive so preventDefault works (blocks page scroll/zoom).
    // React 19 registers synthetic touch events as passive, making preventDefault a no-op,
    // so we bypass React and attach directly to the DOM element.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const opts = { passive: false } as EventListenerOptions;
        canvas.addEventListener('touchstart', handleTouchStart, opts);
        canvas.addEventListener('touchmove', handleTouchMove, opts);
        canvas.addEventListener('touchend', handleTouchEnd, opts);
        return () => {
            canvas.removeEventListener('touchstart', handleTouchStart, opts);
            canvas.removeEventListener('touchmove', handleTouchMove, opts);
            canvas.removeEventListener('touchend', handleTouchEnd, opts);
        };
    }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

    if (loading) {
        return (
            <Box
                className="market-viewer-loading"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%'
                }}
            >
                <CircularProgress className="market-viewer-loading-spinner" />
            </Box>
        );
    }

    if (error) {
        return (
            <Box
                className="market-viewer-error"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    p: 2
                }}
            >
                <Alert className="market-viewer-error-alert" severity="error">{error}</Alert>
            </Box>
        );
    }

    return (
        <Box
            className="market-viewer-container"
            ref={containerRef}
            sx={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none'
            }}
        >
            <canvas
                className="market-viewer-canvas"
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setIsDragging(false)}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%'
                }}
            />
        </Box>
    );
}

export default MarketViewer;
