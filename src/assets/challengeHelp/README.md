# Challenge help screenshots

The two stepped explainers on View Challenge (docs/STUDY_CHALLENGE.md § 5.4a, design
F20/F21) each take one screenshot per step. Drop the files here with EXACTLY these
names — `ChallengeHelpPopup` picks them up through `import.meta.glob`, so no code
change is needed:

## "How to study this deck" (the orange button, F20)

| File | What it should show |
|---|---|
| `study-shelf.png` | The flashcards shelf, with the challenge deck highlighted in the Challenges row |
| `study-learn.png` | The flashcards learn page mid-session, with the deck named in the header |
| `study-games.png` | A game's collection selector with the challenge deck picked as the source |

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
