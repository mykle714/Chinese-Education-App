import { useNavigate } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import MobileFooter from "../components/MobileFooter";

// Design tokens from Figma
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    onSurface: "#1D1B20",
    // Deck colors
    blueMain: "#779BE7",
    blueAccent: "#BAD7F2",
    greenMain: "#05C793",
    greenAccent: "#BAF2D8",
    yellowMain: "#FF8E47",
    yellowAccent: "#F2E2BA",
    redMain: "#EF476F",
    redAccent: "#F2BAC9",
};

// Styled Components
const IPhoneFrame = styled(Box)(({ theme }) => ({
    backgroundColor: COLORS.background,
    borderRadius: "20px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    maxWidth: 393,
    width: "100%",
    margin: "0 auto",
    minHeight: "852px",
    height: "100vh",
    maxHeight: "932px",
}));

const Header = styled(Box)(({ theme }) => ({
    backgroundColor: COLORS.header,
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 10,
}));

const Toolbar = styled(Box)(({ theme }) => ({
    display: "flex",
    gap: 10,
    width: "100%",
    height: 47,
    alignItems: "center",
    padding: "0 12px 0 28px",
    position: "relative",
}));

const ContentArea = styled(Box)(({ theme }) => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
}));

const BucketsContainer = styled(Box)(({ theme }) => ({
    width: 393,
    height: 504,
    position: "relative",
    flexShrink: 0,
}));

// Deck Card Component
interface DeckCardProps {
    label: string;
    mainColor: string;
    accentColor: string;
    x: number;
    y: number;
    onClick: () => void;
}

const DeckCard = styled(Box)<{ mainColor: string; accentColor: string; x: number; y: number }>(
    ({ mainColor, accentColor, x, y }) => ({
        position: "absolute",
        left: x,
        top: y,
        width: 153,
        height: 222,
        cursor: "pointer",
        transition: "transform 0.2s ease-in-out",
        "&:hover": {
            transform: "translateY(-4px)",
        },
        "& .bucket-layer-3": {
            position: "absolute",
            left: 16,
            top: 16,
            width: 137.15,
            height: 199,
            backgroundColor: mainColor,
            borderRadius: 12,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-2": {
            position: "absolute",
            left: 8,
            top: 8,
            width: 137.15,
            height: 199,
            backgroundColor: mainColor,
            borderRadius: 12,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
        },
        "& .bucket-layer-1": {
            position: "absolute",
            left: 0,
            top: 0,
            width: 137,
            height: 199,
            backgroundColor: mainColor,
            borderRadius: 12,
            boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .bucket-inner": {
            width: "calc(100% - 16px)",
            height: "calc(100% - 16px)",
            backgroundColor: accentColor,
            borderRadius: 4,
        },
        "& .bucket-text": {
            position: "absolute",
            width: 100,
            height: 55,
            left: 19,
            top: 73,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.21,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: '"Inter", sans-serif',
            zIndex: 1,
        },
    })
);

const DeckCardComponent: React.FC<DeckCardProps> = ({
    label,
    mainColor,
    accentColor,
    x,
    y,
    onClick,
}) => {
    return (
        <DeckCard
            mainColor={mainColor}
            accentColor={accentColor}
            x={x}
            y={y}
            onClick={onClick}
            className="deck-card"
        >
            <div className="bucket-layer-3" />
            <div className="bucket-layer-2" />
            <div className="bucket-layer-1">
                <div className="bucket-inner" />
                <div className="bucket-text">{label}</div>
            </div>
        </DeckCard>
    );
};

// Main Component
const DiscoverPage: React.FC = () => {
    const navigate = useNavigate();

    const handleDeckClick = (language: string) => {
        navigate(`/discover/sort/${language}`);
    };

    return (
        <Box
            className="discover-page-wrapper"
            sx={{ display: "flex", justifyContent: "center", padding: 2, minHeight: "100vh" }}
        >
            <IPhoneFrame className="discover-page-frame">
                {/* Header */}
                <Header className="discover-page-header">
                    <Toolbar className="discover-page-toolbar">
                        <Typography
                            className="discover-page-title"
                            sx={{
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                textAlign: "center",
                                lineHeight: 1.21,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            Discover
                        </Typography>
                    </Toolbar>
                </Header>

                {/* Content Area */}
                <ContentArea className="discover-page-content">
                    {/* Language Starter Packs */}
                    <BucketsContainer className="discover-buckets-container">
                        {/* Mandarin Starter Pack - Red - Top Left */}
                        <DeckCardComponent
                            label="Mandarin Starter Pack"
                            mainColor={COLORS.redMain}
                            accentColor={COLORS.redAccent}
                            x={29}
                            y={20}
                            onClick={() => handleDeckClick("zh")}
                        />

                        {/* Japanese Starter Pack - Yellow - Top Right */}
                        <DeckCardComponent
                            label="Japanese Starter Pack"
                            mainColor={COLORS.yellowMain}
                            accentColor={COLORS.yellowAccent}
                            x={211}
                            y={20}
                            onClick={() => handleDeckClick("ja")}
                        />

                        {/* Korean Starter Pack - Green - Bottom Left */}
                        <DeckCardComponent
                            label="Korean Starter Pack"
                            mainColor={COLORS.greenMain}
                            accentColor={COLORS.greenAccent}
                            x={29}
                            y={262}
                            onClick={() => handleDeckClick("ko")}
                        />

                        {/* Vietnamese Starter Pack - Blue - Bottom Right */}
                        <DeckCardComponent
                            label="Vietnamese Starter Pack"
                            mainColor={COLORS.blueMain}
                            accentColor={COLORS.blueAccent}
                            x={211}
                            y={262}
                            onClick={() => handleDeckClick("vi")}
                        />
                    </BucketsContainer>
                </ContentArea>

                {/* Footer */}
                <MobileFooter activePage="discover" />
            </IPhoneFrame>
        </Box>
    );
};

export default DiscoverPage;
