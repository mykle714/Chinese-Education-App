import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import MobileDemoHeader from "../components/MobileDemoHeader";
import MobileFooter from "../components/MobileFooter";
import { usePageTitle } from "../hooks/usePageTitle";
import { GAME_REGISTRY } from "../games/registry";
import { useAuth } from "../AuthContext";
import type { GameDef } from "../games/types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../theme/scale";

// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx — this page
// only owns its inner layout.

const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    // This is the one intentionally-scrollable region on the page (the game list
    // can overflow vertically). Allow vertical pan here, but `overscroll-behavior:
    // contain` stops the scroll from chaining to the frame/page so the page itself
    // never scrolls or rubber-bands at the list's scroll boundary.
    touchAction: "pan-y",
    overscrollBehavior: "contain",
}));

// Full-width vertical menu list. Each registered game becomes one row that
// spans the container width.
const GameMenuList = styled(Box)(() => ({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    padding: 0,
}));

const GameMenuRow = styled(RouterLink)(() => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    padding: "16px 20px",
    borderBottom: `1px solid ${COLORS.rowBorder}`,
    textDecoration: "none",
    color: "inherit",
    backgroundColor: "transparent",
    transition: "background-color 120ms ease",
    "&:hover": {
        backgroundColor: COLORS.rowHoverBg,
    },
}));

const GameRowIcon = styled(Box)(() => ({
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.iconBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
}));

const GameRowBody = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
}));

const EmptyState = styled(Box)(() => ({
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 24px",
    textAlign: "center",
    gap: 8,
}));

const GamesPage: React.FC = () => {
    usePageTitle("Games");
    const { user, isAuthenticated } = useAuth();

    // Apply registry-level gating: `requiresAuth` hides games from public/demo
    // accounts; `unlock.minVocabEntries` is reserved for future gating once a
    // vocab count is available client-side.
    const visibleGames = GAME_REGISTRY.filter((g) => {
        if (g.requiresAuth && (!isAuthenticated || user?.isPublic)) return false;
        return true;
    });

    return (
        <>
            <MobileDemoHeader title="Games" activePage="games" />

            <ContentArea className="games-page__content">
                <GameMenuList className="games-page__menu">
                    {visibleGames.map((game: GameDef) => (
                        <GameMenuRow
                            key={game.gameId}
                            to={game.route}
                            className={`games-page__menu-item games-page__menu-item--${game.gameId}`}
                        >
                            <GameRowIcon className="games-page__menu-item-icon">
                                {game.iconAsset ? (
                                    <Box
                                        component="img"
                                        src={game.iconAsset}
                                        alt=""
                                        sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    />
                                ) : (
                                    <SportsEsportsIcon sx={{ color: COLORS.textSecondary }} />
                                )}
                            </GameRowIcon>
                            <GameRowBody className="games-page__menu-item-body">
                                <Typography
                                    className="games-page__menu-item-title"
                                    sx={{
                                        fontSize: SIZE.bodyLg,
                                        fontWeight: WEIGHT.medium,
                                        color: COLORS.onSurface,
                                        fontFamily: FONTS.sans,
                                        lineHeight: LEADING.normal,
                                    }}
                                >
                                    {game.title}
                                </Typography>
                                {game.subtitle && (
                                    <Typography
                                        className="games-page__menu-item-subtitle"
                                        sx={{
                                            fontSize: SIZE.body,
                                            color: COLORS.textSecondary,
                                            fontFamily: FONTS.sans,
                                            lineHeight: LEADING.normal,
                                            mt: 0.25,
                                        }}
                                    >
                                        {game.subtitle}
                                    </Typography>
                                )}
                            </GameRowBody>
                            <ChevronRightIcon sx={{ color: COLORS.textSecondary, flexShrink: 0 }} />
                        </GameMenuRow>
                    ))}
                </GameMenuList>

                {/* Empty state until the first game ships (or all games are gated out). */}
                {visibleGames.length === 0 && (
                    <EmptyState className="games-page__empty">
                        <Typography
                            className="games-page__empty-title"
                            sx={{
                                fontSize: SIZE.subtitle,
                                fontWeight: WEIGHT.medium,
                                color: COLORS.onSurface,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            No games yet
                        </Typography>
                        <Typography
                            className="games-page__empty-subtitle"
                            sx={{
                                fontSize: SIZE.body,
                                color: COLORS.textSecondary,
                                fontFamily: FONTS.sans,
                            }}
                        >
                            Games will appear here as we build them.
                        </Typography>
                    </EmptyState>
                )}
            </ContentArea>

            <MobileFooter activePage="games" />
        </>
    );
};

export default GamesPage;
