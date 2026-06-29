import { Box, Container, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import Message from "../components/Message";
import LeafPage from "../components/LeafPage";
import { useMinutePoints } from "../hooks/useMinutePoints";
import TimeDisplay from "../components/TimeDisplay";
import StreakCounter from "../components/StreakCounter";
import MonthlyCalendar from "../components/MonthlyCalendar";
import LeaderboardPlaceholder from "../components/LeaderboardPlaceholder";
import { usePageTitle } from "../hooks/usePageTitle";

// Tester Dashboard — the former landing page content (study time, streak, monthly
// calendar, leaderboard). Reached from the Home menu; the back arrow returns there.
function TesterDashboardPage() {
    usePageTitle("Tester Dashboard");
    const navigate = useNavigate();
    const {
        totalStudyTimeMinutes,
        currentStreak
    } = useMinutePoints();

    return (
        // Tester Dashboard is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer,
        // DOWN back arrow (→ Home), slides up on enter / down on exit.
        <LeafPage title="Tester Dashboard" onBack={() => navigate("/")} className="tester-dashboard-page">
            <Box className="tester-dashboard-page__scroll" sx={{ flex: 1, overflowY: "auto" }}>
                {/* Always rendered in the mobile single-column layout regardless
                    of viewport width — the desktop two-column layout is retired. */}
                <Container maxWidth="sm" sx={{ py: 4 }}>
                    <Message />

                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: '1fr',
                        gap: 4
                    }}>
                        {/* Left Column - User Dashboard */}
                        <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ mb: 2 }}>
                                {/* Test User Message */}
                                {import.meta.env.VITE_TEST_USER_MESSAGE && (
                                    <Box className="test-user-message-banner" sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                                        <Typography variant="body1" color="text.secondary">
                                            📢 {import.meta.env.VITE_TEST_USER_MESSAGE}
                                        </Typography>
                                    </Box>
                                )}

                                {/* Total Study Time Display */}
                                <TimeDisplay totalMinutes={totalStudyTimeMinutes} />

                                {/* Streak Counter */}
                                <StreakCounter currentStreak={currentStreak} />

                                {/* Monthly Activity Calendar */}
                                <MonthlyCalendar />
                            </Box>
                        </Box>

                        {/* Right Column - Leaderboard */}
                        <Box sx={{ minWidth: 0 }}>
                            <LeaderboardPlaceholder />
                        </Box>
                    </Box>
                </Container>
            </Box>
        </LeafPage>
    );
}

export default TesterDashboardPage;
