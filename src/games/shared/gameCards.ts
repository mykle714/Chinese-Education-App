import type { GameCardData } from "./GameCard";
import type { GameDef } from "../types";

/**
 * GameCard data builders shared by every launch surface (Games hub, Reading Center
 * games carousel). A game's per-surface card is one of these plus, at most, its own
 * options — so the fields every card shares (id, name, glyph, hue, wins) are read off
 * the registry in exactly one place.
 *
 * Referenced by: games/GamesPage, features/flashcards/centers/ReadingGamesCarousel,
 * games/bubble-match/bubbleMatchCard, games/word-search/wordSearchCard.
 * Docs: docs/GAMES_FEATURE.md § "Games hub".
 */

/** The registry-derived fields of a game's card, with no options and no launch. */
export function gameCardBase(game: GameDef, wins?: number): GameCardData {
    return { gameId: game.gameId, title: game.title, glyph: game.glyph, hue: game.hue, wins, options: [] };
}

/** A play-only card: no option tiles, just the corner play button (Speed Reading). */
export function buildPlayCard(game: GameDef, wins: number, onPlay: () => void): GameCardData {
    return { ...gameCardBase(game, wins), play: { ariaLabel: `Start ${game.title}`, onSelect: onPlay } };
}

/** A hub tile (`GameCard variant="tile"`): a router link to `to`, with a win pill only
 *  when the game logs wins (`wins` defined). */
export function buildTileCard(game: GameDef, to: string, wins?: number): GameCardData {
    return { ...gameCardBase(game, wins), to };
}
