import { Box } from "@mui/material";
import MobileTabScreen from "../components/MobileTabScreen";
import { useAuth } from "../AuthContext";
import { Bento, BentoTile, type BentoTileProps } from "../components/bento";
import { FooterSpacer, ScrollPastSpacer } from "../components/MobileFooter";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";
import { isFeatureEnabled } from "../../server/contracts/featureFlags";
import { COLORS } from "../theme/colors";

// Menu (`/menu`) — the footer's second tab. A BENTO MOSAIC of the app's destinations
// (docs/SHELF_REDESIGN.md § A4 and entry 1), replacing the vertical HubMenu of
// equal-weight rows this page used to be.
//
// This page WAS Home (`/`) until 2026-10-10, when Home and Menu swapped contents: Home
// is now the decks page (the fdp), and this bento moved here. The account header —
// Settings gear, profile picture, daily banking run — stayed with the Home tab and
// lives in src/pages/HomePage.tsx, so this header is just the title and the flame.
//
// WHY A MOSAIC AND NOT A LIST: every row of the old menu was the same size, so the
// page said all eight destinations mattered equally — which is false. Night Market is
// the app's set-piece and Compare Words is a utility. The bento's three weights
// (hero / base / low) let the page say that without adding a word.
//
// Phone-frame sizing comes from MobileDemoFrame; the scroll-away header + floating
// footer come from MobileTabScreen.

/** One destination. `hue` + `icon` are the design's, taken from artboard 1. */
interface MenuTile extends Pick<BentoTileProps, "hue" | "icon" | "variant" | "pin"> {
    key: string;
    to: string;
    title: string;
    subtitle?: string;
}

function MenuPage() {
    usePageTitle("Menu");
    const { user } = useAuth();

    // HUES: one tile per ramp hue — the six live main tiles (Games, Arena, Immersive
    // World, Reader, Friends, Community) wear the six tile hues (blu, yel, red, pur, grn,
    // org) exactly once, so no two destinations read as the same feature. The warm hues
    // (yel / red / org) are CHECKERBOARDED on the 2-column grid so no two share an edge:
    //     Games  blu | Arena   yel
    //     IW     red | Reader  pur
    //     Friends grn| Comm.   org
    // Reordering tiles or flipping a flag (Arena, Immersive World) shifts the grid and
    // can put two warm tiles side by side — re-check the pattern. Night Market
    // (flagged off) keeps `pur` and would share it with Reader if re-enabled — there
    // are only six tile hues (grey is the neutral, gld the action colour).
    // Order is the artboard's and is load-bearing: the mosaic reads left-to-right,
    // top-to-bottom, so moving an entry re-weights the page even though every tile
    // keeps its own variant.
    const tiles: MenuTile[] = [
        // Night Market is flagged (server/contracts/featureFlags.ts). This is the hub's
        // only HERO tile, so with the flag off the mosaic opens on Games at base weight
        // rather than promoting a replacement — the bento reads fine without a hero, and
        // choosing a stand-in would re-weight the page for a temporary state.
        ...(isFeatureEnabled("nightMarket")
            ? [{ key: "night-market", to: "/night-market", title: "Night Market", subtitle: "Explore the vocabulary night market", hue: "pur", icon: "nights_stay", variant: "hero" } as MenuTile]
            : []),
        { key: "games", to: "/games", title: "Games", subtitle: "Play vocabulary mini-games", hue: "blu", icon: "sports_esports" },
        // Arena is flagged (server/contracts/featureFlags.ts). This tile is its ONLY
        // navigational entry — nothing in the footer, no row on /friends — so dropping
        // it is the whole client-side entry gate; the route goes in routeMeta.ts.
        ...(isFeatureEnabled("arena")
            ? [{ key: "arena", to: "/arena", title: "Arena", subtitle: "Race 24 other learners", hue: "yel", icon: "emoji_events" } as MenuTile]
            : []),
        // Its own destination rather than a Games tile (docs/IMMERSIVE_WORLD.md § 14 Q9): iw
        // is once per day, earns no marks and is capped by design, so it behaves unlike
        // everything on the Games shelf, where a tile is an activity you can do as much as
        // you like. `red` matches the Scene Editor tile below — one feature, one hue. (It was
        // `tea` until teal left the palette on 2026-09-24, then `blu` until 2026-10-10.)
        ...(isFeatureEnabled("immersiveWorld")
            ? [{ key: "immersive-world", to: "/immersive-world", title: "Immersive World", subtitle: "Walk in and talk to somebody", hue: "red", icon: "theater_comedy" } as MenuTile]
            : []),
        { key: "reader", to: "/reader", title: "Reader", subtitle: "Read texts and mine new words", hue: "pur", icon: "article" },
        // No Dictionary tile: Dictionary is a footer tab (it took Account's slot on
        // 2026-10-09), so a hub tile would be a second door to the same room.
        // The `low` tiles are the utilities. The artboard drops their subtitles:
        // at 90px tall a subtitle crowds the title, and these are self-evident
        // from their names in a way "Night Market" is not.
        // Community is flagged off-able (server/contracts/featureFlags.ts). This tile is
        // the ONLY navigational entry to /community, so dropping it is the whole
        // client-side entry gate; the route itself is removed in routeMeta.ts.
        // Friends sits BEFORE Community so the warm `org` lands bottom-right, off
        // Immersive World's edge (see the HUES note above).
        { key: "friends", to: "/friends", title: "Friends", hue: "grn", icon: "people", variant: "low" },
        ...(isFeatureEnabled("community")
            ? [{ key: "community", to: "/community", title: "Community", hue: "org", icon: "groups", variant: "low" } as MenuTile]
            : []),
        // NOTE: there is no "Compare Words" tile. Compare is not a destination — it is a
        // sheet raised over the word you are already looking at, from the `Compare` pill on
        // WordToolsRail (docs/WORD_COMPARE_FEATURE.md). The tile and its /compare page were
        // deleted 2026-09-04; a cold open with two empty slots was the rarer half of the
        // feature and cost a hub slot to reach.
    ];

    // ── Role-gated tiles ──────────────────────────────────────────────────────
    // Not drawn in the artboard: these are authoring/QA tools that exist only for
    // accounts carrying a grant, so they live BELOW A HAIRLINE in their own grid
    // rather than appended to the mosaic. Two reasons the separator is worth a row
    // of pixels: the main mosaic keeps a stable shape for every account (a gated
    // tile no longer leaves the last artboard row half empty), and a tool that can
    // rewrite authored content reads as a tool rather than as another destination.
    const gatedTiles: MenuTile[] = [
        // Feature testers (users.isFeatureTester, migration 178) AND admins
        // (users.isAdmin, migration 168 — the tdp's User Usage
        // section) reach the tester dashboard; the page applies the same pair.
        ...(user?.isFeatureTester || user?.isAdmin
            ? [{ key: "tester-dashboard", to: "/tester-dashboard", title: "Tester Dashboard", hue: "blu", icon: "dashboard", variant: "low" } as MenuTile]
            : []),
        // All three ride the SAME grant (users.isTemplateAuthor, migration 115) — the two
        // night-market tools and the immersive-world scene editor are one authoring
        // permission, not three (docs/IMMERSIVE_WORLD.md § 12 phase 1e). The scene editor
        // wears `red` (Immersive World's hue) rather than the night market's `pur` because it
        // authors a different feature; sharing a hue would imply it edits night-market
        // templates.
        // Each tool needs BOTH the grant and its feature's flag: the grant says the
        // account may author, the flag says the feature exists to be authored for. The
        // three no longer rise or fall together — with one flag off the other tools stay,
        // and the hairline section disappears only when nothing is left under it.
        ...(user?.isTemplateAuthor && isFeatureEnabled("nightMarket")
            ? [
                  { key: "template-editor", to: "/night-market/template-editor", title: "Template Editor", hue: "pur", icon: "grid_view", variant: "low" } as MenuTile,
                  { key: "template-sandbox", to: "/night-market/template-sandbox", title: "Template Sandbox", hue: "pur", icon: "dashboard_customize", variant: "low" } as MenuTile,
              ]
            : []),
        ...(user?.isTemplateAuthor && isFeatureEnabled("immersiveWorld")
            ? [{ key: "scene-editor", to: "/immersive-world/scene-editor", title: "Scene Editor", hue: "red", icon: "theater_comedy", variant: "low" } as MenuTile]
            : []),
    ];

    return (
        <MobileTabScreen title="Menu" contentClassName="menu-page__content">
            <Bento className="menu-page__bento">
                {tiles.map(({ key, ...tile }) => (
                    <BentoTile
                        key={key}
                        className={`menu-page__tile menu-page__tile--${key}`}
                        {...tile}
                    />
                ))}
            </Bento>
            {/* The separator and the second grid appear together or not at all — an
                account with no grants must not see a rule with nothing under it. */}
            {gatedTiles.length > 0 && (
                <>
                    <Box
                        className="menu-page__gated-divider"
                        // `flexShrink: 0` is load-bearing, not defensive: MobileTabScreen's
                        // content column is a flex column, so a 1px child collapses to
                        // nothing the moment the column is squeezed to fit the viewport.
                        sx={{ height: "1px", flexShrink: 0, backgroundColor: COLORS.border, margin: "20px 16px 0" }}
                    />
                    <Bento className="menu-page__bento menu-page__bento--gated">
                        {gatedTiles.map(({ key, ...tile }) => (
                            <BentoTile
                                key={key}
                                className={`menu-page__tile menu-page__tile--${key}`}
                                {...tile}
                            />
                        ))}
                    </Bento>
                </>
            )}
            <TipBox className="menu-page__tip-box" />
            <FooterSpacer />
            <ScrollPastSpacer />
        </MobileTabScreen>
    );
}

export default MenuPage;
