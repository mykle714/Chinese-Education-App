import { Box, Card, CardContent, Typography } from "@mui/material";
import { WEIGHT } from '../theme/scale';
import { convertMinutesToTimeFormat, formatTimeBreakdown } from "../utils/timeUtils";

interface TimeDisplayProps {
    /** NET balance (penalty-debited, users.totalMinutePoints) — the BIG converted-time number. Can drop when penalized. */
    netMinutes: number;
    /** GROSS lifetime minutes earned (Σ minutesEarned, ignoring penalties) — the small caption. Only grows; ≥ netMinutes. */
    grossMinutes: number;
}

function TimeDisplay({ netMinutes, grossMinutes }: TimeDisplayProps) {
    const timeBreakdown = convertMinutesToTimeFormat(netMinutes);
    const formattedTime = formatTimeBreakdown(timeBreakdown);

    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #4facfe, #00f2fe)',
            color: 'white',
            mb: 3
        }}>
            <CardContent sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        ⏰
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: WEIGHT.bold, mb: 0.5 }}>
                            Current Balance
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            Minutes available now (after any penalties)
                        </Typography>
                    </Box>
                </Box>

                <Typography variant="h5" sx={{
                    fontWeight: WEIGHT.bold,
                    textAlign: 'center',
                    mb: 1,
                    textShadow: '0 1px 2px rgba(0,0,0,0.1)'
                }}>
                    {formattedTime}
                </Typography>

                <Typography variant="body2" sx={{
                    textAlign: 'center',
                    opacity: 0.8
                }}>
                    {grossMinutes} total minutes earned
                </Typography>
            </CardContent>
        </Card>
    );
}

export default TimeDisplay;
