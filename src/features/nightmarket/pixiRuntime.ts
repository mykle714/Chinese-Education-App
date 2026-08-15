/**
 * PIXI runtime shim — import this FIRST in any module that mounts an
 * `<Application>` from `@pixi/react`.
 *
 * ── What it does ───────────────────────────────────────────────────────────────
 * `pixi.js/unsafe-eval` swaps PIXI's shader/uniform-group code generator for one
 * that builds functions without `new Function()`. PIXI's default path compiles
 * uniform upload functions at runtime via `eval`, which a strict CSP
 * (`script-src` without `'unsafe-eval'`) blocks — the renderer then fails at
 * first draw rather than at load. The shim must be evaluated BEFORE a renderer is
 * created, which is why it sits at the top of the import list in each viewer.
 *
 * ── Why it is not in src/main.tsx ──────────────────────────────────────────────
 * It used to be `src/main.tsx:1`. A static import in the entry module pins the
 * whole PIXI runtime into the main bundle for EVERY user, including the majority
 * who never open the Night Market, and it defeats code-splitting of the viewers
 * downstream: the lazy chunk boundary is meaningless once the entry module has
 * already pulled the library in.
 *
 * That also contradicted the stated purpose of the routes/registry ÷ routeMeta
 * split (see `src/routes/routeMeta.ts`), which exists precisely to keep PIXI out
 * of consumers' module graphs — main.tsx then undid it globally.
 *
 * Importing it here instead means PIXI enters the graph only through the four
 * modules that actually construct a renderer, all of which are reached via
 * lazily-loaded routes.
 *
 * ── Importers ──────────────────────────────────────────────────────────────────
 * The four modules that render `<Application>`:
 *   MarketEngineViewer.tsx, TemplateEditorViewer.tsx,
 *   TemplateSandboxViewer.tsx, TemplateLoadGallery.tsx
 *
 * A module that only renders PIXI *children* (layers such as PedestrianLayer or
 * GroundBackdropLayer) does not need it — it can only mount inside one of the
 * four above, which has already applied the shim.
 *
 * Repeat imports are free: ES modules evaluate once.
 *
 * See docs/REACT_NATIVE_MIGRATION.md § Action items, Tier 1 item 1.
 */
import 'pixi.js/unsafe-eval'
