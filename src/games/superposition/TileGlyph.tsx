/**
 * One tile's strokes, drawn in the hanzi-writer glyph box and scaled to whatever box holds
 * it. Shared by the full-size board tile (`SuperpositionBoard`) and its mini in the tray
 * (`SuperpositionTray`), so a mini is always exactly its tile, shrunk.
 *
 * Layer: game component, presentational. Doc: docs/SUPERPOSITION_GAME.md § Tray.
 */

/** The hanzi-writer glyph box, Y-up (see GlyphSvg). */
const GLYPH_VIEW_BOX = "0 0 1024 1024";
const GLYPH_TRANSFORM = "translate(0,900) scale(1,-1)";

interface TileGlyphProps {
    paths: readonly string[];
    fill: string;
}

const TileGlyph: React.FC<TileGlyphProps> = ({ paths, fill }) => (
    <svg className="superposition-tile-glyph" viewBox={GLYPH_VIEW_BOX} width="100%" height="100%" aria-hidden>
        <g transform={GLYPH_TRANSFORM}>
            {paths.map((path) => (
                <path key={path} d={path} fill={fill} />
            ))}
        </g>
    </svg>
);

export default TileGlyph;
