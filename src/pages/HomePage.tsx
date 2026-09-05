import MobileTabScreen from "../components/MobileTabScreen";
import { useAuth } from "../AuthContext";
import { Bento, BentoTile, type BentoTileProps } from "../components/bento";
import { FooterSpacer, ScrollPastSpacer } from "../components/MobileFooter";
import TipBox from "../components/TipBox";
import { usePageTitle } from "../hooks/usePageTitle";

// Home hub (`/`) — the landing surface for the footer's Home tab. A BENTO MOSAIC of
// the app's destinations (docs/SHELF_REDESIGN.md § A4 and entry 1), replacing the
// vertical HubMenu of equal-weight rows this page used to be.
//
// WHY A MOSAIC AND NOT A LIST: every row of the old menu was the same size, so the
// page said all eight destinations mattered equally — which is false. Night Market is
// the app's set-piece and Compare Words is a utility. The bento's three weights
// (hero / base / low) let the page say that without adding a word.
//
// Phone-frame sizing comes from MobileDemoFrame; the scroll-away header + floating
// footer come from MobileTabScreen.

/** One destination. `hue` + `icon` are the design's, taken from artboard 1. */
interface HomeTile extends Pick<BentoTileProps, "hue" | "icon" | "variant" | "pin"> {
    key: string;
    to: string;
    title: string;
    subtitle?: string;
}

function HomePage() {
    usePageTitle();
    const { user } = useAuth();

    // Order is the artboard's and is load-bearing: the mosaic reads left-to-right,
    // top-to-bottom, so moving an entry re-weights the page even though every tile
    // keeps its own variant.
    const tiles: HomeTile[] = [
        { key: "night-market", to: "/night-market", title: "Night Market", subtitle: "Explore the vocabulary night market", hue: "pur", icon: "nights_stay", variant: "hero" },
        { key: "games", to: "/games", title: "Games", subtitle: "Play vocabulary mini-games", hue: "blu", icon: "sports_esports" },
        { key: "arena", to: "/arena", title: "Arena", subtitle: "Race 24 other learners", hue: "pur", icon: "emoji_events" },
        { key: "reader", to: "/reader", title: "Reader", subtitle: "Read texts and mine new words", hue: "org", icon: "article" },
        { key: "dictionary", to: "/dictionary", title: "Dictionary", subtitle: "Look up words and add them", hue: "red", icon: "book" },
        // The three `low` tiles are the utilities. The artboard drops their subtitles:
        // at 90px tall a subtitle crowds the title, and these three are self-evident
        // from their names in a way "Night Market" is not.
        { key: "community", to: "/community", title: "Community", hue: "grn", icon: "groups", variant: "low" },
        { key: "friends", to: "/friends", title: "Friends", hue: "red", icon: "people", variant: "low" },
        // NOTE: there is no "Compare Words" tile. Compare is not a destination — it is a
        // sheet raised over the word you are already looking at, from the `Compare` pill on
        // WordToolsRail (docs/WORD_COMPARE_FEATURE.md). The tile and its /compare page were
        // deleted 2026-09-04; a cold open with two empty slots was the rarer half of the
        // feature and cost a hub slot to reach.

        // ── Role-gated tiles ──────────────────────────────────────────────────────
        // Not drawn in the artboard. They APPEND as further `low` tiles, which is why
        // the mosaic must never assume a fixed tile count: with one of them present the
        // grid ends on an odd tile and the last row is half empty. That is correct and
        // deliberate — the alternative (stretching the orphan to full width) would give
        // a developer tool the same weight as Night Market.
        ...(user?.isValidator
            ? [{ key: "tester-dashboard", to: "/tester-dashboard", title: "Tester Dashboard", hue: "blu", icon: "dashboard", variant: "low" } as HomeTile]
            : []),
        // All three ride the SAME grant (users.isTemplateAuthor, migration 115) — the two
        // night-market tools and the immersive-world scene editor are one authoring
        // permission, not three (docs/IMMERSIVE_WORLD.md § 12 phase 1e). The scene editor
        // wears `tea` rather than the night market's `pur` because it authors a different
        // feature; sharing a hue would imply it edits night-market templates.
        ...(user?.isTemplateAuthor
            ? [
                  { key: "template-editor", to: "/night-market/template-editor", title: "Template Editor", hue: "pur", icon: "grid_view", variant: "low" } as HomeTile,
                  { key: "template-sandbox", to: "/night-market/template-sandbox", title: "Template Sandbox", hue: "pur", icon: "dashboard_customize", variant: "low" } as HomeTile,
                  { key: "scene-editor", to: "/immersive-world/scene-editor", title: "Scene Editor", hue: "tea", icon: "theater_comedy", variant: "low" } as HomeTile,
              ]
            : []),
    ];

    return (
        <MobileTabScreen title="Home" contentClassName="home-page__content">
            <Bento className="home-page__bento">
                {tiles.map(({ key, ...tile }) => (
                    <BentoTile
                        key={key}
                        className={`home-page__tile home-page__tile--${key}`}
                        {...tile}
                    />
                ))}
            </Bento>
            <TipBox className="home-page__tip-box" />
            <FooterSpacer />
            <ScrollPastSpacer />
        </MobileTabScreen>
    );
}

export default HomePage;
