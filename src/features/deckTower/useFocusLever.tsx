import React, { useEffect, useState } from "react";
import { setFocusMode } from "../../api/focusMode";
import { FOCUS_LEVER_THRESHOLD } from "../../../server/contracts/focusMode";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import FocusDialog, { type FocusDialogContent } from "../focusMode/FocusDialog";
import { FOCUS_WORLD_NAMES } from "../focusMode/focusWorldNames";
import { TOWER_MODES, bandTotal } from "./towerModes";
import { useLeverMotion, type LeverMotion } from "./useLeverMotion";

/**
 * useFocusLever — one world's focus lever: when it shows, what tapping it does, and its
 * popup (docs/FOCUS_MODE.md § 5, docs/DECK_TOWER.md § "Focus lever").
 *
 * Layer: page logic (feature module `src/features/deckTower`). DeckTowerPage runs one per
 * world (like its ready counts), hands the world on screen's `lever` to DeckTowerPlatform
 * and renders every world's `dialog`.
 *
 *   Shows      while the world's Learn Now deck is up AND (focus is on, OR the world holds
 *              FOCUS_LEVER_THRESHOLD off-cooldown cards across all four bands — the same
 *              Mix total the tower stands, read before any focus narrowing).
 *   Tap, off   pulls it and opens "Turn on focus mode?". No → it springs back. Yes → focus
 *              goes on and it STAYS pulled.
 *   Tap, on    opens "Turn off focus mode?". Yes → it springs back; if the pile is now under
 *              the threshold it then recedes into the platform and the hatch shuts.
 *
 * After a flip the world's ready counts are re-read, so the tower stands the new figure.
 */

interface ReadyCountsLike {
    counts: Record<string, number>;
    loaded: boolean;
    focusOn: boolean;
    reload: () => void;
}

export interface FocusLever {
    lever: LeverMotion & { ariaLabel: string; onTap: () => void; busy: boolean };
    dialog: React.ReactElement;
}

export function useFocusLever({
    world,
    ready,
    learnNowShown,
    busy,
}: {
    world: MasteryWorldId;
    ready: ReadyCountsLike;
    /** The world's tower is showing its Learn Now deck (the lever is a Learn Now control). */
    learnNowShown: boolean;
    /** A swap, pan or mode switch is running: taps are ignored. */
    busy: boolean;
}): FocusLever {
    const [dialog, setDialog] = useState<"turn-on" | "turn-off" | null>(null);
    const [saving, setSaving] = useState(false);
    // The state just confirmed, held until the re-read counts agree, so the lever does not
    // flick back for the round trip.
    const [confirmedOn, setConfirmedOn] = useState<boolean | null>(null);
    useEffect(() => {
        if (confirmedOn !== null && ready.focusOn === confirmedOn) setConfirmedOn(null);
    }, [confirmedOn, ready.focusOn]);

    const focusOn = confirmedOn ?? ready.focusOn;
    // All four bands: the lever's threshold counts what the learner sees as assigned to them.
    const readyTotal = ready.loaded ? bandTotal(ready.counts, TOWER_MODES.mix.bands) : 0;
    // While focus is on, the counts are narrowed to today's remaining set (≤ 40), so they
    // cannot say whether the full pile still clears the threshold. Hold the lever up until
    // a just-confirmed flip's re-read lands (`confirmedOn` non-null): turning focus off
    // then either leaves it standing — a plain spring back, no sink-and-rise — or, if the
    // full pile is under the threshold, sinks it.
    const visible = ready.loaded && learnNowShown && (focusOn || confirmedOn !== null || readyTotal >= FOCUS_LEVER_THRESHOLD);
    // Held pulled while its own popup is up, as well as while focus is on.
    const motion = useLeverMotion({ visible, pulled: focusOn || dialog !== null });

    const onTap = () => {
        if (busy || saving || dialog) return;
        setDialog(focusOn ? "turn-off" : "turn-on");
    };

    const onConfirm = async () => {
        if (!dialog) return;
        const turnOn = dialog === "turn-on";
        setSaving(true);
        try {
            await setFocusMode(world, turnOn);
            setConfirmedOn(turnOn);
            ready.reload();
        } catch (err) {
            console.error("Focus mode switch failed:", err);
        } finally {
            setSaving(false);
            setDialog(null);
        }
    };

    const content: FocusDialogContent | null =
        dialog === "turn-on"
            ? { kind: "turn-on", world, readyCount: readyTotal }
            : dialog === "turn-off"
              ? { kind: "turn-off", world }
              : null;

    return {
        lever: {
            ...motion,
            ariaLabel: focusOn
                ? `Focus mode is on in the ${FOCUS_WORLD_NAMES[world]} world. Turn it off`
                : `Turn on focus mode in the ${FOCUS_WORLD_NAMES[world]} world`,
            onTap,
            busy: busy || saving || dialog !== null,
        },
        dialog: (
            <FocusDialog
                key={`focus-dialog-${world}`}
                content={content}
                onClose={() => !saving && setDialog(null)}
                onConfirm={onConfirm}
                busy={saving}
            />
        ),
    };
}
