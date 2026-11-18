import { Bento, BentoTile, toggleTileSx } from "../../components/bento";
import type { RampHue } from "../../theme/colors";
import type { TextKind } from "../../../server/contracts/wire";
import type { ReaderCollection } from "./readerListOrder";

/**
 * The `/reader` page's collection SELECTOR — two `compact` Bento tiles in halves, the
 * Friends tab's action-tile shape (FriendActionTiles):
 *
 *   Documents (purple)   ┐ plain SWITCH buttons: pressing one shows that collection
 *   Journal (yellow)     ┘ (Documents by default). Neither tile shows a selected state —
 *                          both always rest at their MID fill (owner, 2026-11-17: "just
 *                          switch on press", not the Friends tiles' two-state look). They
 *                          keep the shared press feel only (toggleTileSx with
 *                          `dimmed = false`: sink to 0.76, spring back).
 *
 * The page's actions (New document, sort, grid/list) live in the toolbar below it
 * (ReaderListToolbar). (History: on 2026-11-17 New document briefly sat in this row as a
 * third tile; it moved into the toolbar the same day.)
 *
 * The host (ReaderPage) owns the selection and the body's slide; this file only draws.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections (Documents / Journal)".
 * Layer: feature view (src/features/reader). Rendered by: ReaderPage.tsx.
 */

interface CollectionTile {
    kind: TextKind;
    title: string;
    hue: RampHue;
    icon: string;
}

const COLLECTION_TILES: CollectionTile[] = [
    { kind: "document", title: "Documents", hue: "pur", icon: "description" },
    // Yellow by owner's call (2026-11-17).
    { kind: "journal", title: "Journal", hue: "yel", icon: "auto_stories" },
];

interface ReaderCollectionTilesProps {
    collection: ReaderCollection;
    /** Select a collection tile (a no-op for the selected one — the host decides). */
    onSelect: (kind: TextKind) => void;
}

function ReaderCollectionTiles({ collection, onSelect }: ReaderCollectionTilesProps) {
    return (
        <Bento className="reader-page__collection-tiles">
            {COLLECTION_TILES.map((tile) => {
                return (
                    <BentoTile
                        key={tile.kind}
                        // `--current` is a hook for tests/styling only; it draws nothing.
                        className={`reader-page__collection-tile reader-page__collection-tile--${tile.kind}${collection === tile.kind ? " reader-page__collection-tile--current" : ""}`}
                        title={tile.title}
                        hue={tile.hue}
                        icon={tile.icon}
                        variant="compact"
                        onClick={() => onSelect(tile.kind)}
                        sx={toggleTileSx(false, tile.hue)}
                    />
                );
            })}
        </Bento>
    );
}

export default ReaderCollectionTiles;
