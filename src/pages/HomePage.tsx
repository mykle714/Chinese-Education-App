import NightsStayIcon from "@mui/icons-material/NightsStay";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import ArticleIcon from "@mui/icons-material/Article";
import BookIcon from "@mui/icons-material/Book";
import DashboardIcon from "@mui/icons-material/Dashboard";
import GroupsIcon from "@mui/icons-material/Groups";
import MobileTabScreen from "../components/MobileTabScreen";
import { HubMenu, HubMenuRow } from "../components/HubMenu";
import { usePageTitle } from "../hooks/usePageTitle";
import { COLORS } from "../theme/colors";

// Home hub (`/`) — the landing surface for the footer's Home tab. A vertical
// HubMenu (same component the Discover / Games hubs use) of the app's secondary
// destinations. Phone-frame sizing comes from MobileDemoFrame; the scroll-away
// header + floating footer come from MobileTabScreen.

interface HomeMenuItem {
    to: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    key: string;
}

const iconSx = { color: COLORS.textSecondary } as const;

function HomePage() {
    usePageTitle();

    const items: HomeMenuItem[] = [
        { key: "night-market", to: "/night-market", title: "Night Market", subtitle: "Explore the vocabulary night market", icon: <NightsStayIcon sx={iconSx} /> },
        { key: "games", to: "/games", title: "Games", subtitle: "Play vocabulary mini-games", icon: <SportsEsportsIcon sx={iconSx} /> },
        { key: "community", to: "/community", title: "Community", subtitle: "Discover and upvote card designs from other learners", icon: <GroupsIcon sx={iconSx} /> },
        { key: "reader", to: "/reader", title: "Reader", subtitle: "Read texts and mine new words", icon: <ArticleIcon sx={iconSx} /> },
        { key: "dictionary", to: "/dictionary", title: "Dictionary", subtitle: "Look up words and add them to your decks", icon: <BookIcon sx={iconSx} /> },
        { key: "tester-dashboard", to: "/tester-dashboard", title: "Tester Dashboard", subtitle: "Study time, streak, and activity", icon: <DashboardIcon sx={iconSx} /> },
    ];

    return (
        <MobileTabScreen title="Home" activePage="home" contentClassName="home-page__content">
            <HubMenu className="home-page__menu">
                {items.map((item) => (
                    <HubMenuRow
                        key={item.key}
                        to={item.to}
                        className={`home-page__menu-item home-page__menu-item--${item.key}`}
                        title={item.title}
                        subtitle={item.subtitle}
                        icon={item.icon}
                    />
                ))}
            </HubMenu>
        </MobileTabScreen>
    );
}

export default HomePage;
