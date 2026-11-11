import { useAuth } from "../../AuthContext";
import { useTestingFeatures } from "../../hooks/useTestingFeatures";
import { isFeatureEnabled } from "../../../server/contracts/featureFlags";
import type { RampHue } from "../../theme/colors";

/**
 * The Menu's destinations: every page the footer's Menu tab can open.
 *
 * This list used to be the tile list of the `/menu` bento page (MenuPage, deleted
 * 2026-11-06). The Menu tab now raises a popover of rows (MenuPopover) instead of
 * navigating, and this hook is what both halves of that list come from.
 *
 * Two groups, drawn with a hairline between them:
 *   - `main`: the learner-facing destinations, in reading order. Order is
 *     load-bearing: the first row is the one nearest the eye when the popover rises.
 *   - `gated`: authoring / QA tools that exist only for accounts holding a grant. They
 *     sit under the hairline so a tool that can rewrite authored content reads as a
 *     tool rather than as another destination, and so the main list keeps the same shape
 *     for every account.
 *
 * Every flag-gated row needs its flag (server/contracts/featureFlags.ts); for Community
 * and Arena this list is the ONLY navigational entry, so dropping the row is the whole client-side
 * entry gate (docs/FEATURE_FLAGS.md). A gated tool needs its grant (and its feature's flag,
 * if it has one). The grant says the account may use it; the flag says the feature exists.
 *
 * Hues are the destinations' existing identities (the ramp hue each wore as a bento
 * tile): one feature, one hue.
 *
 * There is no Dictionary or Lessons row: both are footer tabs, so a row would be a second
 * door to the same room. (Arena was a footer tab 2026-11-04 → 11-10; Lessons took its slot
 * and Arena came back here as a row.) There is no Compare row either: Compare is a sheet over a word
 * (docs/WORD_COMPARE_FEATURE.md).
 *
 * Docs: docs/NAVIGATION.md § Menu, docs/FEATURE_FLAGS.md, docs/FEATURE_TESTING.md.
 * LAYER: shared UI data hook (reads auth + flags; renders nothing).
 */

export interface MenuDestination {
    key: string;
    /** Route a tap navigates to. Also the prefix that marks the row current (its drill-ins). */
    route: string;
    title: string;
    /** Material Symbols name. */
    icon: string;
    hue: RampHue;
}

export interface MenuDestinations {
    main: MenuDestination[];
    gated: MenuDestination[];
}

export function useMenuDestinations(): MenuDestinations {
    const { user } = useAuth();
    const testingFeatures = useTestingFeatures();

    const main: MenuDestination[] = [
        // No Games row: the Games hub was deleted 2026-11-06 and the routed games' pages
        // are off (`standaloneGames` flag). Games are played as flp breaks in the Deck Tower.
        routeDest("reader", "/reader", "Reader", "article", "pur"),
        // `yel` is the hue Arena wore as a bento tile before it became a footer tab
        // (2026-11-04) — one feature, one hue. `emoji_events` is the icon it wore as a tab.
        ...(isFeatureEnabled("arena")
            ? [routeDest("arena", "/arena", "Arena", "emoji_events", "yel")]
            : []),
        // No Friends row: the `/friends` page was deleted 2026-11-06, and Friends lives only
        // in the AccountSheet's Friends tab (raised from the Deck Tower avatar).
        ...(isFeatureEnabled("community")
            ? [routeDest("community", "/community", "Community", "groups", "org")]
            : []),
    ];

    const gated: MenuDestination[] = [
        // Feature testers with testing features on (useTestingFeatures) AND admins
        // (users.isAdmin, migration 168). TesterDashboardPage applies the same pair as a
        // route bounce (docs/NAVIGATION.md § Tester Dashboard).
        ...(testingFeatures || user?.isAdmin
            ? [routeDest("tester-dashboard", "/tester-dashboard", "Tester Dashboard", "dashboard", "blu")]
            : []),
    ];

    return { main, gated };
}

/** Shorthand for one row. */
function routeDest(key: string, route: string, title: string, icon: string, hue: RampHue): MenuDestination {
    return { key, route, title, icon, hue };
}

/** True when `pathname` is `dest.route` or one of its drill-ins. */
export function isCurrentDestination(dest: MenuDestination, pathname: string): boolean {
    return pathname === dest.route || pathname.startsWith(`${dest.route}/`);
}
