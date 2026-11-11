import { lazyWithPreload } from "../runtime/lazyWithPreload";
import { dealSuperposition, type SuperpositionWord } from "../../api/superposition";
import type { WritingGridDealRequest } from "../../api/writingGrid";
import { loadGlyph } from "../../components/handwriting/GlyphSvg";
import type { FlpBreakContext, FlpBreakGame } from "./types";

/** A break's deal: the same seed and focus rule as Writing Grid's (`writingGridBreakRequest`). */
export function superpositionBreakRequest(context: FlpBreakContext): WritingGridDealRequest {
    return { seedIds: context.seedIds, flpBreak: true };
}

/**
 * Superposition as an flp game break (docs/SUPERPOSITION_GAME.md), in the writing world.
 * The prefetch also loads the stroke data, so Play has no spinner in a production build,
 * where every glyph comes over the CDN (GlyphSvg → CDN_BASE).
 */
export const SUPERPOSITION_BREAK: FlpBreakGame<SuperpositionWord[]> = {
    gameId: "superposition",
    rulesLine: "Stack the scattered strokes back into their characters.",
    prefetch: async (_candidate, context) => {
        const words = await dealSuperposition(superpositionBreakRequest(context));
        await Promise.all(words.flatMap((word) => word.characters.map(({ char }) => loadGlyph(char))));
        return words;
    },
    isPlayable: (words) => words.length > 0,
    Stage: lazyWithPreload(() => import("./SuperpositionBreakStage")),
};
