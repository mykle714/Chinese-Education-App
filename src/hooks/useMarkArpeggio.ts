/**
 * useMarkArpeggio — scope the answer-feedback arpeggio to one mark surface.
 *
 * The ladder itself lives at module scope in
 * `src/services/audio/markArpeggio.ts`, because the thing that plays it is
 * `markFlashcard`, which is not a component and cannot read React state. This
 * hook supplies the only piece that IS component-scoped: the streak describes a
 * run of answers on ONE screen, so it resets when that screen mounts and again
 * when it unmounts. Leaving the flp mid-arpeggio and opening Word Search starts
 * again on the low C.
 *
 * Call it once from every surface that records marks (the flp working loop, the
 * six games, and the Practice Writing button). Forgetting it is not silent — the
 * next page simply inherits the previous page's position in the ladder.
 *
 * Used by: the eight `MarkSurface` call sites — see `src/api/flashcards.ts`.
 * Documented in: docs/AUDIO_PLAYBACK.md § 6.
 */
import { useEffect } from "react";
import { resetMarkArpeggio } from "../services/audio/markArpeggio";

export function useMarkArpeggio(): void {
    useEffect(() => {
        resetMarkArpeggio();
        return resetMarkArpeggio;
    }, []);
}
