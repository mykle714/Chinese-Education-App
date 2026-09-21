import { COLORS } from '../../theme/colors';

/**
 * iwListZebra — the one rule for how a LIST ITEM is grounded in the scene editor's menus
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature style helper. No state, no DOM — it returns `sx` fragments the panels
 * spread into whatever element already roots one item of a collection.
 *
 * WHY IT EXISTS. Every authoring panel in the editor is a stack of lists — cast, places,
 * complications, events, conversations, per-NPC action groups — and every one of them was
 * drawn on the column's single white ground, separated only by a hairline or by nothing at
 * all. The complaint that produced this file was not "an item is hard to find on the page",
 * it was "two ADJACENT items are hard to tell apart", which a uniform card fill does not
 * fix: give every item the same tint and neighbours still look identical. Alternating the
 * ground does fix it, because the boundary between two items is now a change in value rather
 * than a 1px line the eye has to hunt for.
 *
 * WHY GREY AND NOT THE RAMP. A hue cycling down a list reads as MEANING — the eye takes
 * `RAMP.red` on the third place to be saying something about that place — and nothing in
 * these lists is categorical. Two neutrals say only "this is a different row from the one
 * above", which is the entire message.
 *
 * EVERY LIST, AT EVERY DEPTH (2026-09-20). The fill was originally confined to the
 * outermost item of each list, on the theory that stacking striped surfaces would turn the
 * Actions and Places panels to mud. In practice the nested lists are where the adjacency
 * problem is WORST — two `steps` rows of an action, or two lines of a conversation, are a
 * select plus a text field repeated verbatim, with nothing but a 6px gap between them — and
 * the border/indent that was supposed to be "doing the separating" separates the nested list
 * from its PARENT, not one nested row from the next. So nested items stripe too, from the
 * same two grounds, via {@link iwZebraNestedItemSx}.
 *
 * The mud is avoided by the phase rather than by a third colour: a nested list restarts at
 * `white`, so the row that sits directly on its parent's ground is the one that MATCHES it
 * and simply disappears into it. At most two distinct values are ever on screen, however
 * deep the nesting goes.
 */

/**
 * The two grounds a list alternates between, in index order.
 *
 * `white` first so a list's FIRST item matches the column it sits in — the stripe then
 * reads as the second item stepping away from the first, rather than as the whole list
 * being a tinted block with a hole punched in it.
 */
export const IW_ZEBRA_GROUNDS = [COLORS.white, COLORS.header] as const;

/**
 * The ground for the item at `index` of a list.
 *
 * Takes the index rather than a boolean so a call site can pass the `map` index it already
 * has; the modulo is here instead of at seven call sites.
 */
export function iwZebraBg(index: number): string {
  return IW_ZEBRA_GROUNDS[index % IW_ZEBRA_GROUNDS.length];
}

/**
 * The full `sx` fragment for one item of a list: the alternating ground plus the corner
 * rounding and padding that make it read as a surface rather than as a colour accident.
 *
 * Spread it FIRST so an item that already has its own border, padding or margin keeps it —
 * the places and conversation items do, and those outlines are still worth having on top of
 * the stripe.
 */
export function iwZebraItemSx(index: number) {
  return {
    backgroundColor: iwZebraBg(index),
    borderRadius: 1,
    // Tight sides, roomier top and bottom: the step rows inside the Actions and Places
    // panels are the widest thing in the column, so horizontal padding is the expensive
    // kind. This matches the padding the action panel's NPC box already chose for itself.
    px: 0.75,
    py: 0.75,
  } as const;
}

/**
 * The `sx` fragment for one item of a list nested INSIDE another list's item (an action in
 * an NPC group, a step in an action or a place interaction, a line in a conversation).
 *
 * Same two grounds and the same index-phase as {@link iwZebraItemSx} — the nesting is
 * already carried by the parent's border or indent, so the stripe does not need to say it
 * again — but with tighter padding. A nested row is the widest thing in the editor column
 * (a `kind` select plus a full-width field plus a delete button), so the 6px of side padding
 * the top-level fragment adds is the one kind of space these rows cannot spare.
 */
export function iwZebraNestedItemSx(index: number) {
  return {
    backgroundColor: iwZebraBg(index),
    borderRadius: 1,
    px: 0.5,
    py: 0.5,
  } as const;
}
