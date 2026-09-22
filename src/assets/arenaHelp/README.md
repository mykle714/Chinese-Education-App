# Arena help screenshots

The three-step explainer on /arena (docs/ARENA_FEATURE.md § 2.4, design
`Arena Flow - Shelf System.html` A16/A17) takes one screenshot per step. Drop the files
here with EXACTLY these names — `arenaHelpSteps.ts` picks them up through
`import.meta.glob` and hands them to the shared `SteppedHelpPopup`, so no code change is
needed:

| File | What it should show |
|---|---|
| `arena-board.png` | The live board, with the green promotion line cutting across the rows |
| `arena-minutes.png` | The minute-points flame in a page header, ticking up during a study session |
| `arena-results.png` | The results card after a promotion, with the banner already on the new rung |

**Shape:** the slot is `3:4` and the image is `object-fit: cover`, so a portrait phone
capture fits without cropping anything important. `.png`, `.jpg`, `.jpeg` and `.webp`
are all picked up.

**Until a file exists** its step renders a hatched placeholder frame captioned with the
description above — the explainer is fully usable without them, and each one improves
independently as it lands.

⚠️ Unlike the Study Challenge explainers, this one **auto-opens on a learner's first
visit** to /arena, so its placeholder frames are seen by every new user rather than only
by someone who went looking for help. Worth capturing early.

The list of steps (and these descriptions) lives in
`src/features/arena/arenaHelpSteps.ts`.
