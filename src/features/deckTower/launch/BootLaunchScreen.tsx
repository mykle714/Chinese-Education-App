import LaunchScreen, { LaunchSceneStill } from "./LaunchScreen";
import { launchLook } from "./launchLook";
import type { BootCoverRenderProps, BootSceneRenderProps } from "../../../hooks/useBootCover";

/**
 * BootLaunchScreen — the LaunchScreen as the app shell's boot cover draws it
 * (docs/LOGIN_REWORK.md § 1, docs/LAUNCH_SCREEN.md).
 *
 * Its own module so App.tsx can load it LAZILY: the scene pulls in the iso kit (through the
 * `../iso` barrel, towerWorlds, timeOfDay), which added ~75 kB to the main chunk when it was
 * imported statically. Until this chunk arrives the slot shows a plain ground in the same sky
 * colour (`src/components/bootCover/bootCoverGround.ts`), so nothing visibly changes when it lands.
 * `launchLook.test.ts` keeps that colour and `launchLook().world.sky` equal.
 *
 * Layer: feature page view (src/features/deckTower/launch). Lazily imported by App.tsx.
 */

/** The cover's look, fixed for the session: main's day sky in clear weather. */
const BOOT_LOOK = launchLook();

export default function BootLaunchScreen({ ready, onOpen, onDone }: BootCoverRenderProps) {
    return <LaunchScreen look={BOOT_LOOK} ready={ready} onOpen={onOpen} onDone={onDone} />;
}

/** The launch scene at rest, for the login screen (App.tsx → the boot-cover context's `renderScene`). */
export function BootSceneStill({ className, children, platformCentreRef }: BootSceneRenderProps) {
    return (
        <LaunchSceneStill look={BOOT_LOOK} className={className} platformCentreRef={platformCentreRef}>
            {children}
        </LaunchSceneStill>
    );
}
