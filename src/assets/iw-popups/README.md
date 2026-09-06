# iw popup art

Pictures a scene's **place interaction** can show the learner (`popup` step,
docs/IMMERSIVE_WORLD.md § 5.4a — a menu board, a price list, a notice on a door).

**To add one: drop the file in this folder.** That is the whole procedure — no code change,
no rebuild of a catalogue constant, no upload endpoint. `src/features/immersiveworld/iwPopupArt.ts`
globs this directory at build time, and the scene editor's picture picker lists whatever it
finds.

- **Accepted extensions:** `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`.
- **The FILE STEM is the id** that gets stored in `iw_scenes.interactions`, so it must match
  `IW_POPUP_IMAGE_ID` in `server/contracts/iw.ts`: start with a letter or digit, then letters,
  digits, `.`, `_` or `-`, at most 64 characters. `tea_menu.png` → the id `tea_menu`.
- **Renaming or deleting a file breaks the scenes that referenced its stem.** The reference is
  the stem, not the path, so the picture survives asset re-fingerprinting across builds — but
  nothing on the server can see this folder, so a removed file shows in the editor as a
  missing picture rather than as a save-time complaint. Prefer adding a new file.

This folder ships empty. Until art lands here the `popup` step is authorable but has nothing
to offer, and the editor says so.
