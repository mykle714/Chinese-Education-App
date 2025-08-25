import { Box, Container, Typography } from "@mui/material";
import Message from "../Message";

function HomePage() {
    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                Vocabulary Entry Manager
            </Typography>

            <Message />

            <Box sx={{ mb: 4 }}>
                <Typography variant="body1" paragraph>
                    Welcome to the Vocabulary Entry Manager! This application helps non-mandarin speakers learn mandarin by providing tools and games to engage users.
                </Typography>
                <Typography variant="body1" paragraph>
                    Use the navigation to explore vocabulary entries, add new entries, or view your profile.
                </Typography>
            </Box>
        </Container>
    );
}

export default HomePage;
