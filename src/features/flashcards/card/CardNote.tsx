import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
import { SIZE, WEIGHT, LEADING } from "../../../theme/scale";
import { FC_FONT } from "../constants";
import { CARD_NOTE_MAX_LENGTH } from "../../../types";
import type { VocabEntry } from "../types";

/**
 * Right-hand berth reserved for the `•••` card-ops dot (`CardOpsRail`: `top/right: 11`,
 * a 30px puck). The note strip stops here so the two never overlap — this is the "spans
 * the area to the left of the triple dot menu" rule, as one number.
 */
const CARD_OPS_DOT_GUTTER = 49;

/**
 * `CardNote` — the learner's own note about ONE card (vet.note, migration 155), pinned to
 * the TOP EDGE of the card's answer face, in the band left of the `•••` card-ops dot.
 *
 * ── Why it lives on the answer face only ──────────────────────────────────────
 * A note is the learner's private commentary on the ANSWER ("my landlord says this one",
 * "not the 借 one"). On the question face it would be a hint they never asked for, and on a
 * recognition prompt it could give the answer away outright. The caller decides — this
 * component is mounted from `CardFace`'s side 2 and nowhere else — but the rule is the
 * reason the component exists as a slot rather than as part of the text blocks.
 *
 * ── Why the top EDGE and not a text block ─────────────────────────────────────
 * The two text blocks (foreign / english) are MOVABLE — the fie can drag, scale and rotate
 * them anywhere on the card (docs/CARD_ICON_LAYOUT.md). The note is deliberately NOT part
 * of that system: it is chrome, not card design, so it keeps a fixed berth along one edge
 * where it can never be dragged over the word it annotates. It renders in `CardFaceSide`'s
 * outer box (like `topRail`) so it paints above the icon layer.
 *
 * It sits along the TOP edge rather than the bottom because the card's own content grows
 * DOWNWARD: the english block (and its definition, which can run several lines) is
 * centred-to-low on the face, so a bottom strip collided with a long definition exactly
 * when the note was also long — the two things most worth reading landed on top of each
 * other. The top band is the one strip of the face nothing else claims. It stops short of
 * the `•••` (`CARD_OPS_DOT_GUTTER`) so the note and the card-ops dot share the edge instead
 * of overlapping.
 *
 * ── Read mode is INERT ────────────────────────────────────────────────────────
 * The displayed note is `pointerEvents: none`. It is a label sitting on the card, not a
 * control on it, so it is not a hit target at all: a tap that lands on the note flips the
 * card, and a swipe that starts on it marks the card, exactly as if the note were not
 * there. The learner never has to aim around their own note.
 *
 * ── Edit mode is the exception ────────────────────────────────────────────────
 * Editing is INLINE (no dialog): the same strip becomes a textarea in place — keeping the
 * leading sticky-note icon so it reads as the same element gaining a caret — and the learner
 * sees the note in its real position, at its real width, while typing it. That, and only
 * that, puts an interactive surface on top of the card's flip/drag target — which costs
 * two guards, both of them scoped to the open editor:
 *
 *   • every pointer/mouse/touch/click event on the EDITOR is stopped here, so a press
 *     aimed at the textarea or its buttons is never read as a flip or a swipe-to-mark;
 *   • the host ALSO detaches the card's drag handlers while `editing` (flp: `noteEditing`),
 *     which covers the gestures that begin on the editor and travel off it.
 *
 * The editor closes on its own ✓ / ✕ rather than on an outside tap, for the same reason
 * `CardOpsRail` does: an outside tap on this surface is a flip or a mark, and spending it
 * on dismissing an editor would either eat the gesture or mark the card by accident.
 *
 * The character cap is `CARD_NOTE_MAX_LENGTH`, shared with the server (server/contracts/wire.ts)
 * so the counter here and the truncation in `VocabEntryService.updateNote` are one number.
 *
 * Referenced by docs/CARD_NOTES.md.
 */

export interface CardNoteProps {
    entry: VocabEntry;
    /** True while this card's note is being edited in place (host-owned state). */
    editing?: boolean;
    /**
     * Commit the edited note. `null` means "no note" (the learner cleared it). The host
     * persists it (optimistically) and closes the editor.
     */
    onSave?: (note: string | null) => void;
    /** Abandon the edit, leaving the stored note untouched. */
    onCancel?: () => void;
    className?: string;
}

export const CardNote: React.FC<CardNoteProps> = ({ entry, editing = false, onSave, onCancel, className }) => {
    const stored = entry.note ?? "";
    // Draft lives here, not in the host: the host only needs the committed value, and
    // keeping keystrokes local avoids re-rendering the whole card slot on every character.
    const [draft, setDraft] = useState(stored);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    // (Re-)seed the draft whenever an edit session OPENS, or the underlying card changes
    // mid-edit (card swapped out from under an open editor). Keyed on the entry id as well
    // as `editing` so a promoted card never inherits the previous card's draft.
    useEffect(() => {
        if (!editing) return;
        setDraft(entry.note ?? "");
        // Focus at the end of the existing text so an edit continues rather than overwrites.
        const el = inputRef.current;
        if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, [editing, entry.id, entry.note]);

    // EDIT MODE ONLY. The open editor sits ON the flip/drag target, so every press inside
    // it has to be stopped from reaching the card's handlers or the gesture is read as a
    // flip or a swipe-mark. Read mode wants the opposite and is `pointerEvents: none`.
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    // Nothing stored and not editing → render nothing at all. An empty strip would eat
    // card space and read as a broken element on the great majority of cards that have
    // no note.
    if (!editing && !stored) return null;

    if (!editing) {
        return (
            <Box
                className={className ? `card-note ${className}` : "card-note"}
                sx={{
                    position: "absolute",
                    left: 10,
                    // Stops short of the `•••`; the note owns the rest of the top edge.
                    right: CARD_OPS_DOT_GUTTER,
                    top: 10,
                    zIndex: 2,
                    // COMPLETELY INERT in read mode. The note is a label, not a control:
                    // every gesture that starts on it — a tap to flip, a swipe to mark —
                    // must reach the card underneath and be handled as if the note were not
                    // there. `pointerEvents: none` takes the strip out of hit-testing
                    // entirely, so the press lands on the card face itself. That is
                    // stronger than letting the event bubble: bubbling still makes the
                    // strip the gesture's TARGET, which is what a long-press/text-selection
                    // or a stray `user-select` on the paragraph would act on.
                    //
                    // Consequence to keep in mind: the note cannot open its own editor by
                    // being tapped. Editing is entered from the card rail's `note` cell,
                    // which is the only affordance — see CardOpsRail.
                    pointerEvents: "none",
                    borderRadius: "10px",
                    // Translucent rather than opaque: the note sits over the card's icon
                    // arrangement, and an opaque panel punches a hole in the design.
                    backgroundColor: "rgba(255,255,255,0.78)",
                    padding: "7px 10px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "6px",
                }}
            >
                <Icon name="sticky_note_2" size={14} color={COLORS.textSecondary} />
                <Box
                    component="p"
                    className="card-note__text"
                    sx={{
                        margin: 0,
                        fontFamily: FC_FONT,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.regular,
                        lineHeight: LEADING.normal,
                        color: COLORS.onSurface,
                        // A note can run to CARD_NOTE_MAX_LENGTH, which is taller than the
                        // berth reserved here. Clamp to three lines rather than growing the
                        // strip down over the word and its definition — the full text is
                        // always reachable by opening the editor.
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        wordBreak: "break-word",
                    }}
                >
                    {stored}
                </Box>
            </Box>
        );
    }

    const remaining = CARD_NOTE_MAX_LENGTH - draft.length;
    const commit = () => {
        const trimmed = draft.trim();
        // Blank collapses to null — "no note" has ONE representation, matching the server's
        // normalization, so a cleared note removes the strip rather than leaving an empty one.
        onSave?.(trimmed === "" ? null : trimmed);
    };

    // ENTER COMMITS. On a phone the only obvious "I'm done" affordance is the keyboard's own
    // confirm key, so it saves rather than inserting a newline — `enterKeyHint="done"` below
    // labels it accordingly. A note is a one-line aside, not prose, so giving up the newline
    // costs nothing; Shift+Enter still inserts one for the desktop learner who wants two lines.
    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
        }
    };

    // Same rule, second door. Android IMEs frequently report composing keystrokes as
    // `keyCode 229`/`key "Unidentified"`, so the keydown above never sees the Enter — but the
    // resulting input event is still typed `insertLineBreak`. Catching it here is what makes
    // the confirm key work on those keyboards.
    const onBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
        const inputType = (e.nativeEvent as InputEvent).inputType;
        if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
            e.preventDefault();
            commit();
        }
    };

    return (
        <Box
            className={className ? `card-note card-note--editing ${className}` : "card-note card-note--editing"}
            onMouseDown={stop}
            onTouchStart={stop}
            onTouchEnd={stop}
            onPointerDown={stop}
            onClick={stop}
            sx={{
                position: "absolute",
                left: 10,
                // Same berth as read mode: the editor must occupy the strip the note will
                // occupy, or the learner types it at a width it is never displayed at.
                right: CARD_OPS_DOT_GUTTER,
                top: 10,
                zIndex: 5,
                borderRadius: "10px",
                backgroundColor: "rgba(255,255,255,0.97)",
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
            }}
        >
            {/* Same leading icon as read mode, at the same offset — the strip must read as
                the SAME element gaining a caret, not as a different panel appearing over the
                card. Aligned to the first text line and inert, so a press on it goes to the
                textarea rather than stealing focus away from it. */}
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
                <Box
                    className="card-note__icon"
                    // Height of one line of the textarea's text, so the icon sits on the
                    // first line rather than on the box's vertical center.
                    sx={{ flexShrink: 0, display: "flex", alignItems: "center", height: "1.35em", pointerEvents: "none" }}
                >
                    <Icon name="sticky_note_2" size={14} color={COLORS.textSecondary} />
                </Box>
                <Box
                    component="textarea"
                    ref={inputRef}
                    className="card-note__input"
                    aria-label="Card note"
                    placeholder="Add a note about this card…"
                    value={draft}
                    // Hard cap at the shared constant. maxLength stops the keystroke, so the
                    // learner never types text the server would silently truncate.
                    maxLength={CARD_NOTE_MAX_LENGTH}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBeforeInput={onBeforeInput}
                    // Relabels the phone keyboard's confirm key from "return" to "Done", so the
                    // key that now saves the note looks like the key that saves the note.
                    enterKeyHint="done"
                    sx={{
                        // Flex child next to the icon: grow into the remaining width, and
                        // minWidth:0 so long unbroken text cannot push the box wider.
                        flex: 1,
                        minWidth: 0,
                        boxSizing: "border-box",
                        resize: "none",
                        border: "none",
                        outline: "none",
                        backgroundColor: "transparent",
                        fontFamily: FC_FONT,
                        fontSize: SIZE.caption,
                        lineHeight: LEADING.normal,
                        color: COLORS.onSurface,
                        // Text is app-wide user-select:none (CLAUDE.md "Touch & Scroll"); an
                        // input the learner is typing into is an explicit exception, or they
                        // cannot place a caret or select what they wrote.
                        userSelect: "text",
                        WebkitUserSelect: "text",
                        minHeight: "3.4em",
                        maxHeight: "5.2em",
                        overflowY: "auto",
                    }}
                />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Box
                    component="span"
                    className="card-note__counter"
                    sx={{
                        fontFamily: FC_FONT,
                        fontSize: SIZE.micro,
                        // Turns red on the last stretch so the cap is visible BEFORE the
                        // keystroke that silently does nothing.
                        color: remaining <= 20 ? COLORS.dangerInk : COLORS.textSecondary,
                        marginRight: "auto",
                    }}
                >
                    {draft.length}/{CARD_NOTE_MAX_LENGTH}
                </Box>
                <Box
                    component="button"
                    type="button"
                    aria-label="Cancel note"
                    className="card-note__cancel"
                    onClick={(e: React.MouseEvent) => { stop(e); onCancel?.(); }}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: COLORS.card,
                        borderRadius: "999px",
                        width: 28,
                        height: 28,
                        padding: 0,
                    }}
                >
                    <Icon name="close" size={16} color={COLORS.onSurface} />
                </Box>
                <Box
                    component="button"
                    type="button"
                    aria-label="Save note"
                    className="card-note__save"
                    onClick={(e: React.MouseEvent) => { stop(e); commit(); }}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        cursor: "pointer",
                        backgroundColor: COLORS.onSurface,
                        borderRadius: "999px",
                        width: 28,
                        height: 28,
                        padding: 0,
                    }}
                >
                    <Icon name="check" size={16} color={COLORS.white} />
                </Box>
            </Box>
        </Box>
    );
};

export default CardNote;
