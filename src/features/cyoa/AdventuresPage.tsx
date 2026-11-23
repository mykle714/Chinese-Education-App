import { useCallback, useEffect, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import Icon from "../../components/Icon";
import { CommonalityMeter } from "../../components/ScoreMeters";
import { useAuth } from "../../AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { createStory, fetchStories } from "../../api/stories";
import type { StoryListItem } from "../../../server/contracts/stories";
import { cyoaChipSx, cyoaMessageSx, cyoaMutedTextSx, cyoaPillButtonSx } from "./cyoaStyles";
import { storyEditPath, storyPlayPath } from "./adventuresPaths";

/**
 * AdventuresPage — `/adventures`, the story list (docs/CYOA_FEATURE.md § 6.2a, § 7).
 *
 * A NODE page reached from the Menu popover's Adventures row (behind FEATURE_FLAGS.cyoa):
 * keeps the footer (Menu tab lit), slides in from the right — the `/reader` list's
 * archetype. Tier 2 time-of-day look (§ 3.7).
 *
 * The list is the server's order (StoryDAL.listForViewer: most common first, then newest), as
 * a 2-column grid of flat 4:5 cards in the Reader grid's skin
 * (src/features/reader/ReaderDocumentGrid.tsx — mirrored, not imported, per
 * docs/FRONTEND_LAYERING.md). Each card shows:
 *   • the story's icon in a pastel tile (green ramp; `auto_stories` without an icon);
 *   • the title (two lines, then an ellipsis);
 *   • a meta line: the story's commonality as the 5-circle `CommonalityMeter` (the same
 *     meter the eip draws for a word; § 6.2a — it replaced "HSK n" on 2026-11-21) and
 *     "Endings found / total";
 *   • a corner chip: "Draft" (an author's unpublished story) or "In progress"
 *     (a saved resume point).
 * Tapping a card opens `/adventures/:id`, which resumes or starts the story — except an
 * author's own DRAFT, which opens the editor (`/adventures/:id/edit`): a draft is work in
 * progress, and its play page is one tap away there (Preview). A published own story
 * reaches the editor from the play page's header Edit icon.
 *
 * Authors (`isAuthor` arrives with the list) get a toolbar row above the grid with a
 * **New story** pill (blue MID — the Reader list's New document): it creates "Untitled
 * story" with an empty start passage and opens its editor.
 *
 * Load effect keys on `user?.id`, never `token` (CLAUDE.md ⛔ rule).
 *
 * Layer: feature page (src/features/cyoa). Data: src/api/stories.ts → GET /api/stories.
 */

const CARD_RADIUS = "16px";
const ICON_TILE_PX = 64;
const ICON_TILE_RADIUS = "18px";
/** One hue for every story tile — Adventures' menu hue (menuDestinations.ts). */
const STORY_HUE = "grn" as const;

function AdventuresPage() {
    usePageTitle("Adventures");
    const look = useTier2Look();
    const slideNavigate = useSlideNavigate();
    const { user } = useAuth();

    const [stories, setStories] = useState<StoryListItem[]>([]);
    const [isAuthor, setIsAuthor] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        setLoading(true);
        fetchStories()
            .then((res) => {
                if (cancelled) return;
                setStories(res.stories);
                setIsAuthor(res.isAuthor);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("AdventuresPage: failed to load stories", err);
                setStories([]);
                setError("Couldn't load adventures. Please try again later.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
        // Keyed on the stable auth identity, not `token` (CLAUDE.md ⛔ rule).
    }, [user?.id]);

    const handleOpen = useCallback((story: StoryListItem) => {
        const ownDraft = story.isOwn && story.publishedAt === null;
        slideNavigate(ownDraft ? storyEditPath(story.id) : storyPlayPath(story.id));
    }, [slideNavigate]);

    const handleCreate = useCallback(async () => {
        setCreating(true);
        setCreateError(null);
        try {
            const created = await createStory({ title: "Untitled story" });
            slideNavigate(storyEditPath(created.story.id));
        } catch (err) {
            console.error("AdventuresPage: failed to create a story", err);
            setCreateError("Couldn't create a story. Please try again.");
        } finally {
            setCreating(false);
        }
    }, [slideNavigate]);

    return (
        <NodePage
            title="Adventures"
            contentClassName="adventures-page-root"
            surfaceColor={look.ground}
            headerTitleColor={look.ink}
        >
            {isAuthor && (
                <Box className="adventures-toolbar" sx={{ display: "flex", alignItems: "center", gap: 1.5, padding: "13px 16px 0" }}>
                    <Button
                        className="adventures-toolbar__new-story"
                        onClick={handleCreate}
                        disabled={creating}
                        sx={{ ...cyoaPillButtonSx(look, COLORS.bluM), height: 36, px: 2 }}
                    >
                        New story
                    </Button>
                    {createError && <Typography className="adventures-toolbar__error" sx={cyoaMessageSx(look)}>{createError}</Typography>}
                </Box>
            )}
            {loading && <Typography className="adventures-loading" sx={cyoaMutedTextSx(look)}>Loading…</Typography>}
            {!loading && error && <Typography className="adventures-error" sx={cyoaMutedTextSx(look)}>{error}</Typography>}
            {!loading && !error && stories.length === 0 && (
                <Typography className="adventures-empty" sx={cyoaMutedTextSx(look)}>No adventures yet.</Typography>
            )}

            {!loading && stories.length > 0 && (
                <Box
                    className="adventures-grid"
                    sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "10px",
                        padding: "13px 16px 0",
                    }}
                >
                    {stories.map((story) => (
                        <AdventureCard key={story.id} story={story} look={look} onOpen={handleOpen} />
                    ))}
                </Box>
            )}
            <FooterSpacer />
        </NodePage>
    );
}

interface AdventureCardProps {
    story: StoryListItem;
    look: Tier2Look;
    onOpen: (story: StoryListItem) => void;
}

/** One story card (see the page header for its anatomy). */
function AdventureCard({ story, look, onOpen }: AdventureCardProps) {
    const isDraft = story.publishedAt === null;
    // A draft wins the corner: an author's own unpublished story is the more useful fact.
    const cornerLabel = isDraft ? "Draft" : story.inProgress ? "In progress" : null;
    const endings = story.endingsTotal > 0 ? `Endings ${story.endingsFound}/${story.endingsTotal}` : null;
    const hasCommonality = story.commonality !== null;

    return (
        <Box
            component="button"
            type="button"
            className="adventures-card"
            onClick={() => onOpen(story)}
            sx={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                aspectRatio: "4 / 5",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "22px 12px 14px",
                backgroundColor: look.surface,
                border: `1px solid ${look.line}`,
                borderRadius: CARD_RADIUS,
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                touchAction: "manipulation",
            }}
        >
            {cornerLabel && (
                <Box
                    component="span"
                    className="adventures-card__corner-chip"
                    // Draft: outline only on the look; In progress: the hue's pastel.
                    sx={{ ...cyoaChipSx(look, isDraft ? undefined : RAMP[STORY_HUE].mid), position: "absolute", top: 8, right: 8 }}
                >
                    {cornerLabel}
                </Box>
            )}
            <Box
                className="adventures-card__icon-tile"
                sx={{
                    width: ICON_TILE_PX,
                    height: ICON_TILE_PX,
                    borderRadius: ICON_TILE_RADIUS,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: RAMP[STORY_HUE].mid,
                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                }}
            >
                {story.iconId ? (
                    <Box
                        component="img"
                        className="adventures-card__icon-image"
                        src={iconImageUrl(story.iconId)}
                        alt=""
                        sx={{ width: 40, height: 40, objectFit: "contain", display: "block" }}
                    />
                ) : (
                    <Icon name="auto_stories" size={30} color={COLORS.onSurface} />
                )}
            </Box>
            <Typography
                className="adventures-card__title"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: 14.5,
                    fontWeight: WEIGHT.semibold,
                    letterSpacing: "-0.01em",
                    lineHeight: LEADING.tight,
                    color: look.ink,
                    textAlign: "center",
                    width: "100%",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {story.title}
            </Typography>
            {(hasCommonality || endings) && (
                <Typography
                    component="div"
                    className="adventures-card__meta"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        color: look.muted,
                        lineHeight: LEADING.tight,
                        marginTop: "-4px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        maxWidth: "100%",
                    }}
                >
                    {/* Filled and empty circles both in the meta line's muted ink, as the
                        eip draws them in its ink2 (DefinitionFacts). */}
                    {story.commonality !== null && (
                        <CommonalityMeter
                            className="adventures-card__commonality-meter"
                            score={story.commonality}
                            filledColor={look.muted}
                            emptyColor={look.muted}
                        />
                    )}
                    {hasCommonality && endings && <span className="adventures-card__meta-separator">·</span>}
                    {endings && (
                        <Box component="span" className="adventures-card__endings" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {endings}
                        </Box>
                    )}
                </Typography>
            )}
        </Box>
    );
}

export default AdventuresPage;
