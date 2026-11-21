import { Box, InputBase, Typography } from "@mui/material";
import { HeaderIconButton } from "../../components/PageHeader";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { STORY_CHOICE_LABEL_MAX_LENGTH } from "../../../server/contracts/stories";
import type { ChoiceDraft } from "./storyEditorModel";
import { cyoaFieldSx, cyoaFlatCardSx } from "./cyoaStyles";

/**
 * StoryChoiceDraftRow — one choice in the passage editor (docs/CYOA_FEATURE.md § 5: "up to
 * four choice rows — each a label field and a target-passage picker").
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Choice 2                               ✕ │
 *   │ 走进森林____________________________________ │
 *   │ Leads to  [ Passage 4 · 你走进森林… ▾ ]    │
 *   └──────────────────────────────────────────┘
 *
 * The label is story text (CJK face; no English by design but not enforced, § 6.2c). It
 * WRAPS AND GROWS (an auto-sizing multiline field) so the author can read the whole label
 * as it will wrap on the learner's full-width choice button — but it stays ONE logical
 * line: Enter inserts nothing, and a pasted line break becomes a space (`toOneLine`). The
 * server flattens whitespace anyway (StoryService → flattenLabel); doing it here keeps the
 * draft equal to what will be saved, so a stray newline never shows as an unsaved change. The
 * picker is a NATIVE <select> — the OS picker is the right control for a long list on a
 * phone — with three kinds of option: "Not written yet" (no target: learners see the
 * choice disabled, "Coming soon") and every passage of the story, the one being edited
 * included (a free graph allows loops). There is no "create a passage" option: authors
 * make passages with the story editor's **New passage** and link them here.
 *
 * Layer: feature presentation (src/features/cyoa). Rendered by PassageEditorPage.
 */

/** A label as one logical line: every line break (CRLF included) becomes a space. */
const toOneLine = (value: string) => value.replace(/\r?\n/g, " ");

/** The picker's value for "no target" (a <select> value cannot be null). */
const NO_TARGET = "";

interface StoryChoiceDraftRowProps {
    look: Tier2Look;
    index: number;
    choice: ChoiceDraft;
    /** Every passage as a picker option, in story order. */
    passageOptions: Array<{ id: string; label: string }>;
    onChange: (next: ChoiceDraft) => void;
    onRemove: () => void;
}

function StoryChoiceDraftRow({ look, index, choice, passageOptions, onChange, onRemove }: StoryChoiceDraftRowProps) {
    return (
        <Box className="story-choice-draft" sx={{ ...cyoaFlatCardSx(look), p: "10px 8px 12px 14px", display: "flex", flexDirection: "column", gap: 1 }}>
            <Box className="story-choice-draft__head" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography className="story-choice-draft__number" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: look.ink, lineHeight: LEADING.tight }}>
                    Choice {index + 1}
                </Typography>
                <HeaderIconButton className="story-choice-draft__remove" icon="close" label={`Remove choice ${index + 1}`} color={look.ink2} onClick={onRemove} />
            </Box>
            <Box sx={{ pr: 0.75 }}>
                <InputBase
                    className="story-choice-draft__label"
                    multiline
                    minRows={1}
                    value={choice.label}
                    onChange={(event) => onChange({ ...choice, label: toOneLine(event.target.value) })}
                    // Wrap, don't break: Enter would add a line break the label cannot keep.
                    onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                    placeholder="What the learner chooses"
                    inputProps={{ maxLength: STORY_CHOICE_LABEL_MAX_LENGTH, "aria-label": `Choice ${index + 1} text`, enterKeyHint: "done" }}
                    // Wrapped lines need real leading; a single-line field never showed it.
                    sx={{ ...cyoaFieldSx(look, { cjk: true }), lineHeight: LEADING.normal }}
                />
            </Box>
            <Box className="story-choice-draft__target" sx={{ display: "flex", alignItems: "center", gap: 1, pr: 0.75 }}>
                <Typography component="label" htmlFor={`${choice.key}-target`} sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted, flexShrink: 0 }}>
                    Leads to
                </Typography>
                <Box
                    component="select"
                    id={`${choice.key}-target`}
                    className="story-choice-draft__target-select"
                    value={choice.target ?? NO_TARGET}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        onChange({ ...choice, target: event.target.value === NO_TARGET ? null : event.target.value })
                    }
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        height: 32,
                        px: 1,
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        color: look.ink,
                        backgroundColor: look.surface,
                        border: `1px solid ${look.outline}`,
                        borderRadius: "10px",
                        textOverflow: "ellipsis",
                    }}
                >
                    <option value={NO_TARGET}>Not written yet</option>
                    {passageOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </Box>
            </Box>
        </Box>
    );
}

export default StoryChoiceDraftRow;
