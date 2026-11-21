import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, InputBase, Typography } from "@mui/material";
import NodePageHeader from "../../components/NodePageHeader";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useComfortableCaretScroll } from "../../hooks/useComfortableCaretScroll";
import { transitionForInset, useKeyboardInset } from "../beginnerKeyboard";
import { usePageSlide } from "../../hooks/usePageSlide";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE } from "../../theme/scale";
import { ApiError } from "../../api/http";
import {
    deleteStoryPassage,
    saveStoryPassage,
    updateStory,
} from "../../api/stories";
import {
    STORY_ENDING_TITLE_MAX_LENGTH,
    STORY_MAX_CHOICES,
    STORY_PASSAGE_NAME_MAX_LENGTH,
    STORY_PASSAGE_MAX_LENGTH,
    type StoryPassageEdit,
} from "../../../server/contracts/stories";
import { useStoryEdit } from "./useStoryEdit";
import { useAbcTypingIsNotActivity } from "./useAbcTypingIsNotActivity";
import StoryChoiceDraftRow from "./StoryChoiceDraftRow";
import StoryConfirmDialog from "./StoryConfirmDialog";
import {
    draftFromPassage,
    isDraftDirty,
    nextDraftKey,
    passageLabels,
    passageNumbers,
    passageSnippet,
    saveBodyFromDraft,
    type ChoiceDraft,
    type PassageDraft,
} from "./storyEditorModel";
import {
    cyoaChipSx,
    cyoaFieldSx,
    cyoaMessageSx,
    cyoaMutedTextSx,
    cyoaPillButtonSx,
    cyoaSectionHeadingSx,
} from "./cyoaStyles";
import { storyEditPath } from "./adventuresPaths";

/**
 * PassageEditorPage — `/adventures/:id/edit/:passageId`, one passage of a story
 * (docs/CYOA_FEATURE.md § 5). Author only (the server's 403 → "forbidden").
 *
 * Footerless node-style drill-in from the story editor, Tier 2 look, one scrolling column:
 *
 *   header   — back (SAVES first when there are changes, then → the story editor),
 *              the passage NAME as an always-editable field (blank → "Passage n"
 *              placeholder), Save pill (lit only while there are changes)
 *   role     — Start chip, or "Make this the start"
 *   text     — the passage body
 *   choices  — 0–4 StoryChoiceDraftRow + "Add choice"; no choices = an ending, so the
 *              Ending name field shows instead
 *   delete   — Delete passage (not for the start passage — the server refuses it too)
 *
 * ⚠️ ENGINE PENDING: the design's body editor is the Reader's box-less editable `TextArea`
 * with `useReaderContentEditor` undo/redo, which arrive with the engine move to
 * `src/reading/` (build step 2). Until then the body is a box-less multiline InputBase in
 * the reading face (`.passage-editor__text`) — same look, no undo stack.
 *
 * ── The name (header) ──────────────────────────────────────────────────────────
 * The header title is PageHeader's `editableTitle` field (the Reader's rename field,
 * docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Renaming), always on here: a passage is never
 * read on this page, only edited. The name is an author-only organizing label
 * (docs/CYOA_FEATURE.md § 6.2d, migration 197). It is part of the DRAFT like the body: it
 * lights the Save pill and goes in the same PUT (and the same 409 check). Blank = unnamed,
 * and the field's placeholder shows the "Passage n" the rest of the editor will call it.
 *
 * ── Saving ───────────────────────────────────────────────────────────────────
 * One PUT replaces the passage and its choices (new choice ids — learners mid-passage get
 * the stale-choice 400 and re-read, § 6.3). A choice can only target a passage that already
 * exists (or none); authors make passages from the story editor's **New passage** and link
 * them here. After the PUT the whole graph is re-read (new ids, live warnings) and the draft
 * re-seeded from it.
 *
 * ── Leaving with unsaved changes ───────────────────────────────────────────────
 * The header's back saves first and stays (with the notice) if that fails. The other ways
 * out are covered too: the edge-swipe back gesture is BLOCKED while there are changes
 * (useBlockEdgeSwipe), a browser/hardware back SAVES IN THE BACKGROUND on unmount (the same
 * persistDraft, fire-and-forget — the request outlives the page), and closing or reloading
 * the tab asks first (`beforeunload`). The router is a plain <BrowserRouter>, so React
 * Router's useBlocker is not available to intercept the back itself.
 *
 * ── Two tabs on one passage (optimistic concurrency) ──────────────────────────
 * The draft remembers the `updatedAt` it was seeded from (`base`) and every save sends it
 * as `expectedUpdatedAt`. If the passage was saved elsewhere since, the server answers 409
 * with "Save again to replace that version with yours"; the next save then omits the
 * version (`overwrite`) and wins. A re-read that brings a NEWER version from elsewhere does
 * not re-seed over unsaved typing — only this page's own save, or a different passage, does.
 *
 * ── Writing with a keyboard up ───────────────────────────────────────────────
 * The scrolling column ends at the keyboard's top edge: it reserves `useKeyboardInset()`
 * (the beginner keyboard ∪ the OS keyboard) as a bottom MARGIN riding the keyboard's own
 * slide curve — a margin on the column rather than padding on the surface, because the
 * surface's inline style already carries usePageSlide's transform transition. Inside it,
 * useComfortableCaretScroll keeps the line being written — in the body, a choice label or
 * the ending name — at a comfortable height above the keyboard, with clear space below it,
 * both while writing and when a tap places the caret (src/hooks/useComfortableCaretScroll.ts). The choices and the
 * delete button below the body are what it scrolls into when writing at the end.
 *
 * State: useStoryEdit (graph + notice). Local: the draft, the delete dialog.
 * Layer: feature page (src/features/cyoa). Route row: src/routes/routeMeta.ts.
 */

/**
 * Write a draft to the server: one PUT of the whole passage. `expectedUpdatedAt` null =
 * overwrite (after a 409). Used by the Save pill, the header back and the background save
 * on unmount.
 */
function persistDraft(
    storyId: string,
    passageId: string,
    draft: PassageDraft,
    expectedUpdatedAt: string | null
): Promise<StoryPassageEdit> {
    const body = saveBodyFromDraft(draft);
    return saveStoryPassage(storyId, passageId, expectedUpdatedAt ? { ...body, expectedUpdatedAt } : body);
}

function PassageEditorPage() {
    const { id: storyId, passageId } = useParams<{ id: string; passageId: string }>();
    const navigate = useNavigate();
    const look = useTier2Look();
    const { surfaceRef, style, exit } = usePageSlide({ axis: "x" });
    const { status, edit, busy, notice, setNotice, setEdit, reload, run } = useStoryEdit(storyId);
    // Typing on the abc keyboard here is English, not study (§ 8).
    useAbcTypingIsNotActivity();

    const passage = edit?.passages.find((p) => p.id === passageId) ?? null;
    const numbers = useMemo(() => passageNumbers(edit?.passages ?? []), [edit]);
    const number = passageId ? numbers.get(passageId) : undefined;
    const numberedLabel = number ? `Passage ${number}` : "Passage";
    // What the rest of the editor calls the other passages (name, or "Passage n").
    const labels = useMemo(() => passageLabels(edit?.passages ?? []), [edit]);
    usePageTitle(passage?.name || (number ? `Passage ${number}` : "Edit passage"));

    const [draft, setDraft] = useState<PassageDraft | null>(null);
    // The saved version the draft was seeded from — sent as `expectedUpdatedAt` (see header).
    const [base, setBase] = useState<{ id: string; updatedAt: string } | null>(null);
    // After a 409: the next save replaces the other version instead of being refused again.
    const [overwrite, setOverwrite] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    // Set just before this page's own post-save re-read, so that re-read re-seeds the draft.
    const reseedNext = useRef(false);

    // Seed the draft: on load, for a different passage, and after this page's own save.
    // NOT on every graph change — a Make-start re-read keeps unsaved typing, and a newer
    // version saved in another tab must not wipe it (the 409 handles that).
    const passageVersion = passage ? `${passage.id}@${passage.updatedAt}` : null;
    useEffect(() => {
        if (!passage) return;
        if (draft && base?.id === passage.id && !reseedNext.current) return;
        reseedNext.current = false;
        setDraft(draftFromPassage(passage));
        setBase({ id: passage.id, updatedAt: passage.updatedAt });
        setOverwrite(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the version on purpose (see above)
    }, [passageVersion]);

    const dirty = !!(draft && passage && isDraftDirty(draft, passage));

    // ── Writing with a keyboard up (see header) ──
    const keyboardInset = useKeyboardInset();
    const bodyScrollRef = useRef<HTMLDivElement | null>(null);
    // Every text field in the column (body, choice labels, ending name) — whichever has
    // focus. `value` joins them all, so writing in any one counts as "just wrote".
    useComfortableCaretScroll({
        scrollerRef: bodyScrollRef,
        value: draft ? [draft.content, draft.endingTitle, ...draft.choices.map((choice) => choice.label)].join("\u0000") : "",
        enabled: status === "ready",
    });

    // ── Unsaved changes on the other ways out (see header) ──
    useBlockEdgeSwipe(dirty);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    // The latest draft for the unmount save (a cleanup closure would hold the first render's).
    const latest = useRef({ dirty, draft, base, overwrite });
    latest.current = { dirty, draft, base, overwrite };
    // Set when leaving on purpose without saving (a deleted passage).
    const discardOnLeave = useRef(false);
    useEffect(() => {
        return () => {
            const { dirty: wasDirty, draft: last, base: lastBase, overwrite: force } = latest.current;
            if (!wasDirty || !last || !storyId || !passageId || discardOnLeave.current) return;
            persistDraft(storyId, passageId, last, force ? null : lastBase?.updatedAt ?? null)
                .catch((err) => console.error("PassageEditorPage: background save on leave failed", err));
        };
    }, [storyId, passageId]);

    const passageOptions = useMemo(
        () => (edit?.passages ?? []).map((p) => {
            const snippet = passageSnippet(p.content, 18);
            return { id: p.id, label: `${labels.get(p.id)}${snippet ? ` · ${snippet}` : ""}` };
        }),
        [edit, labels]
    );

    if (!storyId || !passageId) return null;

    const isStart = edit?.story.startPassageId === passageId;
    const toEditor = () => navigate(storyEditPath(storyId));

    /** Save the draft. Resolves true when saved (or nothing to save). */
    const save = async (): Promise<boolean> => {
        if (!draft || !passage) return false;
        if (!isDraftDirty(draft, passage)) return true;

        const saved = await run(async () => {
            try {
                return await persistDraft(storyId, passageId, draft, overwrite ? null : base?.updatedAt ?? null);
            } catch (err) {
                // Saved elsewhere since this draft was seeded: the notice (the server's own
                // line) says "Save again", and the next save omits the version.
                if (err instanceof ApiError && err.status === 409) setOverwrite(true);
                throw err;
            }
        });
        if (!saved) return false;
        reseedNext.current = true;
        await reload();
        return true;
    };

    const handleBack = async () => {
        if (dirty && !(await save())) return; // stay, with the notice, rather than lose the edit
        exit(toEditor);
    };

    const updateChoice = (index: number, next: ChoiceDraft) =>
        setDraft((current) => current && { ...current, choices: current.choices.map((c, i) => (i === index ? next : c)) });
    const removeChoice = (index: number) =>
        setDraft((current) => current && { ...current, choices: current.choices.filter((_, i) => i !== index) });
    const addChoice = () =>
        setDraft((current) => current && current.choices.length < STORY_MAX_CHOICES
            ? { ...current, choices: [...current.choices, { key: nextDraftKey(), label: "", target: null }] }
            : current);

    const handleMakeStart = () => void run(() => updateStory(storyId, { startPassageId: passageId }), setEdit);

    const handleDelete = async () => {
        const done = await run(() => deleteStoryPassage(storyId, passageId));
        setConfirmDelete(false);
        if (done) {
            discardOnLeave.current = true; // the passage is gone: nothing to save on the way out
            navigate(storyEditPath(storyId), { replace: true });
        }
    };

    return (
        <Box
            ref={surfaceRef}
            className="passage-editor-surface"
            style={{ ...style, backgroundColor: look.ground }}
            sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
            <NodePageHeader
                title={passage?.name || numberedLabel}
                onBack={() => void handleBack()}
                titleColor={look.ink}
                editableTitle={draft ? {
                    value: draft.name,
                    onChange: (name) => setDraft({ ...draft, name }),
                    placeholder: numberedLabel,
                    maxLength: STORY_PASSAGE_NAME_MAX_LENGTH,
                    ariaLabel: "Passage name",
                    lineColor: look.outline,
                    placeholderColor: look.muted,
                } : undefined}
                rightContent={
                    draft ? (
                        <Button
                            className="passage-editor__save"
                            onClick={() => { setNotice(null); void save(); }}
                            disabled={!dirty || busy}
                            sx={cyoaPillButtonSx(look, COLORS.bluM)}
                        >
                            {busy ? "Saving…" : "Save"}
                        </Button>
                    ) : undefined
                }
            />

            <Box
                ref={bodyScrollRef}
                className="passage-editor-body"
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    touchAction: "pan-y",
                    px: 2,
                    pb: 4,
                    // End the column at the keyboard's top edge (see header).
                    marginBottom: `${keyboardInset}px`,
                    transition: transitionForInset(keyboardInset, "margin-bottom"),
                }}
            >
                {status === "loading" && <Typography className="passage-editor-loading" sx={cyoaMutedTextSx(look)}>Loading…</Typography>}
                {status === "forbidden" && <Typography className="passage-editor-forbidden" sx={cyoaMutedTextSx(look)}>Only this story's author can edit it.</Typography>}
                {(status === "unavailable" || (status === "ready" && !passage)) && (
                    <Typography className="passage-editor-unavailable" sx={cyoaMutedTextSx(look)}>This passage no longer exists.</Typography>
                )}
                {status === "error" && <Typography className="passage-editor-error" sx={cyoaMutedTextSx(look)}>Couldn't load this story. Please try again later.</Typography>}

                {status === "ready" && passage && draft && (
                    <Box className="passage-editor-content" sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1 }}>
                        {notice && <Typography className="passage-editor-notice" sx={{ ...cyoaMessageSx(look), textAlign: "center" }}>{notice}</Typography>}

                        <Box className="passage-editor-role" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            {isStart ? (
                                <Box component="span" className="passage-editor-role__start" sx={cyoaChipSx(look, COLORS.bluM)}>Start passage</Box>
                            ) : (
                                <Button className="passage-editor-role__make-start" onClick={handleMakeStart} disabled={busy} sx={cyoaPillButtonSx(look)}>
                                    Make this the start
                                </Button>
                            )}
                        </Box>

                        {/* The body. PLACEHOLDER for the shared box-less TextArea (see header). */}
                        <InputBase
                            className="passage-editor__text"
                            multiline
                            minRows={6}
                            value={draft.content}
                            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                            placeholder="Write the passage…"
                            inputProps={{ maxLength: STORY_PASSAGE_MAX_LENGTH, "aria-label": "Passage text" }}
                            sx={{
                                width: "100%",
                                alignItems: "flex-start",
                                fontFamily: FONTS.cjk,
                                fontSize: SIZE.subtitle,
                                lineHeight: LEADING.relaxed,
                                color: look.ink,
                                "& textarea::placeholder": { color: look.muted, opacity: 1 },
                            }}
                        />

                        <Box className="passage-editor-choices" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <Typography className="passage-editor-choices__heading" sx={cyoaSectionHeadingSx(look)}>
                                Choices · {draft.choices.length}/{STORY_MAX_CHOICES}
                            </Typography>
                            {draft.choices.map((choice, index) => (
                                <StoryChoiceDraftRow
                                    key={choice.key}
                                    look={look}
                                    index={index}
                                    choice={choice}
                                    passageOptions={passageOptions}
                                    onChange={(next) => updateChoice(index, next)}
                                    onRemove={() => removeChoice(index)}
                                />
                            ))}
                            {draft.choices.length < STORY_MAX_CHOICES && (
                                <Box>
                                    <Button className="passage-editor-choices__add" onClick={addChoice} sx={cyoaPillButtonSx(look)}>
                                        Add choice
                                    </Button>
                                </Box>
                            )}
                        </Box>

                        {/* No choices = an ending (§ 6.2): its name is what the end screen shows. */}
                        {draft.choices.length === 0 && (
                            <Box className="passage-editor-ending" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                                <Typography className="passage-editor-ending__heading" sx={cyoaSectionHeadingSx(look)}>Ending name</Typography>
                                <InputBase
                                    className="passage-editor-ending__field"
                                    value={draft.endingTitle}
                                    onChange={(event) => setDraft({ ...draft, endingTitle: event.target.value })}
                                    placeholder="The End"
                                    inputProps={{ maxLength: STORY_ENDING_TITLE_MAX_LENGTH, "aria-label": "Ending name" }}
                                    sx={cyoaFieldSx(look)}
                                />
                                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: look.muted }}>
                                    A passage with no choices is an ending. Learners see this name on the end screen.
                                </Typography>
                            </Box>
                        )}

                        {!isStart && (
                            <Box className="passage-editor-danger" sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                                <Button className="passage-editor-danger__delete" onClick={() => setConfirmDelete(true)} disabled={busy} sx={cyoaPillButtonSx(look)}>
                                    Delete passage
                                </Button>
                            </Box>
                        )}
                    </Box>
                )}
            </Box>

            <StoryConfirmDialog
                look={look}
                open={confirmDelete}
                title="Delete passage?"
                message="Choices that lead here will lead nowhere until you pick a new target. Learners on this passage start the story over. This can't be undone."
                confirmLabel={busy ? "Deleting…" : "Delete"}
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={handleDelete}
            />
        </Box>
    );
}

export default PassageEditorPage;
