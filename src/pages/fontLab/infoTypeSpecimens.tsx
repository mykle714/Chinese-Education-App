// Specimen surfaces for the Info-type lab.
//
// Every string here is REAL COPY lifted from the app, not lorem — the whole failure mode
// of the incumbent shows up on specific strings ("sense 1 · to be located at" at 10px in
// faint ink) and disappears on a tidy invented one. Where a specimen names its source
// file, that is where the string is rendered for real.
//
// The specimens deliberately render through `Label`/`SectionRule`/`SectionHeader` from
// src/components/primitives, NOT through a local copy: they inherit `FONTS.label`, which
// the lab re-faces per column via `--label-font`, so what you are judging is the actual
// shipped component at its actual size. Anything that hardcodes a family here would be
// lying to you.

/* eslint-disable react-refresh/only-export-components -- This file intentionally exports
   both the specimen DATA (`INFO_SPECIMENS`) and the two local components the specimens are
   built from, which costs it Fast Refresh. Splitting them into a third file to satisfy the
   rule would scatter throwaway dev scaffolding across more files than it is worth; the
   sibling `specimens.tsx` avoids the warning only because it inlines its render functions
   into the array, which is less readable at this file's size. */
import React from "react";
import { Box, Typography } from "@mui/material";
import { Label, SectionRule, SectionHeader } from "../../components/primitives";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

export interface InfoSpecimen {
    id: string;
    /** Row label in the lab's sticky left column. */
    title: string;
    /** What this row is testing, and what failure looks like. */
    hint: string;
    Render: React.FC;
}

/** The two-label caption row from the eip tabs, reproduced exactly. */
const TabCaption: React.FC<{ left: string; right: string }> = ({ left, right }) => (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "13px 0 0" }}>
        <Label>{left}</Label>
        <Label>{right}</Label>
    </Box>
);

/** A stand-in for the pane a caption sits on, so the ink is judged against real paper. */
const Pane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Box sx={{ background: COLORS.white, border: `1px solid ${COLORS.rowBorder}`, borderRadius: "12px", padding: "0 14px 12px" }}>
        {children}
    </Box>
);

export const INFO_SPECIMENS: readonly InfoSpecimen[] = [
    {
        id: "eip-caption",
        title: "eip tab caption",
        hint: "The complaint. `.mobile-demo-examples-caption` in InfoCardTabContent — a SENTENCE set at 10px, uppercased and tracked to 0.14em. If a face is going to fall apart, it falls apart on the long left-hand string.",
        Render: () => (
            <Pane>
                <TabCaption left="sense 1 · to be located at" right="12 examples" />
                <TabCaption left="sense 2 · to exist; to be alive" right="4 examples" />
                <TabCaption left="学习 · 2 characters" right="tap to open" />
                <TabCaption left="在 · used in" right="tap to open" />
            </Pane>
        ),
    },
    {
        id: "section-rules",
        title: "section rules",
        hint: "`SectionRule` (.sec2) — the app's default section divider. Short strings, so this row is about COLOUR: does the overline sit at the same weight as the hairline, or shout over it?",
        Render: () => (
            <Pane>
                <SectionRule label="mastery" />
                <SectionRule label="your library" />
                <SectionRule label="this week" right={<Label sx={{ whiteSpace: "nowrap" }}>minutes</Label>} />
                <SectionRule label="recently studied" />
            </Pane>
        ),
    },
    {
        id: "section-headers",
        title: "section headers",
        hint: "`SectionHeader` (.shelfhd) with a meta fact and a chevron. Tests the overline next to an ICON — a face that is too light disappears beside a 19px glyph.",
        Render: () => (
            <Pane>
                <SectionHeader label="collections" meta="8 decks" action="chevron_right" onActionClick={() => {}} actionLabel="Open" />
                <SectionHeader label="friends" meta="3 pending" action="add" onActionClick={() => {}} actionLabel="Add" />
                <SectionHeader label="arena" meta="25 players" action="chevron_right" onActionClick={() => {}} actionLabel="Open" />
            </Pane>
        ),
    },
    {
        id: "inline-facts",
        title: "inline facts",
        hint: "The OTHER job `.lab` is doing: counts and ranks sitting inline. These are DATA, and are the argument for keeping a mono. If a sans face wins the caption row but loses here, the answer is two tokens, not one.",
        Render: () => (
            <Pane>
                <Box sx={{ display: "flex", gap: "14px", flexWrap: "wrap", paddingTop: "13px" }}>
                    <Label>rank 12</Label>
                    <Label>1,284</Label>
                    <Label>4 senses</Label>
                    <Label>commonality</Label>
                    <Label>×12 wins</Label>
                    <Label>00:42</Label>
                </Box>
                <Box sx={{ display: "flex", gap: "14px", flexWrap: "wrap", paddingTop: "8px" }}>
                    <Label>0123456789</Label>
                    <Label>day 7 · 90 min</Label>
                </Box>
            </Pane>
        ),
    },
    {
        id: "on-pastel",
        title: "on a pastel",
        hint: "Overlines on the tinted tiles (Bento, mastery bands), where `color` is overridden off the faint default. Contrast is higher here, so a face that only worked because it was faint will suddenly look heavy.",
        Render: () => (
            <Box sx={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {([["night market", COLORS.orgTint], ["games", COLORS.grnTint], ["reader", COLORS.bluTint], ["dictionary", COLORS.purTint]] as const).map(
                    ([text, tint]) => (
                        <Box key={text} sx={{ background: tint, borderRadius: "12px", padding: "10px 12px", minWidth: "116px" }}>
                            <Label color={COLORS.onSurface}>{text}</Label>
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, marginTop: "3px" }}>
                                Open
                            </Typography>
                        </Box>
                    ),
                )}
            </Box>
        ),
    },
    {
        id: "dark",
        title: "on dark",
        hint: "Reversed out. Thin faces gain apparent weight on dark and can bloom shut; this is where a light mono stops being readable.",
        Render: () => (
            <Box sx={{ background: COLORS.onSurface, borderRadius: "12px", padding: "12px 14px" }}>
                <Label color="rgba(255,255,255,.55)">sense 1 · to be located at</Label>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.white, margin: "4px 0 10px" }}>
                    在 — zài
                </Typography>
                <Label color="rgba(255,255,255,.88)">tap to open</Label>
            </Box>
        ),
    },
    {
        id: "density",
        title: "density",
        hint: "Eight overlines stacked, which is roughly what a settings page or the decks page actually shows. Judge this row for TEXTURE, not for any single line — the incumbent's problem is most visible here.",
        Render: () => (
            <Pane>
                {["display", "study", "notifications", "language", "typeface", "account", "privacy", "danger zone"].map((s) => (
                    <Box key={s} sx={{ paddingTop: "11px" }}>
                        <Label>{s}</Label>
                    </Box>
                ))}
            </Pane>
        ),
    },
    {
        id: "case-and-figures",
        title: "case & figures",
        hint: "Raw material: full caps, the digits, and the punctuation the captions lean on (· × —). Check that the digits are the same width as each other and that the middot does not vanish.",
        Render: () => (
            <Pane>
                <Box sx={{ paddingTop: "13px", display: "grid", gap: "6px" }}>
                    <Label>ABCDEFGHIJKLM</Label>
                    <Label>NOPQRSTUVWXYZ</Label>
                    <Label>0123456789</Label>
                    <Label>· × — ÷ … / ( ) [ ] % + ✓ ⚠</Label>
                </Box>
            </Pane>
        ),
    },
];
