import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../AuthContext";
import { FOCUS_ENDED_EVENT } from "../../api/http";
import { acknowledgeFocusNotices, fetchFocusStatus } from "../../api/focusMode";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import FocusDialog from "./FocusDialog";

/**
 * FocusEndedNoticeHost — shows the "focus mode is off" popup on whatever page is up when
 * the server switches a world's focus off by itself (docs/FOCUS_MODE.md § 4).
 *
 * Mounted once, app-wide (src/App.tsx). It checks `GET /api/focus` for owed notices:
 *   - once when the learner is signed in (a notice owed from a request no page was
 *     watching — Home's background flp preload — or from a closed session);
 *   - whenever src/api/http.ts raises FOCUS_ENDED_EVENT, i.e. a response just carried
 *     the X-Focus-Ended header.
 * Dismissing the popup acknowledges the notices, so each shows once.
 *
 * Layer: feature component (features/focusMode). Draws nothing until a notice is owed.
 */
const FocusEndedNoticeHost: React.FC = () => {
    const { isAuthenticated } = useAuth();
    const [worlds, setWorlds] = useState<MasteryWorldId[] | null>(null);

    const check = useCallback(async () => {
        try {
            const status = await fetchFocusStatus();
            if (status.endedNotices.length > 0) setWorlds(status.endedNotices);
        } catch (err) {
            // Best-effort: a missed notice is re-offered on the next check.
            console.error("Focus notice check failed:", err);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        void check();
        const onEnded = () => void check();
        window.addEventListener(FOCUS_ENDED_EVENT, onEnded);
        return () => window.removeEventListener(FOCUS_ENDED_EVENT, onEnded);
    // isAuthenticated, not the token: CLAUDE.md "Never reload on token refresh".
    }, [isAuthenticated, check]);

    const dismiss = () => {
        const shown = worlds ?? [];
        setWorlds(null);
        acknowledgeFocusNotices(shown).catch((err) => console.error("Focus notice ack failed:", err));
    };

    return <FocusDialog content={worlds ? { kind: "ended", worlds } : null} onClose={dismiss} />;
};

export default FocusEndedNoticeHost;
