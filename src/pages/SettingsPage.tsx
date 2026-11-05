import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import LeafPage from '../components/LeafPage';
import { usePageTitle } from '../hooks/usePageTitle';
import SettingsBody from './settings/SettingsBody';

/**
 * Settings (`/settings`) — the page shell around SettingsBody. The AccountSheet's Settings
 * tab shows the same body.
 *
 * Depended on by: src/routes, docs/LEAF_NODE_PAGES.md.
 */
function SettingsPage() {
    usePageTitle("Settings");
    const navigate = useNavigate();
    return (
        // Settings is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN back arrow
        // (→ `/`, the Deck Tower, whose avatar raises the AccountSheet that also carries
        // Settings as a tab; this route is where /settings/account's Back lands), slides
        // up on enter / down on exit. Phone-frame sizing comes from MobileDemoFrame via
        // Layout.tsx (/settings is in MOBILE_DEMO_PATHS).
        <LeafPage title="Settings" onBack={() => navigate("/")} className="settings-page">
            <Box className="settings-page__scroll" sx={{ flex: 1, overflowY: "auto" }}>
                <SettingsBody />
                {/* Bottom clearance — a leaf page has no footer, but the last section
                    still needs air under it when the list is scrolled to the end. */}
                <Box className="settings-page__bottom-clearance" sx={{ height: 28 }} />
            </Box>
        </LeafPage>
    );
}

export default SettingsPage;
