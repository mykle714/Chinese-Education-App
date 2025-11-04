import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';

interface Layer {
    imagePath: string;      // Path to image file
    x: number;              // X position in scene (0 = center)
    y: number;              // Y position in scene (0 = center)
    zIndex: number;         // Draw order (lower = behind)
    scale?: number;         // Optional: scale this layer independently (default 1.0)
}

interface MarketViewerProps {
    layers: Layer[];
}

interface Point {
    x: number;
    y: number;
}

interface LoadedImage {
    image: HTMLImageElement;
    layer: Layer;
}

function MarketViewer({ layers }: MarketViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const loadedImagesRef = useRef<LoadedImage[]>([]);

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadedCount, setLoadedCount] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
    const [lastPan, setLastPan] = useState<Point>({ x: 0, y: 0 });

    // Touch state for pinch zoom
    const [touchDistance, setTouchDistance] = useState<number | null>(null);
    const [lastZoom, setLastZoom] = useState(1);

    // Constants
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 5.0;
    const ZOOM_SPEED = 0.002;

    // Calculate distance between two touch points
    const getTouchDistance = useCallback((touches: React.TouchList): number => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }, []);

    // Get center point between two touches
    const getTouchCenter = useCallback((touches: React.TouchList): Point => {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }, []);

    // Load all images
    useEffect(() => {
        if (layers.length === 0) {
            setError('No layers provided');
            setLoading(false);
            return;
        }

        setLoading(true);
        setLoadedCount(0);
        loadedImagesRef.current = [];

        let loadedImages: LoadedImage[] = [];
        let errorOccurred = false;

        // Load each layer's image
        layers.forEach((layer) => {
            const img = new Image();

            img.onload = () => {
                if (errorOccurred) return;

                loadedImages.push({ image: img, layer });
                setLoadedCount(prev => prev + 1);

                // Check if all images are loaded
                if (loadedImages.length === layers.length) {
                    // Sort by zIndex before storing
                    loadedImages.sort((a, b) => a.layer.zIndex - b.layer.zIndex);
                    loadedImagesRef.current = loadedImages;
                    setLoading(false);
                    fitSceneToViewport();
                }
            };

            img.onerror = () => {
                if (!errorOccurred) {
                    errorOccurred = true;
                    setError(`Failed to load image: ${layer.imagePath}`);
                    setLoading(false);
                }
            };

            img.src = layer.imagePath;
        });
    }, [layers]);

    // Fit scene to viewport (fit to largest image dimensions)
    const fitSceneToViewport = useCallback(() => {
        if (loadedImagesRef.current.length === 0 || !containerRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const container = containerRef.current;

        // Find the bounding box of all layers
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        loadedImagesRef.current.forEach(({ image, layer }) => {
            const layerScale = layer.scale || 1.0;
            const width = image.width * layerScale;
            const height = image.height * layerScale;
            const x = layer.x - width / 2;
            const y = layer.y - height / 2;

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

        console.log('[Fit Scene]', {
            sceneWidth,
            sceneHeight,
            containerWidth,
            containerHeight,
            scaleX,
            scaleY,
            finalZoom: scale,
            layerCount: loadedImagesRef.current.length
        });

        setZoom(scale);
        setPan({ x: 0, y: 0 });
        setLastPan({ x: 0, y: 0 });
    }, []);

    // Render canvas with all layers
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || loadedImagesRef.current.length === 0) return;

        console.log('[Render]', {
            zoom,
            pan,
            canvasSize: { w: canvas.width, h: canvas.height },
            layerCount: loadedImagesRef.current.length
        });

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Save context state
        ctx.save();

        // Apply global transformations (zoom and pan)
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        ctx.translate(centerX + pan.x, centerY + pan.y);
        ctx.scale(zoom, zoom);

        // Draw each layer in z-order (already sorted)
        loadedImagesRef.current.forEach(({ image, layer }) => {
            ctx.save();

            // Apply layer-specific transformations
            const layerScale = layer.scale || 1.0;
            ctx.translate(layer.x, layer.y);
            ctx.scale(layerScale, layerScale);

            // Draw image centered at layer position
            ctx.drawImage(image, -image.width / 2, -image.height / 2);

            ctx.restore();
        });

        // Restore context state
        ctx.restore();
    }, [zoom, pan]);

    // Resize canvas to match container
    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        console.log('[Canvas Resize]', {
            containerSize: { w: container.clientWidth, h: container.clientHeight },
            oldCanvasSize: { w: canvas.width, h: canvas.height }
        });

        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        console.log('[Canvas Resize]', {
            newCanvasSize: { w: canvas.width, h: canvas.height }
        });

        render();
    }, [render]);

    // Handle window resize
    useEffect(() => {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, [resizeCanvas]);

    // Render when zoom or pan changes
    useEffect(() => {
        render();
    }, [render]);

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

    // Mouse drag pan
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setLastPan(pan);
    }, [pan]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        setPan({
            x: lastPan.x + dx,
            y: lastPan.y + dy
        });
    }, [isDragging, dragStart, lastPan]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Touch handlers
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 1) {
            // Single touch - start pan
            setIsDragging(true);
            setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            setLastPan(pan);
        } else if (e.touches.length === 2) {
            // Two touches - start pinch zoom
            setIsDragging(false);
            const distance = getTouchDistance(e.touches);
            setTouchDistance(distance);
            setLastZoom(zoom);
        }
    }, [pan, zoom, getTouchDistance]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 1 && isDragging) {
            // Single touch - pan
            const dx = e.touches[0].clientX - dragStart.x;
            const dy = e.touches[0].clientY - dragStart.y;

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

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        e.preventDefault();

        if (e.touches.length === 0) {
            // All touches ended
            setIsDragging(false);
            setTouchDistance(null);
        } else if (e.touches.length === 1) {
            // Back to single touch, reset drag
            setTouchDistance(null);
            setIsDragging(true);
            setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            setLastPan(pan);
        }
    }, [pan]);

    // Add wheel event listener
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    if (loading) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%'
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    p: 2
                }}
            >
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    return (
        <Box
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
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
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
