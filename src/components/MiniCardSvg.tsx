import React, { memo, useId, useMemo } from "react";
import { useTheme } from "@mui/material";
import type { Language } from "../types";
import { COLORS } from "../theme/colors";
import { iconImageUrl } from "../cardIcons/cardIconLayout";
import { useFontLoadEpoch } from "../hooks/useFontLoadEpoch";
import type { FontSpec } from "../utils/canvasText";
import type { MiniCardSize } from "./miniCardFace";
import { layoutMiniCardSvg } from "./miniCardSvgLayout";

/**
 * MiniCardSvg — the mini preview card (MiniCard) drawn as NATIVE SVG, in the card's own
 * px space (0,0 = top-left; 92 × 132 for `regular`). Place it with a `transform` on a
 * parent `<g>`; it draws nothing outside its box.
 *
 * WHY IT EXISTS: the acp's iso decks lay the top card's face flat on the deck with an
 * affine transform (SortBins → DeckFace). The HTML MiniCard in a `<foreignObject>` did
 * that perfectly in Chrome, but WebKit (iOS Safari) paints positioned / clipped HTML
 * inside a transformed foreignObject WITHOUT the SVG transforms — the face landed as a
 * flat, unrotated card at the scene's corner (2026-11-10, iPhone). Native SVG text,
 * images and rects take the transform in every engine.
 *
 * Faithfulness: the contents are placed by `layoutMiniCardSvg` from the same numbers the
 * HTML card reads (MiniCard's MINI_CARD_CONTENT_LAYOUT / DEFINITION_*, the cpcd tables
 * and pinyin solver in cpcdLayout.ts) and text measured with canvas — so the two agree to
 * sub-pixel for ordinary words. Re-laid when a web font finishes loading.
 *
 * Draws: the tile (fill + hairline ring), the icon slot's icon, the word (zh: tone-
 * coloured cpcd with the pinyin shift and separator apostrophes; es: plain text), the
 * gloss clamped to two lines. NOT drawn: MiniCard's mastery strip, custom icon layer,
 * overlay children and its raised shadow (the iso slab under it is its elevation).
 *
 * Layer: presentation (src/components). Depended on by SortBins.tsx (DeckFace). Docs:
 * docs/ISO_ART_FRAMEWORK.md (intro), docs/SORT_CARDS_REQUIREMENTS.md § 5.3 ("the deck"),
 * docs/CARD_LIBRARY.md (the mini card's renderers).
 */
export interface MiniCardSvgProps {
    language?: Language;
    entryKey: string;
    pronunciation?: string | null;
    /** The display definition, already cleaned by the caller. */
    definition: string;
    iconId?: string | null;
    /** Tile fill. Defaults to the theme's card face, as MiniCard does. */
    background?: string;
    /** Per-card Contrast overrides, as MiniCard's. */
    characterColor?: string;
    definitionColor?: string;
    size?: MiniCardSize;
    className?: string;
}

/** SVG text attributes for a FontSpec. The family goes in `style`: `var()` is CSS-only. */
function fontProps(font: FontSpec): Pick<React.SVGProps<SVGTextElement>, "fontSize" | "fontWeight" | "fontStyle" | "style"> {
    return {
        fontSize: font.sizePx,
        fontWeight: font.weight,
        fontStyle: font.italic ? "italic" : undefined,
        style: { fontFamily: font.family, ...(font.stretch && { fontStretch: font.stretch }) },
    };
}

const MiniCardSvg: React.FC<MiniCardSvgProps> = ({
    language,
    entryKey,
    pronunciation,
    definition,
    iconId,
    background,
    characterColor,
    definitionColor,
    size = "regular",
    className,
}) => {
    const theme = useTheme();
    // Re-measure once web fonts land: a layout measured against a fallback face would
    // wrap and shift by the fallback's widths.
    const fontEpoch = useFontLoadEpoch();
    const layout = useMemo(
        () => layoutMiniCardSvg({ language, entryKey, pronunciation, definition, iconId, size }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fontEpoch re-measures with the loaded font
        [language, entryKey, pronunciation, definition, iconId, size, fontEpoch],
    );
    // useId gives ":r1:"-style ids; keep only characters that are safe inside url(#…).
    const clipId = `mini-card-svg-gloss-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const ink = characterColor ?? theme.palette.text.primary;
    const fill = background ?? theme.palette.flashcard.flashCard;

    return (
        <g className={className ? `mini-card-svg ${className}` : "mini-card-svg"} pointerEvents="none">
            <defs>
                <clipPath id={clipId}>
                    <rect
                        x={layout.definitionClip.x}
                        y={layout.definitionClip.y}
                        width={layout.definitionClip.width}
                        height={layout.definitionClip.height}
                    />
                </clipPath>
            </defs>
            <rect className="mini-card-svg__tile" x={0} y={0} width={layout.width} height={layout.height} rx={layout.radius} fill={fill} />
            {/* MINI_CARD_RING: a 1px inset hairline — a stroke centred half a px inside the edge. */}
            <rect
                className="mini-card-svg__ring"
                x={0.5}
                y={0.5}
                width={layout.width - 1}
                height={layout.height - 1}
                rx={layout.radius - 0.5}
                fill="none"
                stroke={COLORS.border}
                strokeWidth={1}
            />
            {iconId && (
                <image
                    className="mini-card-svg__icon"
                    href={iconImageUrl(iconId)}
                    x={layout.iconBox.x}
                    y={layout.iconBox.y}
                    width={layout.iconBox.size}
                    height={layout.iconBox.size}
                    preserveAspectRatio="xMidYMid meet"
                />
            )}
            <g className="mini-card-svg__entry-key">
                {layout.glyphs.map((g, i) => (
                    <text key={`g${i}`} className="mini-card-svg__character" x={g.x} y={g.y} textAnchor="middle" fill={ink} {...fontProps(layout.glyphFont)}>
                        {g.text}
                    </text>
                ))}
                {layout.pinyins.map((p, i) => (
                    <text key={`p${i}`} className="mini-card-svg__pinyin" x={p.x} y={p.y} textAnchor={p.anchor} fill={p.color} {...fontProps(layout.pinyinFont)}>
                        {p.text}
                    </text>
                ))}
                {layout.separators.map((s, i) => (
                    <text key={`s${i}`} className="mini-card-svg__pinyin-sep" x={s.x} y={s.y} textAnchor="middle" fill={theme.palette.text.primary} {...fontProps(layout.separatorFont)}>
                        {"’"}
                    </text>
                ))}
                {layout.plainLines.map((l, i) => (
                    <text key={`l${i}`} className="mini-card-svg__plain-word" x={l.x} y={l.y} fill={ink} {...fontProps(layout.plainFont)}>
                        {l.text}
                    </text>
                ))}
            </g>
            <g className="mini-card-svg__definition" clipPath={`url(#${clipId})`}>
                {layout.definitionLines.map((line, i) => (
                    <text
                        key={i}
                        className="mini-card-svg__definition-line"
                        x={layout.definitionCenterX}
                        y={line.y}
                        textAnchor="middle"
                        fill={definitionColor ?? COLORS.textSecondary}
                        {...fontProps(layout.definitionFont)}
                    >
                        {line.runs.map((run, k) => (
                            <tspan key={k} className={run.italic ? "mini-card-svg__classifier-label" : undefined} fontStyle={run.italic ? "italic" : undefined}>
                                {run.text}
                            </tspan>
                        ))}
                    </text>
                ))}
            </g>
        </g>
    );
};

// Memoized: the deck re-renders on every highlight change; its faces rarely change.
export default memo(MiniCardSvg);
