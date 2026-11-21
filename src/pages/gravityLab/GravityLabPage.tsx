import React, { lazy, Suspense, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import GravityLabStage, { type GravityLabStageHandle } from "./GravityLabStage";
import { gravityTimings, type GravityTimingRow } from "./gravityTimings";
import {
    FALL_DEFAULTS,
    FALL_PARAM_RANGE,
    FALL_TYPES,
    clearGravityOverrides,
    fallParams,
    hasGravityOverride,
    setGravityOverride,
    useFallParams,
    useGravityVersion,
    type FallParam,
    type FallType,
} from "../../theme/gravity";
import { launchLook } from "../../features/deckTower/launch/launchLook";
import { COLORS } from "../../theme/colors";
import { DATA_TYPE, FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { TEXT } from "../../theme/typography";

// The launch screen is a full-screen cover; only loaded when replayed.
const LaunchScreen = lazy(() => import("../../features/deckTower/launch/LaunchScreen"));

/**
 * /gravity-lab — the dev lab for the iso world's fall physics (src/theme/gravity.ts), tuned PER
 * FALL TYPE: trap door, pawn sky fall, sky drop, collapse, launch screen. Each type has its own
 * gravity, start speed and jerk (`FallTypeCard` → three `KnobRow`s), its own replay button and
 * its own timing rows. The pawn sky fall's gravity is also the pawn's own (plate launch, poke,
 * bounces — gravity.ts → `pawnGravity`), so its card carries the pawn rows too.
 *
 * Overrides are temporary (memory + sessionStorage, this tab only) and app-wide for the tab, so
 * `/` also falls at the lab's values until they are reset or the tab is closed. The stage
 * (./GravityLabStage.tsx) is the REAL Deck Tower platform, swap and resizes on a fixed iPhone 16
 * frame; the timings (./gravityTimings.ts) come from the real planning code.
 *
 * The endpoint is to hardcode the winners: "Copy FALL_DEFAULTS" puts the whole table on the
 * clipboard for src/theme/gravity.ts.
 *
 * Layout: the stage on the left, sticky, and the fall-type cards on the right, so a fall can be
 * tuned and replayed without scrolling; on a narrow window they stack.
 *
 * Layer: page (dev lab). Not linked from any menu; reachable by typing the URL, like
 * /font-lab. Docs: docs/GRAVITY_LAB.md.
 */

/** Tower sizes the stage can be reset to (cards). */
const TOWER_SIZES = [30, 80, 150] as const;
/** Cards the Collapse button removes (owner, 2026-11-20), and the Sky drop button adds. */
const COLLAPSE_BY = 70;
const GROW_BY = 8;

/** Per-parameter slider specs: label, unit, `step` (slider granularity), `nudge` (± buttons). */
const PARAM_SPECS: Record<FallParam, { label: string; unit: string; step: number; nudge: number }> = {
    g: { label: "Gravity", unit: "u/s²", step: 1, nudge: 5 },
    v0: { label: "Start speed", unit: "u/s ↓", step: 1, nudge: 1 },
    j: { label: "Jerk", unit: "u/s³", step: 5, nudge: 25 },
};
const PARAM_ORDER: readonly FallParam[] = ["g", "v0", "j"];

/** Per-fall-type card copy. */
const TYPE_SPECS: Record<FallType, { title: string; note: string }> = {
    trapDoor: { title: "Trap door", note: "The tower falling through the open door on a deck swap." },
    skyFall: { title: "Pawn sky fall", note: "The new pawn dropping in on a swap, and the flp hint pawn. Its gravity is also the pawn's jumps and bounces." },
    skyDrop: { title: "Sky drop", note: "New cards falling onto the tower, and a swap's new tower landing." },
    collapse: { title: "Collapse", note: "Runs of cards settling after ghosted cards vanish." },
    launchScreen: { title: "Launch screen", note: "The pawn dropping onto the boot cover's platform." },
};

const fmtMs = (ms: number) => `${Math.round(ms)} ms`;

/** The lab's outlined button (app rule: every tappable carries `COLORS.border`). `active` = ink fill, the selected state. */
const LabButton: React.FC<{ children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; className?: string; compact?: boolean }> = ({
    children,
    onClick,
    disabled = false,
    active = false,
    className,
    compact = false,
}) => (
    <Box
        component="button"
        className={`gravity-lab__button${className ? ` ${className}` : ""}`}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active || undefined}
        sx={{
            cursor: disabled ? "default" : "pointer",
            border: `1px solid ${active ? COLORS.onSurface : COLORS.border}`,
            background: active ? COLORS.onSurface : COLORS.white,
            color: active ? COLORS.white : COLORS.onSurface,
            opacity: disabled ? 0.45 : 1,
            borderRadius: "10px",
            padding: compact ? "4px 8px" : "8px 12px",
            fontFamily: FONTS.sans,
            fontSize: SIZE.caption,
            fontWeight: WEIGHT.semibold,
            whiteSpace: "nowrap",
        }}
    >
        {children}
    </Box>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography className="gravity-lab__section-label" sx={{ ...TEXT.overline, color: COLORS.textFaint, marginBottom: "8px" }}>
        {children}
    </Typography>
);

/**
 * One parameter of one fall type: label, −/+ nudges, slider, value, reset. Setting the shipped
 * value clears the override (gravity.ts → `setGravityOverride`).
 */
const KnobRow: React.FC<{ type: FallType; param: FallParam; value: number }> = ({ type, param, value }) => {
    const spec = PARAM_SPECS[param];
    const { min, max } = FALL_PARAM_RANGE[param];
    const shipped = FALL_DEFAULTS[type][param];
    const set = (v: number) => setGravityOverride(type, param, Math.min(max, Math.max(min, Math.round(v / spec.step) * spec.step)));
    const changed = value !== shipped;
    return (
        <Box className={`gravity-lab__knob gravity-lab__knob--${param}`} sx={{ display: "grid", gridTemplateColumns: "84px auto 1fr auto 52px auto", alignItems: "center", gap: "6px" }}>
            <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold }}>
                {spec.label}
                <Box component="span" sx={{ ...DATA_TYPE, display: "block", fontSize: SIZE.micro, fontWeight: WEIGHT.regular, color: COLORS.textFaint }}>
                    {spec.unit}
                </Box>
            </Typography>
            <LabButton compact onClick={() => set(value - spec.nudge)} disabled={value <= min} className="gravity-lab__step">
                −{spec.nudge}
            </LabButton>
            <Box
                component="input"
                type="range"
                className="gravity-lab__slider"
                min={min}
                max={max}
                step={spec.step}
                value={value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value))}
                aria-label={`${TYPE_SPECS[type].title} ${spec.label}`}
                sx={{ minWidth: 0, width: "100%", cursor: "pointer", accentColor: COLORS.onSurface }}
            />
            <LabButton compact onClick={() => set(value + spec.nudge)} disabled={value >= max} className="gravity-lab__step">
                +{spec.nudge}
            </LabButton>
            <Typography
                className="gravity-lab__value"
                title={changed ? `shipped ${shipped}` : undefined}
                sx={{ ...DATA_TYPE, fontSize: SIZE.body, fontWeight: changed ? WEIGHT.bold : WEIGHT.regular, color: changed ? COLORS.onSurface : COLORS.textSecondary, textAlign: "right" }}
            >
                {value}
            </Typography>
            <LabButton compact onClick={() => setGravityOverride(type, param, null)} disabled={!changed} className="gravity-lab__reset">
                Reset
            </LabButton>
        </Box>
    );
};

/** A timing row: what falls, which case, and how long. */
const TimingRow: React.FC<{ row: GravityTimingRow }> = ({ row }) => (
    <Box className="gravity-lab__timing-row" sx={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "4px 0", borderTop: `1px solid ${COLORS.rowBorder}` }}>
        <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.semibold }}>{row.effect}</Typography>
        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, flex: 1, minWidth: 0 }}>{row.detail}</Typography>
        <Typography sx={{ ...DATA_TYPE, fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, whiteSpace: "nowrap" }}>{fmtMs(row.ms)}</Typography>
    </Box>
);

/** One fall type: its title and replay button, its three knobs, and its timing rows. */
const FallTypeCard: React.FC<{ type: FallType; rows: GravityTimingRow[]; action: React.ReactNode }> = ({ type, rows, action }) => {
    const params = useFallParams(type);
    const spec = TYPE_SPECS[type];
    return (
        <Box
            className={`gravity-lab__fall-card gravity-lab__fall-card--${type}`}
            sx={{ border: `1px solid ${COLORS.border}`, background: COLORS.white, borderRadius: "14px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}
        >
            <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Typography component="h2" sx={{ fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, flex: 1 }}>
                    {spec.title}
                </Typography>
                {action}
            </Box>
            <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, marginTop: "-4px" }}>{spec.note}</Typography>
            {PARAM_ORDER.map((param) => (
                <KnobRow key={param} type={type} param={param} value={params[param]} />
            ))}
            {rows.length > 0 && (
                <Box className="gravity-lab__fall-card-timings">
                    {rows.map((r, i) => (
                        <TimingRow key={i} row={r} />
                    ))}
                </Box>
            )}
        </Box>
    );
};

/** The FALL_DEFAULTS literal for src/theme/gravity.ts, from the values in force. */
function fallDefaultsSource(): string {
    const lines = FALL_TYPES.map((type) => {
        const p = fallParams(type);
        return `    ${type}: { g: ${p.g}, v0: ${p.v0}, j: ${p.j} },`;
    });
    return `export const FALL_DEFAULTS: Record<FallType, FallParams> = {\n${lines.join("\n")}\n};`;
}

const GravityLabPage: React.FC = () => {
    // Re-renders on any override change: the banner, the checks and the timing rows.
    useGravityVersion();
    const overridden = hasGravityOverride();
    const stageRef = useRef<GravityLabStageHandle>(null);
    const [stageBusy, setStageBusy] = useState(false);
    const [towerSize, setTowerSize] = useState<number>(80);
    const [launchKey, setLaunchKey] = useState<number | null>(null);
    const [copied, setCopied] = useState(false);

    const copyDefaults = () => {
        const source = fallDefaultsSource();
        navigator.clipboard?.writeText(source).then(
            () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
            },
            () => window.prompt("Copy this into src/theme/gravity.ts", source)
        );
    };

    const { rows, checks } = gravityTimings();
    // The pawn's throw rows ride on the sky fall's gravity, so they show in its card.
    const rowsFor = (type: FallType) => rows.filter((r) => r.type === type || (type === "skyFall" && r.type === "pawn"));

    const swapButton = (
        <LabButton onClick={() => stageRef.current?.swap()} disabled={stageBusy}>
            Swap deck
        </LabButton>
    );
    const actions: Record<FallType, React.ReactNode> = {
        trapDoor: swapButton,
        skyFall: swapButton,
        skyDrop: (
            <LabButton onClick={() => stageRef.current?.grow(GROW_BY)} disabled={stageBusy}>
                Sky drop +{GROW_BY}
            </LabButton>
        ),
        collapse: (
            <LabButton onClick={() => stageRef.current?.shrink(COLLAPSE_BY)} disabled={stageBusy}>
                Collapse −{COLLAPSE_BY}
            </LabButton>
        ),
        launchScreen: (
            <LabButton onClick={() => setLaunchKey(Date.now())} disabled={launchKey !== null}>
                Play
            </LabButton>
        ),
    };

    return (
        <Box
            className="gravity-lab"
            // Owns its own scroll container (the plain shell never scrolls).
            sx={{ height: "100dvh", overflowY: "auto", background: COLORS.background, color: COLORS.onSurface, fontFamily: FONTS.sans }}
        >
            <Box className="gravity-lab__column" sx={{ maxWidth: "1120px", marginInline: "auto", padding: "20px 16px 48px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* ── Header ───────────────────────────────────────────── */}
                <Box className="gravity-lab__header" sx={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
                    <Box sx={{ flex: 1, minWidth: "260px" }}>
                        <Typography sx={{ ...TEXT.overline, color: COLORS.textFaint }}>Dev lab</Typography>
                        <Typography component="h1" sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: 1.2, marginTop: "4px" }}>
                            Gravity
                        </Typography>
                        <Typography sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, marginTop: "6px" }}>
                            Each kind of fall has its own gravity, start speed and jerk. Tune them here, then hardcode the winners in{" "}
                            <Box component="code" sx={{ ...DATA_TYPE, fontSize: SIZE.caption }}>src/theme/gravity.ts</Box>.
                        </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: "8px" }}>
                        <LabButton onClick={clearGravityOverrides} disabled={!overridden}>
                            Reset all
                        </LabButton>
                        <LabButton onClick={copyDefaults}>{copied ? "Copied" : "Copy FALL_DEFAULTS"}</LabButton>
                    </Box>
                </Box>

                {overridden && (
                    <Box
                        className="gravity-lab__override-banner"
                        sx={{ border: `1px solid ${COLORS.border}`, background: COLORS.orgTint, borderRadius: "12px", padding: "10px 12px", fontSize: SIZE.caption }}
                    >
                        Overrides on for this tab: the Deck Tower at <code>/</code> falls with these values too, until you reset or close the tab.
                    </Box>
                )}

                <Box className="gravity-lab__workspace" sx={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
                    {/* ── The stage: the real tower on an iPhone 16 (sticky while the cards scroll) ── */}
                    <Box className="gravity-lab__stage-section" sx={{ position: "sticky", top: 0, flexShrink: 0, marginInline: "auto" }}>
                        <GravityLabStage key={towerSize} ref={stageRef} initialCards={towerSize} onBusyChange={setStageBusy} />
                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, marginTop: "8px", textAlign: "center" }}>
                            Press the plate to swap decks · tap the pawn to poke it
                        </Typography>
                        <Box sx={{ display: "flex", gap: "6px", marginTop: "8px", justifyContent: "center", alignItems: "center" }}>
                            <Typography sx={{ ...TEXT.overline, color: COLORS.textFaint, marginRight: "4px" }}>Tower</Typography>
                            {TOWER_SIZES.map((n) => (
                                <LabButton key={n} onClick={() => setTowerSize(n)} active={n === towerSize} disabled={stageBusy}>
                                    {n} cards
                                </LabButton>
                            ))}
                        </Box>
                    </Box>

                    {/* ── One card per fall type, then the timing rules ───── */}
                    <Box className="gravity-lab__controls" sx={{ flex: 1, minWidth: "320px", display: "flex", flexDirection: "column", gap: "12px" }}>
                        {FALL_TYPES.map((type) => (
                            <FallTypeCard key={type} type={type} rows={rowsFor(type)} action={actions[type]} />
                        ))}

                        <Box className="gravity-lab__checks">
                            <SectionLabel>Timing rules</SectionLabel>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {checks.map((c) => (
                                    <Box
                                        key={c.rule}
                                        className={`gravity-lab__check gravity-lab__check--${c.ok ? "ok" : "broken"}`}
                                        sx={{ border: `1px solid ${COLORS.border}`, background: c.ok ? COLORS.grnTint : COLORS.redTint, borderRadius: "12px", padding: "10px 12px" }}
                                    >
                                        <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold }}>
                                            {c.ok ? "✓" : "✗"} {c.rule}
                                        </Typography>
                                        <Typography sx={{ ...DATA_TYPE, fontSize: SIZE.caption, color: COLORS.textSecondary, marginTop: "2px" }}>{c.detail}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Box>

            {launchKey !== null && (
                <Suspense fallback={null}>
                    <LaunchScreen key={launchKey} look={launchLook()} ready onOpen={() => {}} onDone={() => setLaunchKey(null)} />
                </Suspense>
            )}
        </Box>
    );
};

export default GravityLabPage;
