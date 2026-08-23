import { Box } from "@mui/material";
import { BoardRow } from "../../components/leaderboard/Board";
import { COLORS } from "../../theme/colors";
import { LANGUAGE_FLAGS } from "../../types";
import type { Language } from "../../types";
import type { ArenaEntry } from "../../api/arena";

/**
 * One row of the arena board (docs/ARENA_FEATURE.md § 2.1).
 *
 * Since the shelf redesign (docs/SHELF_REDESIGN.md § A7) this is a thin binding of the
 * shared `BoardRow` rather than its own layout: the rank column, the name/sub-line stack
 * and the score column are all the board's, and what is left here is only the arena's
 * mapping onto them.
 *
 * ── THE SUB-LINE IS THE COMPETITOR'S MESSAGE, AND THE METER IS GONE ──────────────────
 * The row used to draw a 74px bar of the score against the leader's. It was decoration:
 * the ranks are already sorted by that number and the number itself is on the row, so the
 * bar restated twice-known information in a third form — and on a board where the leader
 * runs away with it, every bar below the top read as a uniform stub.
 *
 * What sits there now is `message` — the one line each competitor writes about themselves
 * (§ 2.1a). It is the only thing on this board that is not derived from a score, which is
 * exactly why it earns the space: 25 rows of ranked minutes are 25 rows of the same fact,
 * and the messages are what makes them people.
 *
 * ⚠️ WHAT THIS ROW MAY SHOW IS A PRIVACY DECISION, NOT A LAYOUT ONE (Q20).
 * Name, message and score. An arena puts a learner in front of 24 strangers they did not
 * choose and cannot leave, so a streak here would expose their daily routine (including
 * the day they broke it) to people with no relationship to them. /friends can show more
 * because both parties opted into seeing each other. Adding a field means reopening that
 * question, not passing another prop.
 *
 * The message is the one exception, and only because it is AUTHORED: nothing appears in
 * it that the competitor did not choose to type. That also makes it the one field here
 * that needs moderation, which does not exist yet — see docs/DEFERRED_WORK.md.
 *
 * Note the avatar is gone rather than moved: `BoardRow` has no avatar slot at all, which
 * is the privacy decision made structural.
 *
 * ── THE FLAG IS WHICH LANGUAGE THEY ARE LEARNING, NOT WHERE THEY ARE ────────────────
 * Arenas are not language-scoped (§ 5.0) — the 25 members may be studying different
 * tracks, each scored in their own — so the flag answers a question the board otherwise
 * leaves open: is the person above me racing at Chinese or at Spanish? It leads the name
 * line rather than taking the sub-line back, because the message lives there now.
 *
 * It is the emoji, not an image: `LANGUAGE_FLAGS` is the app's one source for it, and on
 * Windows — which draws no flag glyph — the pair of Regional Indicator characters falls
 * back to the letters "CN"/"ES", which still identifies the language. An unknown language
 * (a value this client build does not know) contributes nothing rather than a tofu box.
 *
 * ⚠️ Note this is a flag for a LANGUAGE. It is a rough stand-in — Spanish is not Spain
 * for most of its speakers — and it says nothing about where the member is; location is
 * never displayed anywhere in this feature (§ 5.2).
 *
 * Synthetic members render EXACTLY like humans, with no marker of any kind — messages
 * included (they draw one from a pool by seed, and only some of them do, precisely so
 * that having one is not a tell). That is the entire point of padding; a visible "bot"
 * tag would tell a learner in a thin division that their competition is fake, which is
 * worse than the empty board padding prevents.
 */
export default function ArenaEntryRow({ entry }: { entry: ArenaEntry }) {
    // '' for a language this build does not know — rendered as nothing rather than as a
    // missing-glyph box.
    const flag = LANGUAGE_FLAGS[entry.language as Language] ?? "";
    return (
        <BoardRow
            className={`arena-page__row arena-page__row--${entry.zone}${entry.isViewer ? " arena-page__row--viewer" : ""}`}
            rank={entry.rank}
            name={
                <>
                    {flag && (
                        // Its own span rather than a prefix baked into the name string, so
                        // it can carry its own size: an emoji at the name's 13.5px/600 sits
                        // visually heavier than the letters beside it, and on Windows the
                        // fallback letters would otherwise render bold alongside the name.
                        <Box component="span" className="arena-page__row-flag" sx={{ fontSize: 11.5, marginRight: "6px" }}>
                            {flag}
                        </Box>
                    )}
                    {entry.name}
                </>
            }
            // Undefined, not "", when there is no message: an empty sub-line would
            // reserve its leading and make the row taller than its neighbours for no
            // visible reason.
            sublabel={entry.message ?? undefined}
            // Sans, not the slot's default mono: this is a sentence a person wrote.
            sublabelVariant="prose"
            // A zero is drawn, not hidden: "0 so far" is information, and a blank cell
            // would read as a rendering bug.
            score={entry.score.toLocaleString()}
            // The same flame the minute-points badge burns in every header, so the column
            // reads as "the points I watch tick up" with no caption. Kept in the badge's
            // own fireActive orange rather than the row ink — that colour IS the unit.
            scoreIcon="local_fire_department"
            scoreIconColor={COLORS.fireActive}
            highlighted={entry.isViewer}
            zone={entry.zone}
        />
    );
}
