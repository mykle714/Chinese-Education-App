/**
 * The data side of `SteppedHelpPopup` — the step shape, and the resolver that turns a
 * step's filename into a bundled image URL.
 *
 * Separate from the component file because this repo lints for `react-refresh`'s
 * only-export-components rule: a module that exports both a component and a function
 * breaks Fast Refresh for every importer of it.
 */
/** One step: an image, a heading over it, and one instruction under it. */
export interface HelpStep {
    /** The line over the image — what this step is about. */
    heading: string;
    /** Filename within the OWNING FEATURE's screenshot folder. */
    shot: string;
    /** What the shot should show, used as the placeholder caption until it exists. */
    shotDescription: string;
    /** The instruction under the image. May contain `{token}` placeholders. */
    title: string;
    body: string;
}

/**
 * Build a filename → URL resolver over a feature's own screenshot folder.
 *
 * ⚠️ THE `import.meta.glob` CALL CANNOT LIVE HERE. Vite requires a literal pattern at
 * the call site and resolves it relative to THAT file, so a shared component physically
 * cannot glob each feature's assets. Each feature globs its own folder and passes the
 * result in; this helper is the shared half — the matching and the `undefined` fallback.
 *
 * A step naming a file that does not exist yet resolves to `undefined` and renders the
 * placeholder frame, which is why an explainer is usable before its screenshots exist.
 */
export function makeShotResolver(
    shots: Record<string, { default: string }>
): (filename: string) => string | undefined {
    return (filename) =>
        Object.entries(shots).find(([path]) => path.endsWith(`/${filename}`))?.[1].default;
}
