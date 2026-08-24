import React from "react";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/**
 * What "Allow anytime" actually does to the data, shown WHILE IT IS ON
 * (docs/STUDY_CHALLENGE.md § 2a).
 *
 * ⚠️ THIS IS NOT A DISCLAIMER, IT IS THE FEATURE'S DOCUMENTATION AT THE POINT OF USE.
 * The hatch lifts a calendar, and every consequence below is something a tester will
 * otherwise meet as a bug report against themselves: a library that grew twelve cards
 * they never sorted, a deck they did not make, a challenge dated three weeks out, a
 * friend who cannot accept, rounds that vanish when the switch goes off. All of them
 * are correct behaviour; none of them is guessable.
 *
 * Rendered only while the switch is ON — a permanent block would be wallpaper, and the
 * things it warns about only exist while the hatch is being used.
 *
 * Every line here is a statement about SHIPPED behaviour and was verified against the
 * server, not inferred. If one stops being true, fix it here in the same change.
 */

/** One caution. `detail` is the part a tester needs in order to act on it. */
const CAUTIONS: { label: string; detail: string }[] = [
    {
        label: "It writes real cards and a real deck",
        detail:
            "Accepting materialises all 12 words as Learn Now cards on BOTH accounts and creates a "
            + "\"vs <name>\" deck for each. The deck is dropped when that player finishes the test — "
            + "abandon the challenge instead and it stays on /decks.",
    },
    {
        label: "Rounds are real play",
        detail:
            "A challenge round writes normal typed marks and earns normal minute points and streak. "
            + "Test runs move your own mastery, and can put a word on cooldown.",
    },
    {
        label: "A repeat challenge is parked in a FUTURE week",
        detail:
            "One challenge per pair per week is a unique index, not just a rule, so a second "
            + "challenge to the same friend takes the pair's next free week. Its deadlines then read "
            + "as dates weeks out — ignore them — and that week is occupied for a genuine challenge "
            + "until the row is deleted. The FIRST one has to be finished before you can start "
            + "another with that friend: at most one unfinished challenge per pair is a data rule, "
            + "not a calendar one, and this switch does not lift it.",
    },
    {
        label: "It only covers what YOU do",
        detail:
            "It is spent per REQUEST, so it covers your own calls only: issuing, accepting, playing "
            + "your rounds. It is not attached to the challenge, so the other player's accept and "
            + "their own three rounds are judged against the real calendar unless they are also on a "
            + "validator account with this switched on in their own browser. A two-sided test "
            + "therefore needs two validator accounts and two switches — otherwise they are told the "
            + "time to accept has passed, or that their test window is not open.",
    },
    {
        label: "Switching it off hides an in-flight test",
        detail:
            "A parked challenge's test window is in the future, so with the switch off the server "
            + "withholds the game list and the Play buttons disappear. Rounds already submitted are "
            + "kept — switch it back on to carry on.",
    },
    {
        label: "The 6-challenge cap comes back with it",
        detail:
            "Challenges issued this way still count toward the cap, so a normal session can find "
            + "itself at \"you're in 6 challenges\" until they resolve or are deleted.",
    },
    {
        label: "On prod, parked challenges resolve themselves later",
        detail:
            "The hourly maintenance job expires or no-contests a challenge once its parked week "
            + "actually passes. Not installed on dev, where they sit until deleted.",
    },
];

const ChallengeAnytimeNotice: React.FC = () => (
    <Box
        className="challenges-page__anytime-notice"
        sx={{
            backgroundColor: COLORS.yellowAccent,
            border: `1px solid ${COLORS.warnInk}`,
            borderRadius: 3,
            px: 2,
            py: 1.25,
            display: "flex",
            flexDirection: "column",
            gap: 0.75,
        }}
    >
        <Typography
            className="challenges-page__anytime-notice-title"
            sx={{
                fontFamily: FONTS.sans,
                fontSize: SIZE.caption,
                fontWeight: WEIGHT.bold,
                color: COLORS.warnInk,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
            }}
        >
            While anytime is on
        </Typography>

        {CAUTIONS.map((caution) => (
            <Box key={caution.label} className="challenges-page__anytime-caution">
                <Typography
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.caption,
                        fontWeight: WEIGHT.semibold,
                        color: COLORS.onSurface,
                        lineHeight: LEADING.tight,
                    }}
                >
                    · {caution.label}
                </Typography>
                <Typography
                    sx={{
                        fontFamily: FONTS.sans,
                        fontSize: SIZE.micro,
                        color: COLORS.textSecondary,
                        lineHeight: LEADING.normal,
                        pl: 1.25,
                    }}
                >
                    {caution.detail}
                </Typography>
            </Box>
        ))}
    </Box>
);

export default ChallengeAnytimeNotice;
