import { type ReactNode } from "react";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import MobileDemoHeader from "../../components/MobileDemoHeader";
import MobileFooter from "../../components/MobileFooter";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { GameDef } from "../types";

const ContentArea = styled(Box)(() => ({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}));

export interface GamePageProps {
    /** Registry entry for the game being rendered (used for title + back-nav). */
    game: GameDef;
    /** Optional override for the back button target; defaults to "/games". */
    backTo?: string;
    /** Optional buttons placed in the header's extraActions slot. */
    headerActions?: ReactNode;
    /** Game body — typically a `<GameStage>` driving Pixi. */
    children: ReactNode;
}

/**
 * Page shell every registered game renders inside.
 *
 * Composition: `MobileDemoHeader` (provides hamburger + back) → `ContentArea`
 * (game body, usually `GameStage`) → `MobileFooter` (keeps the Games tab
 * highlighted while the user is inside a game).
 *
 * Games should NOT render their own header/footer or wrap themselves in a
 * `MobileDemoFrame` — that's done once by `Layout.tsx` for every route listed
 * in `MOBILE_DEMO_PATHS`.
 */
const GamePage: React.FC<GamePageProps> = ({ game, backTo = "/games", headerActions, children }) => {
    const navigate = useNavigate();
    usePageTitle(game.title);

    return (
        <>
            <MobileDemoHeader
                title={game.title}
                showBack
                onBack={() => navigate(backTo)}
                extraActions={headerActions}
            />
            <ContentArea className={`game-page__content game-page--${game.gameId}`}>
                {children}
            </ContentArea>
            <MobileFooter activePage="games" />
        </>
    );
};

export default GamePage;
