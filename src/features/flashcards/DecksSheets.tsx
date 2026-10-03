import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import SheetPanel, { type SheetPanelBodyHandle, type SheetPanelHandle } from "../../components/sheet/SheetPanel";
import SheetPill from "../../components/SheetPill";
import { FOOTER_TOTAL_CLEARANCE } from "../../components/MobileFooter";
import DecksPanelBody from "./DecksPanelBody";
import NewDeckDialog from "./NewDeckDialog";
import type { DecksPanelState } from "./useDecksPanel";
import type { DecksSheetsSnapshot } from "./backRestore";
import type { VocabEntry } from "../../types";

// ── What this file is ─────────────────────────────────────────────────────────
//
// The decks panel's FRONT layer, as one piece: the two side-by-side pills ("Cards",
// "Decks") floating one footer-clearance above the bar, the modal pull-up sheet each
// raises (`SheetPanel` around `DecksPanelBody`), and the New-deck dialog the Decks
// sheet's add spine opens.
//
// Three pages mount it, through three lenses (docs/DECKS_FEATURE.md § "Mastery
// Centers", docs/READING_WRITING_CENTERS.md):
//   fdp (/flashcards/decks)   — core lens, titles "Cards" / "Decks";
//   Reading Center            — reading lens, "Reading Cards" / "Reading Decks";
//   Writing Center            — writing lens, "Writing Cards" / "Writing Decks".
// It was extracted from FlashcardsDecksPage when the Centers stopped rendering the
// panel inline as a page and adopted the fdp's sheets — copying ~90 lines of sheet
// wiring into a second page would have let the two drift.
//
// ── The two pills ─────────────────────────────────────────────────────────────
// The sheets' only entry points, and the direct counterpart of the flp's More Info
// pill: capsules floating over the bottom of the page, under the sheet's own scrim
// (zIndex 2 vs the scrim's 10) so they dim and go inert while a sheet is up.
//
// There are TWO because there are two sheets, each named after the one errand it
// serves ("where is that word?" vs "which set do I open?"). They are laid out by
// `SheetPill`'s `align` — each offset half a gap off the frame's midline, so the PAIR
// is centred whatever the labels measure.
//
// They are offset by the FULL footer clearance rather than by FOOTER_HEIGHT, so they
// clear the floating pill bar with the same gap every other page's last row gets.
//
// ── Hosting contract ──────────────────────────────────────────────────────────
// The host must render this inside a POSITIONED box that fills the frame: SheetPanel
// is `absolute; bottom: 0` and sizes its max height from that box's clientHeight, and
// the pills are absolutely placed in it too. The host's own scroll area must reserve
// `DECKS_SHEET_PILL_BAND` at its foot so its last row is not hidden behind the pills.
//
// Layer: feature component (src/features/flashcards). Data comes in as `panel`
// (`useDecksPanel`); this file owns only which sheet is open and the sheet plumbing.

/** Pill height in px. */
export const DECKS_SHEET_PILL_HEIGHT = 34;

/** Breathing room between a host's last row and the pills. */
const PILL_GAP = 12;

/**
 * The band a host's scroll content must leave free above the footer clearance so its
 * last row clears the pills. Derived rather than typed, or a taller pill would silently
 * overlap the row above it.
 */
export const DECKS_SHEET_PILL_BAND = DECKS_SHEET_PILL_HEIGHT + PILL_GAP;

export type DecksSheetId = "cards" | "decks";

/** Read by the host at the moment of leaving, for its Back-restore snapshot. */
export interface DecksSheetsHandle {
    capture: () => DecksSheetsSnapshot;
}

export interface DecksSheetsProps {
    /** The whole decks-panel state for the host's lens (`useDecksPanel`). */
    panel: DecksPanelState;
    /** BEM block for the pills and dialog, e.g. "flashcards-decks", "mastery-center". */
    classPrefix: string;
    /**
     * Each sheet's name — the pill label AND the sheet's merge-header title, so a sheet
     * pulled to full height still says which of the two it is.
     */
    titles: Record<DecksSheetId, string>;
    /** The pill labels, when shorter than the sheet titles. Defaults to `titles`. */
    pillLabels?: Record<DecksSheetId, string>;
    /** A Back restore: reopen this sheet at this height and scroll. Read once. */
    restore?: DecksSheetsSnapshot | null;
    onOpenPath: (path: string) => void;
    onOpenCard: (entry: VocabEntry) => void;
}

const DecksSheets = forwardRef<DecksSheetsHandle, DecksSheetsProps>(function DecksSheets({
    panel,
    classPrefix,
    titles,
    pillLabels = titles,
    restore,
    onOpenPath,
    onOpenCard,
}, ref) {
    // `restoreRef` is dropped when the restored sheet closes, so reopening it later in
    // the same visit opens it fresh rather than re-applying a stale height and scroll.
    const restoreRef = useRef<DecksSheetsSnapshot | null>(restore ?? null);
    // WHICH sheet is up, or null for neither. One state rather than two booleans: the
    // sheets are modal and mutually exclusive, and two flags could describe a state
    // (both open) that has no rendering. The panel is mounted ONLY while a section is
    // named, so each open replays SheetPanel's 0 → default animation.
    const [openSheet, setOpenSheet] = useState<DecksSheetId | null>(() => restore?.openSheet ?? null);
    const [newDeckOpen, setNewDeckOpen] = useState(false);
    // Body of the open sheet; SheetPanel reads {root, scroll} off this handle to wire
    // its resize/scroll coupling.
    const sheetBodyRef = useRef<SheetPanelBodyHandle | null>(null);
    // The sheet itself — read only for its live height when the learner leaves.
    const sheetPanelRef = useRef<SheetPanelHandle | null>(null);

    useImperativeHandle(ref, () => ({
        capture: () => ({
            openSheet,
            sheetHeight: sheetPanelRef.current?.getCurrentHeight() ?? null,
            scrollTop: sheetBodyRef.current?.scroll?.scrollTop ?? 0,
        }),
    }), [openSheet]);

    const restoring = (id: DecksSheetId) => restoreRef.current?.openSheet === id;

    return (
        <>
            {/* Left is Cards, right is Decks — a card is the unit, a deck the container. */}
            <SheetPill
                className={`${classPrefix}__cards-pill`}
                label={pillLabels.cards}
                align="left"
                onClick={() => setOpenSheet("cards")}
                ariaLabel="Open your cards"
                ariaExpanded={openSheet === "cards"}
                bottom={FOOTER_TOTAL_CLEARANCE}
                height={DECKS_SHEET_PILL_HEIGHT}
            />
            <SheetPill
                className={`${classPrefix}__decks-pill`}
                label={pillLabels.decks}
                align="right"
                onClick={() => setOpenSheet("decks")}
                ariaLabel="Open your decks"
                ariaExpanded={openSheet === "decks"}
                bottom={FOOTER_TOTAL_CLEARANCE}
                height={DECKS_SHEET_PILL_HEIGHT}
            />

            {/* MODAL, with the eip's stops and scrim: mounted only while open, dismissed
                by a downward drag or a scrim tap. Keyed on the section so switching
                sheets remounts rather than swapping content under a held height. */}
            {openSheet && (
                <SheetPanel
                    key={openSheet}
                    ref={sheetPanelRef}
                    restoreHeight={restoring(openSheet) ? restoreRef.current?.sheetHeight ?? null : null}
                    onClose={() => {
                        restoreRef.current = null;
                        setOpenSheet(null);
                    }}
                    bodyRef={sheetBodyRef}
                    // The body's scroll element identity changes when the deck list first
                    // arrives, so re-bind once decks have loaded. The section is in the key
                    // too: the two bodies are different elements.
                    bodyKey={`${openSheet}-${panel.decksLoading ? "loading" : "ready"}`}
                    title={titles[openSheet]}
                >
                    {({ bindHeaderDrag }) => (
                        <DecksPanelBody
                            ref={sheetBodyRef}
                            panel={panel}
                            variant="sheet"
                            section={openSheet}
                            onOpenPath={onOpenPath}
                            onOpenCard={onOpenCard}
                            initialScrollTop={restoring(openSheet) ? restoreRef.current?.scrollTop : undefined}
                            onNewDeck={() => setNewDeckOpen(true)}
                            headerDragBind={bindHeaderDrag}
                        />
                    )}
                </SheetPanel>
            )}

            <NewDeckDialog
                classPrefix={classPrefix}
                open={newDeckOpen}
                onClose={() => setNewDeckOpen(false)}
                onCreate={panel.addDeck}
            />
        </>
    );
});

export default DecksSheets;
