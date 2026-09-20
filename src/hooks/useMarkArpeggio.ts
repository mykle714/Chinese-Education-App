/**
 * useMarkArpeggio — scope the answer-feedback arpeggio to one mark surface.
 *
 * The ladder itself lives at module scope in
 * `src/services/audio/markArpeggio.ts`, because the thing that plays it is
 * `markFlashcard`, which is not a component and cannot read React state. This
 * hook supplies the only piece that IS component-scoped: the streak describes a
 * run of answers on ONE screen, so it resets when that screen mounts and again
 * when it unmounts. Leaving Match Speed mid-arpeggio and opening Bubble
 * Match starts again on the low C.
 *
 * Call it once from every surface that PLAYS the arpeggio — the pages whose
 * `MarkSurface` is in `ARPEGGIO_SURFACES` (`src/api/flashcards.ts`). Forgetting it
 * is not silent: the page simply inherits the previous page's ladder position.
 *
 * Used by: `MatchSpeedPage`, `BubbleMatchPage`.
 * Documented in: docs/AUDIO_PLAYBACK.md § 7.
 */
import { useEffect } from "react";
import { resetMarkArpeggio } from "../services/audio/markArpeggio";

export function useMarkArpeggio(): void {
    useEffect(() => {
        resetMarkArpeggio();
        return resetMarkArpeggio;
    }, []);
}
