import { useNavigate } from "react-router-dom";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { usePageTitle } from "../../hooks/usePageTitle";
import FriendsBody from "./FriendsBody";

/**
 * `/friends` — the page shell around FriendsBody: a Menu drill-in (NodePage), and where the
 * action screens' back arrows return to. The AccountSheet's Friends tab shows the same body.
 *
 * Depended on by: src/routes, docs/FRIENDS_FEATURE.md.
 */
function FriendsPage() {
    usePageTitle("Friends");
    const navigate = useNavigate();
    return (
        <NodePage title="Friends" onBack={() => navigate("/menu")} contentClassName="friends-page__content">
            <FriendsBody />
            <FooterSpacer />
        </NodePage>
    );
}

export default FriendsPage;
