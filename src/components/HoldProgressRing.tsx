import { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS } from "../theme/colors";

/**
 * HoldProgressRing — the press-and-hold timer: one ink stroke that traces its host's
 * rounded outline exactly once over `durationMs`, starting at the top-left corner and
 * running clockwise. It is the visual half of `useLongPress` (src/hooks/useLongPress.ts):
 * the host mounts it while the hook reports `pressing`, and the stroke closes at the
 * moment the hold fires.
 *
 * MOUNT IT PER PRESS (`{pressing && <HoldProgressRing … />}`): the trace is a one-shot CSS
 * animation, so remounting is what restarts it from zero on the next press.
 *
 * Sizing: it fills the nearest positioned ancestor (`position: absolute; inset: 0`) and
 * measures that box once on mount, so one component fits any host — a 92×132 MiniCard or
 * the 24px-tall Skip button. The host must be positioned (`relative`) and should pass
 * its own corner radius so the stroke follows its outline. Hosts that resize MID-HOLD are
 * not tracked; a hold is ~2s and none of today's hosts change size during one.
 *
 * Layer: shared presentational (src/components).
 * Referenced by: docs/SORT_CARDS_REQUIREMENTS.md §5.1a — SortCardsPage's Skip button and
 * SkippedCardsSheet's `RecyclableSkippedCard`.
 */

const ringTrace = keyframes({ from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 } });

interface HoldProgressRingProps {
    durationMs: number;
    /** The host's corner radius in px, so the stroke follows its outline. */
    radius: number;
    strokeWidth?: number;
    className?: string;
}

export default function HoldProgressRing({ durationMs, radius, strokeWidth = 2.5, className }: HoldProgressRingProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);

    // Measure before paint, so the first painted frame already has the right geometry.
    useLayoutEffect(() => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
    }, []);

    // Inset by half the stroke so the whole stroke sits on the host's edge, inside it.
    const inset = strokeWidth / 2;

    return (
        <Box
            component="svg"
            ref={svgRef}
            className={className ? `hold-progress-ring ${className}` : "hold-progress-ring"}
            viewBox={size ? `0 0 ${size.w} ${size.h}` : undefined}
            aria-hidden
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
        >
            {size && (
                <Box
                    component="rect"
                    x={inset}
                    y={inset}
                    width={Math.max(size.w - strokeWidth, 0)}
                    height={Math.max(size.h - strokeWidth, 0)}
                    rx={Math.max(radius - inset, 0)}
                    // pathLength=1 makes the dash math independent of the host's size.
                    pathLength={1}
                    sx={{
                        fill: "none",
                        stroke: COLORS.onSurface,
                        strokeWidth,
                        strokeDasharray: 1,
                        strokeDashoffset: 1,
                        animation: `${ringTrace} ${durationMs}ms linear forwards`,
                    }}
                />
            )}
        </Box>
    );
}
