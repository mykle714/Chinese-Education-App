import React, { useCallback, useState } from "react";
import { Box } from "@mui/material";
import CjkLab from "./CjkLab";
import InfoTypeLab from "./InfoTypeLab";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * /font-lab — the dev type labs. A thin shell over TWO independent labs:
 *
 *   • Chinese   (./CjkLab.tsx)      — chooses `FONTS.cjk`, the face every Chinese glyph
 *                                     renders in. Ships as a per-account SETTING
 *                                     (`users."chineseFont"`), so its catalog lives in
 *                                     production code (src/theme/cjkFontOptions.ts).
 *   • Info type (./InfoTypeLab.tsx) — chooses `FONTS.label`, the overline/caption voice.
 *                                     NOT a setting and never will be: it is one design
 *                                     decision, so its catalog is throwaway dev code and
 *                                     the endpoint is to hardcode the winner.
 *
 * They are separate modes rather than separate routes because they are the same kind of
 * work with the same controls, and one bookmark is easier to remember than two. The mode
 * persists in localStorage so a reload lands you back where you were mid-comparison.
 *
 * Each lab owns its OWN scroll container (see the `100dvh` note in CjkLab) — the shell
 * deliberately adds no wrapper, because a wrapper would become the scrolling ancestor
 * and break both grids' sticky headers. The tab strip is therefore passed DOWN into each
 * lab as a node and rendered inside its scroll container, not floated above it.
 *
 * Dev-only. Not linked from any menu; reachable by typing the URL.
 * Docs: docs/CJK_TYPEFACE_LAB.md, docs/INFO_TYPE_LAB.md.
 */

type LabMode = "cjk" | "info";

const MODE_KEY = "fontLabMode";

const MODES: readonly { id: LabMode; label: string; blurb: string }[] = [
    { id: "cjk", label: "Chinese", blurb: "FONTS.cjk" },
    { id: "info", label: "Info type", blurb: "FONTS.label" },
];

const FontLabPage: React.FC = () => {
    const [mode, setMode] = useState<LabMode>(() => (localStorage.getItem(MODE_KEY) === "info" ? "info" : "cjk"));

    const choose = useCallback((next: LabMode) => {
        setMode(next);
        localStorage.setItem(MODE_KEY, next);
    }, []);

    const tabs = (
        <Box className="font-lab__modes" sx={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
            {MODES.map((m) => {
                const active = m.id === mode;
                return (
                    <Box
                        key={m.id}
                        component="button"
                        className={`font-lab__mode${active ? " font-lab__mode--active" : ""}`}
                        onClick={() => choose(m.id)}
                        aria-pressed={active}
                        sx={{
                            cursor: "pointer",
                            border: `1px solid ${active ? COLORS.onSurface : COLORS.rowBorder}`,
                            background: active ? COLORS.onSurface : COLORS.white,
                            color: active ? COLORS.white : COLORS.onSurface,
                            borderRadius: "10px",
                            padding: "7px 14px",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.semibold,
                            display: "flex",
                            alignItems: "baseline",
                            gap: "7px",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {m.label}
                        {/* The token each lab actually writes — the shortest possible
                            statement of what the mode does. Set in mono because it is a
                            code identifier, and NOT through FONTS.label: the info lab
                            re-faces that, and its own chrome must not move underfoot. */}
                        <Box component="span" sx={{ fontFamily: FONTS.mono, fontSize: 10, opacity: 0.62 }}>
                            {m.blurb}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );

    return mode === "cjk" ? <CjkLab tabs={tabs} /> : <InfoTypeLab tabs={tabs} />;
};

export default FontLabPage;
