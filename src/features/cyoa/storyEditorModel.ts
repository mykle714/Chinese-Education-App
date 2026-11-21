import type {
    StoryPassageEdit,
    StoryPassageSaveBody,
    StoryPublishWarning,
} from "../../../server/contracts/stories";

/**
 * storyEditorModel.ts — the pure rules behind the Adventures editor (docs/CYOA_FEATURE.md
 * § 5): passage numbering and labels, the publish warnings as sentences,
 * and the passage editor's choice drafts. No React, no I/O — unit-tested in
 * src/features/cyoa/__tests__/storyEditorModel.test.ts.
 *
 * ── Passage labels ────────────────────────────────────────────────────────────
 * A passage is called by its author-written NAME (migration 197, edited in the passage
 * editor's header — § 6.2d) when it has one, and otherwise "Passage n" by LIST ORDER — the
 * author-set order GET /edit returns (`story_passages.position`, migration 199; dragged in
 * the story editor, § 5.3). The number follows the row (owner's call 2026-11-21): moving
 * or deleting a passage renumbers the unnamed ones it passes.
 * `passageLabels` is the one map every editor surface reads — the passage rows, the
 * choice target picker and the publish warnings — so a passage
 * is never called two different things on one screen. Names are author-only.
 *
 * Layer: feature model (src/features/cyoa). Depended on by: StoryEditorPage.tsx,
 * StoryPassageList.tsx, PassageEditorPage.tsx, StoryChoiceDraftRow.tsx.
 */

/** Longest opening-words snippet shown for a passage, in characters. */
export const PASSAGE_SNIPPET_CHARS = 28;

/** passageId → its 1-based number (list order — the author-set order, migration 199). */
export function passageNumbers(passages: Array<Pick<StoryPassageEdit, "id">>): Map<string, number> {
    return new Map(passages.map((passage, index) => [passage.id, index + 1]));
}

/**
 * A passage's opening words: whitespace collapsed, cut at `max` characters (by code
 * point, so a CJK passage is never split mid-surrogate) with an ellipsis. Null when empty.
 */
export function passageSnippet(content: string, max: number = PASSAGE_SNIPPET_CHARS): string | null {
    const flat = content.replace(/\s+/g, " ").trim();
    if (!flat) return null;
    const chars = [...flat];
    return chars.length <= max ? flat : `${chars.slice(0, max).join("").trimEnd()}…`;
}

/**
 * passageId → what the editor calls it: the passage's name, or "Passage n" when unnamed.
 * See "Passage labels" above.
 */
export function passageLabels(passages: Array<Pick<StoryPassageEdit, "id" | "name">>): Map<string, string> {
    const numbers = passageNumbers(passages);
    return new Map(passages.map((passage) => [passage.id, passage.name || `Passage ${numbers.get(passage.id)}`]));
}

/** The passage's label (`passageLabels`), or "A deleted passage" for an id no longer in the story. */
export function passageLabel(passageId: string, labels: Map<string, string>): string {
    return labels.get(passageId) ?? "A deleted passage";
}

/** One publish warning (server/contracts/stories.ts → storyPublishWarnings) as a sentence. */
export function warningText(warning: StoryPublishWarning, labels: Map<string, string>): string {
    switch (warning.kind) {
        case "noStartPassage":
            return "No passage is set as the start.";
        case "noEnding":
            return "The story has no ending yet (a passage with no choices).";
        case "choiceWithoutTarget":
            return `${passageLabel(warning.passageId, labels)}: choice ${warning.position} doesn't lead anywhere yet — learners see it as "Coming soon".`;
        case "unreachablePassage":
            return `${passageLabel(warning.passageId, labels)} can't be reached from the start.`;
        case "unnamedEnding":
            return `${passageLabel(warning.passageId, labels)} is an ending with no name — learners see "The End".`;
    }
}

// ── Passage editor: choice drafts ────────────────────────────────────────────

/**
 * One choice row being edited. `key` is a client-only React key (server choice ids are
 * replaced on every save, so they cannot key the rows). `target` is a passage id, null
 * ("not written yet"). Authors create passages in the story editor and link them here.
 */
export interface ChoiceDraft {
    key: string;
    label: string;
    target: string | null;
}

let draftKeySeq = 0;
/** A fresh client-only row key. */
export function nextDraftKey(): string {
    draftKeySeq += 1;
    return `choice-draft-${draftKeySeq}`;
}

/** The passage editor's whole draft. */
export interface PassageDraft {
    /** The header's name field; "" = unnamed ("Passage n"). */
    name: string;
    content: string;
    endingTitle: string;
    choices: ChoiceDraft[];
}

/** Seed a draft from the saved passage. */
export function draftFromPassage(passage: StoryPassageEdit): PassageDraft {
    return {
        name: passage.name ?? "",
        content: passage.content,
        endingTitle: passage.endingTitle ?? "",
        choices: [...passage.choices]
            .sort((a, b) => a.position - b.position)
            .map((choice) => ({ key: nextDraftKey(), label: choice.label, target: choice.targetPassageId })),
    };
}

/**
 * A name as the server will store it (StoryService.normalizePassageName): whitespace runs
 * collapsed to one space, trimmed. So "Lost " vs "Lost" is not an unsaved change.
 */
function flattenName(name: string): string {
    return name.replace(/\s+/g, " ").trim();
}

/**
 * True when the draft differs from the saved passage in anything Save would send. The
 * ending name only counts while the passage has no choices (it is dropped otherwise —
 * see saveBodyFromDraft).
 */
export function isDraftDirty(draft: PassageDraft, passage: StoryPassageEdit): boolean {
    const saved = draftFromPassage(passage);
    if (draft.content !== saved.content) return true;
    if (flattenName(draft.name) !== flattenName(saved.name)) return true;
    if (draft.choices.length !== saved.choices.length) return true;
    if (draft.choices.length === 0 && draft.endingTitle.trim() !== saved.endingTitle.trim()) return true;
    return draft.choices.some(
        (choice, index) => choice.label !== saved.choices[index].label || choice.target !== saved.choices[index].target
    );
}

/**
 * The PUT body. Positions are the rows' order (1–4). An ending name is sent only for a
 * passage with no choices (a passage with choices is not an ending, so a stale name would
 * only resurface later).
 */
export function saveBodyFromDraft(draft: PassageDraft): StoryPassageSaveBody {
    const endingTitle = draft.endingTitle.trim();
    return {
        // Always sent: the PUT replaces the whole passage, so an omitted name would clear it.
        name: flattenName(draft.name) || null,
        content: draft.content,
        endingTitle: draft.choices.length === 0 && endingTitle ? endingTitle : null,
        choices: draft.choices.map((choice, index) => ({
            position: index + 1,
            label: choice.label,
            targetPassageId: choice.target,
        })),
    };
}
