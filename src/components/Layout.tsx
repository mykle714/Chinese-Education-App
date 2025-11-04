import { type ReactNode } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import {
    AppBar,
    Box,
    Toolbar,
    Typography,
    Button,
    Container,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Divider,
    useMediaQuery,
    useTheme as useMuiTheme,
    IconButton
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import AddIcon from "@mui/icons-material/Add";
import PersonIcon from "@mui/icons-material/Person";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SettingsIcon from "@mui/icons-material/Settings";
import ArticleIcon from "@mui/icons-material/Article";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import MenuIcon from "@mui/icons-material/Menu";
import { useState } from "react";

interface LayoutProps {
    children: ReactNode;
}

interface NavItem {
    text: string;
    path: string;
    icon: ReactNode;
}

function Layout({ children }: LayoutProps) {
    const location = useLocation();
    const theme = useMuiTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { isAuthenticated, user, logout } = useAuth();
    const { confirm } = useConfirmation();

    // Drawer width for both permanent and temporary drawers
    const drawerWidth = 250;

    // Define navigation items based on authentication status
    const navItems: NavItem[] = [
        { text: "Home", path: "/", icon: <HomeIcon /> },
    ];

    // Add authenticated-only navigation items
    if (isAuthenticated) {
        navItems.push(
            { text: "Cards", path: "/entries", icon: <MenuBookIcon /> },
            { text: "Flashcards", path: "/flashcards", icon: <ShuffleIcon /> },
            { text: "Reader", path: "/reader", icon: <ArticleIcon /> },
            { text: "Night Market", path: "/night-market", icon: <NightsStayIcon /> },
            { text: "Profile", path: "/profile", icon: <PersonIcon /> },
            { text: "Settings", path: "/settings", icon: <SettingsIcon /> }
        );
    } else {
        navItems.push(
            { text: "Login", path: "/login", icon: <PersonIcon /> },
            { text: "Register", path: "/register", icon: <AddIcon /> }
        );
    }

    const toggleDrawer = (open: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
        if (
            event.type === "keydown" &&
            ((event as React.KeyboardEvent).key === "Tab" || (event as React.KeyboardEvent).key === "Shift")
        ) {
            return;
        }
        setDrawerOpen(open);
    };

    // Handle logout with confirmation
    const handleLogout = async () => {
        const confirmed = await confirm("Are you sure you want to log out?");
        if (confirmed) {
            logout();
        }
    };

    // Navigation content - used in both permanent sidebar and mobile drawer
    const navigationContent = (
        <>
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
            }}>
                <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 'bold' }}>
                        Vocabulary Manager
                    </Typography>
                    {isAuthenticated && user && (
                        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                            {user.name}
                        </Typography>
                    )}
                </Box>
                <Divider />
                <List sx={{ flexGrow: 1, pt: 2 }}>
                    {navItems.map((item) => (
                        <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                            <ListItemButton
                                component={RouterLink}
                                to={item.path}
                                selected={location.pathname === item.path}
                                sx={{
                                    borderRadius: '0 20px 20px 0',
                                    mr: 1,
                                    pl: 3,
                                    '&.Mui-selected': {
                                        backgroundColor: 'primary.main',
                                        color: 'white',
                                        '&:hover': {
                                            backgroundColor: 'primary.dark',
                                        },
                                        '& .MuiListItemIcon-root': {
                                            color: 'white',
                                        },
                                    },
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                <ListItemIcon sx={{
                                    minWidth: 40,
                                    color: location.pathname === item.path ? 'white' : 'inherit'
                                }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText primary={item.text} />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>

                {isAuthenticated && (
                    <Box sx={{ p: 2, borderTop: '1px solid rgba(0, 0, 0, 0.08)' }}>
                        <Button
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
        </>
    );

    return (
        <Box sx={{ display: "flex", minHeight: "100vh", position: "relative", pb: 6 }}>
            {/* App bar - only visible on mobile */}
            <AppBar
                position="fixed"
                elevation={1}
                sx={{
                    width: isMobile ? '100%' : `calc(100% - ${drawerWidth}px)`,
                    ml: isMobile ? 0 : `${drawerWidth}px`,
                    display: isMobile ? 'block' : 'none',
                    backgroundColor: 'background.paper',
                    color: 'text.primary'
                }}
            >
                <Toolbar>
                    <IconButton
                        color="inherit"
                        aria-label="open drawer"
                        edge="start"
                        onClick={toggleDrawer(true)}
                        sx={{ mr: 2 }}
                    >
                        <MenuIcon />
                    </IconButton>
                    <Typography variant="h6" noWrap component="div">
                        Vocabulary Manager
                    </Typography>
                </Toolbar>
            </AppBar>

            {/* Permanent drawer for desktop */}
            {!isMobile && (
                <Drawer
                    variant="permanent"
                    sx={{
                        width: 0,
                        flexShrink: 0,
                        [`& .MuiDrawer-paper`]: {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                            borderRight: '1px solid rgba(0, 0, 0, 0.08)',
                            boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.05)'
                        },
                    }}
                    open
                >
                    {navigationContent}
                </Drawer>
            )}

            {/* Temporary drawer for mobile */}
            {isMobile && (
                <Drawer
                    variant="temporary"
                    open={drawerOpen}
                    onClose={toggleDrawer(false)}
                    ModalProps={{
                        keepMounted: true, // Better open performance on mobile
                    }}
                    sx={{
                        [`& .MuiDrawer-paper`]: {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                            boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.1)'
                        },
                    }}
                >
                    {navigationContent}
                </Drawer>
            )}

            {/* Main content wrapper */}
            <Box
                sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
                    ml: { xs: 0, md: `${drawerWidth}px` }
                }}
            >
                {/* Content area */}
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',    // center content horizontally
                        pt: { xs: 2, sm: 3 },    // top padding
                        pr: { xs: 2, sm: 3 },    // right padding  
                        pb: { xs: 2, sm: 3 },    // bottom padding
                        pl: { xs: 2, sm: 3 },    // left padding - now equal to right
                        mt: isMobile ? 8 : 2,
                        mb: 6 // Add more bottom margin to account for the footer
                    }}
                >
                    {children}
                </Box>
            </Box>

            {/* Footer - spans full width */}
            <Box
                component="footer"
                sx={{
                    py: 2,
                    px: 2,
                    backgroundColor: (theme) => theme.palette.grey[100],
                    borderTop: '1px solid rgba(0, 0, 0, 0.08)',
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    zIndex: (theme) => theme.zIndex.drawer - 1
                }}
            >
                <Container maxWidth="lg">
                    <Typography variant="body2" color="text.secondary" align="center">
                        © {new Date().getFullYear()} Vocabulary Entry Manager
                    </Typography>
                </Container>
            </Box>
        </Box>
    );
}

export default Layout;
