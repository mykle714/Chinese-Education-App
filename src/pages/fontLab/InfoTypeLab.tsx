import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { INFO_SPECIMENS } from "./infoTypeSpecimens";
import { INFO_FACE_CATALOG, infoFaceStack, loadInfoFace, type InfoFaceOption } from "./infoTypeCandidates";
import { getLabelFontOverride, setLabelFontOverride } from "./labelFontOverride";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";

/**
 * Info-type lab — a dev surface for choosing the app's OVERLINE/CAPTION face.
 *
 * WHAT IS BEING CHOSEN: `FONTS.label` (src/theme/fonts.ts), which resolves to
 * `var(--label-font, <Public Sans stack>)`. Setting `--label-font` on a column
 * re-faces every `.lab` inside it, and because the specimens render the REAL
 * `Label`/`SectionRule`/`SectionHeader` primitives, what you are judging is the shipped
 * component at its shipped size. Nothing here is a mock-up of the caption.
 *
 * WHY IT IS NOT JUST A FACE PICKER: three of the four numbers behind the flavour are as
 * much to blame as the typeface, so they are controls rather than constants —
 *   • SIZE      10px was below JetBrains Mono's floor, and is still light for a sans.
 *   • TRACKING  0.14em is added on top of a face that already has a uniform, wide
 *               advance; the same number on a sans means something completely different.
 *   • WEIGHT    faint ink at 10px usually wants 500–600, and the primitive ships 400.
 * They apply to EVERY column at once, on purpose: comparing faces at different settings
 * compares nothing. The controls write a `& .lab` override on the grid, which is the one
 * legitimate place to reach into a primitive's styling — the lab is measuring the
 * primitive, not using it.
 *
 * WHAT IT DOES NOT COVER: the ~19 hand-rolled `FONTS.mono` overlines listed in
 * WHAT IT COVERS: everything. The 18 hand-rolled overline sites were migrated to
 * `FONTS.label` on 2026-09-04 (docs/INFO_TYPE_LAB.md § 5), so "Use app-wide" now re-faces
 * the whole app rather than only the `Label` primitive. Deliberate hold-outs are user ids
 * and the `ch`-sized PageHeader chips, which are data and stay on `FONTS.mono`.
 *
 * Route: /font-lab, "Info type" mode (./FontLabPage.tsx). Docs: docs/INFO_TYPE_LAB.md.
 */

/** Faces opened on a first visit: the shipped face, the incumbent it replaced, and the
 *  strongest remaining mono argument. */
const DEFAULT_SELECTION = ["public-sans", "jetbrains-mono", "martian-mono"];

/** The primitive's shipped numbers — the baseline every control resets to. */
const SHIPPED = { size: 10, tracking: 0.14, weight: 400, uppercase: true } as const;

const KIND_TINT: Record<InfoFaceOption["kind"], string> = {
    mono: COLORS.bluTint,
    sans: COLORS.grnTint,
};

const LABEL_COL = "250px";
/** Column floor. Past the point where columns stop fitting, the grid scrolls sideways. */
const MIN_COL = "300px";

const InfoTypeLab: React.FC<{ tabs: React.ReactNode }> = ({ tabs }) => {
    const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_SELECTION);
    const [ready, setReady] = useState<Record<string, boolean>>({});
    const [appWideId, setAppWideId] = useState<string | null>(() => getLabelFontOverride());

    // The four numbers, tunable. See the "WHY IT IS NOT JUST A FACE PICKER" note above.
    const [size, setSize] = useState<number>(SHIPPED.size);
    const [tracking, setTracking] = useState<number>(SHIPPED.tracking);
    const [weight, setWeight] = useState<number>(SHIPPED.weight);
    const [uppercase, setUppercase] = useState<boolean>(SHIPPED.uppercase);

    const selected = useMemo(
        () =>
            selectedIds
                .map((id) => INFO_FACE_CATALOG.find((c) => c.id === id))
                .filter((c): c is InfoFaceOption => Boolean(c)),
        [selectedIds],
    );

    // Load each newly-opened face. Keyed on the JOINED ids rather than the array so an
    // equal-but-new array does not re-run it; `ready` is read as an "already done?"
    // guard and must not retrigger the effect when it fills in.
    const selectionKey = selectedIds.join(",");
    useEffect(() => {
        let cancelled = false;
        for (const face of selected) {
            if (ready[face.id]) continue;
            void loadInfoFace(face).then(() => {
                if (!cancelled) setReady((prev) => ({ ...prev, [face.id]: true }));
            });
        }
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionKey]);

    const toggle = useCallback((id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }, []);

    /** Set (or clear) the single face driving `--label-font` on :root. */
    const toggleAppWide = useCallback((id: string) => {
        setAppWideId((prev) => {
            const isActive = prev === id;
            setLabelFontOverride(isActive ? null : id);
            return isActive ? null : id;
        });
    }, []);

    const resetTuning = useCallback(() => {
        setSize(SHIPPED.size);
        setTracking(SHIPPED.tracking);
        setWeight(SHIPPED.weight);
        setUppercase(SHIPPED.uppercase);
    }, []);

    const tuned = size !== SHIPPED.size || tracking !== SHIPPED.tracking || weight !== SHIPPED.weight || uppercase !== SHIPPED.uppercase;

    // `1fr` only GROWS a column past MIN_COL; once they stop fitting, the floor wins and
    // the grid overflows into the root's horizontal scroll.
    const gridTemplateColumns = `${LABEL_COL} repeat(${selected.length}, minmax(${MIN_COL}, 1fr))`;

    /**
     * The tuning, pushed onto every `.lab` in the grid. `!important` is unavoidable: the
     * primitive sets these four properties inline via MUI's `sx`, which emits a class
     * with higher specificity than a descendant selector can reach. This is dev-only
     * measurement scaffolding and never ships.
     */
    const tuningOverride = {
        "& .lab": {
            fontSize: `${size}px !important`,
            letterSpacing: `${tracking}em !important`,
            fontWeight: `${weight} !important`,
            textTransform: `${uppercase ? "uppercase" : "none"} !important`,
        },
    } as const;

    return (
        <Box
            className="info-type-lab"
            sx={{
                // 100dvh, not 100% — the plain shell has an AUTO height, so a percentage
                // has no definite parent to resolve against and the box would just grow
                // to its content while html/body clip it. Same trap as CjkLab; see
                // docs/UX_AND_NAVIGATION.md.
                height: "100dvh",
                // Both axes on ONE element, so the grid's sticky header row and sticky
                // label column resolve against the same scroll container.
                overflow: "auto",
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-x pan-y",
                overscrollBehavior: "contain",
                background: COLORS.background,
            }}
        >
            <Box className="info-type-lab__inner" sx={{ padding: "22px 24px 80px", minWidth: "fit-content" }}>
                {tabs}
                <Typography
                    className="info-type-lab__title"
                    sx={{ fontFamily: FONTS.serif, fontSize: SIZE.heading, color: COLORS.onSurface, lineHeight: 1.1 }}
                >
                    Info type lab
                </Typography>
                <Typography
                    className="info-type-lab__subtitle"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, marginBottom: "14px", maxWidth: "62ch", lineHeight: 1.5 }}
                >
                    Swaps <code>FONTS.label</code> per column — the overline voice behind <code>.lab</code>,{" "}
                    <code>.sec2</code> and <code>.shelfhd</code>. Specimens render the real primitives, so what you see
                    is the shipped component. Tune size / tracking / weight below; the tuning is shared across every
                    column so the faces stay comparable. Dev-only.
                </Typography>

                {/* ── Face picker ────────────────────────────────────────────────── */}
                <Box className="info-type-lab__picker" sx={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                    {INFO_FACE_CATALOG.map((face) => {
                        const active = selectedIds.includes(face.id);
                        return (
                            <Box
                                key={face.id}
                                component="button"
                                className={`info-type-lab__picker-chip${active ? " info-type-lab__picker-chip--active" : ""}`}
                                onClick={() => toggle(face.id)}
                                aria-pressed={active}
                                // Previewed IN ITS OWN FACE once loaded, so the picker is
                                // itself a specimen rather than a list of names.
                                style={ready[face.id] ? { fontFamily: infoFaceStack(face) } : undefined}
                                sx={{
                                    cursor: "pointer",
                                    border: `1px solid ${active ? COLORS.onSurface : COLORS.rowBorder}`,
                                    background: active ? COLORS.onSurface : KIND_TINT[face.kind],
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
                                {face.family}
                            </Box>
                        );
                    })}
                </Box>

                {/* ── Tuning: the three numbers that are as much to blame as the face ── */}
                <Box
                    className="info-type-lab__tuning"
                    sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "18px",
                        marginTop: "12px",
                        padding: "11px 14px",
                        background: COLORS.white,
                        border: `1px solid ${COLORS.rowBorder}`,
                        borderRadius: "12px",
                    }}
                >
                    <Slider label="size" value={size} min={8} max={14} step={0.5} onChange={setSize} format={(v) => `${v}px`} shipped={SHIPPED.size} />
                    <Slider label="tracking" value={tracking} min={0} max={0.2} step={0.01} onChange={setTracking} format={(v) => `${v.toFixed(2)}em`} shipped={SHIPPED.tracking} />
                    <Slider label="weight" value={weight} min={300} max={700} step={100} onChange={setWeight} format={(v) => `${v}`} shipped={SHIPPED.weight} />
                    <Box
                        component="button"
                        className="info-type-lab__case"
                        onClick={() => setUppercase((v) => !v)}
                        aria-pressed={uppercase}
                        sx={{
                            cursor: "pointer",
                            border: `1px solid ${COLORS.border}`,
                            background: uppercase ? COLORS.onSurface : COLORS.white,
                            color: uppercase ? COLORS.white : COLORS.onSurface,
                            borderRadius: "9px",
                            padding: "6px 11px",
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.caption,
                            fontWeight: WEIGHT.medium,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {uppercase ? "UPPERCASE" : "sentence case"}
                    </Box>
                    {tuned && (
                        <Box
                            component="button"
                            className="info-type-lab__reset"
                            onClick={resetTuning}
                            title="Back to what the primitive ships: 10px / 0.14em / 400 / uppercase"
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
                            reset to shipped
                        </Box>
                    )}
                </Box>

                {/* ── Toolbar ────────────────────────────────────────────────────── */}
                <Box className="info-type-lab__toolbar" sx={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "9px" }}>
                    <ToolbarButton onClick={() => setSelectedIds(INFO_FACE_CATALOG.map((f) => f.id))}>
                        Show all ({INFO_FACE_CATALOG.length})
                    </ToolbarButton>
                    <ToolbarButton onClick={() => setSelectedIds(INFO_FACE_CATALOG.filter((f) => f.kind === "mono").map((f) => f.id))}>
                        Monos only
                    </ToolbarButton>
                    <ToolbarButton onClick={() => setSelectedIds(INFO_FACE_CATALOG.filter((f) => f.kind === "sans").map((f) => f.id))}>
                        Sans only
                    </ToolbarButton>
                    {selectedIds.length > 0 && (
                        <Box
                            component="button"
                            className="info-type-lab__clear"
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
                    <Typography sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint }}>
                        {selectedIds.length} column{selectedIds.length === 1 ? "" : "s"}
                    </Typography>
                </Box>

                {selected.length === 0 ? (
                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textFaint, padding: "40px 0" }}>
                        Pick a face above to start a column.
                    </Typography>
                ) : (
                    <Box className="info-type-lab__grid" sx={{ display: "grid", gridTemplateColumns, marginTop: "16px" }}>
                        {/* The corner sticks on BOTH axes and takes the highest layer, or
                            the sticky header row and sticky label column slide over it. */}
                        <HeaderCell corner className="info-type-lab__grid-corner" />
                        {selected.map((face) => (
                            <HeaderCell key={face.id} className="info-type-lab__column-head">
                                <ColumnHead
                                    face={face}
                                    ready={Boolean(ready[face.id])}
                                    weight={weight}
                                    appWide={appWideId === face.id}
                                    onAppWide={() => toggleAppWide(face.id)}
                                    onRemove={() => toggle(face.id)}
                                />
                            </HeaderCell>
                        ))}

                        {INFO_SPECIMENS.map((specimen) => (
                            <React.Fragment key={specimen.id}>
                                <Cell label className="info-type-lab__row-label">
                                    <Typography
                                        sx={{
                                            // The lab's OWN chrome stays on FONTS.mono, never
                                            // FONTS.label — a row label that re-faces with the
                                            // thing under test is unreadable as a control.
                                            fontFamily: FONTS.mono,
                                            fontSize: SIZE.micro,
                                            letterSpacing: TRACKING.caps,
                                            textTransform: "uppercase",
                                            color: COLORS.textFaint,
                                        }}
                                    >
                                        {specimen.title}
                                    </Typography>
                                    <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.45, marginTop: "4px" }}>
                                        {specimen.hint}
                                    </Typography>
                                </Cell>
                                {selected.map((face) => (
                                    <Cell
                                        key={face.id}
                                        className={`info-type-lab__cell info-type-lab__cell--${specimen.id}`}
                                        // The face for this column. Every specimen reads it
                                        // through FONTS.label; none names a family.
                                        style={{ ["--label-font" as string]: infoFaceStack(face) } as React.CSSProperties}
                                        sx={tuningOverride}
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

/** A labelled range input. Marks when the value has left the shipped baseline. */
const Slider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    shipped: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}> = ({ label, value, min, max, step, shipped, format, onChange }) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Typography sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, letterSpacing: TRACKING.caps, textTransform: "uppercase", color: COLORS.textFaint, whiteSpace: "nowrap" }}>
            {label}
        </Typography>
        <Box
            component="input"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
            aria-label={label}
            sx={{ width: "118px", cursor: "pointer" }}
        />
        <Typography
            sx={{
                fontFamily: FONTS.mono,
                fontSize: SIZE.micro,
                color: value === shipped ? COLORS.textFaint : COLORS.onSurface,
                fontWeight: value === shipped ? WEIGHT.regular : WEIGHT.semibold,
                minWidth: "46px",
                whiteSpace: "nowrap",
            }}
        >
            {format(value)}
        </Typography>
    </Box>
);

const ToolbarButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
    <Box
        component="button"
        onClick={onClick}
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
        {children}
    </Box>
);

/** A grid cell. `label` variant sticks to the left edge during horizontal scroll. */
const Cell: React.FC<{
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    sx?: object;
    label?: boolean;
}> = ({ children, className, style, sx, label }) => (
    <Box
        className={className}
        style={style}
        sx={[
            {
                padding: label ? "16px 18px 16px 0" : "16px 18px",
                borderTop: `1px solid ${COLORS.rowBorder}`,
                borderLeft: label ? "none" : `1px solid ${COLORS.rowBorder}`,
                background: label ? COLORS.background : COLORS.white,
                position: label ? "sticky" : "static",
                left: label ? 0 : "auto",
                zIndex: label ? 1 : "auto",
                minWidth: 0,
            },
            sx ?? {},
        ]}
    >
        {children}
    </Box>
);

/** Header-row cell. `corner` also sticks left and takes the highest layer. */
const HeaderCell: React.FC<{ children?: React.ReactNode; className?: string; corner?: boolean }> = ({ children, className, corner }) => (
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

/** Name, facts and controls for one column. */
const ColumnHead: React.FC<{
    face: InfoFaceOption;
    ready: boolean;
    /** The tuning's current weight, so the head can warn when this face lacks it. */
    weight: number;
    appWide: boolean;
    onAppWide: () => void;
    onRemove: () => void;
}> = ({ face, ready, weight, appWide, onAppWide, onRemove }) => {
    // Google Fonts CLAMPS a weight it does not have to the nearest one it does, and still
    // answers 200 — so a column can silently render at 500 while the control says 700.
    // Saying so is the whole reason `weights` is a verified list rather than a guess.
    const hasWeight = face.weights.includes(weight);

    return (
        <Box sx={{ background: COLORS.white, border: `1px solid ${COLORS.rowBorder}`, borderRadius: "12px", padding: "11px 13px" }}>
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>
                    {face.family}
                </Typography>
                <Box
                    component="button"
                    className="info-type-lab__column-remove"
                    onClick={onRemove}
                    aria-label={`Remove ${face.family}`}
                    sx={{ cursor: "pointer", border: "none", background: "none", color: COLORS.textFaint, fontSize: SIZE.body, padding: "0 2px" }}
                >
                    ×
                </Box>
            </Box>
            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, lineHeight: 1.45, margin: "4px 0 8px" }}>
                {face.note}
            </Typography>

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                <Tag>{face.kind}</Tag>
                <Tag>{face.id === "instrument-sans" ? "already loaded" : "google fonts"}</Tag>
                <Tag tone={hasWeight ? undefined : COLORS.redTint}>
                    {hasWeight ? `weights: ${face.weights.length}` : `⚠ no ${weight} — clamped`}
                </Tag>
                {!ready && <Tag>loading…</Tag>}
            </Box>

            <Box
                component="button"
                className="info-type-lab__app-wide"
                onClick={onAppWide}
                aria-pressed={appWide}
                title="Set this as the app's overline face so you can view flp, the decks page and settings in it. Leaves the ~19 hand-rolled FONTS.mono overlines behind — see docs/INFO_TYPE_LAB.md."
                sx={{
                    cursor: "pointer",
                    width: "100%",
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
    );
};

/** A small mono data pill used by the column head. */
const Tag: React.FC<{ children: React.ReactNode; tone?: string }> = ({ children, tone }) => (
    <Typography
        component="span"
        className="info-type-lab__tag"
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

export default InfoTypeLab;
