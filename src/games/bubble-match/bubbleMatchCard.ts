import { RAMP } from "../../theme/colors";
import type { GameCardData } from "../shared/GameCard";
import { gameCardBase } from "../shared/gameCards";
import type { GameDef } from "../types";
import { LEVEL_CONFIGS, levelHue } from "./constants";

/**
 * Bubble Match's `GameCard` data — one level tile per LEVEL_CONFIGS entry, filled with
 * its LEVEL_HUES mid tier and starred when cleared this week. The ONE definition of the
 * card, shared by the Reading Center's games carousel and the Games hub, so the two can
 * only differ in what a level tap launches (`onSelectLevel`): the carousel pins reading
 * (`showPinyin: false`, exit back to the center), the hub pins recognition
 * (`showPinyin: true`, collection params).
 *
 * Referenced by: features/flashcards/centers/ReadingGamesCarousel, games/GamesPage.
 * Docs: docs/GAMES_FEATURE.md § "Games hub", docs/READING_WRITING_CENTERS.md.
 */
export function buildBubbleMatchCard(
    game: GameDef,
    wins: number,
    clearedLevels: ReadonlySet<number>,
    onSelectLevel: (level: number) => void,
): GameCardData {
    return {
        ...gameCardBase(game, wins),
        // No hue → a WHITE card: its options carry the level hues, and a hued card
        // under hued options reads as one undifferentiated block.
        hue: undefined,
        options: LEVEL_CONFIGS.map((cfg) => ({
            kind: "level" as const,
            key: `level-${cfg.level}`,
            // The level number only — the Chill / Hustle / Torture name (`cfg.label`)
            // is shown in-game (HUD + win screen), not on the launch tile.
            title: `Level ${cfg.level}`,
            ground: RAMP[levelHue(cfg.level)].mid,
            star: clearedLevels.has(cfg.level),
            // The game's own glyph (bubble_chart) as a small ghost — texture on an
            // otherwise flat hued tile, echoing the card's large ghost above it.
            glyph: game.glyph,
            onSelect: () => onSelectLevel(cfg.level),
        })),
    };
}
