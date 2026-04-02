import { useState, type ReactNode } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import {
    Box,
    Button,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PersonIcon from "@mui/icons-material/Person";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SettingsIcon from "@mui/icons-material/Settings";
import ArticleIcon from "@mui/icons-material/Article";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import MenuIcon from "@mui/icons-material/Menu";
import BookIcon from "@mui/icons-material/Book";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";

interface NavItem {
    text: string;
    path: string;
    icon: ReactNode;
}

const DRAWER_WIDTH = 250;

/**
 * Self-contained hamburger menu button + navigation drawer for mobile demo pages.
 * Mirrors the navigation structure from Layout.tsx but without the layout chrome.
 */
const MobileNavDrawer: React.FC = () => {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, user, logout } = useAuth();
    const { confirm } = useConfirmation();

    // Navigation items — same auth-guarded list as Layout.tsx
    const navItems: NavItem[] = [
        { text: "Home", path: "/", icon: <HomeIcon /> },
    ];

    if (isAuthenticated && !user?.isPublic) {
        navItems.push(
            { text: "Cards", path: "/entries", icon: <MenuBookIcon /> },
            { text: "Dictionary", path: "/dictionary", icon: <BookIcon /> },
            { text: "Flashcards", path: "/flashcards", icon: <ShuffleIcon /> },
            { text: "Mobile Demo", path: "/flashcards/decks", icon: <PhoneIphoneIcon /> },
            { text: "Reader", path: "/reader", icon: <ArticleIcon /> },
            { text: "Night Market", path: "/night-market", icon: <NightsStayIcon /> },
            { text: "Profile", path: "/profile", icon: <PersonIcon /> },
            { text: "Settings", path: "/settings", icon: <SettingsIcon /> }
        );
    } else {
        navItems.push(
            { text: "Mobile Demo", path: "/flashcards/decks", icon: <PhoneIphoneIcon /> },
            { text: "Settings", path: "/settings", icon: <SettingsIcon /> }
        );
    }

    const handleLogout = async () => {
        setOpen(false);
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            logout();
            navigate("/");
        }
    };

    return (
        <>
            {/* Hamburger icon button — placed in the page's header toolbar */}
            <IconButton
                className="mobile-nav-drawer__hamburger-button"
                aria-label="open navigation menu"
                onClick={() => setOpen(true)}
                size="small"
            >
                <MenuIcon className="mobile-nav-drawer__hamburger-icon" />
            </IconButton>

            {/* Navigation drawer */}
            <Drawer
                className="mobile-nav-drawer__drawer"
                anchor="left"
                open={open}
                onClose={() => setOpen(false)}
                ModalProps={{ keepMounted: true }}
                sx={{
                    [`& .MuiDrawer-paper`]: {
                        width: DRAWER_WIDTH,
                        boxSizing: "border-box",
                        boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.1)",
                    },
                }}
            >
                <Box
                    className="mobile-nav-drawer__content"
                    sx={{ display: "flex", flexDirection: "column", height: "100%" }}
                >
                    {/* Drawer header */}
                    <Box
                        className="mobile-nav-drawer__header"
                        sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}
                    >
                        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: "bold" }}>
                            Vocabulary Manager
                        </Typography>
                        {isAuthenticated && user && (
                            <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
                                {user.name}
                            </Typography>
                        )}
                    </Box>

                    <Divider />

                    {/* Navigation items */}
                    <List className="mobile-nav-drawer__nav-list" sx={{ flexGrow: 1, pt: 2 }}>
                        {navItems.map((item) => (
                            <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                                <ListItemButton
                                    className="mobile-nav-drawer__nav-item"
                                    component={RouterLink}
                                    to={item.path}
                                    selected={location.pathname === item.path}
                                    onClick={() => setOpen(false)}
                                    sx={{
                                        borderRadius: "0 20px 20px 0",
                                        mr: 1,
                                        pl: 3,
                                        "&.Mui-selected": {
                                            backgroundColor: "primary.main",
                                            color: "white",
                                            "&:hover": { backgroundColor: "primary.dark" },
                                            "& .MuiListItemIcon-root": { color: "white" },
                                        },
                                        "&:hover": { backgroundColor: "action.hover" },
                                    }}
                                >
                                    <ListItemIcon sx={{ minWidth: 40, color: location.pathname === item.path ? "white" : "inherit" }}>
                                        {item.icon}
                                    </ListItemIcon>
                                    <ListItemText primary={item.text} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>

                    {/* Logout button */}
                    {isAuthenticated && (
                        <Box
                            className="mobile-nav-drawer__logout-section"
                            sx={{ p: 2, borderTop: "1px solid rgba(0, 0, 0, 0.08)" }}
                        >
                            <Button
                                className="mobile-nav-drawer__logout-button"
                                fullWidth
                                variant="outlined"
                                color="primary"
                                onClick={handleLogout}
                                startIcon={<PersonIcon />}
                            >
                                Logout
                            </Button>
                        </Box>
                    )}
                </Box>
            </Drawer>
        </>
    );
};

export default MobileNavDrawer;
