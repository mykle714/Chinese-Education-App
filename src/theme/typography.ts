// Semantic text roles — ready-made { fontFamily, fontSize, fontWeight,
// lineHeight } bundles so components spread one role instead of re-picking
// size + weight + leading every time. Spread into an sx prop:
//
//   <Box sx={{ ...TEXT.cardTitle, color: COLORS.onSurface }}>…</Box>
import type { CSSProperties } from "react";
import { FONTS } from "./fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "./scale";

export const TEXT = {
    /** Giant headword character (card-detail page). */
    hero: {
        fontFamily: FONTS.serif,
        fontSize: SIZE.hero,
        fontWeight: WEIGHT.bold,
        lineHeight: LEADING.none,
    },
    /** Big numbers / stats. */
    display: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.display,
        fontWeight: WEIGHT.bold,
        lineHeight: LEADING.none,
    },
    /** Top-level page titles. */
    pageTitle: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.heading,
        fontWeight: WEIGHT.bold,
        lineHeight: LEADING.tight,
    },
    /** Card / section titles. */
    cardTitle: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.title,
        fontWeight: WEIGHT.semibold,
        lineHeight: LEADING.tight,
    },
    /** Sub-headers, list-row titles. */
    subtitle: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.subtitle,
        fontWeight: WEIGHT.semibold,
        lineHeight: LEADING.tight,
    },
    /** Default body text. */
    body: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        fontWeight: WEIGHT.regular,
        lineHeight: LEADING.normal,
    },
    /** Emphasized body (same size, heavier). */
    bodyEmph: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        fontWeight: WEIGHT.semibold,
        lineHeight: LEADING.normal,
    },
    /** Captions / metadata. */
    caption: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.medium,
        lineHeight: LEADING.normal,
    },
    /** UPPERCASE overline labels. */
    overline: {
        fontFamily: FONTS.sans,
        fontSize: SIZE.micro,
        fontWeight: WEIGHT.semibold,
        lineHeight: LEADING.none,
        textTransform: "uppercase",
        letterSpacing: TRACKING.caps,
    },
} satisfies Record<string, CSSProperties>;

export type TextRole = keyof typeof TEXT;
