import { Box, Typography } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import Icon from "../../components/Icon";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { FONTS } from "../../theme/fonts";
import { LEADING, SIZE, WEIGHT } from "../../theme/scale";
import { CARD_SURFACE_RADIUS } from "../../theme/surfaces";
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from "../../theme/roundedEdge";

// The plate's straight drop lip, px — the same depth as the Dictionary's keycaps
// (DictionaryPageParts.tsx → KEYCAP_LIP), so raised objects on Tier-2 pages stand equally tall.
const PLATE_LIP = 4;

/**
 * Lessons — the second footer tab (`/lessons`), which took Arena's slot on 2026-11-10.
 *
 * A placeholder: the lessons feature is not designed yet, so the page only says
 * "Coming soon". Styled as a Deck Tower (td) Tier-2 page, like the Dictionary
 * (docs/SHELF_REDESIGN.md § 7b): the time-of-day ground and ink from `useTier2Look`
 * (which also lends its colours to the slab footer while the page is up), and td's
 * floating slab footer (`footerStyle: "slab"` on the route, src/routes/routeMeta.ts).
 * A plain footer-tab root otherwise: no back arrow, no slide.
 *
 * The message sits on one raised plate — the look's `surface` with the app outline, the
 * top rim light and a straight `surfaceEdge` lip (CLAUDE.md § Buttons & cards, and the
 * rounded edge in src/theme/roundedEdge.ts).
 *
 * Docs: docs/NAVIGATION.md (footer tabs).
 * LAYER: feature page (renders only; no server calls).
 */
function LessonsPage() {
    usePageTitle("Lessons");
    // Call once per page (see useTier2Look): it claims the footer/keyboard/status-bar chrome.
    const look = useTier2Look();

    return (
        <MobileTabScreen
            title="Lessons"
            contentClassName="lessons-page"
            surfaceColor={look.ground}
            headerTitleColor={look.ink}
            scrollable={false}
        >
            {/* Centers the plate in the space between the header and the slab footer. */}
            <Box
                className="lessons-page__stage"
                sx={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    px: "16px",
                }}
            >
                <Box
                    className="lessons-page__coming-soon-plate"
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        maxWidth: 280,
                        boxSizing: "border-box",
                        padding: "28px 20px 26px",
                        textAlign: "center",
                        backgroundColor: look.surface,
                        borderRadius: `${CARD_SURFACE_RADIUS}px`,
                        // Outline ring first, so the rim light below it is pushed under the
                        // ring (`insideRingPx`); then the fillet and the lip, the order the
                        // Dictionary's keycaps use.
                        boxShadow: [
                            `inset 0 0 0 1px ${look.outline}`,
                            roundedEdgeRimLightTop(look.surface, 1),
                            roundedEdgeFilletDown(look.surface, look.surfaceEdge),
                            `0 ${PLATE_LIP}px 0 ${look.surfaceEdge}`,
                        ].join(", "),
                    }}
                >
                    <Icon className="lessons-page__coming-soon-icon" name="school" size={36} color={look.ink2} />
                    <Typography
                        className="lessons-page__coming-soon-title"
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: SIZE.title,
                            fontWeight: WEIGHT.semibold,
                            lineHeight: LEADING.tight,
                            color: look.ink,
                        }}
                    >
                        Coming soon
                    </Typography>
                </Box>
            </Box>
        </MobileTabScreen>
    );
}

export default LessonsPage;
