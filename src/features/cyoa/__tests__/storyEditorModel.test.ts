import { describe, expect, it } from "vitest";
import type { StoryPassageEdit } from "../../../../server/contracts/stories";
import {
    draftFromPassage,
    isDraftDirty,
    passageLabels,
    passageNumbers,
    passageSnippet,
    saveBodyFromDraft,
    warningText,
} from "../storyEditorModel";

/** Tests for the Adventures editor's pure rules (src/features/cyoa/storyEditorModel.ts). */

const passage = (id: string, choices: Array<[number, string, string | null]> = [], extra: Partial<StoryPassageEdit> = {}): StoryPassageEdit => ({
    id,
    name: null,
    content: "",
    endingTitle: null,
    updatedAt: "2026-11-20T00:00:00Z",
    choices: choices.map(([position, label, targetPassageId]) => ({ id: `${id}-c${position}`, position, label, targetPassageId })),
    ...extra,
});

describe("passageSnippet", () => {
    it("collapses whitespace, cuts by code point and marks the cut", () => {
        expect(passageSnippet("  我 \n 去 ")).toBe("我 去");
        expect(passageSnippet("一二三四五", 3)).toBe("一二三…");
        expect(passageSnippet("   ")).toBeNull();
    });
});

describe("passageNumbers", () => {
    it("numbers passages by list order", () => {
        expect(passageNumbers([passage("a"), passage("b"), passage("c")]).get("c")).toBe(3);
    });
});

describe("passageLabels", () => {
    it("uses the name when set and falls back to the list-order number", () => {
        const labels = passageLabels([passage("a"), passage("b", [], { name: "The forest" }), passage("c", [], { name: "" })]);
        expect([labels.get("a"), labels.get("b"), labels.get("c")]).toEqual(["Passage 1", "The forest", "Passage 3"]);
    });
});

describe("warningText", () => {
    it("names passages by label and survives a missing one", () => {
        const labels = passageLabels([passage("a"), passage("b", [], { name: "The forest" })]);
        expect(warningText({ kind: "unreachablePassage", passageId: "b" }, labels)).toBe("The forest can't be reached from the start.");
        expect(warningText({ kind: "noStartPassage" }, labels)).toBe("No passage is set as the start.");
        expect(warningText({ kind: "unnamedEnding", passageId: "gone" }, labels)).toMatch(/^A deleted passage/);
    });
});

describe("choice drafts", () => {
    it("round-trips a saved passage without being dirty", () => {
        const saved = passage("a", [[2, "second", null], [1, "first", "b"]], { content: "你好" });
        const draft = draftFromPassage(saved);
        expect(draft.choices.map((c) => c.label)).toEqual(["first", "second"]);
        expect(isDraftDirty(draft, saved)).toBe(false);
        expect(isDraftDirty({ ...draft, content: "你好!" }, saved)).toBe(true);
    });

    it("ignores the ending name while the passage has choices", () => {
        const saved = passage("a", [[1, "go", null]]);
        const draft = { ...draftFromPassage(saved), endingTitle: "Lost" };
        expect(isDraftDirty(draft, saved)).toBe(false);
        expect(saveBodyFromDraft(draft).endingTitle).toBeNull();
    });

    it("numbers positions by row order and passes targets through", () => {
        const draft = {
            name: "",
            content: "x",
            endingTitle: "",
            choices: [
                { key: "k1", label: "a", target: "p9" },
                { key: "k2", label: "b", target: "p2" },
                { key: "k3", label: "c", target: null },
            ],
        };
        expect(saveBodyFromDraft(draft).choices).toEqual([
            { position: 1, label: "a", targetPassageId: "p9" },
            { position: 2, label: "b", targetPassageId: "p2" },
            { position: 3, label: "c", targetPassageId: null },
        ]);
    });

    it("sends a trimmed ending name for a passage with no choices", () => {
        expect(saveBodyFromDraft({ name: "", content: "", endingTitle: "  Lost  ", choices: [] }).endingTitle).toBe("Lost");
        expect(saveBodyFromDraft({ name: "", content: "", endingTitle: "  ", choices: [] }).endingTitle).toBeNull();
    });

    it("treats the name as part of the draft: flattened for dirtiness, blank sent as null", () => {
        const saved = passage("a", [], { name: "The forest" });
        const draft = draftFromPassage(saved);
        expect(draft.name).toBe("The forest");
        expect(isDraftDirty({ ...draft, name: "  The   forest " }, saved)).toBe(false);
        expect(isDraftDirty({ ...draft, name: "The woods" }, saved)).toBe(true);
        expect(saveBodyFromDraft({ ...draft, name: "  The \n woods " }).name).toBe("The woods");
        expect(saveBodyFromDraft({ ...draft, name: "   " }).name).toBeNull();
    });
});
