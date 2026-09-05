import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { SPECIMENS } from "./specimens";
import { CJK_FONT_CATALOG, loadCandidate, measureHanAdvance, type CjkFontOption } from "./candidates";
import { cjkFontStack } from "../../theme/cjkFontOptions";
import { readPinned, writePinned } from "./pinned";
import { getCjkFontOverride, setCjkFontOverride } from "../../theme/cjkFontOverride";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";

/**
 * Chinese type lab — a dev surface for choosing the app-wide CJK face.
 *
 * HOW IT WORKS: `FONTS.cjk` resolves to `var(--cjk-font, <default stack>)`
 * (src/theme/fonts.ts), so setting `--cjk-font` on a column re-faces every Chinese
 * glyph inside it — through the REAL components (ForeignText → CPCDRow), at their real
 * sizes, including CPCDRow's pinyin-shift measurement, which reads the candidate's own
 * metrics via an in-DOM Range. Nothing is mocked.
 *
 * LAYOUT: a compare grid — one ROW per specimen surface, one COLUMN per selected face,
 * with no cap on the column count. Grid rows give every column a shared baseline for
 * the same surface, which is the only way small differences (stroke weight, counter
 * size, the pinyin's register over its character) are visible at all. Desktop-width by
 * design: this is an authoring tool, not an app screen, so it uses the full page rather
 * than the phone frame, and overflows into a horizontal scroll rather than crushing
 * columns below MIN_COL.
 *
 * TWO THINGS THAT ARE NOT THE SAME, and used to share the word "pin":
 *   • PIN (many)          — a shortlist. Marks candidates still in the running, persists
 *                           in localStorage, and "Show pinned" recalls them all as
 *                           columns. Affects nothing outside this page. See ./pinned.ts.
 *   • USE APP-WIDE (one)  — sets `--cjk-font` on :root so every Chinese glyph in the app
 *                           changes, surviving navigation and reload, so a candidate can
 *                           be judged on flp, the games and the reader. Single by
 *                           necessity — the app has one CJK face.
 *                           See src/theme/cjkFontOverride.ts. Dev-only; see src/main.tsx.
 *
 * ONE OF TWO MODES on /font-lab. This one chooses the CHINESE face; the other
 * (./InfoTypeLab.tsx) chooses the Latin overline/caption face. They share the route, the
 * shell (./FontLabPage.tsx) and the compare-grid idea, and nothing else — the two
 * decisions are independent and their specimens do not overlap.
 *
 * Route: /font-lab (src/routes/routeMeta.ts). Not linked from any menu.
 * Docs: docs/CJK_TYPEFACE_LAB.md.
 */

/** Glyphs the loader must have ready before a measurement is meaningful. */
const MEASURE_SAMPLE = "汉字爱好图书馆学习";

/**
 * Faces shown on a first visit with nothing pinned: the incumbent, and the strongest
 * argued alternative. A pinned shortlist takes precedence (see the initial state below).
 */
const DEFAULT_SELECTION = ["noto-sans-sc", "lxgw-wenkai"];

/** Colour per typographic class, so the picker groups visually without extra chrome. */
const KIND_TINT: Record<CjkFontOption["kind"], string> = {
    hei: COLORS.bluTint,
    song: COLORS.purTint,
    kai: COLORS.grnTint,
    round: COLORS.orgTint,
    display: COLORS.redTint,
};

/** Width of the sticky row-label column. */
const LABEL_COL = "230px";
/**
 * Floor on a specimen column, below which the running-text row stops showing a real
 * line rhythm. There is no column CAP: past the point where the columns no longer fit,
 * the grid overflows and the page scrolls horizontally rather than squeezing them, so
 * every column stays honestly comparable however many are open.
 */
const MIN_COL = "300px";

/** Per-candidate load + measurement state, keyed by candidate id. */
interface FaceState {
    ready: boolean;
    /** Measured han advance in em, or null when it could not be measured. */
    advance: number | null;
}

const CjkLab: React.FC<{ tabs: React.ReactNode }> = ({ tabs }) => {
    // The pinned shortlist, and the columns currently open. They start equal when
    // anything is pinned — reopening the page recalls what you were considering — and
    // then diverge freely: opening a column does not pin it, and unpinning does not
    // close it. "Show pinned" is the explicit way to re-sync them.
    const [pinnedIds, setPinnedIds] = useState<string[]>(() => readPinned());
    const [selectedIds, setSelectedIds] = useState<string[]>(() => {
        const pinned = readPinned();
        return pinned.length > 0 ? pinned : DEFAULT_SELECTION;
    });
    const [faceState, setFaceState] = useState<Record<string, FaceState>>({});
    // The ONE face driving :root via the dev override, or null. Unrelated to
    // `pinnedIds` above, and it OUTRANKS the signed-in account's own preference while
    // set — see src/theme/cjkFontOverride.ts.
    const [appWideId, setAppWideId] = useState<string | null>(() => getCjkFontOverride());

    const selected = useMemo(
        () =>
            selectedIds
                .map((id) => CJK_FONT_CATALOG.find((c) => c.id === id))
                .filter((c): c is CjkFontOption => Boolean(c)),
        [selectedIds],
    );

    // Fetch each newly-selected candidate's slices, then measure its han advance.
    // Keyed on the JOINED ids rather than the array so a re-render with an equal-but-new
    // array does not re-run; results are merged per id, so deselecting and reselecting a
    // face costs nothing (loadCandidate is idempotent and document.fonts is warm).
    const selectionKey = selectedIds.join(",");
    useEffect(() => {
        let cancelled = false;
        for (const candidate of selected) {
            if (faceState[candidate.id]?.ready) continue;
            void loadCandidate(candidate, MEASURE_SAMPLE).then(() => {
                if (cancelled) return;
                setFaceState((prev) => ({
                    ...prev,
                    [candidate.id]: { ready: true, advance: measureHanAdvance(candidate.family) },
                }));
            });
        }
        return () => {
            cancelled = true;
        };
        // `selected` is derived from selectionKey; faceState is read as a "already done?"
        // guard only and must not retrigger the effect when it fills in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionKey]);

    /** Open or close a candidate's column. No cap — the grid scrolls sideways instead. */
    const toggle = useCallback((id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }, []);

    /** Add or remove a candidate from the persisted shortlist. */
    const togglePin = useCallback((id: string) => {
        setPinnedIds((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            writePinned(next);
            return next;
        });
    }, []);

    /** Open every pinned face as a column, in the shortlist's own order. */
    const showPinned = useCallback(() => setSelectedIds(readPinned()), []);

    /** Set (or clear) the single face that drives `--cjk-font` on :root. */
    const toggleAppWide = useCallback((id: string) => {
        setAppWideId((prev) => {
            const isActive = prev === id;
            setCjkFontOverride(isActive ? null : id);
            return isActive ? null : id;
        });
    }, []);

    // `1fr` only ever GROWS a column past MIN_COL; once the columns stop fitting, the
    // track floor wins and the grid overflows into the root's horizontal scroll.
    const gridTemplateColumns = `${LABEL_COL} repeat(${selected.length}, minmax(${MIN_COL}, 1fr))`;

    return (
        <Box
            className="font-lab"
            sx={{
                // 100dvh, NOT 100%. The plain shell (Layout's non-frame branch) is a
                // column flex box with `minHeight: 100dvh` and an AUTO height, so a
                // percentage height here has no definite parent to resolve against —
                // the box just grows to its content, and html/body (pinned to the
                // viewport with `overflow: hidden`, see src/index.css) clip it rather
                // than scroll. Binding to the dynamic viewport gives this container a
                // definite height, which is what makes `overflow: auto` mean anything.
                height: "100dvh",
                // BOTH axes scroll here, on one element, so the grid's sticky header and
                // sticky label column resolve against the same scroll container. A
                // separate inner `overflow-x` wrapper would become its own scrolling
                // ancestor and break `position: sticky; top: 0` on the header row.
                overflow: "auto",
                WebkitOverflowScrolling: "touch",
                // Scrolling is opt-in app-wide (touchAction defaults to "none"); this
                // is the page's designated scroll container, so it opts into both axes.
                touchAction: "pan-x pan-y",
                overscrollBehavior: "contain",
                background: COLORS.background,
            }}
        >
            <Box className="font-lab__inner" sx={{ padding: "22px 24px 80px", minWidth: "fit-content" }}>
                {tabs}
                <Typography
                    className="font-lab__title"
                    sx={{ fontFamily: FONTS.serif, fontSize: SIZE.heading, color: COLORS.onSurface, lineHeight: 1.1 }}
                >
                    Chinese type lab
                </Typography>
                <Typography
                    className="font-lab__subtitle"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, marginBottom: "14px" }}
                >
                    Swaps <code>FONTS.cjk</code> per column. Pick any number of faces — the grid scrolls sideways rather
                    than crushing columns. Dev-only; not linked from any menu.
                </Typography>

                {/* ── Picker ─────────────────────────────────────────────────────── */}
                <Box className="font-lab__picker" sx={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                    {CJK_FONT_CATALOG.map((candidate) => {
                        const active = selectedIds.includes(candidate.id);
                        const pinned = pinnedIds.includes(candidate.id);
                        return (
                            <Box
                                key={candidate.id}
                                component="button"
                                className={`font-lab__picker-chip${active ? " font-lab__picker-chip--active" : ""}`}
                                onClick={() => toggle(candidate.id)}
                                aria-pressed={active}
                                sx={{
                                    cursor: "pointer",
                                    border: `1px solid ${active ? COLORS.onSurface : COLORS.rowBorder}`,
                                    background: active ? COLORS.onSurface : KIND_TINT[candidate.kind],
                                    color: active ? COLORS.white : COLORS.onSurface,
                                    borderRadius: "999px",
                                    padding: "6px 11px",
                                    fontFamily: FONTS.sans,
                                    fontSize: SIZE.caption,
                                    fontWeight: WEIGHT.medium,
                                    lineHeight: 1.1,
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {active && "✓ "}
                                {pinned && "📌 "}
                                {candidate.label}
                                {candidate.license === "restricted" && " ⚠"}
                            </Box>
                        );
                    })}
                </Box>

                {/* ── Toolbar: shortlist recall + column count ───────────────────── */}
                <Box className="font-lab__toolbar" sx={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "9px" }}>
                    <Box
                        component="button"
                        className="font-lab__show-pinned"
                        onClick={showPinned}
                        disabled={pinnedIds.length === 0}
                        title="Open every pinned face as a column"
                        sx={{
                            cursor: pinnedIds.length === 0 ? "not-allowed" : "pointer",
                            opacity: pinnedIds.length === 0 ? 0.4 : 1,
                            border: `1px solid ${COLORS.border}`,
                            background: COLORS.white,
                            color: COLORS.onSurface,
                            borderRadius: "9px",
                            padding: "6px 12px",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.medium,
                            whiteSpace: "nowrap",
                        }}
                    >
                        📌 Show pinned ({pinnedIds.length})
                    </Box>
                    <Box
                        component="button"
                        className="font-lab__show-all"
                        onClick={() => setSelectedIds(CJK_FONT_CATALOG.map((c) => c.id))}
                        title="Open every candidate as a column"
                        sx={{
                            cursor: "pointer",
                            border: `1px solid ${COLORS.border}`,
                            background: COLORS.white,
                            color: COLORS.onSurface,
                            borderRadius: "9px",
                            padding: "6px 12px",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.medium,
                            whiteSpace: "nowrap",
                        }}
                    >
                        Show all ({CJK_FONT_CATALOG.length})
                    </Box>
                    {selectedIds.length > 0 && (
                        <Box
                            component="button"
                            className="font-lab__clear"
                            onClick={() => setSelectedIds([])}
                            sx={{
                                cursor: "pointer",
                                border: "none",
                                background: "none",
                                padding: "4px 2px",
                                fontFamily: FONTS.sans,
                                fontSize: SIZE.caption,
                                color: COLORS.textSecondary,
                                textDecoration: "underline",
                            }}
                        >
                            clear columns
                        </Box>
                    )}
                    <Typography
                        className="font-lab__picker-count"
                        sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint }}
                    >
                        {selectedIds.length} column{selectedIds.length === 1 ? "" : "s"}
                    </Typography>
                </Box>

                {selected.length === 0 ? (
                    <Typography
                        className="font-lab__empty"
                        sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textFaint, padding: "40px 0" }}
                    >
                        Pick a face above to start a column.
                    </Typography>
                ) : (
                    /* ── Compare grid: one row per specimen, one column per face ── */
                    <Box className="font-lab__grid" sx={{ display: "grid", gridTemplateColumns, marginTop: "16px" }}>
                        {/* Header row. Sticky so column identity survives a long scroll.
                            The corner sticks on BOTH axes — it is the intersection of the
                            sticky header row and the sticky label column, and must sit
                            above each or one slides visibly over the other. */}
                        <HeaderCell corner className="font-lab__grid-corner" />
                        {selected.map((candidate) => (
                            <HeaderCell key={candidate.id} className="font-lab__column-head">
                                <ColumnHead
                                    candidate={candidate}
                                    state={faceState[candidate.id]}
                                    pinned={pinnedIds.includes(candidate.id)}
                                    appWide={appWideId === candidate.id}
                                    onPin={() => togglePin(candidate.id)}
                                    onAppWide={() => toggleAppWide(candidate.id)}
                                    onRemove={() => toggle(candidate.id)}
                                />
                            </HeaderCell>
                        ))}

                        {/* One row per specimen. Grid rows share a height, so the same
                            surface sits on one baseline across every column. */}
                        {SPECIMENS.map((specimen) => (
                            <React.Fragment key={specimen.id}>
                                <Cell label className="font-lab__row-label">
                                    <Typography
                                        sx={{
                                            fontFamily: FONTS.mono,
                                            fontSize: SIZE.micro,
                                            letterSpacing: TRACKING.caps,
                                            textTransform: "uppercase",
                                            color: COLORS.textFaint,
                                        }}
                                    >
                                        {specimen.title}
                                    </Typography>
                                    <Typography
                                        sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.45, marginTop: "4px" }}
                                    >
                                        {specimen.hint}
                                    </Typography>
                                </Cell>
                                {selected.map((candidate) => (
                                    <Cell
                                        key={candidate.id}
                                        className={`font-lab__cell font-lab__cell--${specimen.id}`}
                                        // The face for this column. Everything below reads it
                                        // through FONTS.cjk; no specimen names a family.
                                        style={{ ["--cjk-font" as string]: cjkFontStack(candidate) } as React.CSSProperties}
                                    >
                                        <specimen.Render />
                                    </Cell>
                                ))}
                            </React.Fragment>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
};

/** A grid cell. `label` variant sticks to the left edge during horizontal scroll. */
const Cell: React.FC<{
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    label?: boolean;
}> = ({ children, className, style, label }) => (
    <Box
        className={className}
        style={style}
        sx={{
            padding: label ? "16px 18px 16px 0" : "16px 18px",
            borderTop: `1px solid ${COLORS.rowBorder}`,
            borderLeft: label ? "none" : `1px solid ${COLORS.rowBorder}`,
            background: label ? COLORS.background : COLORS.white,
            // Keeps the label readable when the grid is scrolled sideways past it.
            position: label ? "sticky" : "static",
            left: label ? 0 : "auto",
            zIndex: label ? 1 : "auto",
            minWidth: 0,
        }}
    >
        {children}
    </Box>
);

/**
 * Header-row cell — sticks to the top of the page's scroll container. `corner` also
 * sticks to the left, for the one cell that sits in both the sticky row and the sticky
 * column; it takes the highest layer so neither can slide over it.
 */
const HeaderCell: React.FC<{ children?: React.ReactNode; className?: string; corner?: boolean }> = ({
    children,
    className,
    corner,
}) => (
    <Box
        className={className}
        sx={{
            position: "sticky",
            top: 0,
            left: corner ? 0 : "auto",
            // 3 = corner, 2 = header row, 1 = label column (see Cell).
            zIndex: corner ? 3 : 2,
            background: COLORS.background,
            padding: children ? "0 18px 10px" : "0 0 10px",
            minWidth: 0,
        }}
    >
        {children}
    </Box>
);

/** Name, metrics and controls for one column. */
const ColumnHead: React.FC<{
    candidate: CjkFontOption;
    state: FaceState | undefined;
    /** In the persisted shortlist (page-local bookkeeping). */
    pinned: boolean;
    /** Currently driving `--cjk-font` on :root (at most one column can be). */
    appWide: boolean;
    onPin: () => void;
    onAppWide: () => void;
    onRemove: () => void;
}> = ({ candidate, state, pinned, appWide, onPin, onAppWide, onRemove }) => {
    const advance = state?.advance ?? null;
    // ~1.00 means one full em per han glyph, which is what cpcd's column layout
    // assumes (docs/CPCD_PINYIN_SHIFT.md). Anything else puts pinyin out of register.
    const advanceOk = advance !== null && Math.abs(advance - 1) < 0.02;

    return (
        <Box
            sx={{
                background: COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
                borderRadius: "12px",
                padding: "11px 13px",
            }}
        >
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                    {candidate.label}
                </Typography>
                <Box
                    component="button"
                    className="font-lab__column-remove"
                    onClick={onRemove}
                    aria-label={`Remove ${candidate.label}`}
                    sx={{ cursor: "pointer", border: "none", background: "none", color: COLORS.textFaint, fontSize: SIZE.body, padding: "0 2px" }}
                >
                    ×
                </Box>
            </Box>
            <Typography
                className="font-lab__native"
                style={{ fontFamily: cjkFontStack(candidate) }}
                sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, marginBottom: "6px" }}
            >
                {candidate.nativeLabel}
            </Typography>
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.45, marginBottom: "8px" }}>
                {candidate.note}
            </Typography>

            {/* Objective facts, set in mono so they read as data rather than prose. */}
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                <Tag>{candidate.kind}</Tag>
                <Tag>{candidate.href ? "jsdelivr" : "already loaded"}</Tag>
                <Tag tone={candidate.license === "restricted" ? COLORS.redTint : COLORS.grnTint}>
                    {candidate.license === "restricted" ? "licence: NOT free" : `licence: ${candidate.license}`}
                </Tag>
                <Tag tone={state?.ready && !advanceOk ? COLORS.redTint : undefined}>
                    {advance === null ? "advance: …" : `advance: ${advance.toFixed(3)}em${advanceOk ? " ✓" : " ⚠ breaks cpcd"}`}
                </Tag>
                {!state?.ready && <Tag>loading…</Tag>}
            </Box>

            {/* Two controls, deliberately separate — see the header block's note.
                PIN is page-local bookkeeping; USE APP-WIDE actually re-faces the app. */}
            <Box sx={{ display: "flex", gap: "6px" }}>
                <Box
                    component="button"
                    className="font-lab__pin"
                    onClick={onPin}
                    aria-pressed={pinned}
                    title="Keep this face on the shortlist (page-local; recalled by 'Show pinned')"
                    sx={{
                        cursor: "pointer",
                        flex: 1,
                        border: `1px solid ${COLORS.border}`,
                        background: pinned ? COLORS.yel : COLORS.white,
                        color: COLORS.onSurface,
                        borderRadius: "9px",
                        padding: "7px",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.medium,
                        whiteSpace: "nowrap",
                    }}
                >
                    {pinned ? "📌 Pinned" : "Pin"}
                </Box>
                <Box
                    component="button"
                    className="font-lab__app-wide"
                    onClick={onAppWide}
                    aria-pressed={appWide}
                    title="Set this as the app's CJK face so you can view flp, the games and the reader in it"
                    sx={{
                        cursor: "pointer",
                        flex: 2,
                        border: `1px solid ${COLORS.border}`,
                        background: appWide ? COLORS.onSurface : COLORS.white,
                        color: appWide ? COLORS.white : COLORS.onSurface,
                        borderRadius: "9px",
                        padding: "7px",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.medium,
                        whiteSpace: "nowrap",
                    }}
                >
                    {appWide ? "Using app-wide ✓" : "Use app-wide"}
                </Box>
            </Box>
        </Box>
    );
};

/** A small mono data pill used by the column head. */
const Tag: React.FC<{ children: React.ReactNode; tone?: string }> = ({ children, tone }) => (
    <Typography
        component="span"
        className="font-lab__tag"
        sx={{
            fontFamily: FONTS.mono,
            fontSize: SIZE.micro,
            letterSpacing: TRACKING.wide,
            color: COLORS.iconColor,
            background: tone ?? COLORS.card,
            borderRadius: "6px",
            padding: "3px 6px",
            whiteSpace: "nowrap",
        }}
    >
        {children}
    </Typography>
);

export default CjkLab;
