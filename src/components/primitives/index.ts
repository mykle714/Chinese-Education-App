// Barrel for the shelf system's generic atoms (docs/SHELF_REDESIGN.md § A5).
//
// These are the pieces every screen needs and none owns: overlines, list rows, the
// single-figure card. The other two A5 families are NOT here on purpose —
//   * buttons / chips / inputs / segmented controls live in the MUI theme's
//     `components` overrides (src/contexts/ThemeContext.tsx), so 157 existing call
//     sites inherit the new skin without an import change;
//   * `.tip` is `src/components/TipBox.tsx`, which predates this pass; `.dots` became
//     the glyph meters in `src/components/ScoreMeters.tsx` (2026-11-07).
export { Label, SectionRule, SectionHeader } from "./Label";
export type { LabelProps, SectionRuleProps, SectionHeaderProps } from "./Label";
export { Row, RowList } from "./Row";
export type { RowProps, RowListProps } from "./Row";
export { default as SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";
export { default as StatCard } from "./StatCard";
export type { StatCardProps } from "./StatCard";
export { Segmented } from "./Segmented";
export type { SegmentedProps, SegmentedOption } from "./Segmented";
export { SettingsSection, OptionRow, SwitchRow } from "./SettingsSection";
export type { SettingsSectionProps, OptionRowProps, SwitchRowProps } from "./SettingsSection";
