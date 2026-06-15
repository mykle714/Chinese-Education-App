import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import MobileTabScreen from "../components/MobileTabScreen";
import { HubMenu, HubMenuRow } from "../components/HubMenu";
import { usePageTitle } from "../hooks/usePageTitle";
import { GAME_REGISTRY } from "../games/registry";
import { useAuth } from "../AuthContext";
import type { GameDef } from "../games/types";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx; the scroll-away
// header + floating footer + scroll behavior come from MobileTabScreen; the row
// list comes from the shared HubMenu (also used by the Discover hub) — this page
// only owns game gating + the empty state.

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
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();

    // Apply registry-level gating: `requiresAuth` hides games from public/demo
    // accounts; `unlock.minVocabEntries` is reserved for future gating once a
    // vocab count is available client-side.
    const visibleGames = GAME_REGISTRY.filter((g) => {
        if (g.requiresAuth && (!isAuthenticated || user?.isPublic)) return false;
        return true;
    });

    return (
        <MobileTabScreen title="Games" activePage="home" showBack onBack={() => navigate("/")} contentClassName="games-page__content">
                <HubMenu className="games-page__menu">
                    {visibleGames.map((game: GameDef) => (
                        <HubMenuRow
                            key={game.gameId}
                            to={game.route}
                            className={`games-page__menu-item games-page__menu-item--${game.gameId}`}
                            title={game.title}
                            subtitle={game.subtitle}
                            icon={
                                game.iconAsset ? (
                                    <Box
                                        component="img"
                                        src={game.iconAsset}
                                        alt=""
                                        sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    />
                                ) : (
                                    <SportsEsportsIcon sx={{ color: COLORS.textSecondary }} />
                                )
                            }
                        />
                    ))}
                </HubMenu>

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
        </MobileTabScreen>
    );
};

export default GamesPage;
