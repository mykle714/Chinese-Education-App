import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, InputBase, Typography } from "@mui/material";
import NodePageHeader from "../../components/NodePageHeader";
import { HeaderIconButton } from "../../components/PageHeader";
import Icon from "../../components/Icon";
import IconPickerDialog from "../../components/IconPickerDialog";
import { usePageSlide } from "../../hooks/usePageSlide";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import {
    createStoryPassage,
    deleteStory,
    publishStory,
    reorderStoryPassages,
    duplicateStoryPassage,
    unpublishStory,
    updateStory,
} from "../../api/stories";
import { STORY_TITLE_MAX_LENGTH } from "../../../server/contracts/stories";
import { useStoryEdit } from "./useStoryEdit";
import { useAbcTypingIsNotActivity } from "./useAbcTypingIsNotActivity";
import StoryPassageList from "./StoryPassageList";
import StoryConfirmDialog from "./StoryConfirmDialog";
import {
    passageLabels,
    warningText,
} from "./storyEditorModel";
import {
    cyoaFieldSx,
    cyoaFlatCardSx,
    cyoaMessageSx,
    cyoaMutedTextSx,
    cyoaPillButtonSx,
    cyoaSectionHeadingSx,
} from "./cyoaStyles";
import { ADVENTURES_LIST_PATH, passageEditPath, storyEditPath, storyPlayPath } from "./adventuresPaths";

/**
 * StoryEditorPage — `/adventures/:id/edit`, the author's story editor
 * (docs/CYOA_FEATURE.md § 5). Author accounts only; the server refuses everyone else (403
 * → "forbidden" below) and refuses another author's story the same way.
 *
 * A footerless node-style drill-in (NodePageHeader + usePageSlide), Tier 2 look, one
 * scrolling column:
 *
 *   header   — back (→ /adventures), "Edit story", Preview (▶ → /adventures/:id, whose
 *              Back returns here via `state.from`)
 *   story    — icon tile (IconPickerDialog), title field (saved on blur / Enter), status
 *              ("Draft — only you can see it" / "Published · HSK n"), Publish / Unpublish
 *   warnings — the live publish checks as sentences. Publish WARNS, never blocks (§ 6.3)
 *   passages — "New passage" + StoryPassageList: one row per passage (author order —
 *              drag the ⠿ handle, § 5.3) with the link gutter on its right (§ 5.2)
 *   delete   — Delete story, behind StoryConfirmDialog
 *
 * Edits to a published story go live at once (owner's call 2026-11-20) — said under the
 * status so the author knows. Preview is ordinary play: it saves progress and records
 * endings like anyone's (§ 5).
 *
 * State: useStoryEdit (the graph + notice). Local: the title draft, the open dialog.
 * Layer: feature page (src/features/cyoa). Route row: src/routes/routeMeta.ts.
 */

/** The story icon tile, px (the list card's tile size). */
const ICON_TILE_PX = 64;

function StoryEditorPage() {
    const { id: storyId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const look = useTier2Look();
    const { surfaceRef, style, exit } = usePageSlide({ axis: "x" });
    const { status, edit, busy, notice, setEdit, reload, run } = useStoryEdit(storyId);
    usePageTitle(edit ? `Edit · ${edit.story.title}` : "Edit story");
    // Typing on the abc keyboard here is English, not study (§ 8).
    useAbcTypingIsNotActivity();

    const [titleDraft, setTitleDraft] = useState("");
    const [iconPickerOpen, setIconPickerOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Re-seed the title field whenever the saved title changes (load, or a save's echo).
    const savedTitle = edit?.story.title ?? "";
    useEffect(() => { setTitleDraft(savedTitle); }, [savedTitle]);

    const labels = useMemo(() => passageLabels(edit?.passages ?? []), [edit]);

    // The column that scrolls the passage list (the drag auto-scrolls it near its edges).
    const bodyRef = useRef<HTMLDivElement | null>(null);

    const handleBack = () => exit(() => navigate(ADVENTURES_LIST_PATH));

    if (!storyId) return null;

    const saveTitle = () => {
        const next = titleDraft.replace(/\s+/g, " ").trim();
        if (!next) {
            setTitleDraft(savedTitle); // a story always has a title: put the old one back
            return;
        }
        if (next === savedTitle) return;
        void run(() => updateStory(storyId, { title: next }), setEdit);
    };

    const handlePublishToggle = async () => {
        if (!edit) return;
        const done = edit.story.publishedAt
            ? await run(() => unpublishStory(storyId))
            : await run(() => publishStory(storyId));
        if (done) await reload(); // both answer with less than the whole graph
    };

    const handleNewPassage = async () => {
        const created = await run(() => createStoryPassage(storyId));
        if (created) slideNavigate(passageEditPath(storyId, created.value.id));
    };

    /**
     * A drag dropped passages into a new order (§ 5.3): show it at once, then save. The
     * save answers with the whole graph; a failure (e.g. another tab added a passage, so
     * the list was stale) shows the server's message and re-reads the truth.
     */
    const handleReorder = async (passageIds: string[]) => {
        if (!edit) return;
        const byId = new Map(edit.passages.map((passage) => [passage.id, passage]));
        const reordered = passageIds.map((id) => byId.get(id)).filter((passage): passage is NonNullable<typeof passage> => !!passage);
        setEdit({ ...edit, passages: reordered });
        const saved = await run(() => reorderStoryPassages(storyId, passageIds), setEdit);
        if (!saved) await reload();
    };

    /** A row's copy button (§ 5.4): the answer is the whole graph, the copy right below. */
    const handleDuplicate = (passageId: string) => void run(() => duplicateStoryPassage(storyId, passageId), setEdit);

    const handleDelete = async () => {
        const done = await run(() => deleteStory(storyId));
        setConfirmDelete(false);
        if (done) navigate(ADVENTURES_LIST_PATH, { replace: true });
    };

    const story = edit?.story;
    const published = !!story?.publishedAt;

    return (
        <Box
            ref={surfaceRef}
            className="story-editor-surface"
            style={{ ...style, backgroundColor: look.ground }}
            sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
            <NodePageHeader
                title="Edit story"
                onBack={handleBack}
                titleColor={look.ink}
                rightContent={
                    story ? (
                        <HeaderIconButton
                            className="story-editor__preview"
                            icon="play_arrow"
                            label="Preview"
                            color={look.ink2}
                            onClick={() => slideNavigate(storyPlayPath(storyId), { state: { from: storyEditPath(storyId) } })}
                        />
                    ) : undefined
                }
            />

            <Box
                ref={bodyRef}
                className="story-editor-body"
                sx={{ flex: 1, minHeight: 0, overflowY: "auto", touchAction: "pan-y", px: 2, pb: 4 }}
            >
                {status === "loading" && <Typography className="story-editor-loading" sx={cyoaMutedTextSx(look)}>Loading…</Typography>}
                {status === "forbidden" && (
                    <Typography className="story-editor-forbidden" sx={cyoaMutedTextSx(look)}>Only this story's author can edit it.</Typography>
                )}
                {status === "unavailable" && (
                    <Typography className="story-editor-unavailable" sx={cyoaMutedTextSx(look)}>This story no longer exists.</Typography>
                )}
                {status === "error" && (
                    <Typography className="story-editor-error" sx={cyoaMutedTextSx(look)}>Couldn't load this story. Please try again later.</Typography>
                )}

                {status === "ready" && edit && story && (
                    <Box className="story-editor-content" sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1.5 }}>
                        {/* ── The story: icon, title, status, publish ── */}
                        <Box className="story-editor-story" sx={{ ...cyoaFlatCardSx(look), p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
                            <Box className="story-editor-story__identity" sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                <Box
                                    component="button"
                                    type="button"
                                    className="story-editor-story__icon-tile"
                                    aria-label="Choose a story icon"
                                    onClick={() => setIconPickerOpen(true)}
                                    sx={{
                                        width: ICON_TILE_PX,
                                        height: ICON_TILE_PX,
                                        flexShrink: 0,
                                        borderRadius: "18px",
                                        border: "none",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: RAMP.grn.mid,
                                        boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                                        touchAction: "manipulation",
                                    }}
                                >
                                    {story.iconId ? (
                                        <Box component="img" className="story-editor-story__icon-image" src={iconImageUrl(story.iconId)} alt="" sx={{ width: 40, height: 40, objectFit: "contain" }} />
                                    ) : (
                                        <Icon name="add_photo_alternate" size={28} color={COLORS.onSurface} />
                                    )}
                                </Box>
                                <InputBase
                                    className="story-editor-story__title-field"
                                    value={titleDraft}
                                    onChange={(event) => setTitleDraft(event.target.value)}
                                    onBlur={saveTitle}
                                    onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                                    placeholder="Story title"
                                    inputProps={{ maxLength: STORY_TITLE_MAX_LENGTH, "aria-label": "Story title" }}
                                    sx={{ ...cyoaFieldSx(look), fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold }}
                                />
                            </Box>

                            <Typography className="story-editor-story__status" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.muted, lineHeight: LEADING.normal }}>
                                {published
                                    ? `Published${story.difficulty !== null ? ` · HSK ${story.difficulty}` : ""} — edits go live right away.`
                                    : "Draft — only you can see it."}
                            </Typography>

                            <Box className="story-editor-story__actions" sx={{ display: "flex", gap: 1 }}>
                                <Button
                                    className="story-editor-story__publish"
                                    onClick={handlePublishToggle}
                                    disabled={busy}
                                    sx={cyoaPillButtonSx(look, published ? undefined : COLORS.bluM)}
                                >
                                    {published ? "Unpublish" : "Publish"}
                                </Button>
                            </Box>
                        </Box>

                        {notice && <Typography className="story-editor-notice" sx={{ ...cyoaMessageSx(look), textAlign: "center" }}>{notice}</Typography>}

                        {/* ── The live publish checks ── */}
                        {edit.warnings.length > 0 && (
                            <Box className="story-editor-warnings" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                                <Typography className="story-editor-warnings__heading" sx={cyoaSectionHeadingSx(look)}>
                                    {published ? "Things to check" : "Before publishing"}
                                </Typography>
                                {edit.warnings.map((warning, index) => (
                                    <Box key={index} className="story-editor-warnings__item" sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                                        <Icon name="error_outline" size={16} color={look.muted} />
                                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: look.ink2, lineHeight: LEADING.normal }}>
                                            {warningText(warning, labels)}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {/* ── The passages ── */}
                        <Box className="story-editor-passages" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <Box className="story-editor-passages__head" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <Typography className="story-editor-passages__heading" sx={cyoaSectionHeadingSx(look)}>
                                    Passages · {edit.passages.length}
                                </Typography>
                                <Button className="story-editor-passages__new" onClick={handleNewPassage} disabled={busy} sx={cyoaPillButtonSx(look, COLORS.bluM)}>
                                    New passage
                                </Button>
                            </Box>
                            <StoryPassageList
                                look={look}
                                passages={edit.passages}
                                labels={labels}
                                startPassageId={story.startPassageId}
                                onOpen={(passageId) => slideNavigate(passageEditPath(storyId, passageId))}
                                onReorder={(passageIds) => void handleReorder(passageIds)}
                                onDuplicate={handleDuplicate}
                                busy={busy}
                                scrollerRef={bodyRef}
                            />
                        </Box>

                        <Box className="story-editor-danger" sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                            <Button className="story-editor-danger__delete" onClick={() => setConfirmDelete(true)} disabled={busy} sx={cyoaPillButtonSx(look)}>
                                Delete story
                            </Button>
                        </Box>
                    </Box>
                )}
            </Box>

            {/* IconPickerDialog caches the icon (ensureIcon8) before onPick, so the id always
                satisfies stories."iconId"'s FK to icons8 (migration 196). */}
            <IconPickerDialog
                open={iconPickerOpen}
                onClose={() => setIconPickerOpen(false)}
                title="Choose a story icon"
                currentIconId={story?.iconId ?? null}
                onPick={async (iconId) => { await run(() => updateStory(storyId, { iconId }), setEdit); }}
                onRemove={async () => { await run(() => updateStory(storyId, { iconId: null }), setEdit); }}
                removeLabel="Remove icon"
            />
            <StoryConfirmDialog
                look={look}
                open={confirmDelete}
                title="Delete story?"
                message={`"${story?.title ?? ""}" and every passage in it will be deleted, along with learners' progress and endings found. This can't be undone.`}
                confirmLabel={busy ? "Deleting…" : "Delete"}
                busy={busy}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={handleDelete}
            />
        </Box>
    );
}

export default StoryEditorPage;
