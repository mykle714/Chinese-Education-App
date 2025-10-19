import { Box, Card, CardContent, Typography, CircularProgress } from "@mui/material";
import { useCalendarWorkPoints, type CalendarDayData } from "../hooks/useCalendarWorkPoints";

function MonthlyCalendar() {
    const { calendarData, isLoading, error } = useCalendarWorkPoints();

    // Get current date information for layout
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long' });
    const currentYear = now.getFullYear();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startingDayOfWeek = firstDayOfMonth.getDay();

    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Generate calendar display array with empty slots for proper alignment
    const generateCalendarDisplay = () => {
        if (!calendarData) return [];

        const displayArray: (CalendarDayData | null)[] = [];

        // Add empty cells for days before the first day of the month
        for (let i = 0; i < startingDayOfWeek; i++) {
            displayArray.push(null);
        }

        // Add the actual calendar data
        displayArray.push(...calendarData.days);

        return displayArray;
    };

    const calendarDisplay = generateCalendarDisplay();

    // Helper function to get day number
    const getDayNumber = (dayData: CalendarDayData): string => {
        // Parse as local date to avoid UTC timezone shifts
        // Date string format is YYYY-MM-DD, extract day directly
        const [year, month, day] = dayData.date.split('-').map(Number);
        return day.toString();
    };

    // Helper function to get points display text
    const getPointsText = (dayData: CalendarDayData): string => {
        if (!dayData.hasData) {
            // Before user started or future days - no points display
            return '';
        }

        if (dayData.streakMaintained) {
            // Green day - show points earned
            return `+${dayData.workPointsEarned}`;
        } else {
            // Red day - show penalty amount
            return `-${dayData.penaltyAmount}`;
        }
    };

    // Helper function to get status stamp emoji
    const getStatusStamp = (dayData: CalendarDayData): string => {
        if (!dayData.hasData) {
            // Before user started or future days - no stamp
            return '';
        }

        return dayData.streakMaintained ? '✅' : '❌';
    };

    // Helper function to get background color for a day (now minimal)
    const getDayBackgroundColor = (dayData: CalendarDayData): string => {
        if (!dayData.hasData) {
            // Blank days
            return 'transparent';
        }

        if (dayData.isToday) {
            // Today gets very subtle highlighting
            return 'rgba(255, 255, 255, 0.1)';
        }

        // All other days get neutral background
        return 'transparent';
    };

    if (error) {
        return (
            <Card sx={{
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                color: 'white',
                mb: 3
            }}>
                <CardContent sx={{ py: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                            📅
                        </Typography>
                        <Box>
                            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                                {currentMonth} {currentYear}
                            </Typography>
                            <Typography variant="body2" sx={{ opacity: 0.9, color: '#ffcccb' }}>
                                Error loading calendar data
                            </Typography>
                        </Box>
                    </Box>
                    <Typography variant="body2" sx={{ textAlign: 'center', opacity: 0.8 }}>
                        {error}
                    </Typography>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: 'white',
            mb: 3
        }}>
            <CardContent sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        📅
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            {currentMonth} {currentYear}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            {isLoading ? 'Loading activity data...' : 'Work points & penalties'}
                        </Typography>
                    </Box>
                </Box>

                {/* Calendar Grid */}
                <Box>
                    {/* Week day headers */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
                        {weekDays.map((day) => (
                            <Box key={day} sx={{
                                textAlign: 'center',
                                py: 0.5,
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                opacity: 0.8
                            }}>
                                {day}
                            </Box>
                        ))}
                    </Box>

                    {/* Calendar days */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
                        {isLoading ? (
                            <Box sx={{ gridColumn: 'span 7', display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} sx={{ color: 'white' }} />
                            </Box>
                        ) : (
                            calendarDisplay.map((dayData, index) => (
                                <Box key={index} sx={{
                                    height: 48, // Increased height for corner layout
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 1,
                                    backgroundColor: dayData ? getDayBackgroundColor(dayData) : 'transparent',
                                    border: dayData?.isToday
                                        ? '2px solid rgba(255, 255, 255, 0.9)'
                                        : '1px solid rgba(255, 255, 255, 0.2)', // Subtle outline for all cells
                                    minWidth: 0,
                                    color: 'white' // Consistent white text for all days
                                }}>
                                    {dayData && (
                                        <>
                                            {/* Day number in top-left corner */}
                                            <Box sx={{
                                                position: 'absolute',
                                                top: 2,
                                                left: 4,
                                                fontSize: '0.6rem',
                                                opacity: 0.8,
                                                fontWeight: dayData.isToday ? 'bold' : 'normal'
                                            }}>
                                                {getDayNumber(dayData)}
                                            </Box>

                                            {/* Status stamp emoji in center-left */}
                                            <Box sx={{
                                                position: 'absolute',
                                                left: 6,
                                                fontSize: '0.9rem',
                                                opacity: 0.9
                                            }}>
                                                {getStatusStamp(dayData)}
                                            </Box>

                                            {/* Work points prominently displayed in center-right */}
                                            <Box sx={{
                                                fontSize: '0.8rem',
                                                fontWeight: dayData.isToday ? 'bold' : 'normal',
                                                marginLeft: 'auto',
                                                marginRight: 1
                                            }}>
                                                {getPointsText(dayData)}
                                            </Box>
                                        </>
                                    )}
                                </Box>
                            ))
                        )}
                    </Box>
                </Box>

                {/* Legend */}
                {!isLoading && calendarData && (
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                                ✅
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>
                                Goal met (+points)
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontSize: '0.9rem' }}>
                                ❌
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>
                                Penalty (-points)
                            </Typography>
                        </Box>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
}

export default MonthlyCalendar;
