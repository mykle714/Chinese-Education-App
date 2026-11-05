# Challenge help screenshots

The stepped explainer on View Challenge (docs/STUDY_CHALLENGE.md § 5.4a, design
F20/F21) takes one screenshot per step. Drop the files here with EXACTLY these
names — `challengeHelpSteps.ts` picks them up through `import.meta.glob` and hands them to the shared `SteppedHelpPopup`, so no code
change is needed:

## "How the test works" (the card's info button, F21)

| File | What it should show |
|---|---|
| `test-sequence.png` | The test card with its three rounds — the first playable, the rest locked |
| `test-submitted.png` | The round scoreboard, with the score banked in place of the Play button |
| `test-board.png` | A game board mid-round, with nothing marking which words are contested |

**Shape:** the slot is `3:4` and the image is `object-fit: cover`, so a portrait phone
capture fits without cropping anything important. `.png`, `.jpg`, `.jpeg` and `.webp`
are all picked up.

**Until a file exists** its step renders a hatched placeholder frame captioned with the
description above — the explainer is fully usable without them, and each one improves
independently as it lands.

The list of steps (and these descriptions) lives in
`src/features/studyChallenge/challengeHelpSteps.ts`.
