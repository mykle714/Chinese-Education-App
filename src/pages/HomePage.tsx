import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import GridViewIcon from "@mui/icons-material/GridView";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import ArticleIcon from "@mui/icons-material/Article";
import BookIcon from "@mui/icons-material/Book";
import DashboardIcon from "@mui/icons-material/Dashboard";
import GroupsIcon from "@mui/icons-material/Groups";
import MobileTabScreen from "../components/MobileTabScreen";
import { useAuth } from "../AuthContext";
import { HubMenu, HubMenuRow } from "../components/HubMenu";
import { FooterSpacer } from "../components/MobileFooter";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT } from "../theme/scale";

// Home hub (`/`) — the landing surface for the footer's Home tab. A vertical
// HubMenu (same component the Discover / Games hubs use) of the app's secondary
// destinations, with a static welcome header and a tip-box footer (see
// docs/HUB_MENU_SYSTEM.md). Phone-frame sizing comes from MobileDemoFrame; the
// scroll-away header + floating footer come from MobileTabScreen.

interface HomeMenuItem {
    to: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    key: string;
    /** Persistent card background — assigned once below, not randomized per render. */
    bgColor: string;
}

const iconSx = { color: COLORS.textSecondary } as const;

const WelcomeHeader = styled(Box)(() => ({
    padding: "4px 20px 0",
}));

function HomePage() {
    usePageTitle();
    const { user } = useAuth();

    const items: HomeMenuItem[] = [
        { key: "night-market", to: "/night-market", title: "Night Market", subtitle: "Explore the vocabulary night market", icon: <NightsStayIcon sx={iconSx} />, bgColor: COLORS.purpleAccent },
        { key: "games", to: "/games", title: "Games", subtitle: "Play vocabulary mini-games", icon: <SportsEsportsIcon sx={iconSx} />, bgColor: COLORS.blueAccent },
        { key: "community", to: "/community", title: "Community", subtitle: "Discover and upvote card designs from other learners", icon: <GroupsIcon sx={iconSx} />, bgColor: COLORS.greenAccent },
        { key: "reader", to: "/reader", title: "Reader", subtitle: "Read texts and mine new words", icon: <ArticleIcon sx={iconSx} />, bgColor: COLORS.yellowAccent },
        { key: "dictionary", to: "/dictionary", title: "Dictionary", subtitle: "Look up words and add them to your decks", icon: <BookIcon sx={iconSx} />, bgColor: COLORS.redAccent },
        { key: "tester-dashboard", to: "/tester-dashboard", title: "Tester Dashboard", subtitle: "Study time, streak, and activity", icon: <DashboardIcon sx={iconSx} />, bgColor: COLORS.blueAccent },
        // Template-author-only: the Night Market template authoring editor (desktop-only).
        ...(user?.isTemplateAuthor
            ? [{ key: "template-editor", to: "/night-market/template-editor", title: "Template Editor", subtitle: "Author Night Market templates", icon: <GridViewIcon sx={iconSx} />, bgColor: COLORS.purpleAccent } as HomeMenuItem]
            : []),
    ];

    return (
        <MobileTabScreen title="Home" activePage="home" contentClassName="home-page__content">
            <HubMenu
                className="home-page__menu"
                header={
                    <WelcomeHeader className="home-page__welcome">
                        <Typography
                            className="home-page__welcome-title"
                            sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface, fontFamily: FONTS.sans }}
                        >
                            Welcome back
                        </Typography>
                        <Typography
                            className="home-page__welcome-subtitle"
                            sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, fontFamily: FONTS.sans, mt: 0.5 }}
                        >
                            Here's where you can go next.
                        </Typography>
                    </WelcomeHeader>
                }
                footer={
                    <>
                        <TipBox className="home-page__tip-box" />
                        <FooterSpacer />
                    </>
                }
            >
                {items.map((item) => (
                    <HubMenuRow
                        key={item.key}
                        to={item.to}
                        className={`home-page__menu-item home-page__menu-item--${item.key}`}
                        title={item.title}
                        subtitle={item.subtitle}
                        icon={item.icon}
                        bgColor={item.bgColor}
                    />
                ))}
            </HubMenu>
        </MobileTabScreen>
    );
}

export default HomePage;
